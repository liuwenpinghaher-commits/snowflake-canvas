import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_GROUPS,
  addEdge,
  adoptIntoCard,
  applySediment,
  createCard,
  createDocument,
  emptyArc,
  fieldGroups,
  mapGrade,
  mergeCards,
  outlineProgress,
  serializeDocument,
  setCardBody,
  type BookChapter,
  type Entity,
  type SedimentEvent,
} from '../src/document.ts'
import { parseCompleteDocument } from '../src/persist.ts'

const ARCHIVE_KEYS_BEFORE = [
  'bodyName',
  'age',
  'birthday',
  'height',
  'weight',
  'ethnicity',
  'hairEyes',
  'looks',
  'clothes',
  'humor',
  'personality',
  'religion',
  'politics',
  'hobbies',
  'taste',
  'favColor',
  'bag',
  'home',
  'education',
  'job',
  'family',
  'bestFriend',
  'maleFriends',
  'femaleFriends',
  'enemies',
  'bestMemory',
  'worstMemory',
  'traitLine',
  'strongest',
  'weakest',
  'paradox',
  'hope',
  'fear',
  'philosophy',
  'selfView',
  'othersView',
  'endingChange',
] as const

function open(document: unknown) {
  const parsed = parseCompleteDocument(new TextEncoder().encode(JSON.stringify(document)))
  expect(parsed).not.toBeNull()
  if (!parsed) throw new Error('文档没有打开')
  return parsed.state
}

function personEntity(id: string): Entity {
  return { id, entityType: 'person', name: '林晚', views: {}, fields: {}, arc: emptyArc(), premise: false }
}

function sediment(partial: Partial<SedimentEvent> & Pick<SedimentEvent, 'id' | 'requestId' | 'action' | 'quote'>): SedimentEvent {
  return {
    kind: 'manual',
    ideaId: 'idea',
    at: '2026-10-11T00:00:00.000Z',
    target: { entityType: 'person', entityId: 'p1', fieldKey: 'motivation' },
    status: 'written',
    ...partial,
  }
}

