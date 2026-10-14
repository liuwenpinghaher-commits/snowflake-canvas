import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import cytoscape, { type Core, type ElementDefinition, type EventObject, type NodeSingular } from 'cytoscape'
import {
  ENTITY_TYPES,
  RELATION_KINDS,
  type AppState,
  type CanvasEdge,
  type Entity,
  type EntityType,
  type RelationKind,
} from './document.ts'
import { eventsForEntity, fieldLabel } from './person-form.ts'
import { endpointLabel, relationTableRows } from './relation-table.ts'
import {
  ENTITY_COLORS,
  IDEA_COLOR,
  RELATION_GROUP_LABEL,
  RELATION_GROUPS,
  buildRelationGraph,
  defaultRelationFilter,
  edgeKindLabel,
  type RelationEdge,
  type RelationFilter,
  type RelationGraph,
  type RelationGroup,
} from './relations.ts'
import { browserViewStore, readChoice, writeChoice } from './view-memory.ts'

function copyFilter(filter: RelationFilter): RelationFilter {
  return {
    ideaLayer: filter.ideaLayer,
    groups: { ...filter.groups },
    ...(filter.relations ? { relations: { ...filter.relations } } : {}),
  }
}

/** 和 Cytoscape 画字前的判断一致：有效字号是字号乘以 2 的幂，小于 min-zoomed-font-size 就不画。 */
export function nodeLabelVisible(fontSize: number, zoom: number, minZoomedFontSize: number, pixelRatio = 1): boolean {
  if (!(minZoomedFontSize > 0)) return true
  if (!(fontSize > 0) || !(zoom > 0) || !(pixelRatio > 0)) return false
  const scale = 2 ** Math.ceil(Math.log2(zoom * pixelRatio))
  return fontSize * scale >= minZoomedFontSize
}

const NODE_LABEL_FONT = 12

export function minZoomedFontSizeFor(nodeCount: number, zoom: number, pixelRatio = 1): number {
  const ratio = pixelRatio > 0 ? pixelRatio : 1
  const safeZoom = zoom > 0 ? zoom : 1
  const scale = 2 ** Math.ceil(Math.log2(safeZoom * ratio))
  if (nodeCount >= 9) return NODE_LABEL_FONT * scale + 1
  return NODE_LABEL_FONT
}

const NODE_KIND_LABEL: Record<EntityType, string> = {
  person: '人物',
  place: '地点',
  org: '组织',
  concept: '概念',
  theme: '主题',
  'foreshadow-line': '伏笔线',
}

type LineStyle = 'solid' | 'dashed' | 'dotted'

/** 照台指定的两条边色。不是设定物色，不进 ENTITY_COLORS。 */
const MENTION_COLOR = '#b5b0a6'
const CITATION_COLOR = '#8b877f'

interface EdgeLook {
  cls: string
  legend: string
  color: string
  line: LineStyle
  /** 只有「正文提到」用 8,4。其余虚线用另一套间距，避免和它画成同一种。 */
  dash: '8,4' | '6,3' | '2,3' | null
  width: number
  arrow: boolean
  caption: string
}

const EDGE_LOOKS: readonly EdgeLook[] = [
  { cls: 'rel-complement', legend: '互补', color: ENTITY_COLORS.place, line: 'solid', dash: null, width: 2.5, arrow: false, caption: '互补' },
  { cls: 'rel-conflict', legend: '冲突', color: ENTITY_COLORS.person, line: 'solid', dash: null, width: 3, arrow: false, caption: '冲突' },
  { cls: 'rel-plant', legend: '伏笔', color: ENTITY_COLORS['foreshadow-line'], line: 'dotted', dash: null, width: 2, arrow: false, caption: '伏笔' },
  { cls: 'rel-derive', legend: '派生', color: ENTITY_COLORS.org, line: 'dashed', dash: '6,3', width: 2, arrow: false, caption: '派生' },
  { cls: 'rel-mention', legend: '正文提到', color: MENTION_COLOR, line: 'dashed', dash: '8,4', width: 2, arrow: false, caption: '' },
  { cls: 'rel-citation', legend: '引用边', color: CITATION_COLOR, line: 'solid', dash: null, width: 1.5, arrow: true, caption: '' },
  { cls: 'rel-grows', legend: '生长派生', color: ENTITY_COLORS.theme, line: 'solid', dash: null, width: 2, arrow: false, caption: '生长派生' },
  { cls: 'rel-project', legend: '投影边', color: ENTITY_COLORS.concept, line: 'dotted', dash: null, width: 2, arrow: false, caption: '投影' },
  { cls: 'rel-entity', legend: '实体关系', color: ENTITY_COLORS.concept, line: 'solid', dash: null, width: 2.5, arrow: false, caption: '实体关系' },
  { cls: 'rel-foreshadow', legend: '伏笔线', color: ENTITY_COLORS['foreshadow-line'], line: 'dashed', dash: '2,3', width: 2, arrow: false, caption: '伏笔线' },
]

