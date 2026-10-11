import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { messageIndexForAdoption } from '../src/CardDiscuss.tsx'
import {
  createCard,
  createDocument,
  emptyArc,
  type BookChapter,
  type BookScene,
  type CanvasEdge,
  type Entity,
  type SedimentEvent,
} from '../src/document.ts'
import {
  MANY_PERSONS_HINT,
  createPersonEntity,
  defaultSedimentTarget,
  discussPrompt,
  formatGrowthLine,
  traceIdeaFields,
} from '../src/person-form.ts'
import { documentToBytes, mergeDocuments, parseCompleteDocument } from '../src/persist.ts'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function person(id: string, name: string): Entity {
  return { id, entityType: 'person', name, views: {}, fields: {}, arc: emptyArc(), premise: false }
}

function place(id: string, name: string): Entity {
  return { id, entityType: 'place', name, views: {}, fields: {}, arc: emptyArc(), premise: false }
}

function project(from: string, to: string): CanvasEdge {
  return { id: `e-${from}-${to}`, fromNode: from, toNode: to, kind: 'projects-onto' }
}

function sediment(input: Partial<SedimentEvent> & Pick<SedimentEvent, 'id' | 'at' | 'target'>): SedimentEvent {
  return {
    requestId: input.id,
    kind: 'discuss',
    ideaId: 'idea',
    action: 'append',
    quote: '一句',
    status: 'written',
    ...input,
  }
}

function scene(id: string, prose: string, beatIds: string[], ideaIds: string[] = []): BookScene {
  return { id, title: id, ideaIds, prose, beatIds }
}

function chapter(id: string, scenes: BookScene[], title = id): BookChapter {
  return { id, title, scenes }
}

