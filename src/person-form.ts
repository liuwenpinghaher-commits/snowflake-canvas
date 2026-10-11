import {
  ARCHIVE_GROUPS,
  ARC_KEYS,
  FIELD_LABEL,
  RENWUDANGAN_KEYS,
  RENWUGUSHI_KEYS,
  applySediment,
  cardFace,
  commitCardText,
  layerLabel,
  collectPersonEntities,
  emptyArc,
  extraFieldKeys,
  fieldKeys,
  mapGrade,
  mergeCards,
  type AppState,
  type ArcKey,
  type CanvasEdge,
  type Entity,
  type SedimentAction,
  type SedimentEvent,
} from './document.ts'

/** 区二字段头的一句话。文案取自方案 01 第 6 节区二，不另写一套。 */
export const NARRATIVE_HINTS: Record<string, string> = {
  sentence:
    '用一句话概括这个人：名字+核心矛盾+结局方向。来源：雪花法第三步；埃格里《编剧的艺术》第4章，前提是「人物+主张+结果」。',
  paragraph: '把一句扩成一段：他要什么、被什么挡住、最后怎么变。来源：雪花法第四步。',
  motivation:
    '他为什么在意——必须能回溯到过去/错误信念，不是「他想当国王」。来源：6W 第7章（Why）。',
  goal: '外部可见的目标（进入故事的欲望对象）。来源：麦基《故事经济学》第8章。',
  conflict: '谁/什么在挡他，且对手同样有理。来源：埃格里《编剧的艺术》第14章、第16章。',
  epiphany: '故事终点他明白了什么（内在转变的瞬间）。来源：6W 第12章；Bell《这样写出好故事》第55章。',
  arc: '起始点→门→影响事件→加深→转变→后果，六格清单（可空）。来源：Bell《这样写出好故事》第55章；埃格里《编剧的艺术》第8章。',
}

export const ARC_LABEL: Record<ArcKey, string> = {
  start: '起始点',
  door: '门',
  impact: '影响事件',
  deepen: '加深',
  turn: '转变',
  consequence: '后果',
}

export const NARRATIVE_FIELD_KEYS = ['sentence', 'paragraph', 'motivation', 'goal', 'conflict', 'epiphany'] as const

const STORY_SET = new Set<string>(RENWUGUSHI_KEYS)
const ARCHIVE_SET = new Set<string>(RENWUDANGAN_KEYS)

export interface GradeVisibility {
  level: '主要' | '次要' | 'NPC' | '路人'
  /** 路人只有一行摘要，表格行不展开四分区。 */
  summaryOnly: boolean
  /** 不点「更多」就露出的字段。NPC 只有名字、角色、一句。 */
  shown: readonly string[]
  /** 叙事功能区（一句到顿悟）是否直接显示。 */
  narrative: boolean
  /** 弧线六格是否直接显示。主要才全显。 */
  arc: boolean
  /** 档案区是否提供。默认仍折叠。 */
  archive: boolean
  /** 视角样章是否直接显示。 */
  sample: boolean
  /** NPC 把其余收进「更多」。 */
  more: boolean
}

export function gradeVisibility(grade: string | undefined): GradeVisibility {
  const level = mapGrade(grade) as GradeVisibility['level']
  if (level === '路人') {
    return {
      level,
      summaryOnly: true,
      shown: ['name', 'grade', 'sentence'],
      narrative: false,
      arc: false,
      archive: false,
      sample: false,
      more: false,
    }
  }
  if (level === 'NPC') {
    return {
      level,
      summaryOnly: false,
      shown: ['name', 'role', 'sentence'],
      narrative: false,
      arc: false,
      archive: false,
      sample: false,
      more: true,
    }
  }
  if (level === '次要') {
    return {
      level,
      summaryOnly: false,
      shown: ['name', 'role', 'grade', 'sentence', 'paragraph', 'motivation', 'goal', 'conflict', 'epiphany'],
      narrative: true,
      arc: false,
      archive: true,
      sample: true,
      more: false,
    }
  }
  return {
    level: '主要',
    summaryOnly: false,
    shown: ['name', 'role', 'grade', 'sentence', 'paragraph', 'motivation', 'goal', 'conflict', 'epiphany', 'arc'],
    narrative: true,
    arc: true,
    archive: true,
    sample: true,
    more: false,
  }
}

// 只认书里的实体。对不上就当没有这个人，不再造 entity-卡号 这种写不进页名的假实体。
export function entityForPersonCard(state: AppState, cardId: string): Entity | undefined {
  return personEntityForCard(state, cardId)
}

export function personEntityForCard(state: AppState, cardId: string): Entity | undefined {
  return (state.entities ?? []).find(
    (entity) =>
      entity.entityType === 'person' &&
      (entity.views.renwubiao === cardId || entity.views.renwugushi === cardId || entity.views.renwudangan === cardId),
  )
}

