import { useState } from 'react'
import { RELATION_KINDS, type AppState, type CanvasEdge, type Entity, type RelationKind } from './document.ts'
import { eventsForEntity, fieldLabel } from './person-form.ts'
import {
  RELATION_GROUP_LABEL,
  RELATION_GROUPS,
  buildRelationGraph,
  defaultRelationFilter,
  edgeKindLabel,
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

export type RelationSelection = { kind: 'node'; id: string } | { kind: 'edge'; id: string }

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

function SelectionPanel({
  state,
  open,
  onOpenPerson,
  onOpenEncyclopedia,
}: {
  state: AppState
  open: RelationSelection
  onOpenPerson?: (entityId: string) => void
  onOpenEncyclopedia?: () => void
}) {
  if (open.kind === 'node') {
    const entity = (state.entities ?? []).find((item) => item.id === open.id)
    if (!entity) return null
    const lines = draftLines(entity)
    const events = eventsForEntity(state, entity.id)
    return (
      <aside className="relation-side" aria-label="实体" onClick={(event) => event.stopPropagation()}>
        <h3>定稿摘要</h3>
        {lines.length === 0 ? <p>还没有定稿</p> : lines.map((line) => <p key={line}>{line}</p>)}
        <h3>沉淀账本</h3>
        {events.length === 0 ? <p>还没有沉淀</p> : events.map((event) => <p key={event.id}>{event.quote}</p>)}
        {entity.entityType === 'person' ? (
          <button type="button" onClick={() => onOpenPerson?.(entity.id)}>
            打开人物页
          </button>
        ) : null}
        <button type="button" onClick={() => onOpenEncyclopedia?.()}>
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

export default function RelationPage({
  state,
  initialFilter,
  initialSelection = null,
  focusId = null,
  onOpenPerson,
  onOpenEncyclopedia,
}: {
  state: AppState
  initialFilter?: RelationFilter
  initialSelection?: RelationSelection | null
  focusId?: string | null
  onOpenPerson?: (entityId: string) => void
  onOpenEncyclopedia?: () => void
}) {
  const [filter, setFilter] = useState<RelationFilter>(() => copyFilter(initialFilter ?? defaultRelationFilter()))
  const [open, setOpen] = useState<RelationSelection | null>(initialSelection)
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
      <div
        className="relation-stage"
        onClick={(event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          if (target.closest('.relation-side, .relation-node, .relation-edge, .relation-edge-list')) return
          setOpen(null)
        }}
      >
        {graph.nodes.length === 0 ? <p>还没有可画的设定物或念头。</p> : null}
        <svg className="relation-svg" viewBox="0 0 720 380" role="img" aria-label="关系图">
          <rect className="relation-blank" width="720" height="380" fill="transparent" onClick={() => setOpen(null)} />
          {graph.edges.map((edge) => {
            const from = pos.get(edge.from)
            const to = pos.get(edge.to)
            if (!from || !to) return null
            const x = (from.x + to.x) / 2
            const y = (from.y + to.y) / 2
            return (
              <g
                key={edge.id}
                className="relation-edge"
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen({ kind: 'edge', id: edge.id })
                }}
              >
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth="14" />
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
            const focused = focusId === node.id
            return (
              <g
                key={node.id}
                className="relation-node"
                data-focus={focused ? 'true' : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen({ kind: 'node', id: node.id })
                }}
              >
                {node.shape === 'circle' ? (
                  <circle cx={at.x} cy={at.y} r="22" fill={node.color} stroke="currentColor" strokeWidth={focused ? 3 : 0} />
                ) : (
                  <rect x={at.x - 22} y={at.y - 22} width="44" height="44" rx="4" fill={node.color} stroke="currentColor" strokeWidth={focused ? 3 : 0} />
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
        {open ? (
          <SelectionPanel state={state} open={open} onOpenPerson={onOpenPerson} onOpenEncyclopedia={onOpenEncyclopedia} />
        ) : null}
        <ul className="relation-edge-list" aria-label="关系边上的字">
          {graph.edges.map((edge) => (
            <li key={edge.id}>{edgeCaption(edge, graph.nodes)}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