function edgeLook(edge: RelationEdge): EdgeLook | null {
  if (edge.kind === 'relates') {
    return EDGE_LOOKS.find((look) => look.legend === edge.relation) ?? null
  }
  if (edge.kind === 'appears-in') return EDGE_LOOKS.find((look) => look.cls === 'rel-citation') ?? null
  if (edge.kind === 'grows-from') return EDGE_LOOKS.find((look) => look.cls === 'rel-grows') ?? null
  if (edge.kind === 'projects-onto') return EDGE_LOOKS.find((look) => look.cls === 'rel-project') ?? null
  if (edge.kind === 'relates-entity') return EDGE_LOOKS.find((look) => look.cls === 'rel-entity') ?? null
  if (edge.kind === 'foreshadow') return EDGE_LOOKS.find((look) => look.cls === 'rel-foreshadow') ?? null
  return null
}

export function relationCenter(state: AppState, focusId: string | null): string | null {
  if (!focusId) return null
  const entity = (state.entities ?? []).find((item) => item.id === focusId)
  if (entity?.entityType === 'person') return focusId
  const card = state.snowflake.cards[focusId]
  if (card && (card.layer === 'changci' || card.layer === '场景表')) return focusId
  return null
}

export const NODE_SIZE_MIN = 44
export const NODE_SIZE_MAX = 96
const NODE_SIZE_DEGREE_CAP = 8
/** 最低相连边数滑杆的上限，和节点尺寸封顶用的边数是同一个数。 */
export const DEGREE_HIDE_MAX = NODE_SIZE_DEGREE_CAP
export const BRAIN_EDGE_CLASS = 'rel-brain'
export const BRAIN_EDGE_COLOR = '#7a5ea7'

/** 相连边数为 0 时用下限。边数到封顶后停在上限，枢纽点不会再被撑大。 */
export function nodeSizeForDegree(degree: number): number {
  const safe = Number.isFinite(degree) ? Math.max(0, degree) : 0
  const t = Math.min(safe, NODE_SIZE_DEGREE_CAP) / NODE_SIZE_DEGREE_CAP
  return Math.round(NODE_SIZE_MIN + (NODE_SIZE_MAX - NODE_SIZE_MIN) * t)
}

export const LOCAL_DEPTH_DEFAULT = 1
export const LOCAL_DEPTH_MAX = 3

export function clampLocalDepth(depth: number): number {
  if (!Number.isFinite(depth)) return LOCAL_DEPTH_DEFAULT
  const hops = Math.floor(depth)
  if (hops < 1) return LOCAL_DEPTH_DEFAULT
  if (hops > LOCAL_DEPTH_MAX) return LOCAL_DEPTH_MAX
  return hops
}

/** 从中心向外走若干跳。不传深度时是 1 跳，和原来的一圈相同；最多 3 跳。中心可以是场次卡，本身不必在节点里。 */
export function localNeighborhood(graph: RelationGraph, centerId: string | null, depth = LOCAL_DEPTH_DEFAULT): RelationGraph {
  if (!centerId) return graph
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  const hops = clampLocalDepth(depth)
  const keep = new Set<string>()
  if (nodeIds.has(centerId)) keep.add(centerId)
  const seen = new Set<string>([centerId])
  let frontier = [centerId]
  for (let step = 0; step < hops; step += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of graph.edges) {
        const other = edge.from === id ? edge.to : edge.to === id ? edge.from : null
        if (!other || !nodeIds.has(other) || seen.has(other)) continue
        seen.add(other)
        keep.add(other)
        next.push(other)
      }
    }
    frontier = next
  }
  if (keep.size === 0) return graph
  const nodes = graph.nodes.filter((node) => keep.has(node.id))
  const kept = new Set(nodes.map((node) => node.id))
  const edges = graph.edges.filter((edge) => {
    const fromOk = kept.has(edge.from)
    const toOk = kept.has(edge.to)
    if (fromOk && toOk) return true
    return edge.kind === 'appears-in' && (fromOk || toOk)
  })
  return { nodes, edges }
}

