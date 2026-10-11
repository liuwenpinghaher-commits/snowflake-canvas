import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { hangSceneOnBeat, placeBeat, readBookBeats, setBeatLength } from '../src/chapter.ts'
import {
  CHANGCI_KEYS,
  LINK_KIND_LABEL,
  addEdge,
  appearanceDecision,
  cardFootnotes,
  chooseCanvasLink,
  commitCardText,
  confirmAppearance,
  createCard,
  createDocument,
  edgeAllowed,
  emptyArc,
  footnoteLine,
  legalEdgeKinds,
  markBookPremise,
  moveNode,
  outlineProgress,
  placeEntityOnCanvas,
  premiseMark,
  type AppState,
  type Entity,
  type SedimentEvent,
} from '../src/document.ts'
import { documentToBytes, mergeDocuments, parseCompleteDocument } from '../src/persist.ts'
import RelationPage from '../src/RelationPage.tsx'
import { ENTITY_COLORS, entityCanvasPaint } from '../src/relations.ts'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function person(id: string, name: string, premise = false): Entity {
  return { id, entityType: 'person', name, views: {}, fields: {}, arc: emptyArc(), premise }
}

function event(id: string, entityId: string, quote: string): SedimentEvent {
  return {
    id,
    requestId: `req-${id}`,
    kind: 'manual',
    ideaId: 'idea',
    at: '2026-10-11T00:00:00.000Z',
    target: { entityType: 'person', entityId, fieldKey: 'motivation' },
    action: 'append',
    quote,
    status: 'written',
  }
}

function openBytes(state: AppState) {
  const parsed = parseCompleteDocument(documentToBytes(state))
  expect(parsed).not.toBeNull()
  if (!parsed) throw new Error('文档没有打开')
  return parsed.state
}

