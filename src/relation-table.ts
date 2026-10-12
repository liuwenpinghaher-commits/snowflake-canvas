import { cardFace, type AppState, type CanvasEdge } from './document.ts'
import { buildRelationGraph, edgeKindLabel, type RelationFilter } from './relations.ts'

export interface RelationTableRow {
  id: string
  from: string
  to: string
  kind: string
  relation: string
}

export function endpointLabel(state: AppState, nodeId: string): string {
  const entity = (state.entities ?? []).find((item) => item.id === nodeId)
  const entityName = entity?.name.trim() ?? ''
  if (entityName) return entityName
  const card = state.snowflake.cards[nodeId]
  if (card) {
    const title = cardFace(card).title.trim()
    if (title) return title
  }
  const node = state.canvas.nodes.find((item) => item.id === nodeId)
  const text = node?.text?.trim() ?? ''
  if (text) return text
  return nodeId
}

export function relationKindText(edge: CanvasEdge): string {
  if (!edge.kind) return ''
  return edgeKindLabel(edge.kind, edge.relation)
}

export function relationWord(edge: CanvasEdge): string {
  if (edge.relation) return edge.relation
  return edge.label ?? ''
}

/** 行来自当前筛选下的 CanvasEdge，不写回第二份边。 */
export function relationTableRows(state: AppState, filter: RelationFilter): RelationTableRow[] {
  const visible = new Set(buildRelationGraph(state, filter).edges.map((edge) => edge.id))
  const rows: RelationTableRow[] = []
  for (const edge of state.canvas.edges) {
    if (!visible.has(edge.id)) continue
    rows.push({
      id: edge.id,
      from: endpointLabel(state, edge.fromNode),
      to: endpointLabel(state, edge.toNode),
      kind: relationKindText(edge),
      relation: relationWord(edge),
    })
  }
  return rows
}
