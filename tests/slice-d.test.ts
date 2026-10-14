import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ChapterPage from '../src/ChapterPage.tsx'
import {
  BEAT_LENGTHS,
  beatAnchors,
  createBeatSheet,
  placeBeat,
  resizeBeatSheet,
  sceneAppearanceNames,
} from '../src/chapter.ts'
import {
  RELATION_KINDS,
  addEdge,
  createCard,
  createDocument,
  emptyArc,
  outlineProgress,
  type AppState,
  type Entity,
  type EntityType,
  type RelationKind,
} from '../src/document.ts'
import RelationPage, {
  LOCAL_DEPTH_DEFAULT,
  LOCAL_DEPTH_MAX,
  NODE_SIZE_MAX,
  NODE_SIZE_MIN,
  localNeighborhood,
  mountRelationCy,
  nodeSizeForDegree,
} from '../src/RelationPage.tsx'
import {
  ENTITY_COLORS,
  buildRelationGraph,
  defaultRelationFilter,
  type RelationFilter,
  type RelationGraph,
  type RelationGroup,
} from '../src/relations.ts'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function entity(id: string, entityType: EntityType, name: string): Entity {
  return { id, entityType, name, views: {}, fields: {}, arc: emptyArc(), premise: false }
}

function groups(on: RelationGroup | null): RelationFilter['groups'] {
  return {
    'grows-from': on === 'grows-from',
    relates: on === 'relates',
    'projects-onto': on === 'projects-onto',
    'appears-in': on === 'appears-in',
    'relates-entity': on === 'relates-entity',
    foreshadow: on === 'foreshadow',
  }
}