describe('P1d 实体上画布、拖线、脚注、前提、出场', () => {
  it('标为全书前提后画布卡带前提徽标，再标另一张时旧徽标消失，同时只有一条 premise', () => {
    let state = createDocument('a5')
    state = createCard(state, { id: 'idea-winter', layer: 'situation', x: 0, y: 0, body: '凛冬将至' })
    state = createCard(state, { id: 'idea-other', layer: 'situation', x: 40, y: 0, body: '另一句' })
    state = { ...state, entities: [person('ned', '奈德', true)], sediment: [event('kept', 'ned', '原来的账')] }

    const marked = markBookPremise(state, 'idea-winter')
    expect(premiseMark(marked, 'idea-winter')).toBe('前提')
    expect(premiseMark(marked, 'idea-other')).toBeNull()
    expect(marked.snowflake.cards['idea-winter']?.premise).toBeFalsy()
    const themes = (marked.entities ?? []).filter((item) => item.premise)
    expect(themes).toHaveLength(1)
    expect(themes[0]).toMatchObject({
      id: 'premise:idea-winter',
      entityType: 'theme',
      premise: true,
    })
    expect(themes[0]?.fields.sentence?.value).toBe('凛冬将至')
    expect(marked.sediment).toEqual(state.sediment)
    expect((marked.entities ?? []).find((item) => item.id === 'ned')?.premise).toBe(false)

    const again = markBookPremise(marked, 'idea-other')
    expect(premiseMark(again, 'idea-winter')).toBeNull()
    expect(premiseMark(again, 'idea-other')).toBe('前提')
    expect((again.entities ?? []).filter((item) => item.premise)).toHaveLength(1)
    expect((again.entities ?? []).find((item) => item.id === 'premise:idea-winter')?.premise).toBe(false)
    expect((again.entities ?? []).find((item) => item.id === 'premise:idea-other')?.fields.sentence?.value).toBe('另一句')
    expect(again.sediment).toEqual(state.sediment)

    const flow = read('src/FlowCanvas.tsx')
    expect(flow).toContain('premise-badge')
    expect(flow).toContain('前提')
    expect(flow).toContain("premiseMark(documentState, node.id) === '前提'")
    expect(read('src/SideEditor.tsx')).toContain('标为全书前提')
  })

  it('念头拖到实体时合法选项含投影，确认后脚注是投影 1，边不往字段写字', () => {
    let state = createDocument('b8')
    state = createCard(state, { id: 'idea-ned', layer: 'situation', x: 0, y: 0, body: '奈德与小指头' })
    state = {
      ...state,
      entities: [
        {
          ...person('ned', '奈德'),
          fields: { motivation: { value: '守住临冬城', events: ['kept'] } },
        },
      ],
      sediment: [event('kept', 'ned', '守住临冬城')],
    }
    const beforeEntities = JSON.stringify(state.entities)
    const beforeSediment = JSON.stringify(state.sediment)

    const kinds = legalEdgeKinds(state, 'idea-ned', 'ned')
    expect(kinds).toContain('projects-onto')
    expect(LINK_KIND_LABEL['projects-onto']).toBe('投影')
    expect(kinds).not.toContain('grows-from')
    expect(kinds).not.toContain('appears-in')

    const linked = chooseCanvasLink(state, 'idea-ned', 'ned', 'projects-onto')
    expect(footnoteLine(linked, 'idea-ned')).toContain('投影 1')
    expect(footnoteLine(linked, 'idea-ned')).not.toContain('投影 0')
    const edge = linked.canvas.edges.find((item) => item.kind === 'projects-onto')
    expect(edge).toMatchObject({ fromNode: 'idea-ned', toNode: 'ned', sedimentEvents: [] })
    expect(edge?.label).toBeUndefined()
    expect(JSON.stringify(linked.entities)).toBe(beforeEntities)
    expect(JSON.stringify(linked.sediment)).toBe(beforeSediment)
    expect(linked.entities?.[0]?.fields.motivation?.value).toBe('守住临冬城')

    const app = read('src/App.tsx')
    expect(app).toContain('这条线是什么')
    expect(app).toContain('这两端不能连')
    expect(app).not.toContain('linkCards')
    const flow = read('src/FlowCanvas.tsx')
    expect(flow).toContain('strokeDasharray')
    expect(flow).toContain('sedimentEvents?.length ?? 0')
  })

  it('两端不能连时不写边，章节归属不进拖线面板', () => {
    let state = createDocument('illegal')
    state = createCard(state, { id: 'idea', layer: 'situation', x: 0, y: 0, body: '念头' })
    state = createCard(state, { id: 'beat', layer: 'changci', x: 20, y: 0, fields: { task: '进门' } })
    state = {
      ...state,
      entities: [person('ned', '奈德')],
      chapters: [{ id: 'ch-1', title: '第一章', scenes: [{ id: 'sc-1', title: '城门', ideaIds: [], prose: '', beatIds: [] }] }],
    }

    expect(legalEdgeKinds(state, 'ned', 'idea')).toEqual([])
    expect(chooseCanvasLink(state, 'ned', 'idea', 'grows-from')).toBe(state)
    expect(addEdge(state, 'ned', 'idea', 'grows-from')).toBe(state)
    expect(chooseCanvasLink(state, 'ned', 'idea', 'projects-onto')).toBe(state)

    expect(edgeAllowed(state, 'ch-1', 'sc-1', 'chapter-in')).toBe(true)
    expect((legalEdgeKinds(state, 'ch-1', 'sc-1') as readonly string[]).includes('chapter-in')).toBe(false)
    expect(edgeAllowed(state, 'sc-1', 'beat', 'chapter-in')).toBe(true)
    expect((legalEdgeKinds(state, 'sc-1', 'beat') as readonly string[]).includes('chapter-in')).toBe(false)

    const ideas = createCard(createCard(createDocument('pair'), { id: 'a', layer: 'situation', x: 0, y: 0, body: '甲' }), {
      id: 'b',
      layer: 'situation',
      x: 10,
      y: 0,
      body: '乙',
    })
    expect(legalEdgeKinds(ideas, 'a', 'b')).toEqual(['grows-from', 'relates', 'foreshadow'])
    const sceneToPerson = createCard(
      { ...createDocument('appear'), entities: [person('ned', '奈德')] },
      { id: 'beat', layer: 'changci', x: 0, y: 0, fields: { task: '进门' } },
    )
    expect(legalEdgeKinds(sceneToPerson, 'beat', 'ned')).toEqual(['appears-in'])
    const both = { ...createDocument('ents'), entities: [person('ned', '奈德'), { ...person('cat', '凯特琳'), entityType: 'person' as const }] }
    expect(legalEdgeKinds(both, 'ned', 'cat')).toEqual(['relates-entity'])
  })

  it('实体没放上画布时不造节点，放上之后是方形且颜色来自实体色', () => {
    let state = createDocument('place')
    state = createCard(state, { id: 'beat', layer: 'changci', x: 0, y: 0, fields: { task: '进门' } })
    state = { ...state, entities: [person('ned', '奈德'), person('jon', '琼恩')] }
    state = addEdge(state, 'beat', 'ned', 'appears-in')
    expect(state.canvas.nodes.some((node) => node.entityId)).toBe(false)
    expect(state.canvas.edges.some((edge) => edge.kind === 'appears-in')).toBe(true)

    const placed = placeEntityOnCanvas(state, 'ned', 12, 34)
    const node = placed.canvas.nodes.find((item) => item.entityId === 'ned')
    expect(node).toMatchObject({ id: 'entity:ned', type: 'text', x: 12, y: 34, width: 160, height: 160 })
    expect(placed.canvas.nodes.some((item) => item.entityId === 'jon')).toBe(false)
    const paint = entityCanvasPaint('person')
    expect(paint).toEqual({ shape: 'square', color: ENTITY_COLORS.person })
    const moved = moveNode(placed, 'entity:ned', 3, 4)
    expect(moved.canvas.nodes.find((item) => item.id === 'entity:ned')).toMatchObject({ x: 3, y: 4 })

    const back = openBytes(placed)
    expect(back.canvas.nodes.find((item) => item.entityId === 'ned')).toMatchObject({ id: 'entity:ned', type: 'text', x: 12, y: 34 })

    const flow = read('src/FlowCanvas.tsx')
    const flowNodes = flow.slice(flow.indexOf('const flowNodes'), flow.indexOf('const flowEdges'))
    expect(flowNodes).toContain('nodes.map')
    expect(flowNodes).toContain('node.entityId')
    expect(flowNodes).not.toContain('entities.map')
    const flowEdges = flow.slice(flow.indexOf('const flowEdges'), flow.indexOf('const onNodesChange'))
    expect(flowEdges).toContain('if (!source || !target) return []')
    expect(flowEdges).toContain('strokeWidth: 1')
    expect(flow).toContain('entityCanvasPaint(')
    expect(flow).toContain("shape: 'square'")
    expect(flow).not.toContain(ENTITY_COLORS.person)
    expect(read('src/CastPage.tsx')).toContain('放到画布')
    expect(read('src/CastPage.tsx')).toContain('place-entity:')
    expect(read('src/CastPage.tsx')).not.toContain('cardFootnotes')
    expect(read('src/CastPage.tsx')).not.toContain('snow-footnotes')
  })

  it('脚注只写真实段，四个词能跳到对应视图', () => {
    let state = createDocument('notes')
    state = createCard(state, { id: 'src', layer: 'situation', x: 0, y: 0, body: '#12' })
    state = createCard(state, { id: 'dst', layer: 'situation', x: 20, y: 0, body: '后一张\n还有一句' })
    state = createCard(state, { id: 'other', layer: 'situation', x: 40, y: 0, body: '旁边' })
    state = createCard(state, { id: 'beat', layer: 'changci', x: 60, y: 0, fields: { task: '进门' } })
    state = {
      ...state,
      entities: [person('ned', '奈德'), { ...person('winter', '临冬城'), entityType: 'place' }],
    }
    expect(footnoteLine(state, 'dst')).toBe('')

    state = addEdge(state, 'src', 'dst', 'grows-from')
    state = addEdge(state, 'dst', 'ned', 'projects-onto')
    state = addEdge(state, 'dst', 'other', 'relates', { relation: '互补' })
    expect(footnoteLine(state, 'dst')).toBe('生长自 #12 · 投影 1 · 关系 1 条')
    const ideaNotes = cardFootnotes(state, 'dst')
    expect(ideaNotes.map((item) => item.target)).toEqual([
      { view: 'card', cardId: 'src' },
      { view: 'relation', focusId: 'ned', mode: 'project' },
      { view: 'relation', focusId: 'other', mode: 'relate' },
    ])

    state = addEdge(state, 'beat', 'ned', 'appears-in')
    state = addEdge(state, 'beat', 'winter', 'appears-in')
    expect(footnoteLine(state, 'beat')).toBe('出场 2 场')
    expect(cardFootnotes(state, 'beat')[0]?.target).toEqual({ view: 'cast', entityId: 'ned' })

    state = placeEntityOnCanvas(state, 'ned')
    expect(footnoteLine(state, 'entity:ned')).toContain('出场 1 场')
    expect(cardFootnotes(state, 'entity:ned').find((item) => item.text.startsWith('出场'))?.target).toEqual({
      view: 'card',
      cardId: 'beat',
    })
  })

  it('场次视角填奈德并确认后建成出场，账本条数不变，对不上或重复都不另建', () => {
    let state = createDocument('b9')
    state = createCard(state, { id: 'beat', layer: 'changci', x: 0, y: 0, fields: { task: '进门' } })
    state = { ...state, entities: [person('ned', '奈德')], sediment: [event('kept', 'ned', '原来的账')] }
    expect(CHANGCI_KEYS).not.toContain('pov')

    const committed = commitCardText(state, 'beat', '奈德', 'pov', false)
    expect(committed.snowflake.cards.beat?.fields.pov).toBe('奈德')
    expect(committed.canvas.edges.some((edge) => edge.kind === 'appears-in')).toBe(false)
    expect(appearanceDecision(committed, 'beat', '奈德')).toEqual({
      kind: 'offer',
      cardId: 'beat',
      entityId: 'ned',
      name: '奈德',
    })
    expect(appearanceDecision(committed, 'beat', '琼恩')).toEqual({ kind: 'missing', name: '琼恩' })
    expect(confirmAppearance(committed, 'beat', 'missing-person')).toBe(committed)

    const next = confirmAppearance(committed, 'beat', 'ned')
    expect(next.canvas.edges.filter((edge) => edge.kind === 'appears-in' && edge.fromNode === 'beat' && edge.toNode === 'ned')).toHaveLength(1)
    expect(next.sediment).toEqual(committed.sediment)
    expect(appearanceDecision(next, 'beat', '奈德').kind).toBe('ignore')
    expect(confirmAppearance(next, 'beat', 'ned').canvas.edges.filter((edge) => edge.kind === 'appears-in')).toHaveLength(1)

    const app = read('src/App.tsx')
    expect(app).toContain('要不要建成出场？')
    expect(app).toContain('没有这个人')
    expect(read('src/SideEditor.tsx')).toContain('aria-label="视角"')
  })
})

