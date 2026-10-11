import { markAdoptionSediment, sessionOwned } from './discuss-store.mjs'
import { loadDocumentModule } from './load-document.mjs'

const ACTIONS = new Set(['append', 'replace', 'negate'])
const timelineWrote = new Set()

export function clearTimelineMemory() {
  timelineWrote.clear()
}

function textField(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function rejected(statusCode, error, document, store) {
  return { statusCode, payload: { error }, document, store }
}

function fieldValue(document, entityId, fieldKey) {
  const entity = (document.entities || []).find((item) => item && item.id === entityId)
  const field = entity && entity.fields ? entity.fields[fieldKey] : undefined
  return field && typeof field.value === 'string' ? field.value : ''
}

function withStatus(document, requestId, status) {
  return {
    ...document,
    sediment: (document.sediment || []).map((event) => (event.requestId === requestId ? { ...event, status } : event)),
  }
}

function detailText({ bookId, cardId, sessionId, adoptionKey, requestId }) {
  return `bookId=${bookId} cardId=${cardId} sessionId=${sessionId} adoptionKey=${adoptionKey} requestId=${requestId}`
}

function timelinePage(entity) {
  if (!entity || typeof entity.slug !== 'string') return ''
  return entity.slug.trim()
}

function wroteKey(bookId, requestId) {
  return `${bookId}\0${requestId}`
}

async function appendTimeline(deps, bookId, requestId, page, detail) {
  const key = wroteKey(bookId, requestId)
  if (timelineWrote.has(key)) return { ok: true }
  if (await deps.gbrainDisabled()) return { ok: false }
  try {
    await deps.addTimeline(page, detail, '百科没写上')
    timelineWrote.add(key)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

function finish(document, store, bookId, cardId, sessionId, entityId, fieldKey, adoptionKey, requestId, status) {
  const nextStore = markAdoptionSediment(store, cardId, sessionId, adoptionKey, { sedimentStatus: status, requestId })
  const payload = {
    ok: status === 'written',
    status,
    requestId,
    cardId,
    sessionId,
    entityId,
    fieldKey,
    adoptionKey,
    value: fieldValue(document, entityId, fieldKey),
  }
  if (status === 'failed') payload.error = '百科没写上'
  return { statusCode: 200, payload, document, store: nextStore }
}

function requireBody(body) {
  const cardId = textField(body.cardId)
  const sessionId = textField(body.sessionId)
  const entityId = textField(body.entityId)
  const fieldKey = textField(body.fieldKey)
  const action = textField(body.action)
  const requestId = textField(body.requestId)
  const quote = typeof body.quote === 'string' ? body.quote : ''
  const missing = [
    ['cardId', cardId],
    ['sessionId', sessionId],
    ['entityId', entityId],
    ['fieldKey', fieldKey],
    ['action', action],
    ['quote', quote.trim()],
    ['requestId', requestId],
  ].find(([, value]) => !value)
  if (missing) return { error: `缺少 ${missing[0]}` }
  if (!ACTIONS.has(action)) return { error: 'action 只能是 append、replace 或 negate' }
  if (fieldKey === 'philosophy') return { error: 'philosophy 只读，不能沉淀' }
  return { cardId, sessionId, entityId, fieldKey, action, requestId, quote }
}

// 讨论沉淀：先折叠书内 value，再补时间线。没有页名或时间线失败都不回滚 value。同一 requestId 不折第二次。
export async function writeSediment(args, deps) {
  const document = args.document
  const store = args.store
  const bookId = args.bookId
  const parsed = requireBody(args.body || {})
  if (parsed.error) return rejected(400, parsed.error, document, store)
  const { cardId, sessionId, entityId, fieldKey, action, requestId, quote } = parsed
  const sediment = Array.isArray(document.sediment) ? document.sediment : []
  const existing = sediment.find((event) => event && event.requestId === requestId)
  if (existing) {
    if (existing.status === 'written') {
      return finish(document, store, bookId, existing.ideaId || cardId, existing.sessionId || sessionId, existing.target?.entityId || entityId, existing.target?.fieldKey || fieldKey, existing.adoptionKey || textField(args.body.adoptionKey), requestId, 'written')
    }
    const adoptionKey = existing.adoptionKey || textField(args.body.adoptionKey)
    const entity = (document.entities || []).find((item) => item && item.id === (existing.target?.entityId || entityId))
    const page = timelinePage(entity)
    const retryCardId = existing.ideaId || cardId
    const retrySessionId = existing.sessionId || sessionId
    const retryEntityId = existing.target?.entityId || entityId
    const retryFieldKey = existing.target?.fieldKey || fieldKey
    if (!page) {
      const next = withStatus(document, requestId, 'failed')
      return finish(next, store, bookId, retryCardId, retrySessionId, retryEntityId, retryFieldKey, adoptionKey, requestId, 'failed')
    }
    const timeline = await appendTimeline(
      deps,
      bookId,
      requestId,
      page,
      detailText({
        bookId,
        cardId: retryCardId,
        sessionId: retrySessionId,
        adoptionKey,
        requestId,
      }),
    )
    const status = timeline.ok ? 'written' : 'failed'
    const next = withStatus(document, requestId, status)
    return finish(next, store, bookId, existing.ideaId || cardId, existing.sessionId || sessionId, existing.target?.entityId || entityId, existing.target?.fieldKey || fieldKey, adoptionKey, requestId, status)
  }

  const cards = document.snowflake && document.snowflake.cards
  if (!cards || !cards[cardId]) return rejected(400, `没有这张念头卡：${cardId}`, document, store)
  if (!sessionOwned(store, cardId, sessionId)) return rejected(400, 'cardId 对不上该会话', document, store)
  const entities = Array.isArray(document.entities) ? document.entities : []
  const entity = entities.find((item) => item && item.id === entityId)
  if (!entity) return rejected(404, `没有这个实体：${entityId}，没有写入时间线`, document, store)

  let adoptionKey = textField(args.body.adoptionKey)
  if (!adoptionKey) {
    const resolved = await deps.resolveQuote(sessionId, quote.trim())
    if (!resolved || resolved.error || !resolved.adoptionKey) {
      return rejected(400, (resolved && resolved.error) || `对不上这条消息：${quote.trim()}`, document, store)
    }
    adoptionKey = resolved.adoptionKey
  }

  const { applySediment } = await loadDocumentModule()
  const state = {
    ...document,
    canvas: {
      nodes: Array.isArray(document.canvas?.nodes) ? document.canvas.nodes : [],
      edges: Array.isArray(document.canvas?.edges) ? document.canvas.edges : [],
    },
    entities,
    sediment,
  }
  const event = {
    id: `sed-${requestId}`,
    requestId,
    kind: 'discuss',
    ideaId: cardId,
    sessionId,
    adoptionKey,
    at: new Date().toISOString(),
    target: { entityType: entity.entityType, entityId, fieldKey },
    action,
    quote,
    status: 'proposed',
  }
  const folded = applySediment(state, event)
  if (folded === state) return rejected(400, '这句话没有写进账本', document, store)
  const page = timelinePage(entity)
  if (!page) {
    const next = withStatus(folded, requestId, 'failed')
    return finish(next, store, bookId, cardId, sessionId, entityId, fieldKey, adoptionKey, requestId, 'failed')
  }
  const timeline = await appendTimeline(deps, bookId, requestId, page, detailText({ bookId, cardId, sessionId, adoptionKey, requestId }))
  const status = timeline.ok ? 'written' : 'failed'
  const next = withStatus(folded, requestId, status)
  return finish(next, store, bookId, cardId, sessionId, entityId, fieldKey, adoptionKey, requestId, status)
}