describe('切片 D 关系图与章节', () => {
  it('默认只看设定物和出场、实体关系，打开卡片层后卡片和横向关系才出现', () => {
    let state = createDocument('dual')
    state = createCard(state, { id: 'idea-1', layer: 'situation', x: 0, y: 0, body: '门口的卡片' })
    state = createCard(state, { id: 'idea-2', layer: 'situation', x: 20, y: 0, body: '城里的卡片' })
    state = createCard(state, { id: 'beat', layer: 'changci', x: 40, y: 0, fields: { task: '进门' } })
    state = {
      ...state,
      entities: [entity('ent-person', 'person', '奈德'), entity('ent-place', 'place', '临冬城')],
    }
    state = addEdge(state, 'ent-person', 'ent-place', 'relates-entity')
    state = addEdge(state, 'beat', 'ent-person', 'appears-in')
    state = addEdge(state, 'idea-1', 'idea-2', 'relates', { relation: '冲突' })
    state = {
      ...state,
      canvas: {
        ...state.canvas,
        edges: [...state.canvas.edges, { id: 'dangling', fromNode: 'missing', toNode: 'also-missing', kind: 'relates-entity' }],
      },
    }

    const def = buildRelationGraph(state)
    expect(def.nodes.map((node) => node.layer)).toEqual(['entity', 'entity'])
    expect(def.nodes.map((node) => node.id)).toEqual(['ent-person', 'ent-place'])
    expect(def.nodes.find((node) => node.id === 'ent-person')).toMatchObject({
      shape: 'square',
      entityType: 'person',
      color: ENTITY_COLORS.person,
      label: '奈德',
    })
    expect(def.nodes.find((node) => node.id === 'ent-place')?.color).toBe(ENTITY_COLORS.place)
    expect(new Set(Object.values(ENTITY_COLORS)).size).toBe(Object.keys(ENTITY_COLORS).length)
    expect(read('src/RelationPage.tsx')).not.toContain(ENTITY_COLORS.person)
    expect(read('src/RelationPage.tsx')).toContain('node.color')
    const app = read('src/App.tsx')
    expect(app).toContain("page === 'encyclopedia'")
    expect(app).not.toContain('百科页还没做')
    expect(app).toContain('EncyclopediaPage')
    expect(app).not.toContain("page === 'relation' || page === 'encyclopedia' || page === 'chapter'")
    expect(def.edges.map((edge) => edge.kind).sort()).toEqual(['appears-in', 'relates-entity'])
    expect(def.edges.find((edge) => edge.kind === 'appears-in')).toMatchObject({
      from: 'beat',
      to: 'ent-person',
      label: '出场',
    })
    expect(def.edges.some((edge) => edge.kind === 'relates')).toBe(false)
    expect(def.edges.some((edge) => edge.id === 'dangling')).toBe(false)

    const opened = buildRelationGraph(state, { ...defaultRelationFilter(), ideaLayer: true })
    expect(opened.nodes.some((node) => node.id === 'idea-1' && node.layer === 'idea' && node.shape === 'circle')).toBe(true)
    expect(opened.nodes.some((node) => node.id === 'idea-2' && node.layer === 'idea')).toBe(true)
    expect(opened.edges.some((edge) => edge.kind === 'relates' && edge.relation === '冲突')).toBe(true)

    const html = renderToStaticMarkup(createElement(RelationPage, { state }))
    expect(html).toContain('卡片层')
    expect(html).toContain('生长派生')
    expect(html).toContain('横向关系')
    expect(html).toContain('投影边')
    expect(html).toContain('引用边')
    expect(html).toContain('实体关系')
    expect(html).toContain('伏笔线')
    expect(html).toContain('出场：奈德')
    expect(html).not.toContain('门口的卡片')
  })

  it('六组开关各自只放行对应 kind', () => {
    let state = createDocument('kinds')
    for (const id of ['ga', 'gb', 'ra', 'rb', 'fa', 'fb', 'pa']) {
      state = createCard(state, { id, layer: 'situation', x: 0, y: 0, body: id })
    }
    state = createCard(state, { id: 'beat', layer: 'changci', x: 0, y: 0, fields: { task: '问一句' } })
    state = {
      ...state,
      entities: [entity('ent-person', 'person', '奈德'), entity('ent-place', 'place', '临冬城')],
      chapters: [
        {
          id: 'ch-1',
          title: '第一章',
          scenes: [{ id: 'sc-1', title: '城门', ideaIds: [], prose: '', beatIds: [] }],
        },
      ],
    }
    state = addEdge(state, 'ga', 'gb', 'grows-from')
    state = addEdge(state, 'pa', 'ent-person', 'projects-onto')
    state = addEdge(state, 'beat', 'ent-place', 'appears-in')
    state = addEdge(state, 'ent-person', 'ent-place', 'relates-entity')
    state = addEdge(state, 'fa', 'fb', 'foreshadow')
    state = addEdge(state, 'ch-1', 'sc-1', 'chapter-in')
    expect(state.canvas.edges.some((edge) => edge.kind === 'chapter-in')).toBe(true)
    const relatePairs: Array<[string, string, RelationKind]> = RELATION_KINDS.map((relation, index) => {
      const from = `rel-from-${index}`
      const to = `rel-to-${index}`
      return [from, to, relation]
    })
    for (const [from, to] of relatePairs) {
      state = createCard(state, { id: from, layer: 'situation', x: 0, y: 0, body: from })
      state = createCard(state, { id: to, layer: 'situation', x: 0, y: 0, body: to })
    }
    for (const [from, to, relation] of relatePairs) {
      state = addEdge(state, from, to, 'relates', { relation })
    }
    state = {
      ...state,
      canvas: {
        ...state.canvas,
        edges: [...state.canvas.edges, { id: 'dangling', fromNode: 'nope', toNode: 'nope2', kind: 'grows-from' }],
      },
    }

    const groupsOn: RelationGroup[] = ['grows-from', 'relates', 'projects-onto', 'appears-in', 'relates-entity', 'foreshadow']
    for (const group of groupsOn) {
      const view = buildRelationGraph(state, { ideaLayer: false, groups: groups(group) })
      expect(view.edges.length).toBeGreaterThan(0)
      expect(view.edges.every((edge) => edge.kind === group)).toBe(true)
      expect(view.edges.some((edge) => edge.kind === 'chapter-in')).toBe(false)
    }

    for (const relation of RELATION_KINDS) {
      const relations = Object.fromEntries(RELATION_KINDS.map((item) => [item, item === relation])) as Partial<
        Record<RelationKind, boolean>
      >
      const view = buildRelationGraph(state, { ideaLayer: false, groups: groups('relates'), relations })
      const relates = view.edges.filter((edge) => edge.kind === 'relates')
      expect(relates.length).toBeGreaterThan(0)
      expect(relates.every((edge) => edge.relation === relation)).toBe(true)
      expect(view.edges.every((edge) => edge.kind === 'relates')).toBe(true)
    }
  })

  it('场次拖进场后记入 beatIds，空节拍表不改大纲分母', () => {
    let state = createDocument('beats')
    state = createCard(state, { id: 'c1', layer: 'changci', x: 0, y: 0, fields: { task: '进门' } })
    state = createCard(state, { id: 'idea', layer: 'situation', x: 0, y: 0, body: '不是场次' })
    state = {
      ...state,
      entities: [entity('ent-person', 'person', '奈德'), entity('ent-theme', 'theme', '誓言')],
      chapters: [
        {
          id: 'ch-1',
          title: '第一章',
          scenes: [
            { id: 's1', title: '城门', ideaIds: [], prose: '', beatIds: [] },
            { id: 's2', title: '空场', ideaIds: [], prose: '', beatIds: [] },
          ],
        },
      ],
    }
    expect(outlineProgress(state.chapters)).toEqual({ filled: 0, total: 2 })
    expect(placeBeat(state, 's1', 'idea')).toBe(state)

    const once = placeBeat(state, 's1', 'c1')
    expect(once.chapters?.[0]?.scenes[0]?.beatIds).toEqual(['c1'])
    expect(outlineProgress(once.chapters)).toEqual({ filled: 1, total: 2 })
    const twice = placeBeat(once, 's1', 'c1')
    expect(twice).toBe(once)
    expect(twice.chapters?.[0]?.scenes[0]?.beatIds).toEqual(['c1'])

    const sheet = createBeatSheet(60)
    expect(sheet).toHaveLength(60)
    expect(sheet.every((slot) => slot.sceneIds.length === 0)).toBe(true)
    expect(outlineProgress(once.chapters).total).toBe(2)
    expect(outlineProgress(once.chapters).total).not.toBe(sheet.length)

    const withCast = addEdge(once, 'c1', 'ent-person', 'appears-in')
    const ignored = addEdge(withCast, 'c1', 'ent-theme', 'appears-in')
    expect(ignored).toBe(withCast)
    const scene = withCast.chapters?.[0]?.scenes[0]
    expect(scene).toBeTruthy()
    expect(sceneAppearanceNames(withCast, scene!)).toEqual(['奈德'])

    const html = renderToStaticMarkup(
      createElement(ChapterPage, {
        state: withCast,
        canEdit: true,
        onApply: (recipe: (current: AppState) => AppState) => recipe(withCast),
      }),
    )
    expect(html).toContain('大纲 1/2')
    expect(html).toContain('第1章')
    expect(html).toContain('1/2')
    expect(html).toContain('出场：奈德')
    expect(html).toContain('节拍表')
    expect(html).not.toContain('这一页下一刀才做。')

    const anchors = beatAnchors(60)
    expect(anchors.find((item) => item.label === '悬念')?.index).toBe(0)
    expect(anchors.find((item) => item.label === '结局')?.index).toBe(59)
    const span = 59
    const plot1 = anchors.find((item) => item.label === '第一情节点')?.index ?? -1
    const mid = anchors.find((item) => item.label === '中间点')?.index ?? -1
    const plot2 = anchors.find((item) => item.label === '第二情节点')?.index ?? -1
    expect(plot1 / span).toBeGreaterThanOrEqual(0.2)
    expect(plot1 / span).toBeLessThanOrEqual(0.25)
    expect(Math.abs(mid / span - 0.5)).toBeLessThan(0.02)
    expect(plot2 / span).toBeGreaterThanOrEqual(0.7)
    expect(plot2 / span).toBeLessThanOrEqual(0.75)

    let moved = createBeatSheet(60)
    moved = moved.map((slot, index) => ({ sceneIds: index === plot1 || index === 59 ? [`scene-${index}`] : [] }))
    const resized = resizeBeatSheet(moved, 40)
    expect(resized).toHaveLength(40)
    const nextAnchors = beatAnchors(40)
    const nextPlot = nextAnchors.find((item) => item.label === '第一情节点')?.index ?? -1
    expect(resized[nextPlot]?.sceneIds).toContain(`scene-${plot1}`)
    expect(resized[39]?.sceneIds).toContain('scene-59')
    expect(resized.reduce((count, slot) => count + slot.sceneIds.length, 0)).toBe(2)
    for (const size of BEAT_LENGTHS) {
      const row = beatAnchors(size)
      const width = Math.max(size - 1, 1)
      const first = row.find((item) => item.label === '第一情节点')?.index ?? -1
      const second = row.find((item) => item.label === '第二情节点')?.index ?? -1
      expect(row.find((item) => item.label === '悬念')?.index).toBe(0)
      expect(row.find((item) => item.label === '结局')?.index).toBe(size - 1)
      expect(first / width).toBeGreaterThanOrEqual(0.2)
      expect(first / width).toBeLessThanOrEqual(0.25)
      expect(second / width).toBeGreaterThanOrEqual(0.7)
      expect(second / width).toBeLessThanOrEqual(0.75)
    }
  })

  it('≥9 个节点时，默认缩放下节点名不是全部同时画在图上', async () => {
    const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬']
    let state = createDocument('zoom-labels')
    state = {
      ...state,
      entities: names.map((name, index) => entity(`zoom-${index}`, index % 2 === 0 ? 'person' : 'place', name)),
    }
    for (let index = 0; index < names.length - 1; index += 1) {
      state = addEdge(state, `zoom-${index}`, `zoom-${index + 1}`, 'relates-entity')
    }
    const html = renderToStaticMarkup(createElement(RelationPage, { state }))
    if (html.includes('relation-svg')) {
      const drawn = names.filter((name) => html.includes(name)).length
      expect(drawn).toBeLessThan(names.length)
      return
    }
    const page = await import('../src/RelationPage.tsx')
    const graph = buildRelationGraph(state)
    const cy = page.mountRelationCy({
      graph,
      focusId: null,
      viewport: { width: 960, height: 640 },
    })
    const drawn = cy.nodes().filter((node) => {
      const label = String(node.style('label') ?? '')
      if (!label) return false
      return page.nodeLabelVisible(
        Number(node.numericStyle('font-size')),
        cy.zoom(),
        Number(node.numericStyle('min-zoomed-font-size')),
        1,
      )
    }).length
    expect(cy.nodes().length).toBeGreaterThanOrEqual(9)
    expect(Number(cy.nodes()[0]?.numericStyle('min-zoomed-font-size'))).toBeGreaterThan(0)
    expect(drawn).toBeLessThan(names.length)
    cy.destroy()
  })

  it('局部深度默认 1 跳且最多 3 跳，节点大小下限 44、上限不超过 96', () => {
    const chain: RelationGraph = {
      nodes: ['a', 'b', 'c', 'd'].map((id) => ({
        id,
        layer: 'entity',
        label: id,
        shape: 'square',
        color: '#000',
      })),
      edges: [
        { id: 'ab', from: 'a', to: 'b', kind: 'relates-entity' },
        { id: 'bc', from: 'b', to: 'c', kind: 'relates-entity' },
        { id: 'cd', from: 'c', to: 'd', kind: 'relates-entity' },
      ],
    }
    const ids = (depth?: number) =>
      localNeighborhood(chain, 'a', depth)
        .nodes.map((node) => node.id)
        .sort()
    expect(LOCAL_DEPTH_DEFAULT).toBe(1)
    expect(LOCAL_DEPTH_MAX).toBe(3)
    expect(ids()).toEqual(['a', 'b'])
    expect(ids(1)).toEqual(['a', 'b'])
    expect(ids(2)).toEqual(['a', 'b', 'c'])
    expect(ids(3)).toEqual(['a', 'b', 'c', 'd'])
    expect(ids(4)).toEqual(ids(3))
    expect(localNeighborhood(chain, null, 3)).toBe(chain)

    const dangling: RelationGraph = {
      nodes: [
        { id: 'a', layer: 'entity', label: 'a', shape: 'square', color: '#000' },
        { id: 'b', layer: 'entity', label: 'b', shape: 'square', color: '#000' },
      ],
      edges: [
        { id: 'app', from: 'a', to: 'scene', kind: 'appears-in' },
        { id: 'ab', from: 'a', to: 'b', kind: 'relates-entity' },
      ],
    }
    const near = localNeighborhood(dangling, 'a')
    expect(near.nodes.map((node) => node.id).sort()).toEqual(['a', 'b'])
    expect(near.edges.map((edge) => edge.id).sort()).toEqual(['ab', 'app'])

    const sceneCenter: RelationGraph = {
      nodes: [
        { id: 'ned', layer: 'entity', label: 'ned', shape: 'square', color: '#000' },
        { id: 'other', layer: 'entity', label: 'other', shape: 'square', color: '#000' },
      ],
      edges: [
        { id: 'app', from: 'scene', to: 'ned', kind: 'appears-in' },
        { id: 'rel', from: 'ned', to: 'other', kind: 'relates-entity' },
      ],
    }
    expect(localNeighborhood(sceneCenter, 'scene').nodes.map((node) => node.id)).toEqual(['ned'])
    expect(localNeighborhood(sceneCenter, 'scene', 2).nodes.map((node) => node.id).sort()).toEqual(['ned', 'other'])

    expect(NODE_SIZE_MIN).toBe(44)
    expect(NODE_SIZE_MAX).toBeLessThanOrEqual(96)
    expect(nodeSizeForDegree(0)).toBe(44)
    let previous = nodeSizeForDegree(0)
    for (const degree of [1, 2, 4, 8, 20, 100]) {
      const size = nodeSizeForDegree(degree)
      expect(size).toBeGreaterThanOrEqual(44)
      expect(size).toBeLessThanOrEqual(96)
      expect(size).toBeGreaterThanOrEqual(previous)
      previous = size
    }
    expect(nodeSizeForDegree(100)).toBe(NODE_SIZE_MAX)
    expect(nodeSizeForDegree(100)).toBe(nodeSizeForDegree(1000))

    const state = {
      ...createDocument('depth-slider'),
      entities: [entity('ned', 'person', '奈德')],
    }
    const localHtml = renderToStaticMarkup(createElement(RelationPage, { state, focusId: 'ned' }))
    expect(localHtml).toContain('aria-label="局部深度"')
    expect(localHtml).toContain('min="1"')
    expect(localHtml).toContain('max="3"')
    expect(localHtml).toContain('value="1"')
    const bookHtml = renderToStaticMarkup(createElement(RelationPage, { state }))
    expect(bookHtml).not.toContain('局部深度')

    const source = read('src/RelationPage.tsx')
    expect(source).toContain('animate: Boolean(container)')
    expect(source).not.toContain('autoungrabify')
    expect(source).toContain("connectedEdges().addClass('hover-edge')")
    expect(source).toContain("connectedEdges().removeClass('hover-edge')")
    expect(source).toContain('edge.hover-edge')
    expect(source).not.toContain('localStorage')
  })

  it('图上的节点宽度落在 44 到 96 之间，枢纽点比叶子大', () => {
    const leaves = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const graph: RelationGraph = {
      nodes: ['hub', ...leaves].map((id) => ({
        id,
        layer: 'entity',
        label: id,
        shape: 'square',
        color: '#000',
      })),
      edges: leaves.map((id) => ({ id: `e-${id}`, from: 'hub', to: id, kind: 'relates-entity' as const })),
    }
    const cy = mountRelationCy({ graph, focusId: null, viewport: { width: 960, height: 640 } })
    const hub = cy.getElementById('hub').numericStyle('width')
    const leaf = cy.getElementById('a').numericStyle('width')
    expect(hub).toBeGreaterThan(leaf)
    expect(leaf).toBeGreaterThanOrEqual(44)
    expect(hub).toBeLessThanOrEqual(96)
    cy.nodes().forEach((node) => {
      const width = node.numericStyle('width')
      expect(width).toBeGreaterThanOrEqual(44)
      expect(width).toBeLessThanOrEqual(96)
    })
    cy.destroy()
  })
})