function degreeByNode(graph: RelationGraph): Map<string, number> {
  const counts = new Map<string, number>()
  const ids = new Set(graph.nodes.map((node) => node.id))
  for (const edge of graph.edges) {
    const ends = edge.from === edge.to ? [edge.from] : [edge.from, edge.to]
    for (const id of ends) {
      if (!ids.has(id)) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return counts
}

export function clampDegreeThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0
  const whole = Math.floor(value)
  if (whole < 0) return 0
  if (whole > DEGREE_HIDE_MAX) return DEGREE_HIDE_MAX
  return whole
}

/** 勾上「隐藏孤点」时，至少按 1 条边来藏；滑杆更高就用滑杆。 */
export function activeDegreeThreshold(minEdges: number, hideIsolates: boolean): number {
  const slider = clampDegreeThreshold(minEdges)
  if (!hideIsolates) return slider
  return Math.max(slider, 1)
}

/**
 * 只改返回给画面的那一份。阈值为 0 时原样交还，不复制、不改传入的 nodes / edges。
 * 藏掉节点后，连到这些节点上的边也不再进入这份图，尺寸按这份图重算。
 */
export function hideLowDegree(graph: RelationGraph, minEdges: number, hideIsolates = false): RelationGraph {
  const threshold = activeDegreeThreshold(minEdges, hideIsolates)
  if (threshold <= 0) return graph
  const degree = degreeByNode(graph)
  const hidden = new Set<string>()
  for (const node of graph.nodes) {
    if ((degree.get(node.id) ?? 0) < threshold) hidden.add(node.id)
  }
  if (hidden.size === 0) return graph
  const nodes = graph.nodes.filter((node) => !hidden.has(node.id))
  const edges = graph.edges.filter((edge) => !hidden.has(edge.from) && !hidden.has(edge.to))
  return { nodes, edges }
}

export function relationDisplayElements(
  graph: RelationGraph,
  focusId: string | null,
  options?: { minDegree?: number; hideIsolates?: boolean },
): ElementDefinition[] {
  const shown = hideLowDegree(graph, options?.minDegree ?? 0, options?.hideIsolates === true)
  return relationElements(shown, focusId)
}

function relationElements(graph: RelationGraph, focusId: string | null): ElementDefinition[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  const degree = degreeByNode(graph)
  const radius = 80 + graph.nodes.length * 28
  const nodes: ElementDefinition[] = graph.nodes.map((node, index) => {
    const angle = graph.nodes.length <= 1 ? 0 : (index / graph.nodes.length) * Math.PI * 2
    return {
      data: {
        id: node.id,
        label: node.label,
        color: node.color,
        shape: node.shape,
        size: nodeSizeForDegree(degree.get(node.id) ?? 0),
      },
      position: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
      classes: focusId === node.id ? 'focus' : undefined,
    }
  })
  const edges: ElementDefinition[] = []
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
    const look = edgeLook(edge)
    if (!look) continue
    edges.push({
      data: {
        id: edge.id,
        source: edge.from,
        target: edge.to,
      },
      classes: look.cls,
    })
  }
  return [...nodes, ...edges]
}

export interface BrainBacklink {
  fromSlug: string
  toSlug: string
  label: string
}

/** 当前画面里的设定物，有百科页名才去问脑。同一个页名只问一次。 */
export function entitySlugsForBacklinks(
  entities: readonly { id: string; slug?: string }[],
  nodeIds: readonly string[],
): string[] {
  const ids = new Set(nodeIds)
  const slugs: string[] = []
  const seen = new Set<string>()
  for (const entity of entities) {
    if (!ids.has(entity.id)) continue
    const slug = typeof entity.slug === 'string' ? entity.slug.trim() : ''
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    slugs.push(slug)
  }
  return slugs
}

/** 两端的页名都对得上当前画面里的设定物才画。对不上的不新建节点。 */
export function brainBacklinkElements(
  graph: RelationGraph,
  entities: readonly { id: string; slug?: string }[],
  links: readonly BrainBacklink[],
): ElementDefinition[] {
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  const slugToId = new Map<string, string>()
  for (const entity of entities) {
    if (!nodeIds.has(entity.id)) continue
    const slug = typeof entity.slug === 'string' ? entity.slug.trim() : ''
    if (!slug || slugToId.has(slug)) continue
    slugToId.set(slug, entity.id)
  }
  const elements: ElementDefinition[] = []
  const seen = new Set<string>()
  for (const link of links) {
    const source = slugToId.get(link.fromSlug)
    const target = slugToId.get(link.toSlug)
    if (!source || !target) continue
    const key = `${source}\0${target}\0${link.label}`
    if (seen.has(key)) continue
    seen.add(key)
    elements.push({
      data: {
        id: `brain:${source}:${target}:${seen.size}`,
        source,
        target,
      },
      classes: BRAIN_EDGE_CLASS,
    })
  }
  return elements
}

