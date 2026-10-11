// 讨论会话按卡片分组。旧的单号文件只在能找到念头卡时迁入，迁不走就不改原文件。

export function situationTarget(document) {
  if (!document || typeof document !== 'object') return ''
  const snowflake = document.snowflake
  const canvas = document.canvas
  if (!snowflake || !snowflake.cards || typeof snowflake.cards !== 'object' || Array.isArray(snowflake.cards)) {
    return ''
  }
  const cards = snowflake.cards
  const nodes = canvas && Array.isArray(canvas.nodes) ? canvas.nodes : []
  const edges = canvas && Array.isArray(canvas.edges) ? canvas.edges : []
  const incoming = new Set()
  for (const edge of edges) {
    if (edge && typeof edge.toNode === 'string' && edge.toNode) incoming.add(edge.toNode)
  }
  const ordered = []
  const seen = new Set()
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || seen.has(node.id)) continue
    seen.add(node.id)
    ordered.push(node.id)
  }
  for (const id of Object.keys(cards)) {
    if (!seen.has(id)) ordered.push(id)
  }
  const situations = ordered.filter((id) => cards[id] && cards[id].layer === 'situation')
  const roots = situations.filter((id) => !incoming.has(id))
  if (roots.length > 0) return roots[0]
  return situations[0] || ''
}

export function isLegacyRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.cards && typeof value.cards === 'object') return false
  return typeof value.sessionId === 'string' && value.sessionId.trim().length > 0
}

export function emptyStore() {
  return { cards: {} }
}

function copyAdoptionFields(entry, item) {
  if (!entry.messageId && typeof item.messageId === 'string' && item.messageId) entry.messageId = item.messageId
  if (!entry.sedimentStatus && (item.sedimentStatus === 'written' || item.sedimentStatus === 'failed')) {
    entry.sedimentStatus = item.sedimentStatus
  }
  if (!entry.requestId && typeof item.requestId === 'string' && item.requestId) entry.requestId = item.requestId
  if (!entry.text && typeof item.text === 'string' && item.text) entry.text = item.text
}

function normalizeAdoptions(value) {
  const list = Array.isArray(value) ? value : []
  const out = []
  const seen = new Map()
  for (const item of list) {
    if (!item || typeof item.key !== 'string' || !item.key.trim()) continue
    const key = item.key.trim()
    const prev = seen.get(key)
    if (prev) {
      copyAdoptionFields(prev, item)
      continue
    }
    const entry = { key, adoptedAt: typeof item.adoptedAt === 'string' ? item.adoptedAt : '' }
    copyAdoptionFields(entry, item)
    out.push(entry)
    seen.set(key, entry)
  }
  return out
}

// 会话条目除了号和标题，还带首问预览和采纳记录；首问只给新建时标了 firstAskOpen 的会话写一次。
function sessionEntry(item, cardId) {
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '念头讨论'
  const entry = {
    sessionId: item.sessionId.trim(),
    title,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
    cardId,
  }
  const firstAsk = typeof item.firstAsk === 'string' ? item.firstAsk.trim() : ''
  if (firstAsk) entry.firstAsk = firstAsk
  else if (item.firstAskOpen === true) entry.firstAskOpen = true
  const adoptions = normalizeAdoptions(item.adoptions)
  if (adoptions.length > 0) entry.adoptions = adoptions
  return entry
}