describe('返工 P1c', () => {
  it('第 1 步用同一场讨论里最近一笔还在的实体', () => {
    const entities = [person('p1', '奈德'), person('p2', '瑟曦')]
    const edges = [project('idea', 'p1'), project('idea', 'p2')]
    const events = [
      sediment({
        id: 'old',
        at: '2026-10-11T01:00:00.000Z',
        sessionId: 'sess',
        target: { entityType: 'person', entityId: 'p1', fieldKey: 'motivation' },
      }),
      sediment({
        id: 'new',
        at: '2026-10-11T02:00:00.000Z',
        sessionId: 'sess',
        target: { entityType: 'person', entityId: 'p2', fieldKey: 'goal' },
      }),
      sediment({
        id: 'dead',
        at: '2026-10-11T03:00:00.000Z',
        sessionId: 'sess',
        superseded: true,
        target: { entityType: 'person', entityId: 'p1', fieldKey: 'goal' },
      }),
    ]
    expect(defaultSedimentTarget({ sessionId: 'sess', ideaId: 'idea', sediment: events, entities, edges })).toEqual({
      step: 1,
      entityId: 'p2',
    })
    const gone = [
      sediment({
        id: 'missing',
        at: '2026-10-11T04:00:00.000Z',
        sessionId: 'sess',
        target: { entityType: 'person', entityId: 'gone', fieldKey: 'motivation' },
      }),
    ]
    expect(
      defaultSedimentTarget({
        sessionId: 'sess',
        ideaId: 'idea',
        sediment: gone,
        entities: [person('p1', '奈德')],
        edges: [project('idea', 'p1')],
      }),
    ).toEqual({ step: 2, entityId: 'p1' })
  })

  it('第 2 步只有一个人物投影时预选那个人', () => {
    expect(
      defaultSedimentTarget({
        sessionId: 'sess',
        ideaId: 'idea',
        sediment: [],
        entities: [person('p1', '奈德'), place('loc', '临冬城')],
        edges: [project('idea', 'p1'), project('idea', 'loc')],
      }),
    ).toEqual({ step: 2, entityId: 'p1' })
  })

  it('第 3 步人物多于一个时不预选，并给出先点一个的红字', () => {
    expect(
      defaultSedimentTarget({
        sessionId: 'sess',
        ideaId: 'idea',
        sediment: [],
        entities: [person('p1', '奈德'), person('p2', '瑟曦')],
        edges: [project('idea', 'p1'), project('idea', 'p2')],
      }),
    ).toEqual({ step: 3, hint: MANY_PERSONS_HINT, personIds: ['p1', 'p2'] })
  })

  it('第 4 步没有人物、只有一个地点时预选那个地点', () => {
    expect(
      defaultSedimentTarget({
        sessionId: 'sess',
        ideaId: 'idea',
        sediment: [],
        entities: [place('loc', '临冬城')],
        edges: [project('idea', 'loc')],
      }),
    ).toEqual({ step: 4, entityId: 'loc' })
  })

  it('第 5 步没有投影时改成新建人物，不改念头的采纳栏', () => {
    expect(
      defaultSedimentTarget({ sessionId: 'sess', ideaId: 'idea', sediment: [], entities: [], edges: [] }),
    ).toEqual({ step: 5 })
    let state = createDocument('new-person')
    state = createCard(state, { id: 'idea', layer: 'situation', x: 0, y: 0, body: '念头' })
    const card = state.snowflake.cards.idea
    state = {
      ...state,
      snowflake: {
        ...state.snowflake,
        cards: { ...state.snowflake.cards, idea: { ...card, fields: { ...card.fields, adopted: '原句' } } },
      },
    }
    const next = createPersonEntity(state, 'np', '')
    expect(next.snowflake.cards.idea?.fields.adopted).toBe('原句')
    expect(next.entities?.[0]).toMatchObject({ id: 'np', entityType: 'person', name: '' })
    expect(read('src/CardDiscuss.tsx')).toContain('defaultSedimentTarget(')
    expect(read('src/CardDiscuss.tsx')).toContain('onCreatePerson')
  })

  it('去讨论带上字段名做成的预填问题', () => {
    expect(discussPrompt('epiphany')).toBe('顿悟这一栏空着，接着谈')
    expect(read('src/CastPage.tsx')).toContain('discussPrompt(fieldKey)')
  })

  it('正向清单出现实体·字段，点击要带上实体和字段', () => {
    let state = createDocument('growth')
    state = createCard(state, { id: 'idea-12', layer: 'situation', x: 0, y: 0, body: '奈德与小指头' })
    state = { ...state, entities: [person('p1', '奈德')] }
    state = {
      ...state,
      sediment: [
        sediment({
          id: 'e1',
          at: '2026-10-11T14:02:00.000Z',
          ideaId: 'idea-12',
          target: { entityType: 'person', entityId: 'p1', fieldKey: 'motivation' },
        }),
      ],
    }
    const hits = traceIdeaFields(state, 'idea-12')
    expect(hits).toEqual([{ entityId: 'p1', fieldKey: 'motivation' }])
    const line = formatGrowthLine(state, hits[0]!)
    expect(line.label).toContain('奈德·动机')
    expect(line).toMatchObject({ entityId: 'p1', fieldKey: 'motivation' })
    const side = read('src/SideEditor.tsx')
    expect(side).toContain('traceIdeaFields(')
    expect(side).toContain('这条念头长出了什么')
    expect(side).toContain('onOpen(hit.entityId, hit.fieldKey)')
    expect(read('src/CastPage.tsx')).toContain('data-field-focus')
  })

  it('采纳定位用正文或下标对上消息，找不到不假装定位成功', () => {
    const messages = [
      { content: '问', adopted: false },
      { content: '别的', adopted: true, serverKey: 'k-other' },
      { content: '荣誉不是筹码', adopted: true, serverKey: 'k1' },
    ]
    expect(messageIndexForAdoption(messages, { found: true, text: '荣誉不是筹码', index: 0, adoptionKey: 'nope' })).toBe(2)
    expect(messageIndexForAdoption(messages, { found: true, index: 0, adoptionKey: 'nope' })).toBe(1)
    expect(messageIndexForAdoption(messages, { found: true, adoptionKey: 'k1', index: 9 })).toBe(2)
    expect(messageIndexForAdoption(messages, { found: false, text: '荣誉不是筹码', index: 0 })).toBe(-1)
    expect(read('src/CardDiscuss.tsx')).toContain('data-adoption-focus')
    const http = read('server/http.mjs')
    expect(http).toContain('locateAdoption(')
    expect(http).toContain("'/discuss/adoption'")
  })

  it('不同场的节拍合并后都在，同一场正文冲突留着远端句子', () => {
    const base = [chapter('c1', [scene('s1', '原来', ['a0']), scene('s2', '原来', ['b0'])])]
    const local = [chapter('c1', [scene('s1', '原来', ['a0', 'a1']), scene('s2', '原来', ['b0'])])]
    const remote = [
      chapter('c1', [scene('s1', '原来', ['a0']), scene('s2', '原来', ['b0', 'b1'])]),
      chapter('c-remote', [scene('s-remote', '只有远端', ['r1'])]),
    ]
    const beats = mergeDocuments(
      documentToBytes({ ...createDocument('ch'), chapters: base }),
      documentToBytes({ ...createDocument('ch'), chapters: remote }),
      documentToBytes({ ...createDocument('ch'), chapters: local }),
    )
    expect(beats.kind).toBe('merged')
    if (beats.kind !== 'merged') return
    const chapters = parseCompleteDocument(beats.bytes)?.state.chapters ?? []
    expect(chapters.find((item) => item.id === 'c1')?.scenes.find((item) => item.id === 's1')?.beatIds).toEqual(['a0', 'a1'])
    expect(chapters.find((item) => item.id === 'c1')?.scenes.find((item) => item.id === 's2')?.beatIds).toEqual(['b0', 'b1'])
    expect(chapters.some((item) => item.id === 'c-remote')).toBe(true)
    expect(beats.conflicts).toEqual([])

    const prose = mergeDocuments(
      documentToBytes({ ...createDocument('ch'), chapters: [chapter('c1', [scene('s1', '原来', [])])] }),
      documentToBytes({ ...createDocument('ch'), chapters: [chapter('c1', [scene('s1', '远端句子', [])])] }),
      documentToBytes({ ...createDocument('ch'), chapters: [chapter('c1', [scene('s1', '本地句子', [])])] }),
    )
    expect(prose.kind).toBe('merged')
    if (prose.kind !== 'merged') return
    expect(prose.conflicts.length).toBeGreaterThan(0)
    const record = prose.conflicts.find((item) => item.cardId.startsWith('chapter-prose:'))
    expect(record).toBeTruthy()
    const detail = JSON.parse(record?.serverKey ?? '{}') as { sceneId?: string; remote?: string; local?: string }
    expect(detail.sceneId).toBe('s1')
    expect(detail.remote).toBe('远端句子')
    expect(detail.local).toBe('本地句子')
    expect(parseCompleteDocument(prose.bytes)?.state.chapters?.[0]?.scenes[0]?.prose).toBe('本地句子')
  })

  it('只有远端有的待写场还在，同一条内容不同则冲突里留着远端', () => {
    const kept = mergeDocuments(
      documentToBytes({ ...createDocument('pend'), pendingProseScenes: [] }),
      documentToBytes({ ...createDocument('pend'), pendingProseScenes: [{ cardId: 'draft-9', chapterHint: '第一章' }] }),
      documentToBytes({ ...createDocument('pend'), pendingProseScenes: [] }),
    )
    expect(kept.kind).toBe('merged')
    if (kept.kind !== 'merged') return
    expect(parseCompleteDocument(kept.bytes)?.state.pendingProseScenes).toEqual([{ cardId: 'draft-9', chapterHint: '第一章' }])

    const clash = mergeDocuments(
      documentToBytes({ ...createDocument('pend'), pendingProseScenes: [{ cardId: 'draft-1', chapterHint: '原来' }] }),
      documentToBytes({ ...createDocument('pend'), pendingProseScenes: [{ cardId: 'draft-1', chapterHint: '远端待写' }] }),
      documentToBytes({ ...createDocument('pend'), pendingProseScenes: [{ cardId: 'draft-1', chapterHint: '本地待写' }] }),
    )
    expect(clash.kind).toBe('merged')
    if (clash.kind !== 'merged') return
    const record = clash.conflicts.find((item) => item.cardId.startsWith('pending-prose:'))
    expect(JSON.parse(record?.serverKey ?? '{}')).toMatchObject({ cardId: 'draft-1', remote: '远端待写', local: '本地待写' })
    expect(parseCompleteDocument(clash.bytes)?.state.pendingProseScenes?.[0]?.chapterHint).toBe('本地待写')
    expect(read('src/persist.ts')).not.toContain('pickJson(base.state.chapters')
  })
})