describe('P1d 节拍表落盘', () => {
  it('挂场写入 chapters[].beats，读回仍在，换尺长不丢场，大纲进度不看格子数', () => {
    let state = createDocument('sheet')
    state = createCard(state, { id: 'c1', layer: 'changci', x: 0, y: 0, fields: { task: '进门' } })
    state = {
      ...state,
      chapters: [
        {
          id: 'ch-1',
          title: '第一章',
          scenes: [
            { id: 's1', title: '城门', ideaIds: [], prose: '', beatIds: [] },
            { id: 's2', title: '空场', ideaIds: [], prose: '', beatIds: [] },
          ],
        },
        {
          id: 'ch-2',
          title: '第二章',
          scenes: [{ id: 's3', title: '另一场', ideaIds: [], prose: '', beatIds: [] }],
        },
      ],
    }
    expect(state.chapters?.[0]?.beats).toBeUndefined()
    expect(readBookBeats(state.chapters)).toMatchObject({ length: 60 })
    expect(readBookBeats(state.chapters).slots.every((slot) => slot.sceneIds.length === 0)).toBe(true)
    expect(outlineProgress(state.chapters)).toEqual({ filled: 0, total: 3 })

    const hung = hangSceneOnBeat(state, 's1', 3)
    expect(hung.chapters?.[0]?.beats).toMatchObject({ length: 60 })
    expect(hung.chapters?.[0]?.beats?.slots[3]).toEqual(['s1'])
    expect(hung.chapters?.[1]?.beats?.slots[3]).toEqual(['s1'])
    expect(hung.chapters?.[0]?.scenes[0]?.beatIds).toEqual([])
    expect(outlineProgress(hung.chapters)).toEqual({ filled: 0, total: 3 })
    expect(outlineProgress(hung.chapters).total).not.toBe(hung.chapters?.[0]?.beats?.length)

    const shifted = hangSceneOnBeat(hung, 's1', 8)
    expect(shifted.chapters?.[0]?.beats?.slots[3]).toEqual([])
    expect(shifted.chapters?.[0]?.beats?.slots[8]).toEqual(['s1'])

    const back = openBytes(shifted)
    expect(back.chapters?.[0]?.beats?.slots[8]).toEqual(['s1'])
    expect(back.chapters?.[1]?.beats?.slots[8]).toEqual(['s1'])
    expect(back.chapters?.[0]?.scenes[0]?.beatIds).toEqual([])

    const resized = setBeatLength(shifted, 120)
    expect(resized.chapters?.[0]?.beats?.length).toBe(120)
    expect(resized.chapters?.[0]?.beats?.slots.flat().filter((id) => id === 's1')).toEqual(['s1'])
    expect(resized.chapters?.[1]?.beats?.slots.flat().filter((id) => id === 's1')).toEqual(['s1'])
    expect(resized.chapters?.[0]?.scenes[0]?.beatIds).toEqual([])
    expect(outlineProgress(resized.chapters).total).toBe(3)
    expect(outlineProgress(resized.chapters).total).not.toBe(120)

    const outlined = placeBeat(resized, 's1', 'c1')
    expect(outlined.chapters?.[0]?.scenes[0]?.beatIds).toEqual(['c1'])
    expect(outlined.chapters?.[0]?.beats?.slots.flat().filter((id) => id === 's1')).toEqual(['s1'])
    expect(outlineProgress(outlined.chapters)).toEqual({ filled: 1, total: 3 })
    expect(outlineProgress(outlined.chapters).total).not.toBe(outlined.chapters?.[0]?.beats?.length)

    const merged = mergeDocuments(documentToBytes(state), documentToBytes(state), documentToBytes(hung))
    expect(merged.kind).toBe('merged')
    if (merged.kind !== 'merged') return
    const mergedState = parseCompleteDocument(merged.bytes)?.state
    expect(mergedState?.chapters?.[0]?.beats?.slots[3]).toEqual(['s1'])

    const raw = JSON.parse(new TextDecoder().decode(documentToBytes(state))) as { chapters: Array<{ beats?: unknown; title: string }> }
    raw.chapters[0]!.beats = { length: 15, slots: [] }
    const bad = parseCompleteDocument(new TextEncoder().encode(JSON.stringify(raw)))
    expect(bad).not.toBeNull()
    expect(bad?.state.chapters?.[0]?.beats).toBeUndefined()
    expect(bad?.state.chapters?.[0]?.title).toBe('第一章')
    expect(readBookBeats(bad?.state.chapters).length).toBe(60)

    const page = read('src/ChapterPage.tsx')
    expect(page).toContain('hangSceneOnBeat')
    expect(page).toContain('setBeatLength')
    expect(page).not.toContain('useState(createBeatSheet')
  })
})