export function normalizeStore(value) {
  const cards = {}
  const source = value && value.cards && typeof value.cards === 'object' && !Array.isArray(value.cards) ? value.cards : {}
  for (const [cardId, bucket] of Object.entries(source)) {
    if (!cardId || !bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue
    const sessions = []
    const list = Array.isArray(bucket.sessions) ? bucket.sessions : []
    for (const item of list) {
      if (!item || typeof item.sessionId !== 'string' || !item.sessionId.trim()) continue
      sessions.push(sessionEntry(item, cardId))
    }
    let lastSessionId = typeof bucket.lastSessionId === 'string' ? bucket.lastSessionId.trim() : ''
    if (!sessions.some((item) => item.sessionId === lastSessionId)) {
      lastSessionId = sessions.length > 0 ? sessions[sessions.length - 1].sessionId : ''
    }
    cards[cardId] = { lastSessionId, sessions }
  }
  return { cards }
}

export function storeFromLegacy(legacy, cardId, createdAt) {
  const sessionId = String(legacy.sessionId || '').trim()
  const title = typeof legacy.title === 'string' && legacy.title.trim() ? legacy.title.trim() : '画布讨论'
  return {
    cards: {
      [cardId]: {
        lastSessionId: sessionId,
        sessions: [{ sessionId, title, createdAt, cardId }],
      },
    },
  }
}

export function sessionOwned(store, cardId, sessionId) {
  if (!cardId || !sessionId) return false
  const bucket = store.cards[cardId]
  if (!bucket) return false
  return bucket.sessions.some((item) => item.sessionId === sessionId)
}

export function activeSessionId(store, cardId) {
  const bucket = store.cards[cardId]
  if (!bucket || bucket.sessions.length === 0) return ''
  if (bucket.lastSessionId && bucket.sessions.some((item) => item.sessionId === bucket.lastSessionId)) {
    return bucket.lastSessionId
  }
  return bucket.sessions[bucket.sessions.length - 1].sessionId
}

export function withSession(store, cardId, session) {
  const next = normalizeStore(store)
  const bucket = next.cards[cardId] || { lastSessionId: '', sessions: [] }
  const prior = bucket.sessions.find((item) => item.sessionId === session.sessionId)
  const sessions = bucket.sessions.filter((item) => item.sessionId !== session.sessionId)
  const merged = { ...(prior || {}), ...session }
  merged.adoptions = [...((prior && prior.adoptions) || []), ...(session.adoptions || [])]
  if (prior && prior.firstAsk && !session.firstAsk) merged.firstAsk = prior.firstAsk
  sessions.push(sessionEntry(merged, cardId))
  next.cards[cardId] = { lastSessionId: session.sessionId, sessions }
  return next
}

export function withLast(store, cardId, sessionId) {
  const next = normalizeStore(store)
  const bucket = next.cards[cardId]
  if (!bucket || !bucket.sessions.some((item) => item.sessionId === sessionId)) return next
  next.cards[cardId] = { ...bucket, lastSessionId: sessionId }
  return next
}

export function mergeStores(base, extra) {
  let next = normalizeStore(base)
  const more = normalizeStore(extra)
  for (const [cardId, bucket] of Object.entries(more.cards)) {
    for (const session of bucket.sessions) {
      next = withSession(next, cardId, session)
    }
    if (bucket.lastSessionId) next = withLast(next, cardId, bucket.lastSessionId)
  }
  return next
}

export function publicSessions(store, cardId) {
  const bucket = store.cards[cardId]
  if (!bucket) return []
  return bucket.sessions.map((item) => {
    const entry = {
      sessionId: item.sessionId,
      title: item.title,
      createdAt: item.createdAt,
      cardId,
    }
    if (item.firstAsk) entry.firstAsk = item.firstAsk
    return entry
  })
}

function sessionAt(store, cardId, sessionId) {
  const bucket = store.cards[cardId]
  if (!bucket) return null
  return bucket.sessions.find((item) => item.sessionId === sessionId) || null
}

export const FIRST_ASK_CHARS = 24

export function firstAskPreview(text) {
  const flat = typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : ''
  if (!flat) return ''
  const chars = Array.from(flat)
  if (chars.length <= FIRST_ASK_CHARS) return flat
  return `${chars.slice(0, FIRST_ASK_CHARS).join('')}…`
}

// 只有新建时标了 firstAskOpen 的会话才写首问；旧会话没有首问就一直没有，不拿后来的话冒充。
export function withFirstAsk(store, cardId, sessionId, text) {
  const next = normalizeStore(store)
  const entry = sessionAt(next, cardId, sessionId)
  const preview = firstAskPreview(text)
  if (!entry || !entry.firstAskOpen || entry.firstAsk || !preview) return { store: next, changed: false }
  entry.firstAsk = preview
  delete entry.firstAskOpen
  return { store: next, changed: true }
}

function fnv1a(text) {
  let hash = 0x811c9dc5
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    hash ^= code
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function messageKey(message) {
  const id = message && message.id
  if ((typeof id === 'string' && id) || (typeof id === 'number' && Number.isFinite(id))) return `id:${id}`
  const role = message && typeof message.role === 'string' ? message.role : ''
  const at = message && typeof message.at === 'string' ? message.at : ''
  const content = message && typeof message.content === 'string' ? message.content.trim() : ''
  return `fp:${role}|${at}|${fnv1a(content)}`
}

export function withAdoption(store, cardId, sessionId, adoption) {
  const next = normalizeStore(store)
  const entry = sessionAt(next, cardId, sessionId)
  if (!entry) return next
  const list = entry.adoptions || []
  if (list.some((item) => item.key === adoption.key)) return next
  const record = { key: adoption.key, adoptedAt: adoption.adoptedAt || new Date().toISOString() }
  if (adoption.messageId) record.messageId = String(adoption.messageId)
  entry.adoptions = [...list, record]
  return next
}

// 沉淀只在已有采纳上补状态和 requestId。没有这条采纳时补一条，不改「采纳进本念头」的入口。
export function markAdoptionSediment(store, cardId, sessionId, adoptionKey, patch) {
  const next = normalizeStore(store)
  if (!adoptionKey) return next
  const entry = sessionAt(next, cardId, sessionId)
  if (!entry) return next
  const list = entry.adoptions ? [...entry.adoptions] : []
  const index = list.findIndex((item) => item.key === adoptionKey)
  const record = index >= 0 ? { ...list[index] } : { key: adoptionKey, adoptedAt: new Date().toISOString() }
  if (patch && (patch.sedimentStatus === 'written' || patch.sedimentStatus === 'failed')) {
    record.sedimentStatus = patch.sedimentStatus
  }
  if (patch && typeof patch.requestId === 'string' && patch.requestId) record.requestId = patch.requestId
  if (index >= 0) list[index] = record
  else list.push(record)
  entry.adoptions = list
  return next
}

export function adoptedKeys(store, cardId, sessionId) {
  const entry = sessionAt(store, cardId, sessionId)
  return new Set(((entry && entry.adoptions) || []).map((item) => item.key))
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
      return ''
    })
    .join('')
}

