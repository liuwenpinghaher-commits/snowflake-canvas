import { useState } from 'react'
import { RELATION_KINDS, type AppState, type RelationKind } from './document.ts'
import {
  RELATION_GROUP_LABEL,
  RELATION_GROUPS,
  buildRelationGraph,
  defaultRelationFilter,
  type RelationEdge,
  type RelationFilter,
  type RelationGroup,
  type RelationNode,
} from './relations.ts'

function copyFilter(filter: RelationFilter): RelationFilter {
  return {
    ideaLayer: filter.ideaLayer,
    groups: { ...filter.groups },
    ...(filter.relations ? { relations: { ...filter.relations } } : {}),
  }
}

function edgeCaption(edge: RelationEdge, nodes: readonly RelationNode[]): string {
  if (edge.kind === 'appears-in') {
    const entity =
      nodes.find((node) => node.id === edge.to && node.layer === 'entity') ??
      nodes.find((node) => node.id === edge.from && node.layer === 'entity')
    return entity ? `出场：${entity.label}` : '出场'
  }
  if (edge.relation) return edge.relation
  return edge.label ?? ''
}

function layoutNodes(nodes: readonly RelationNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const place = (group: readonly RelationNode[], y: number) => {
    group.forEach((node, index) => {
      const x = group.length === 1 ? 360 : 72 + (index * (720 - 144)) / (group.length - 1)
      pos.set(node.id, { x, y })
    })
  }
  place(nodes.filter((node) => node.layer === 'entity'), 110)
  place(nodes.filter((node) => node.layer === 'idea'), 280)
  return pos
}

export default function RelationPage({
  state,
  initialFilter,
}: {
  state: AppState
  initialFilter?: RelationFilter
}) {
  const [filter, setFilter] = useState<RelationFilter>(() => copyFilter(initialFilter ?? defaultRelationFilter()))
  const graph = buildRelationGraph(state, filter)
  const pos = layoutNodes(graph.nodes)
  const hasRelates = state.canvas.edges.some((edge) => edge.kind === 'relates')

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

  return (
    <section className="relation-page" aria-label="关系">
      <aside className="relation-filter" aria-label="关系过滤">
        <h2>关系</h2>
        <label>
          <input
            type="checkbox"
            checked={filter.ideaLayer}
            onChange={() => setFilter((current) => ({ ...current, ideaLayer: !current.ideaLayer }))}
          />
          念头层
        </label>
        {RELATION_GROUPS.map((group) => (
          <div key={group} className="relation-group">
            <label>
              <input type="checkbox" checked={filter.groups[group]} onChange={() => toggleGroup(group)} />
              {RELATION_GROUP_LABEL[group]}
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
                    {kind}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </aside>
      <div className="relation-stage">
        {graph.nodes.length === 0 ? <p>还没有可画的设定物或念头。</p> : null}
        <svg className="relation-svg" viewBox="0 0 720 380" role="img" aria-label="关系图">
          {graph.edges.map((edge) => {
            const from = pos.get(edge.from)
            const to = pos.get(edge.to)
            if (!from || !to) return null
            const x = (from.x + to.x) / 2
            const y = (from.y + to.y) / 2
            return (
              <g key={edge.id}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="currentColor" />
                <text x={x} y={y - 6} textAnchor="middle">
                  {edgeCaption(edge, graph.nodes)}
                </text>
              </g>
            )
          })}
          {graph.nodes.map((node) => {
            const at = pos.get(node.id)
            if (!at) return null
            const appearances = graph.edges.filter(
              (edge) => edge.kind === 'appears-in' && (edge.to === node.id || edge.from === node.id) && !pos.get(edge.from === node.id ? edge.to : edge.from),
            )
            return (
              <g key={node.id}>
                {node.shape === 'circle' ? (
                  <circle cx={at.x} cy={at.y} r="22" fill={node.color} />
                ) : (
                  <rect x={at.x - 22} y={at.y - 22} width="44" height="44" rx="4" fill={node.color} />
                )}
                <text x={at.x} y={at.y + 40} textAnchor="middle">
                  {node.label}
                </text>
                {appearances.length > 0 ? (
                  <text x={at.x} y={at.y - 30} textAnchor="middle">
                    出场
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
        <ul className="relation-edge-list" aria-label="关系边上的字">
          {graph.edges.map((edge) => (
            <li key={edge.id}>{edgeCaption(edge, graph.nodes)}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