export function ideaOptions(state: AppState): { id: string; title: string }[] {
  const options: { id: string; title: string }[] = []
  for (const [id, card] of Object.entries(state.snowflake.cards)) {
    if (card.layer !== 'situation') continue
    const title = cardFace(card).title.trim() || '未命名念头'
    options.push({ id, title })
  }
  return options
}

export function ideaTitle(state: AppState, ideaId: string): string {
  const card = state.snowflake.cards[ideaId]
  if (!card) return '找不到这条念头'
  return cardFace(card).title.trim() || '未命名念头'
}

export function projectingIdeas(state: AppState, entityId: string): { id: string; title: string }[] {
  const ids: string[] = []
  for (const edge of state.canvas.edges) {
    if (edge.kind !== 'projects-onto' || edge.toNode !== entityId) continue
    if (!ids.includes(edge.fromNode)) ids.push(edge.fromNode)
  }
  return ids.map((id) => ({ id, title: ideaTitle(state, id) }))
}

export function projectedPersons(entities: readonly Entity[], edges: readonly CanvasEdge[], ideaId: string): Entity[] {
  const ids = new Set<string>()
  for (const edge of edges) {
    if (edge.kind === 'projects-onto' && edge.fromNode === ideaId) ids.add(edge.toNode)
  }
  return entities.filter((entity) => entity.entityType === 'person' && ids.has(entity.id))
}

export const MANY_PERSONS_HINT = '这条念头连着多个人，先点一个'

export type SedimentDefault =
  | { step: 1 | 2 | 4; entityId: string }
  | { step: 3; hint: string; personIds: string[] }
  | { step: 5 }
  | { step: 0 }

/** 沉淀面板的默认目标。顺序与方案 01 第 13 节一致，取到就停。 */
export function defaultSedimentTarget(input: {
  sessionId: string
  ideaId: string
  sediment: readonly SedimentEvent[]
  entities: readonly Entity[]
  edges: readonly CanvasEdge[]
}): SedimentDefault {
  const sessionId = input.sessionId.trim()
  if (sessionId) {
    let latest: SedimentEvent | undefined
    for (const event of input.sediment) {
      if (event.sessionId !== sessionId || event.superseded === true) continue
      if (!latest || event.at >= latest.at) latest = event
    }
    const previousId = latest?.target.entityId
    if (previousId && input.entities.some((entity) => entity.id === previousId)) {
      return { step: 1, entityId: previousId }
    }
  }
  const resolved: Entity[] = []
  const seen = new Set<string>()
  let projectionCount = 0
  for (const edge of input.edges) {
    if (edge.kind !== 'projects-onto' || edge.fromNode !== input.ideaId) continue
    projectionCount += 1
    if (seen.has(edge.toNode)) continue
    seen.add(edge.toNode)
    const entity = input.entities.find((item) => item.id === edge.toNode)
    if (entity) resolved.push(entity)
  }
  const persons = resolved.filter((entity) => entity.entityType === 'person')
  if (persons.length === 1) return { step: 2, entityId: persons[0].id }
  if (persons.length > 1) return { step: 3, hint: MANY_PERSONS_HINT, personIds: persons.map((entity) => entity.id) }
  if (persons.length === 0 && resolved.length === 1) return { step: 4, entityId: resolved[0].id }
  if (projectionCount === 0) return { step: 5 }
  return { step: 0 }
}

export function createPersonEntity(state: AppState, id: string, name: string): AppState {
  const trimmed = name.trim()
  if (!id || (state.entities ?? []).some((entity) => entity.id === id)) return state
  const entity: Entity = {
    id,
    entityType: 'person',
    name: trimmed,
    views: {},
    fields: trimmed ? { name: { value: trimmed, events: [] } } : {},
    arc: emptyArc(),
    premise: false,
  }
  return { ...state, entities: [...(state.entities ?? []), entity] }
}

export function discussPrompt(fieldKey: string): string {
  return `${fieldLabel(fieldKey)}这一栏空着，接着谈`
}

const ENTITY_KIND_LABEL: Record<string, string> = {
  person: '人物表',
  place: '地点',
  org: '组织',
  concept: '概念',
  theme: '主题',
  'foreshadow-line': '伏笔线',
}

export function formatGrowthLine(
  state: AppState,
  hit: { entityId: string; fieldKey: string },
): { entityId: string; fieldKey: string; label: string } {
  const entity = (state.entities ?? []).find((item) => item.id === hit.entityId)
  const entityName = entity?.name.trim() || '未命名'
  const fieldName = fieldLabel(hit.fieldKey)
  let processName = ENTITY_KIND_LABEL.person
  if (entity) {
    const viewId = viewCardFor(entity, hit.fieldKey)
    const card = viewId ? state.snowflake.cards[viewId] : undefined
    if (card) processName = cardFace(card).title.trim() || layerLabel(card.layer)
    else processName = ENTITY_KIND_LABEL[entity.entityType] ?? entity.entityType
  }
  return { entityId: hit.entityId, fieldKey: hit.fieldKey, label: `${processName} ${entityName}·${fieldName}` }
}