describe('切片 A 数据模型', () => {
  it('账本按追加、替换、否定折叠，同一 requestId 不重复折进字段', () => {
    let state = createDocument('fold')
    state = createCard(state, { id: 'idea', layer: 'situation', x: 0, y: 0, body: '卡片' })
    state = { ...state, entities: [personEntity('p1')] }

    state = applySediment(state, sediment({ id: 'a', requestId: 'ra', action: 'append', quote: '第一段', at: '2026-10-11T00:00:01.000Z' }))
    state = applySediment(state, sediment({ id: 'b', requestId: 'rb', action: 'append', quote: '第二段', at: '2026-10-11T00:00:02.000Z' }))
    expect(state.entities?.[0]?.fields.motivation?.value).toBe('第一段\n\n第二段')

    state = applySediment(state, sediment({ id: 'c', requestId: 'rc', action: 'replace', quote: '新句', at: '2026-10-11T00:00:03.000Z' }))
    expect(state.entities?.[0]?.fields.motivation?.value).toBe('新句')
    expect(state.sediment?.some((event) => event.quote === '第一段')).toBe(true)
    expect(state.sediment?.some((event) => event.quote === '第二段')).toBe(true)

    let negated = createDocument('negate')
    negated = { ...negated, entities: [personEntity('p1')] }
    negated = applySediment(negated, sediment({ id: 'old', requestId: 'rold', action: 'append', quote: '被否定的句子', at: '2026-10-11T00:00:01.000Z' }))
    negated = applySediment(negated, sediment({ id: 'no', requestId: 'rno', action: 'negate', quote: '被否定的句子', at: '2026-10-11T00:00:02.000Z' }))
    expect(negated.entities?.[0]?.fields.motivation?.value.includes('被否定的句子')).toBe(false)
    expect(negated.sediment?.find((event) => event.id === 'old')?.superseded).toBe(true)
    expect(negated.sediment?.find((event) => event.id === 'no')).toBeTruthy()

    const once = applySediment(
      { ...createDocument('retry'), entities: [personEntity('p1')] },
      sediment({ id: 'once', requestId: 'same', action: 'append', quote: '只记一次' }),
    )
    const twice = applySediment(once, sediment({ id: 'again', requestId: 'same', action: 'append', quote: '只记一次' }))
    expect(twice).toBe(once)
    expect(twice.entities?.[0]?.fields.motivation?.value).toBe('只记一次')
    expect(twice.sediment).toHaveLength(1)
  })

  it('addEdge 拒绝非法组合并返回原来的 state', () => {
    let state = createDocument('edges')
    state = createCard(state, { id: 'idea', layer: 'situation', x: 0, y: 0, body: '卡片' })
    state = createCard(state, { id: 'scene', layer: '场景表', x: 20, y: 0, fields: { title: '门口' } })
    state = createCard(state, { id: 'beat', layer: 'changci', x: 40, y: 0, fields: { task: '问一句' } })
    state = { ...state, entities: [personEntity('ent-person')] }

    expect(addEdge(state, 'idea', 'ent-person', 'appears-in')).toBe(state)
    expect(addEdge(state, 'scene', 'ent-person', 'projects-onto')).toBe(state)
    expect(state.canvas.edges).toHaveLength(0)
    expect(state.sediment).toEqual([])

    const linked = addEdge(state, 'beat', 'ent-person', 'appears-in')
    expect(linked).not.toBe(state)
    expect(linked.canvas.edges.map((edge) => edge.kind)).toEqual(['appears-in'])
    expect(linked.sediment).toEqual([])
    expect(linked.entities?.[0]?.fields).toEqual({})
  })

  it('同名人物卡归并后，事件改挂到留下的卡，被并卡不在画布上', () => {
    let state = createDocument('merge')
    state = createCard(state, { id: 'keep', layer: 'renwubiao', x: 0, y: 0, fields: { name: '奈德' } })
    state = createCard(state, { id: 'drop', layer: 'renwubiao', x: 40, y: 0, fields: { name: '奈德' } })
    state = createCard(state, { id: 'other', layer: 'situation', x: 80, y: 0, body: '另一条卡片' })
    state = setCardBody(state, 'keep', '留下的正文')
    state = setCardBody(state, 'drop', '被并的正文')
    state = {
      ...state,
      snowflake: {
        ...state.snowflake,
        cards: {
          ...state.snowflake.cards,
          drop: { ...state.snowflake.cards.drop!, premise: true },
          other: { ...state.snowflake.cards.other!, premise: true },
        },
      },
      canvas: {
        ...state.canvas,
        edges: [
          ...state.canvas.edges,
          { id: 'rel-1', fromNode: 'drop', toNode: 'other', kind: 'relates', relation: '冲突' },
        ],
      },
      sediment: [
        sediment({
          id: 'ev-1',
          requestId: 'req-1',
          action: 'append',
          quote: '他想回家',
          ideaId: 'drop',
          target: { entityType: 'person', entityId: 'drop', fieldKey: 'motivation' },
        }),
      ],
    }

    const next = mergeCards(state, 'keep', ['drop'])
    expect(next.snowflake.cards.drop).toBeUndefined()
    expect(next.canvas.nodes.some((node) => node.id === 'drop')).toBe(false)
    expect(next.snowflake.cards.keep?.mergeNote).toBe('drop')
    expect(next.snowflake.cards.keep?.body).toBe('留下的正文\n\n被并的正文')
    expect(next.snowflake.cards.keep?.premise).toBe(true)
    expect(next.snowflake.cards.other?.premise).toBeUndefined()
    expect(next.sediment).toHaveLength(1)
    expect(next.sediment?.[0]?.id).toBe('ev-1')
    expect(next.sediment?.[0]?.requestId).toBe('req-1')
    expect(next.sediment?.[0]?.ideaId).toBe('keep')
    expect(next.sediment?.[0]?.target.entityId).toBe('keep')
    expect(next.canvas.edges.some((edge) => edge.fromNode === 'keep' && edge.toNode === 'other' && edge.kind === 'relates')).toBe(true)
  })

  it('正文四步：空正文抄入卡片，两边不同则标分叉且两份都留着', () => {
    const copied = open({
      canvas: { nodes: [], edges: [] },
      snowflake: {
        fileId: 'prose-copy',
        cards: {
          draft: { layer: '正文草稿', body: '卡上的正文', fields: {}, derivedFrom: 'scene-1' },
        },
      },
      chapters: [
        {
          id: 'ch-1',
          title: '第一章',
          scenes: [{ id: 'scene-1', title: '门口', ideaIds: [], prose: '', beatIds: [] }],
        },
      ],
    })
    expect(copied.chapters?.[0]?.scenes[0]?.prose).toBe('卡上的正文')
    expect(copied.snowflake.cards.draft?.body).toBe('')

    const kept = open({
      canvas: { nodes: [], edges: [] },
      snowflake: {
        fileId: 'prose-keep',
        cards: {
          draft: { layer: '正文草稿', body: '', fields: {}, derivedFrom: 'scene-1' },
        },
      },
      chapters: [
        {
          id: 'ch-1',
          title: '第一章',
          scenes: [{ id: 'scene-1', title: '门口', ideaIds: [], prose: '场上的正文', beatIds: [] }],
        },
      ],
    })
    expect(kept.chapters?.[0]?.scenes[0]?.prose).toBe('场上的正文')
    expect(kept.chapters?.[0]?.scenes[0]?.proseFork).toBeUndefined()
    expect(kept.snowflake.cards.draft?.body).toBe('')

    const forked = open({
      canvas: { nodes: [], edges: [] },
      snowflake: {
        fileId: 'prose-fork',
        cards: {
          draft: { layer: '正文草稿', body: '卡上的另一份', fields: {}, derivedFrom: 'scene-1' },
        },
      },
      chapters: [
        {
          id: 'ch-1',
          title: '第一章',
          scenes: [{ id: 'scene-1', title: '门口', ideaIds: [], prose: '场上的正文', beatIds: [] }],
        },
      ],
    })
    expect(forked.chapters?.[0]?.scenes[0]?.proseFork).toBe(true)
    expect(forked.chapters?.[0]?.scenes[0]?.prose).toBe('场上的正文')
    expect(forked.snowflake.cards.draft?.body).toBe('卡上的另一份')

    const pending = open({
      canvas: { nodes: [], edges: [] },
      snowflake: {
        fileId: 'prose-pending',
        cards: {
          draft: { layer: '正文草稿', body: '还在卡上', fields: {} },
        },
      },
      chapters: [{ id: 'ch-1', title: '第一章', scenes: [] }],
    })
    expect(pending.chapters?.[0]?.scenes).toEqual([])
    expect(pending.snowflake.cards.draft?.body).toBe('还在卡上')
    expect(pending.pendingProseScenes?.some((item) => item.cardId === 'draft')).toBe(true)
  })

  it('旧书没有 entities 和 sediment 时仍能打开，章场读出节拍、地点和分叉', () => {
    const old = open({
      canvas: { nodes: [], edges: [] },
      snowflake: { fileId: 'old-book', cards: { sit: { layer: 'situation', body: '还在', fields: {} } } },
    })
    expect(old.snowflake.cards.sit?.body).toBe('还在')
    expect(old.entities).toEqual([])
    expect(old.sediment).toEqual([])

    let state = createDocument('chapters')
    const chapters: BookChapter[] = [
      {
        id: 'ch-1',
        title: '第一章',
        scenes: [
          {
            id: 'scene-1',
            title: '门口',
            ideaIds: ['sit'],
            prose: '场上的正文',
            beatIds: ['beat-1'],
            placeEntityId: 'place-1',
            proseFork: true,
          },
          { id: 'scene-2', title: '空场', ideaIds: [], prose: '', beatIds: [] },
        ],
      },
    ]
    state = { ...state, chapters }
    const again = open(serializeDocument(state))
    expect(again.chapters?.[0]?.scenes[0]).toMatchObject({
      beatIds: ['beat-1'],
      placeEntityId: 'place-1',
      proseFork: true,
      prose: '场上的正文',
      ideaIds: ['sit'],
    })
    expect(outlineProgress(again.chapters)).toEqual({ filled: 1, total: 2 })
  })

  it('三种人物卡按同名归到一个实体的三视图，philosophy 只镜像动机', () => {
    const state = open({
      canvas: { nodes: [], edges: [] },
      snowflake: {
        fileId: 'person-views',
        cards: {
          table: { layer: 'renwubiao', body: '', fields: { name: '奈德', motivation: '想证明自己' } },
          story: { layer: 'renwugushi', body: '', fields: { who: '奈德', story: '从他眼里看' } },
          dossier: { layer: 'renwudangan', body: '', fields: { bodyName: '奈德', philosophy: '另一套人生' } },
        },
      },
    })
    expect(state.snowflake.cards.table).toBeTruthy()
    expect(state.snowflake.cards.story).toBeTruthy()
    expect(state.snowflake.cards.dossier).toBeTruthy()
    expect(state.entities).toHaveLength(1)
    expect(state.entities?.[0]?.views).toEqual({ renwubiao: 'table', renwugushi: 'story', renwudangan: 'dossier' })
    expect(state.entities?.[0]?.fields.philosophy).toBeUndefined()
    expect(state.entities?.[0]?.fields.motivation?.value).toBe('想证明自己')
    expect(state.snowflake.cards.dossier?.fields.philosophy).toBe('想证明自己')
    expect(state.entities?.[0]?.arc).toEqual(emptyArc())
  })

  it('类别在加载时映射，采纳进卡不写账本', () => {
    const state = open({
      canvas: { nodes: [], edges: [] },
      snowflake: {
        fileId: 'grades',
        cards: {
          empty: { layer: 'renwubiao', body: '', fields: { name: '甲', grade: '' } },
          lead: { layer: 'renwubiao', body: '', fields: { name: '乙', grade: '主角' } },
          main: { layer: 'renwubiao', body: '', fields: { name: '丙', grade: '主要' } },
          side: { layer: 'renwubiao', body: '', fields: { name: '丁', grade: '配角' } },
          minor: { layer: 'renwubiao', body: '', fields: { name: '戊', grade: '次要' } },
          npc: { layer: 'renwubiao', body: '', fields: { name: '己', grade: '隐藏NPC' } },
          extra: { layer: 'renwubiao', body: '', fields: { name: '庚', grade: '龙套' } },
        },
      },
    })
    expect(state.snowflake.cards.empty?.fields.grade).toBe('主要')
    expect(state.snowflake.cards.lead?.fields.grade).toBe('主要')
    expect(state.snowflake.cards.main?.fields.grade).toBe('主要')
    expect(state.snowflake.cards.side?.fields.grade).toBe('次要')
    expect(state.snowflake.cards.minor?.fields.grade).toBe('次要')
    expect(state.snowflake.cards.npc?.fields.grade).toBe('NPC')
    expect(state.snowflake.cards.extra?.fields.grade).toBe('路人')
    expect(mapGrade('')).toBe('主要')

    let adopted = createDocument('adopt')
    adopted = createCard(adopted, { id: 'scene', layer: '场景表', x: 0, y: 0, fields: { what: '雪还没停' } })
    const before = adopted.sediment ?? []
    const nextBody = `${adopted.snowflake.cards.scene?.body ?? ''}\n门外那个人是弟弟`
    adopted = adoptIntoCard(adopted, 'scene', nextBody, 'what')
    expect(adopted.snowflake.cards.scene?.fields.adopted).toContain('门外那个人是弟弟')
    expect(adopted.sediment ?? []).toEqual(before)
  })

  it('档案五组的 key 与改前逐字相同', () => {
    const keys = ARCHIVE_GROUPS.flatMap((group) => [...group.keys])
    expect(keys).toEqual([...ARCHIVE_KEYS_BEFORE])
    expect(new Set(keys).size).toBe(37)
    expect(fieldGroups('renwudangan')?.map((group) => group.title)).toEqual([
      '身体 · 埃格里·生理',
      '性格 · 埃格里·社会',
      '环境 · 埃格里·社会',
      '心理 · 埃格里·心理',
      '结局',
    ])
    expect(fieldGroups('renwudangan')?.flatMap((group) => [...group.keys])).toEqual([...ARCHIVE_KEYS_BEFORE])
  })
})