function relationBacklinksUrl(slug: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}/api/relation/backlinks?slug=${encodeURIComponent(slug)}`
}

/** 失败、非 JSON、ok 为 false、中途取消：这一页的脑反链当空的，不往外抛。 */
export async function fetchRelationBacklinks(slug: string, signal?: AbortSignal): Promise<BrainBacklink[]> {
  try {
    const response = await fetch(relationBacklinksUrl(slug), { cache: 'no-store', signal })
    if (!response.ok) return []
    const body = (await response.json()) as { ok?: unknown; edges?: unknown }
    if (!body || body.ok !== true || !Array.isArray(body.edges)) return []
    const links: BrainBacklink[] = []
    for (const edge of body.edges) {
      if (!edge || typeof edge !== 'object') continue
      const record = edge as { fromSlug?: unknown; toSlug?: unknown; label?: unknown }
      const fromSlug = typeof record.fromSlug === 'string' ? record.fromSlug : ''
      const toSlug = typeof record.toSlug === 'string' ? record.toSlug : ''
      if (!fromSlug || !toSlug) continue
      const label = typeof record.label === 'string' && record.label.trim() ? record.label : '脑反链'
      links.push({ fromSlug, toSlug, label })
    }
    return links
  } catch {
    return []
  }
}

/** 默认只有引用边带三角。总开关打开后，当前画面上每一种边都指向 target。 */
export function relationArrowByClass(showAllArrows = false): Record<string, 'triangle' | 'none'> {
  const arrows: Record<string, 'triangle' | 'none'> = {}
  for (const look of EDGE_LOOKS) {
    arrows[look.cls] = showAllArrows || look.arrow ? 'triangle' : 'none'
  }
  arrows[BRAIN_EDGE_CLASS] = showAllArrows ? 'triangle' : 'none'
  return arrows
}

export function relationStylesheet(showAllArrows = false): cytoscape.StylesheetJson {
  const arrows = relationArrowByClass(showAllArrows)
  return [
    {
      selector: 'node',
      style: {
        'background-color': (node: NodeSingular) => String(node.data('color') ?? ''),
        label: (node: NodeSingular) => String(node.data('label') ?? ''),
        color: '#241c16',
        'font-size': NODE_LABEL_FONT,
        'min-zoomed-font-size': NODE_LABEL_FONT,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 8,
        'text-wrap': 'ellipsis',
        'text-max-width': '120px',
        'text-events': 'yes',
        width: 'data(size)',
        height: 'data(size)',
        shape: 'round-rectangle',
        'border-width': 0,
        'border-color': '#241c16',
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'node[shape = "circle"]',
      style: { shape: 'ellipse' },
    },
    {
      selector: 'node.focus',
      style: { 'border-width': 3 },
    },
    {
      selector: 'node.picked, node.hover',
      style: {
        'min-zoomed-font-size': 0,
        'border-width': 3,
        'z-index': 10,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'curve-style': 'bezier',
        'font-size': 11,
        'min-zoomed-font-size': 0,
        color: '#241c16',
        'text-rotation': 'autorotate',
        'text-background-color': '#fffdf8',
        'text-background-opacity': 0.92,
        'text-background-padding': '2px',
        'text-events': 'yes',
        'overlay-opacity': 0,
        'target-arrow-shape': 'none',
      },
    },
    ...EDGE_LOOKS.map((look) => ({
      selector: `edge.${look.cls}`,
      style: {
        width: look.width,
        'line-color': look.color,
        'line-style': look.line,
        ...(look.dash === '8,4'
          ? { 'line-dash-pattern': [8, 4] }
          : look.dash === '6,3'
            ? { 'line-dash-pattern': [6, 3] }
            : look.dash === '2,3'
              ? { 'line-dash-pattern': [2, 3] }
              : {}),
        'target-arrow-shape': arrows[look.cls],
        'target-arrow-color': look.color,
        ...(arrows[look.cls] === 'triangle' ? { 'arrow-scale': 1 } : {}),
        label: look.caption,
        'text-background-opacity': look.caption ? 0.92 : 0,
      },
    })),
    {
      selector: `edge.${BRAIN_EDGE_CLASS}`,
      style: {
        width: 1.5,
        'line-color': BRAIN_EDGE_COLOR,
        'line-style': 'dashed',
        'line-dash-pattern': [6, 3],
        'target-arrow-shape': arrows[BRAIN_EDGE_CLASS],
        'target-arrow-color': BRAIN_EDGE_COLOR,
        ...(arrows[BRAIN_EDGE_CLASS] === 'triangle' ? { 'arrow-scale': 1 } : {}),
        label: '',
        'font-size': 11,
        'min-zoomed-font-size': 0,
        color: '#241c16',
        'text-background-opacity': 0,
      },
    },
    {
      selector: '.faded',
      style: { opacity: 0.15 },
    },
    {
      selector: 'edge.hover-edge',
      style: {
        width: 6,
        opacity: 1,
        'z-index': 20,
        'overlay-color': '#fff4d6',
        'overlay-opacity': 0.9,
        'overlay-padding': 3,
      },
    },
  ]
}

function readPixelRatio(cy: Core): number {
  const renderer = (cy as Core & { renderer?: () => { getPixelRatio?: () => number } }).renderer?.()
  if (!renderer || typeof renderer.getPixelRatio !== 'function') return 1
  try {
    const value = renderer.getPixelRatio()
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  } catch {
    return 1
  }
  return 1
}

function settleRelationView(cy: Core, viewport?: { width: number; height: number }) {
  if (viewport) {
    const bb = cy.elements().boundingBox()
    const width = viewport.width
    const height = viewport.height
    if (width > 80 && height > 80 && bb.w > 0 && bb.h > 0) {
      let zoom = Math.min((width - 160) / bb.w, (height - 200) / bb.h)
      zoom = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), zoom))
      cy.zoom(zoom)
      cy.pan({
        x: (width - zoom * (bb.x1 + bb.x2)) / 2,
        y: (height - zoom * (bb.y1 + bb.y2)) / 2,
      })
    }
  } else {
    cy.resize()
    if (cy.width() > 80 && cy.height() > 80) cy.fit(cy.elements(), 88)
  }
  const minZoomed = minZoomedFontSizeFor(cy.nodes().length, cy.zoom(), readPixelRatio(cy))
  cy.style().selector('node').style('min-zoomed-font-size', minZoomed).update()
}

export function mountRelationCy(options: {
  container?: HTMLElement | null
  graph: RelationGraph
  focusId?: string | null
  viewport?: { width: number; height: number }
  showAllArrows?: boolean
}): Core {
  const container = options.container ?? undefined
  const cy = cytoscape({
    container,
    headless: !container,
    styleEnabled: true,
    elements: relationElements(options.graph, options.focusId ?? null),
    style: relationStylesheet(options.showAllArrows === true),
    layout: {
      name: 'cose',
      animate: Boolean(container),
      fit: false,
      randomize: false,
      padding: 40,
      nodeDimensionsIncludeLabels: false,
      idealEdgeLength: 90,
      nodeRepulsion: 12000,
      componentSpacing: 60,
    },
    minZoom: 0.08,
    maxZoom: 6,
    userZoomingEnabled: true,
    userPanningEnabled: true,
    boxSelectionEnabled: false,
  })
  const settle = () => settleRelationView(cy, options.viewport)
  settle()
  if (container && !options.viewport && typeof ResizeObserver !== 'undefined' && (cy.width() < 80 || cy.height() < 80)) {
    const observer = new ResizeObserver(() => {
      if (cy.destroyed()) {
        observer.disconnect()
        return
      }
      cy.resize()
      if (cy.width() < 80 || cy.height() < 80) return
      settleRelationView(cy)
      observer.disconnect()
    })
    observer.observe(container)
    cy.one('destroy', () => observer.disconnect())
  }
  if (container && import.meta.env.DEV && typeof window !== 'undefined') {
    ;(window as Window & { __relationCy?: Core }).__relationCy = cy
  }
  return cy
}

function placeAppearanceBadges(cy: Core, badges: Map<string, HTMLElement>) {
  for (const [nodeId, el] of badges) {
    const node = cy.getElementById(nodeId)
    if (node.empty()) {
      el.style.visibility = 'hidden'
      continue
    }
    const pos = node.renderedPosition()
    el.style.left = `${pos.x + node.renderedWidth() / 2 - 12}px`
    el.style.top = `${pos.y - node.renderedHeight() / 2 - 8}px`
    el.style.visibility = 'visible'
  }
}

function applyFocusFade(cy: Core, open: RelationSelection | null) {
  cy.batch(() => {
    cy.elements().removeClass('faded')
    cy.nodes().removeClass('picked')
    if (open?.kind !== 'node') return
    const node = cy.getElementById(open.id)
    if (node.empty()) return
    node.addClass('picked')
    cy.elements().not(node.closedNeighborhood()).addClass('faded')
  })
}

function stopNative(event: EventObject) {
  const native = event.originalEvent as { stopPropagation?: () => void } | undefined
  native?.stopPropagation?.()
}

interface AppearanceBadge {
  nodeId: string
  count: number
  label: string
}

function appearanceBadges(graph: RelationGraph): AppearanceBadge[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  const counts = new Map<string, number>()
  for (const edge of graph.edges) {
    if (edge.kind !== 'appears-in') continue
    const fromNode = nodes.get(edge.from)
    const toNode = nodes.get(edge.to)
    if (Boolean(fromNode) === Boolean(toNode)) continue
    const entity = fromNode ?? toNode
    if (!entity) continue
    counts.set(entity.id, (counts.get(entity.id) ?? 0) + 1)
  }
  return [...counts.entries()].map(([nodeId, count]) => ({
    nodeId,
    count,
    label: `出场：${nodes.get(nodeId)?.label ?? ''}`,
  }))
}

function danglingAppearances(state: AppState, graph: RelationGraph, nodeId: string): string[] {
  const nodes = new Set(graph.nodes.map((node) => node.id))
  const lines: string[] = []
  for (const edge of graph.edges) {
    if (edge.kind !== 'appears-in') continue
    if (edge.from !== nodeId && edge.to !== nodeId) continue
    if (nodes.has(edge.from) && nodes.has(edge.to)) continue
    const other = edge.from === nodeId ? edge.to : edge.from
    lines.push(`出场：${endpointLabel(state, other)}`)
  }
  return lines
}

function keptNodeIds(graph: RelationGraph, nodeId: string): Set<string> {
  const present = new Set(graph.nodes.map((node) => node.id))
  const keep = new Set<string>()
  if (!present.has(nodeId)) return keep
  keep.add(nodeId)
  for (const edge of graph.edges) {
    if (!present.has(edge.from) || !present.has(edge.to)) continue
    if (edge.from === nodeId) keep.add(edge.to)
    if (edge.to === nodeId) keep.add(edge.from)
  }
  return keep
}

function draftLines(entity: Entity): string[] {
  const lines: string[] = []
  const name = entity.name.trim()
  if (name) lines.push(`名字：${name}`)
  for (const [key, field] of Object.entries(entity.fields)) {
    const value = field.value.trim()
    if (!value) continue
    if (key === 'name' && value === name) continue
    lines.push(`${fieldLabel(key)}：${value}`)
  }
  return lines
}

function edgeDetail(state: AppState, edge: CanvasEdge): { heading: string; lines: string[] } {
  if (edge.kind === 'appears-in') return { heading: '出场', lines: [] }
  if (edge.kind === 'relates') return { heading: edge.relation ?? '横向关系', lines: [] }
  if (edge.kind === 'projects-onto') {
    const ids = new Set(edge.sedimentEvents ?? [])
    const lines = (state.sediment ?? []).filter((event) => ids.has(event.id)).map((event) => event.quote)
    return { heading: '投影', lines: lines.length > 0 ? lines : ['还没有沉淀'] }
  }
  return { heading: edge.kind ? edgeKindLabel(edge.kind, edge.relation) : '', lines: [] }
}

export type RelationSelection = { kind: 'node'; id: string } | { kind: 'edge'; id: string }

type RelationView = 'graph' | 'table'
type RelationScope = 'local' | 'book'

function SelectionPanel({
  state,
  open,
  graph,
  onOpenPerson,
  onOpenEncyclopedia,
}: {
  state: AppState
  open: RelationSelection
  graph: RelationGraph
  onOpenPerson?: (entityId: string) => void
  onOpenEncyclopedia?: (entityId: string) => void
}) {
  if (open.kind === 'node') {
    const entity = (state.entities ?? []).find((item) => item.id === open.id)
    if (!entity) return null
    const lines = draftLines(entity)
    const events = eventsForEntity(state, entity.id)
    const appearances = danglingAppearances(state, graph, open.id)
    return (
      <aside className="relation-side" aria-label="实体" onClick={(event) => event.stopPropagation()}>
        <h3>定稿摘要</h3>
        {lines.length === 0 ? <p>还没有定稿</p> : lines.map((line) => <p key={line}>{line}</p>)}
        <h3>沉淀账本</h3>
        {events.length === 0 ? <p>还没有沉淀</p> : events.map((event) => <p key={event.id}>{event.quote}</p>)}
        {appearances.length > 0 ? (
          <>
            <h3>出场</h3>
            {appearances.map((line, index) => (
              <p key={`${index}:${line}`}>{line}</p>
            ))}
          </>
        ) : null}
        {entity.entityType === 'person' ? (
          <button type="button" onClick={() => onOpenPerson?.(entity.id)}>
            打开人物页
          </button>
        ) : null}
        <button type="button" onClick={() => onOpenEncyclopedia?.(entity.id)}>
          打开百科页
        </button>
      </aside>
    )
  }
  const edge = state.canvas.edges.find((item) => item.id === open.id)
  if (!edge?.kind) return null
  const detail = edgeDetail(state, edge)
  return (
    <aside className="relation-side" aria-label="这条边" onClick={(event) => event.stopPropagation()}>
      <h3>{detail.heading}</h3>
      {detail.lines.map((line, index) => (
        <p key={`${index}:${line}`}>{line}</p>
      ))}
    </aside>
  )
}

function visibleIdeaCount(graph: RelationGraph): number {
  let count = 0
  for (const node of graph.nodes) {
    if (node.layer === 'idea') count += 1
  }
  return count
}

function visibleEdgeCount(graph: RelationGraph, kind: RelationGroup, relation?: RelationKind): number {
  let count = 0
  for (const edge of graph.edges) {
    if (edge.kind !== kind) continue
    if (relation !== undefined && edge.relation !== relation) continue
    count += 1
  }
  return count
}

function RowCount({ n }: { n: number }) {
  if (n <= 0) return null
  return <span className="relation-count">{n}</span>
}

export default function RelationPage({
  state,
  initialFilter,
  initialSelection = null,
  focusId = null,
  onOpenPerson,
  onOpenEncyclopedia,
  bookId = null,
  initialView,
}: {
  state: AppState
  initialFilter?: RelationFilter
  initialSelection?: RelationSelection | null
  focusId?: string | null
  onOpenPerson?: (entityId: string) => void
  onOpenEncyclopedia?: (entityId: string) => void
  bookId?: string | null
  initialView?: RelationView
}) {
  const storageId = bookId ?? 'none'
  const [filter, setFilter] = useState<RelationFilter>(() => copyFilter(initialFilter ?? defaultRelationFilter()))
  const [open, setOpen] = useState<RelationSelection | null>(initialSelection)
  const [view, setView] = useState<RelationView>(
    () => initialView ?? readChoice(browserViewStore(), storageId, 'relation', ['graph', 'table'] as const, 'graph'),
  )
  const centerId = relationCenter(state, focusId)
  const [scope, setScope] = useState<RelationScope>(() => (centerId ? 'local' : 'book'))
  const [localDepth, setLocalDepth] = useState(LOCAL_DEPTH_DEFAULT)
  const [showArrows, setShowArrows] = useState(false)
  const [minDegree, setMinDegree] = useState(0)
  const [hideIsolates, setHideIsolates] = useState(false)
  useLayoutEffect(() => {
    setScope(centerId ? 'local' : 'book')
  }, [centerId])
  useLayoutEffect(() => {
    if (initialView) return
    setView(readChoice(browserViewStore(), storageId, 'relation', ['graph', 'table'] as const, 'graph'))
  }, [storageId, initialView])
  const graph = useMemo(() => buildRelationGraph(state, filter), [state, filter])
  const displayed = useMemo(
    () => (scope === 'local' ? localNeighborhood(graph, centerId, localDepth) : graph),
    [graph, scope, centerId, localDepth],
  )
  const shown = useMemo(
    () => hideLowDegree(displayed, minDegree, hideIsolates),
    [displayed, minDegree, hideIsolates],
  )
  const brainSlugs = useMemo(
    () => entitySlugsForBacklinks(state.entities ?? [], shown.nodes.map((node) => node.id)),
    [state.entities, shown],
  )
  const graphKey = `${scope}|${scope === 'local' ? localDepth : ''}|${focusId ?? ''}|${showArrows ? 1 : 0}|${activeDegreeThreshold(minDegree, hideIsolates)}|${shown.nodes.map((node) => node.id).join(',')}|${shown.edges
    .map((edge) => edge.id)
    .join(',')}`
  const badges = useMemo(() => {
    const ids = new Set(shown.nodes.map((node) => node.id))
    return appearanceBadges(displayed).filter((badge) => ids.has(badge.nodeId))
  }, [displayed, shown])
  const kept = open?.kind === 'node' ? keptNodeIds(displayed, open.id) : null
  const rows = relationTableRows(state, filter)
  const hasRelates = state.canvas.edges.some((edge) => edge.kind === 'relates')
  const hostRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const badgeEls = useRef(new Map<string, HTMLElement>())
  const openRef = useRef(open)
  openRef.current = open

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || view !== 'graph' || displayed.nodes.length === 0 || shown.nodes.length === 0) {
      cyRef.current?.destroy()
      cyRef.current = null
      return
    }
    const cy = mountRelationCy({ container: host, graph: shown, focusId, showAllArrows: showArrows })
    cyRef.current = cy
    const place = () => placeAppearanceBadges(cy, badgeEls.current)
    place()
    cy.on('pan zoom resize', place)
    cy.on('mouseover', 'node', (event) => {
      event.target.addClass('hover')
      event.target.connectedEdges().addClass('hover-edge')
    })
    cy.on('mouseout', 'node', (event) => {
      event.target.removeClass('hover')
      event.target.connectedEdges().removeClass('hover-edge')
    })
    cy.on('tap', 'node', (event) => {
      stopNative(event)
      setOpen({ kind: 'node', id: event.target.id() })
    })
    cy.on('tap', 'edge', (event) => {
      stopNative(event)
      const target = event.target
      if (target !== cy && target.hasClass(BRAIN_EDGE_CLASS)) return
      setOpen({ kind: 'edge', id: target.id() })
    })
    cy.on('tap', (event) => {
      if (event.target === cy) setOpen(null)
    })
    return () => {
      cy.destroy()
      if (cyRef.current === cy) cyRef.current = null
    }
  }, [graphKey, view, displayed, shown, focusId, showArrows])

  useEffect(() => {
    if (view !== 'graph') return
    const cy = cyRef.current
    if (!cy || cy.destroyed()) return
    if (brainSlugs.length === 0) {
      cy.edges(`.${BRAIN_EDGE_CLASS}`).remove()
      return
    }
    let cancelled = false
    const controllers = brainSlugs.map(() => new AbortController())
    const graph = shown
    const entities = state.entities ?? []
    const slugs = brainSlugs
    void (async () => {
      const batches = await Promise.all(slugs.map((slug, index) => fetchRelationBacklinks(slug, controllers[index]?.signal)))
      if (cancelled || cy.destroyed() || cyRef.current !== cy) return
      const elements = brainBacklinkElements(graph, entities, batches.flat())
      cy.batch(() => {
        cy.edges(`.${BRAIN_EDGE_CLASS}`).remove()
        for (const element of elements) cy.add(element)
        applyFocusFade(cy, openRef.current)
      })
    })()
    return () => {
      cancelled = true
      for (const controller of controllers) controller.abort()
    }
  }, [view, graphKey, brainSlugs, shown, state.entities])

  useLayoutEffect(() => {
    const cy = cyRef.current
    if (!cy || view !== 'graph') return
    applyFocusFade(cy, open)
  }, [open, graphKey, view])

  function toggleGroup(group: RelationGroup) {
    setFilter((current) => ({
      ...current,
      groups: { ...current.groups, [group]: !current.groups[group] },
    }))
  }

  function toggleRelation(kind: RelationKind) {
    setFilter((current) => {
      const relations: Partial<Record<RelationKind, boolean>> = {}
      for (const item of RELATION_KINDS) relations[item] = current.relations?.[item] ?? true
      relations[kind] = !relations[kind]
      return { ...current, relations }
    })
  }

  function chooseView(next: RelationView) {
    setView(next)
    writeChoice(browserViewStore(), storageId, 'relation', next)
  }

  return (
    <section className="relation-page" aria-label="关系">
      <aside className="relation-filter" aria-label="关系过滤">
        <h2>关系</h2>
        <div className="view-switch" role="tablist" aria-label="关系视图">
          <button type="button" role="tab" aria-selected={view === 'graph'} className={view === 'graph' ? 'on' : undefined} onClick={() => chooseView('graph')}>
            图
          </button>
          <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : undefined} onClick={() => chooseView('table')}>
            表
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={filter.ideaLayer}
            onChange={() => setFilter((current) => ({ ...current, ideaLayer: !current.ideaLayer }))}
          />
          <span>卡片层</span>
          <RowCount n={visibleIdeaCount(displayed)} />
        </label>
        {RELATION_GROUPS.map((group) => (
          <div key={group} className="relation-group">
            <label>
              <input type="checkbox" checked={filter.groups[group]} onChange={() => toggleGroup(group)} />
              <span>{RELATION_GROUP_LABEL[group]}</span>
              <RowCount n={visibleEdgeCount(displayed, group)} />
            </label>
            {group === 'relates' && filter.groups.relates && hasRelates ? (
              <div className="relation-sub">
                {RELATION_KINDS.map((kind) => (
                  <label key={kind}>
                    <input
                      type="checkbox"
                      checked={filter.relations?.[kind] ?? true}
                      onChange={() => toggleRelation(kind)}
                    />
                    <span>{kind}</span>
                    <RowCount n={visibleEdgeCount(displayed, 'relates', kind)} />
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </aside>
      <div
        className="relation-stage"
        onClick={(event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          if (target.closest('.relation-side, .relation-graph, .relation-table')) return
          setOpen(null)
        }}
      >
        {view === 'table' ? (
          <table className="relation-table" aria-label="关系表">
            <thead>
              <tr>
                <th>从</th>
                <th>到</th>
                <th>种类</th>
                <th>关系词</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => setOpen({ kind: 'edge', id: row.id })}>
                  <td>{row.from}</td>
                  <td>{row.to}</td>
                  <td>{row.kind}</td>
                  <td>{row.relation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : displayed.nodes.length === 0 ? (
          <p>还没有可画的设定物或卡片。</p>
        ) : (
          <div className="relation-graph">
            <div ref={hostRef} className="relation-cyto" role="img" aria-label="关系图" />
            {badges.map((badge) => (
              <button
                key={badge.nodeId}
                type="button"
                className={kept && !kept.has(badge.nodeId) ? 'relation-badge relation-faded' : 'relation-badge'}
                style={{ background: ENTITY_COLORS.concept }}
                aria-label={badge.label}
                ref={(el) => {
                  if (el) badgeEls.current.set(badge.nodeId, el)
                  else badgeEls.current.delete(badge.nodeId)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen({ kind: 'node', id: badge.nodeId })
                }}
              >
                {badge.count > 1 ? `出场 ${badge.count}` : '出场'}
              </button>
            ))}
            <div className="relation-scope">
              <button type="button" className={scope === 'book' ? 'on' : undefined} aria-pressed={scope === 'book'} onClick={() => setScope('book')}>
                看整书
              </button>
              <button type="button" className={scope === 'local' ? 'on' : undefined} aria-pressed={scope === 'local'} onClick={() => setScope('local')}>
                回到局部
              </button>
              {scope === 'local' ? (
                <label className="relation-depth">
                  深度
                  <input
                    type="range"
                    min={LOCAL_DEPTH_DEFAULT}
                    max={LOCAL_DEPTH_MAX}
                    step={1}
                    value={localDepth}
                    aria-label="局部深度"
                    onChange={(event) => setLocalDepth(clampLocalDepth(Number(event.target.value)))}
                  />
                  <span>{localDepth}</span>
                </label>
              ) : null}
              <label className="relation-depth">
                <input
                  type="checkbox"
                  checked={showArrows}
                  aria-label="方向箭头"
                  onChange={(event) => setShowArrows(event.target.checked)}
                />
                方向箭头
              </label>
              <label className="relation-depth">
                最低相连边数
                <input
                  type="range"
                  min={0}
                  max={DEGREE_HIDE_MAX}
                  step={1}
                  value={minDegree}
                  aria-label="最低相连边数"
                  onChange={(event) => setMinDegree(clampDegreeThreshold(Number(event.target.value)))}
                />
                <span>{minDegree}</span>
              </label>
              <label className="relation-depth">
                <input
                  type="checkbox"
                  checked={hideIsolates}
                  aria-label="隐藏孤点"
                  onChange={(event) => setHideIsolates(event.target.checked)}
                />
                隐藏孤点
              </label>
            </div>
            <div className="relation-legend" aria-label="图例">
              {ENTITY_TYPES.map((type) => (
                <span key={type} className="relation-legend-item">
                  <i className="relation-swatch is-square" style={{ background: ENTITY_COLORS[type] }} />
                  {NODE_KIND_LABEL[type]}
                </span>
              ))}
              <span className="relation-legend-item">
                <i className="relation-swatch is-circle" style={{ background: IDEA_COLOR }} />
                卡片
              </span>
              {EDGE_LOOKS.map((look) => (
                <span key={look.cls} className="relation-legend-item">
                  <i
                    className={`relation-legend-line is-${look.line}${look.dash === '8,4' ? ' is-dash-8-4' : ''}${look.arrow || showArrows ? ' is-arrow' : ''}${look.width <= 1.5 ? ' is-thin' : ''}`}
                    style={{ borderTopColor: look.color, ['--legend-line' as string]: look.color }}
                  />
                  {look.legend}
                </span>
              ))}
              <span className="relation-legend-item">
                <i
                  className={`relation-legend-line is-dashed is-thin${showArrows ? ' is-arrow' : ''}`}
                  style={{ borderTopColor: BRAIN_EDGE_COLOR, ['--legend-line' as string]: BRAIN_EDGE_COLOR }}
                />
                脑反链
              </span>
            </div>
          </div>
        )}
        {open ? (
          <SelectionPanel
            state={state}
            open={open}
            graph={displayed}
            onOpenPerson={onOpenPerson}
            onOpenEncyclopedia={onOpenEncyclopedia}
          />
        ) : null}
      </div>
    </section>
  )
}