export function fieldLabel(key: string): string {
  if (key.startsWith('arc.')) {
    const arcKey = key.slice(4) as ArcKey
    return ARC_LABEL[arcKey] ?? key
  }
  if (key === 'sentence') return '一句'
  if (key === 'paragraph') return '一段'
  return FIELD_LABEL[key] ?? key
}

export function readPersonField(state: AppState, entity: Entity, key: string): string {
  if (key === 'philosophy') {
    return entity.fields.motivation?.value ?? cardField(state, entity.views.renwubiao, 'motivation')
  }
  const arcKey = arcKeyOf(key)
  if (arcKey) return entity.arc[arcKey] ?? ''
  const direct = entity.fields[key]?.value ?? ''
  if (direct.trim()) return direct
  return cardField(state, viewCardFor(entity, key), key)
}

function cardField(state: AppState, cardId: string | undefined, key: string): string {
  if (!cardId) return ''
  return state.snowflake.cards[cardId]?.fields[key] ?? ''
}

export function arcKeyOf(fieldKey: string): ArcKey | null {
  if (!fieldKey.startsWith('arc.')) return null
  const key = fieldKey.slice(4)
  return (ARC_KEYS as readonly string[]).includes(key) ? (key as ArcKey) : null
}

export function viewCardFor(entity: Entity, fieldKey: string): string | undefined {
  if (STORY_SET.has(fieldKey)) return entity.views.renwugushi
  if (ARCHIVE_SET.has(fieldKey) && fieldKey !== 'philosophy') return entity.views.renwudangan
  return entity.views.renwubiao
}

export function fieldEvents(state: AppState, entityId: string, fieldKey: string): SedimentEvent[] {
  return (state.sediment ?? []).filter(
    (event) => event.target.entityId === entityId && event.target.fieldKey === fieldKey && event.superseded !== true,
  )
}

/** 手填不带角标。角标只数讨论或导入留下的事件。 */
export function traceEvents(events: readonly SedimentEvent[]): SedimentEvent[] {
  return events.filter((event) => event.kind !== 'manual')
}

export interface TraceHit {
  eventId: string
  ideaId: string
  ideaTitle: string
  entityId: string
  fieldKey: string
  action: SedimentAction
  at: string
  sessionId: string
  adoptionKey: string
  failed: boolean
  label: string
}

export function traceField(state: AppState, entityId: string, fieldKey: string): TraceHit[] {
  return traceEvents(fieldEvents(state, entityId, fieldKey)).map((event) => ({
    eventId: event.id,
    ideaId: event.ideaId,
    ideaTitle: ideaTitle(state, event.ideaId),
    entityId: event.target.entityId,
    fieldKey: event.target.fieldKey,
    action: event.action,
    at: event.at,
    sessionId: event.sessionId ?? '',
    adoptionKey: event.adoptionKey ?? '',
    failed: event.status === 'failed',
    label: event.status === 'failed' ? '百科没写上' : event.quote,
  }))
}

export function traceIdeaFields(state: AppState, ideaId: string): { entityId: string; fieldKey: string }[] {
  const seen = new Set<string>()
  const hits: { entityId: string; fieldKey: string }[] = []
  for (const event of state.sediment ?? []) {
    if (event.ideaId !== ideaId || event.superseded) continue
    const key = `${event.target.entityId}\0${event.target.fieldKey}`
    if (seen.has(key)) continue
    seen.add(key)
    hits.push({ entityId: event.target.entityId, fieldKey: event.target.fieldKey })
  }
  return hits
}

export function eventsForEntity(state: AppState, entityId: string): SedimentEvent[] {
  return (state.sediment ?? []).filter((event) => event.target.entityId === entityId)
}

export function groupEventsByIdea(events: readonly SedimentEvent[]): { ideaId: string; events: SedimentEvent[] }[] {
  const order: string[] = []
  const groups = new Map<string, SedimentEvent[]>()
  for (const event of events) {
    const list = groups.get(event.ideaId)
    if (!list) {
      order.push(event.ideaId)
      groups.set(event.ideaId, [event])
    } else {
      list.push(event)
    }
  }
  return order.map((ideaId) => ({ ideaId, events: groups.get(ideaId) ?? [] }))
}

