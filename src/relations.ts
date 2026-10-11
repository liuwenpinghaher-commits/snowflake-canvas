import {
  RELATION_KINDS,
  isEdgeKind,
  isEntityType,
  type AppState,
  type EdgeKind,
  type EntityType,
  type RelationKind,
} from './document.ts'

/** 设定物颜色只放在这里。页面按节点上的 color 画，不再各写一套色值。 */
export const ENTITY_COLORS: Record<EntityType, string> = {
  person: '#c4554a',
  place: '#2f7d5b',
  org: '#2f6294',
  concept: '#8a6232',
  theme: '#6d4d96',
  'foreshadow-line': '#b56a22',
}

export const IDEA_COLOR = '#8c4a32'

export type RelationGroup =
  | 'grows-from'
  | 'relates'
  | 'projects-onto'
  | 'appears-in'
  | 'relates-entity'
  | 'foreshadow'

export const RELATION_GROUPS: readonly RelationGroup[] = [
  'grows-from',
  'relates',
  'projects-onto',
  'appears-in',
  'relates-entity',
  'foreshadow',
]

export const RELATION_GROUP_LABEL: Record<RelationGroup, string> = {
  'grows-from': '生长派生',
  relates: '横向关系',
  'projects-onto': '投影边',
  'appears-in': '引用边',
  'relates-entity': '实体关系',
  foreshadow: '伏笔线',
}

const IDEA_GROUPS: readonly RelationGroup[] = ['grows-from', 'relates', 'projects-onto', 'foreshadow']

export interface RelationFilter {
  /** 勾上后念头节点出现，生长派生、横向关系、投影边、伏笔线也跟着出现。 */
  ideaLayer: boolean
  groups: Record<RelationGroup, boolean>
  /**
   * 横向关系再按五类收窄。不传表示只看这一组的总开关。
   * 五类都是 false 时，这一组不再放出 relates。
   */
  relations?: Partial<Record<RelationKind, boolean>>
}

export function defaultRelationFilter(): RelationFilter {
  return {
    ideaLayer: false,
    groups: {
      'grows-from': false,
      relates: false,
      'projects-onto': false,
      'appears-in': true,
      'relates-entity': true,
      foreshadow: false,
    },
  }
}

export interface RelationNode {
  id: string
  layer: 'idea' | 'entity'
  entityType?: EntityType
  label: string
  shape: 'circle' | 'square'
  color: string
}

export interface RelationEdge {
  id: string
  from: string
  to: string
  kind: EdgeKind
  relation?: RelationKind
  label?: string
}

export interface RelationGraph {
  nodes: RelationNode[]
  edges: RelationEdge[]
}

function ideaLabel(body: string): string {
  const text = body.trim()
  if (!text) return '念头'
  return [...text].slice(0, 40).join('')
}

export function ideasVisible(filter: RelationFilter): boolean {
  if (filter.ideaLayer) return true
  return IDEA_GROUPS.some((group) => filter.groups[group])
}

function kindEnabled(kind: EdgeKind, filter: RelationFilter): boolean {
  if (kind === 'chapter-in') return false
  if (!(RELATION_GROUPS as readonly string[]).includes(kind)) return false
  const group = kind as RelationGroup
  if (filter.groups[group]) return true
  if (filter.ideaLayer && (IDEA_GROUPS as readonly string[]).includes(kind)) return true
  return false
}

function relationEnabled(relation: RelationKind | undefined, filter: RelationFilter): boolean {
  const picked = filter.relations
  if (!picked) return true
  const chosen = RELATION_KINDS.filter((item) => picked[item])
  if (!relation) return false
  return chosen.includes(relation)
}

function edgeLabel(kind: EdgeKind, relation?: RelationKind): string | undefined {
  if (kind === 'appears-in') return '出场'
  if (kind === 'relates') return relation
  if (kind === 'grows-from') return '生长派生'
  if (kind === 'projects-onto') return '投影'
  if (kind === 'relates-entity') return '实体关系'
  if (kind === 'foreshadow') return '伏笔线'
  return undefined
}

export function buildRelationGraph(state: AppState, filter: RelationFilter = defaultRelationFilter()): RelationGraph {
  const showIdeas = ideasVisible(filter)
  const catalog = new Map<string, RelationNode>()
  const nodes: RelationNode[] = []

  for (const [id, card] of Object.entries(state.snowflake.cards)) {
    if (card.layer !== 'situation') continue
    const node: RelationNode = {
      id,
      layer: 'idea',
      label: ideaLabel(card.body ?? ''),
      shape: 'circle',
      color: IDEA_COLOR,
    }
    catalog.set(id, node)
    if (showIdeas) nodes.push(node)
  }

  for (const entity of state.entities ?? []) {
    if (!isEntityType(entity.entityType)) continue
    const node: RelationNode = {
      id: entity.id,
      layer: 'entity',
      entityType: entity.entityType,
      label: entity.name.trim() || '未命名',
      shape: 'square',
      color: ENTITY_COLORS[entity.entityType],
    }
    catalog.set(entity.id, node)
    nodes.push(node)
  }

  const visible = new Set(nodes.map((node) => node.id))
  const edges: RelationEdge[] = []
  for (const edge of state.canvas.edges) {
    if (!edge.kind || !isEdgeKind(edge.kind)) continue
    if (!kindEnabled(edge.kind, filter)) continue
    if (edge.kind === 'relates' && !relationEnabled(edge.relation, filter)) continue

    const fromNode = catalog.get(edge.fromNode)
    const toNode = catalog.get(edge.toNode)
    if (edge.kind === 'appears-in') {
      // 出场的一端是场次卡，不在念头层，也不占设定物节点。设定物那一端在图上就保留这条边。
      const entityNode = [fromNode, toNode].find((node) => node !== undefined && node.layer === 'entity' && visible.has(node.id))
      const otherId = entityNode?.id === edge.fromNode ? edge.toNode : edge.fromNode
      const otherKnown = Boolean(state.snowflake.cards[otherId] || catalog.get(otherId))
      if (!entityNode || !otherKnown) continue
    } else if (!fromNode || !toNode || !visible.has(fromNode.id) || !visible.has(toNode.id)) {
      continue
    }

    const item: RelationEdge = {
      id: edge.id,
      from: edge.fromNode,
      to: edge.toNode,
      kind: edge.kind,
    }
    if (edge.relation) item.relation = edge.relation
    const label = edgeLabel(edge.kind, edge.relation)
    if (label) item.label = label
    edges.push(item)
  }

  return { nodes, edges }
}