describe('P1d 关系图点击面板', () => {
  it('点实体看到定稿摘要和账本，点边看到说明', () => {
    let state = createDocument('panel')
    state = createCard(state, { id: 'beat', layer: 'changci', x: 0, y: 0, fields: { task: '进门' } })
    state = createCard(state, { id: 'idea', layer: 'situation', x: 20, y: 0, body: '奈德与小指头' })
    state = {
      ...state,
      entities: [
        {
          ...person('ned', '奈德'),
          fields: { motivation: { value: '守住临冬城', events: [] } },
        },
        { ...person('winter', '临冬城'), entityType: 'place', name: '临冬城' },
      ],
      sediment: [event('kept', 'ned', '账上这句话')],
    }
    state = addEdge(state, 'beat', 'ned', 'appears-in')
    state = addEdge(state, 'idea', 'ned', 'projects-onto')
    state = addEdge(state, 'idea', 'idea', 'grows-from')
    const project = state.canvas.edges.find((edge) => edge.kind === 'projects-onto')
    expect(project).toBeTruthy()
    state = {
      ...state,
      canvas: {
        ...state.canvas,
        edges: state.canvas.edges.map((edge) => (edge.id === project?.id ? { ...edge, sedimentEvents: ['kept'] } : edge)),
      },
    }
    const relateState = addEdge(
      createCard(createCard(state, { id: 'left', layer: 'situation', x: 0, y: 0, body: '左' }), {
        id: 'right',
        layer: 'situation',
        x: 10,
        y: 0,
        body: '右',
      }),
      'left',
      'right',
      'relates',
      { relation: '冲突' },
    )

    const nodeHtml = renderToStaticMarkup(
      createElement(RelationPage, { state, initialSelection: { kind: 'node', id: 'ned' } }),
    )
    expect(nodeHtml).toContain('定稿摘要')
    expect(nodeHtml).toContain('名字：奈德')
    expect(nodeHtml).toContain('守住临冬城')
    expect(nodeHtml).toContain('沉淀账本')
    expect(nodeHtml).toContain('账上这句话')
    expect(nodeHtml).toContain('打开人物页')
    expect(nodeHtml).toContain('打开百科页')

    const empty = {
      ...person('blank', ''),
      name: '',
      fields: {},
    }
    const emptyHtml = renderToStaticMarkup(
      createElement(RelationPage, {
        state: { ...createDocument('empty'), entities: [empty] },
        initialSelection: { kind: 'node', id: 'blank' },
      }),
    )
    expect(emptyHtml).toContain('还没有定稿')
    expect(emptyHtml).toContain('还没有沉淀')
    expect(emptyHtml).toContain('打开人物页')

    const placeHtml = renderToStaticMarkup(
      createElement(RelationPage, { state, initialSelection: { kind: 'node', id: 'winter' } }),
    )
    expect(placeHtml).toContain('定稿摘要')
    expect(placeHtml).toContain('名字：临冬城')
    expect(placeHtml).not.toContain('打开人物页')
    expect(placeHtml).toContain('打开百科页')
    expect(placeHtml).toContain('还没有沉淀')

    const appear = state.canvas.edges.find((edge) => edge.kind === 'appears-in')
    const appearHtml = renderToStaticMarkup(
      createElement(RelationPage, { state, initialSelection: { kind: 'edge', id: appear?.id ?? '' } }),
    )
    expect(appearHtml).toContain('<h3>出场</h3>')

    const relate = relateState.canvas.edges.find((edge) => edge.kind === 'relates' && edge.relation === '冲突')
    const relateHtml = renderToStaticMarkup(
      createElement(RelationPage, { state: relateState, initialSelection: { kind: 'edge', id: relate?.id ?? '' } }),
    )
    expect(relateHtml).toContain('<h3>冲突</h3>')

    const projectHtml = renderToStaticMarkup(
      createElement(RelationPage, { state, initialSelection: { kind: 'edge', id: project?.id ?? '' } }),
    )
    expect(projectHtml).toContain('<h3>投影</h3>')
    expect(projectHtml).toContain('账上这句话')

    const bareProject = chooseCanvasLink(
      createCard({ ...createDocument('bare'), entities: [person('ned', '奈德')] }, { id: 'idea', layer: 'situation', x: 0, y: 0, body: '念头' }),
      'idea',
      'ned',
      'projects-onto',
    )
    const bareEdge = bareProject.canvas.edges.find((edge) => edge.kind === 'projects-onto')
    const bareHtml = renderToStaticMarkup(
      createElement(RelationPage, { state: bareProject, initialSelection: { kind: 'edge', id: bareEdge?.id ?? '' } }),
    )
    expect(bareHtml).toContain('还没有沉淀')

    expect(read('src/RelationPage.tsx')).toContain('setOpen(null)')
    expect(read('src/App.tsx')).toContain('这一页下一刀才做。')
  })
})