function putCardArc(state: AppState, cardId: string, key: ArcKey, value: string): AppState {
  const card = state.snowflake.cards[cardId]
  if (!card) return state
  const arc = { ...(card.arc ?? emptyArc()), [key]: value }
  return {
    ...state,
    snowflake: {
      ...state.snowflake,
      cards: { ...state.snowflake.cards, [cardId]: { ...card, arc } },
    },
  }
}

function patchEntity(
  state: AppState,
  entityId: string,
  recipe: (entity: Entity) => Entity,
): AppState {
  const entities = (state.entities ?? []).map((entity) => (entity.id === entityId ? recipe(entity) : entity))
  return { ...state, entities }
}

function ensurePerson(state: AppState, cardId: string | null, entityId: string | null): { state: AppState; entity: Entity | undefined } {
  const found =
    (entityId ? (state.entities ?? []).find((entity) => entity.id === entityId && entity.entityType === 'person') : undefined) ??
    (cardId ? personEntityForCard(state, cardId) : undefined)
  if (found) return { state, entity: found }
  if (!cardId) return { state, entity: undefined }
  const derived = collectPersonEntities(state.snowflake.cards).find(
    (entity) => entity.views.renwubiao === cardId || entity.views.renwugushi === cardId || entity.views.renwudangan === cardId,
  )
  if (!derived) return { state, entity: undefined }
  if ((state.entities ?? []).some((entity) => entity.id === derived.id)) {
    return { state, entity: (state.entities ?? []).find((entity) => entity.id === derived.id) }
  }
  return { state: { ...state, entities: [...(state.entities ?? []), derived] }, entity: derived }
}

export function applyManualField(
  state: AppState,
  input: {
    cardId: string | null
    entityId: string | null
    fieldKey: string
    text: string
    ideaId: string
    requestId: string
    at: string
  },
): AppState {
  if (!input.ideaId.trim() || !input.requestId.trim()) return state
  if (input.fieldKey === 'philosophy') return state
  const stored = input.fieldKey === 'grade' ? mapGrade(input.text) : input.text
  if (!stored.trim()) return state
  const arcKey = arcKeyOf(input.fieldKey)
  let next = state
  const preview = ensurePerson(next, input.cardId, input.entityId)
  if (!arcKey) {
    const viewId = preview.entity ? viewCardFor(preview.entity, input.fieldKey) : undefined
    const cardId = viewId && next.snowflake.cards[viewId] ? viewId : input.cardId
    const card = cardId ? next.snowflake.cards[cardId] : undefined
    const owned = card ? fieldKeys(card.layer).includes(input.fieldKey) || extraFieldKeys(card).includes(input.fieldKey) : false
    if (cardId && owned) {
      const written = commitCardText(next, cardId, stored, input.fieldKey, false)
      if (written !== next) next = written
    }
  }
  const ensured = ensurePerson(next, input.cardId, input.entityId ?? preview.entity?.id ?? null)
  next = ensured.state
  const entity = ensured.entity
  if (!entity) return state
  if (arcKey) {
    next = patchEntity(next, entity.id, (current) => ({
      ...current,
      arc: { ...current.arc, [arcKey]: stored },
    }))
    const viewId = entity.views.renwubiao
    if (viewId) next = putCardArc(next, viewId, arcKey, stored)
  }
  const before = next.sediment?.length ?? 0
  const saved = applySediment(next, {
    id: `sed-${input.requestId}`,
    requestId: input.requestId,
    kind: 'manual',
    ideaId: input.ideaId,
    at: input.at,
    target: { entityType: 'person', entityId: entity.id, fieldKey: input.fieldKey },
    action: 'replace',
    quote: stored,
    status: 'written',
  })
  if ((saved.sediment?.length ?? 0) === before) return state
  if (input.fieldKey !== 'name') return saved
  return patchEntity(saved, entity.id, (current) => ({ ...current, name: stored.trim() || current.name }))
}

export function mergePendingEntity(state: AppState, name: string): { state: AppState; attached: boolean } {
  const pending = (state.pendingEntities ?? []).find((item) => item.name === name)
  if (!pending || pending.cardIds.length < 2) return { state, attached: false }
  const [target, ...drops] = pending.cardIds
  const merged = mergeCards(state, target, drops)
  if (merged === state) return { state, attached: false }
  return {
    attached: true,
    state: {
      ...merged,
      pendingEntities: (merged.pendingEntities ?? []).filter((item) => item.name !== name),
    },
  }
}

export function archiveGroupTitles(): { title: string; egri?: string; keys: readonly string[] }[] {
  return ARCHIVE_GROUPS.map((group) => ({
    title: group.title,
    egri: 'egri' in group ? group.egri : undefined,
    keys: group.keys,
  }))
}

export function actionLabel(action: SedimentAction): string {
  if (action === 'append') return '追加'
  if (action === 'replace') return '替换'
  return '否定'
}
