import { knownSessionIds } from './discuss-store.mjs'

export function stripTimeline(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  const marker = text.indexOf('<!-- timeline -->')
  if (marker < 0) return text.trimEnd()
  return text.slice(0, marker).trimEnd()
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function cardsOf(document) {
  const cards = document && document.snowflake && document.snowflake.cards
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return {}
  return cards
}

function edgesOf(document) {
  const edges = document && document.canvas && document.canvas.edges
  return Array.isArray(edges) ? edges : []
}

function entitiesOf(document) {
  return Array.isArray(document && document.entities) ? document.entities : []
}

function clipChars(text, max) {
  return Array.from(text).slice(0, max).join('')
}

export function parentCardBody(document, cardId) {
  const cards = cardsOf(document)
  for (const edge of edgesOf(document)) {
    if (!edge || edge.kind !== 'grows-from' || edge.toNode !== cardId) continue
    const parent = cards[edge.fromNode]
    if (!parent) continue
    return typeof parent.body === 'string' ? parent.body : ''
  }
  return null
}

export function projectedEntities(document, cardId) {
  const byId = new Map()
  for (const entity of entitiesOf(document)) {
    if (entity && typeof entity.id === 'string' && entity.id) byId.set(entity.id, entity)
  }
  const seen = new Set()
  const out = []
  for (const edge of edgesOf(document)) {
    if (!edge || edge.kind !== 'projects-onto' || edge.fromNode !== cardId) continue
    if (typeof edge.toNode !== 'string' || seen.has(edge.toNode)) continue
    const entity = byId.get(edge.toNode)
    if (!entity) continue
    seen.add(edge.toNode)
    const slug = typeof entity.slug === 'string' ? entity.slug.trim() : ''
    const name = typeof entity.name === 'string' ? entity.name.trim() : ''
    out.push({ id: entity.id, name, slug })
  }
  return out
}

function entityLabel(entity) {
  return entity.name || entity.slug || entity.id
}

export async function finalizedDigest(entities, io) {
  if (!io || io.available !== true) return '定稿读不到'
  const take = entities.slice(0, 8)
  const rest = entities.length - take.length
  const blocks = []
  for (const entity of take) {
    const label = entityLabel(entity)
    if (!entity.slug) {
      blocks.push(`${label}\n还没有定稿`)
      continue
    }
    try {
      const raw = await io.getPage(entity.slug)
      blocks.push(`${label}\n${stripTimeline(raw)}`)
    } catch {
      blocks.push(`${label}\n还没有定稿`)
    }
  }
  if (rest > 0) blocks.push(`还有 ${rest} 个没带`)
  return blocks.join('\n\n')
}

export function renderDiscussContext(cardText, parentText, finalizedText) {
  const finalized = finalizedText ? `\n${finalizedText}` : ''
  return `这张卡\n${cardText}\n\n父卡摘要\n${parentText}\n\n定稿摘要${finalized}`
}

export async function collectDiscussContext(document, cardId, io) {
  const card = cardsOf(document)[cardId]
  const body = card && typeof card.body === 'string' ? card.body : ''
  const cardText = body.trim() ? body : '这张卡还没有正文'
  const parent = parentCardBody(document, cardId)
  const parentText = parent === null ? '没有父卡' : clipChars(parent, 200)
  const finalizedText = await finalizedDigest(projectedEntities(document, cardId), io)
  return renderDiscussContext(cardText, parentText, finalizedText)
}

export function withDiscussContext(instructions, contextText) {
  return `${instructions}\n\n${contextText}`
}

export function discussSessionCreateBody(title, instructions, contextText) {
  return { title, system_prompt: withDiscussContext(instructions, contextText) }
}

export function discussSessionResponse(cardId, sessionId, sessions, context) {
  return { cardId, sessionId, sessions, context }
}

export async function postGatewaySession({ cardId, store, contextText, instructions, apiKey, fetchImpl }) {
  if (!apiKey) throw httpError(503, 'API_SERVER_KEY 未注入')
  const used = new Set(knownSessionIds(store))
  let lastStatus = 502
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const createdAt = new Date().toISOString()
    const nonce = Math.random().toString(36).slice(2, 8)
    const title = `念头讨论 ${createdAt} ${nonce}`
    const created = await fetchImpl('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(discussSessionCreateBody(title, instructions, contextText)),
    })
    const payload = await created.json().catch(() => ({}))
    lastStatus = created.status
    if (created.status === 201 && payload.session && typeof payload.session.id === 'string') {
      const sessionId = payload.session.id.trim()
      if (sessionId && !used.has(sessionId)) {
        return { sessionId, title, createdAt, cardId, firstAskOpen: true }
      }
    }
  }
  throw httpError(lastStatus === 503 ? 503 : 502, '画布会话没有建成')
}
