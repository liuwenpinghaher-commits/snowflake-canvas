import {
  addEdge,
  applySediment,
  commitCardText,
  fieldKeys,
  type AppState,
  type Entity,
  type EntityType,
} from './document.ts'

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  person: '人物',
  place: '地点',
  org: '组织',
  concept: '概念',
  theme: '主题',
  'foreshadow-line': '伏笔线',
}

/** 拉回只写一条 replace。整页定稿落在「一句」上，人物卡片能看见。 */
export const PULL_FIELD = 'sentence'

export function bindLabel(slug: string | undefined): string {
  const text = typeof slug === 'string' ? slug.trim() : ''
  return text ? `已绑定 ${text}` : '还没绑定'
}

export function bindEntitySlug(state: AppState, entityId: string, raw: string): AppState {
  const entities = state.entities ?? []
  const index = entities.findIndex((entity) => entity.id === entityId)
  if (index < 0) return state
  const slug = raw.trim()
  const current = entities[index]
  if (!current) return state
  if (!slug) {
    if (current.slug === undefined) return state
    const next: Entity = { ...current }
    delete next.slug
    const copy = entities.slice()
    copy[index] = next
    return { ...state, entities: copy }
  }
  if (current.slug === slug) return state
  const copy = entities.slice()
  copy[index] = { ...current, slug }
  return { ...state, entities: copy }
}

export function pullFinalized(
  state: AppState,
  input: { entityId: string; ideaId: string; text: string; requestId: string; at: string },
): { state: AppState; saved: boolean } {
  const ideaId = input.ideaId.trim()
  const requestId = input.requestId.trim()
  const text = input.text.trim()
  if (!ideaId || !requestId || !text) return { state, saved: false }
  const entity = (state.entities ?? []).find((item) => item.id === input.entityId)
  if (!entity) return { state, saved: false }
  const card = state.snowflake.cards[ideaId]
  if (!card || card.layer !== 'situation') return { state, saved: false }
  let next = state
  const linked = next.canvas.edges.some(
    (edge) => edge.kind === 'projects-onto' && edge.fromNode === ideaId && edge.toNode === entity.id,
  )
  if (!linked) {
    const withEdge = addEdge(next, ideaId, entity.id, 'projects-onto')
    if (withEdge === next) return { state, saved: false }
    next = withEdge
  }
  const before = next.sediment?.length ?? 0
  const saved = applySediment(next, {
    id: `sed-${requestId}`,
    requestId,
    kind: 'manual',
    ideaId,
    at: input.at,
    target: { entityType: entity.entityType, entityId: entity.id, fieldKey: PULL_FIELD },
    action: 'replace',
    quote: text,
    status: 'written',
  })
  if ((saved.sediment?.length ?? 0) === before) return { state, saved: false }
  const viewId = entity.views.renwubiao
  const view = viewId ? saved.snowflake.cards[viewId] : undefined
  if (!viewId || !view || !fieldKeys(view.layer).includes(PULL_FIELD)) return { state: saved, saved: true }
  return { state: commitCardText(saved, viewId, text, PULL_FIELD, false), saved: true }
}