function atOf(item) {
  const raw = item.timestamp ?? item.createdAt ?? item.at
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const date = new Date(raw > 1e12 ? raw : raw * 1000)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString()
  }
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return ''
}

export const PAGE_DEFAULT = 40
export const PAGE_MAX = 200

function pageNumber(value, fallback, max) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) return fallback
  return Math.min(n, max)
}

// 网关 order=latest 从最新往前数，offset 跳过最新的若干条，返回仍按时间正序。多要一条用来判断还有没有更早的。
export async function fetchMessagePage(gatewayFetch, sessionId, query = {}) {
  const limit = Math.max(1, pageNumber(query.limit, PAGE_DEFAULT, PAGE_MAX))
  const offset = pageNumber(query.offset, 0, Number.MAX_SAFE_INTEGER)
  const upstream = await gatewayFetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages?order=latest&limit=${limit + 1}&offset=${offset}`,
    { method: 'GET', headers: { Accept: 'application/json' } },
  )
  const payload = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    const error = new Error('讨论记录没有取到')
    error.statusCode = 502
    throw error
  }
  const raw = Array.isArray(payload.messages) ? payload.messages : Array.isArray(payload.data) ? payload.data : []
  const hasMore = raw.length > limit
  const rows = hasMore ? raw.slice(raw.length - limit) : raw
  const messages = []
  for (const item of rows) {
    if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue
    const content = textOf(item.content).trim()
    if (!content) continue
    const at = atOf(item)
    const message = { role: item.role, content }
    if (at) message.at = at
    if ((typeof item.id === 'string' && item.id) || (typeof item.id === 'number' && Number.isFinite(item.id))) {
      message.id = String(item.id)
    }
    messages.push(message)
  }
  return { messages, hasMore, nextOffset: offset + rows.length }
}

export async function loadMessagePage(gatewayFetch, store, cardId, sessionId, query = {}) {
  const page = await fetchMessagePage(gatewayFetch, sessionId, query)
  const keys = adoptedKeys(store, cardId, sessionId)
  const messages = page.messages.map((message) => {
    const key = messageKey(message)
    return { ...message, key, adopted: keys.has(key) || keys.has(messageKey({ ...message, id: undefined })) }
  })
  return { cardId, sessionId, messages, hasMore: page.hasMore, nextOffset: page.nextOffset }
}

// 刚收完的回复在浏览器里还没有网关消息号；先回网关最新一页按正文找号，找不到才退回 role+at+正文 的指纹。
export async function resolveAdoptionKey(gatewayFetch, sessionId, message) {
  if (message.messageId) return { key: messageKey({ id: message.messageId }), messageId: String(message.messageId) }
  const content = typeof message.content === 'string' ? message.content.trim() : ''
  try {
    const page = await fetchMessagePage(gatewayFetch, sessionId, { limit: 60 })
    for (let index = page.messages.length - 1; index >= 0; index -= 1) {
      const item = page.messages[index]
      if (item.role === message.role && item.content === content) {
        if (item.id) return { key: messageKey({ id: item.id }), messageId: item.id }
        return { key: messageKey(item) }
      }
    }
  } catch {
    // 网关一时取不到就用指纹，不挡采纳记录。
  }
  return { key: messageKey({ role: message.role, at: message.at, content }) }
}

export function knownSessionIds(store) {
  const ids = []
  for (const bucket of Object.values(store.cards || {})) {
    for (const item of bucket.sessions || []) ids.push(item.sessionId)
  }
  return ids
}
