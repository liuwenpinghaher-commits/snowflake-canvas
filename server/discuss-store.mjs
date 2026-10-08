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

export function normalizeStore(value) {
  const cards = {}
  const source = value && value.cards && typeof value.cards === 'object' && !Array.isArray(value.cards) ? value.cards : {}
  for (const [cardId, bucket] of Object.entries(source)) {
    if (!cardId || !bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue
    const sessions = []
    const list = Array.isArray(bucket.sessions) ? bucket.sessions : []
    for (const item of list) {
      if (!item || typeof item.sessionId !== 'string' || !item.sessionId.trim()) continue
      const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '念头讨论'
      sessions.push({
        sessionId: item.sessionId.trim(),
        title,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        cardId,
      })
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
  const sessions = bucket.sessions.filter((item) => item.sessionId !== session.sessionId)
  sessions.push({
    sessionId: session.sessionId,
    title: session.title,
    createdAt: session.createdAt,
    cardId,
  })
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
  return bucket.sessions.map((item) => ({
    sessionId: item.sessionId,
    title: item.title,
    createdAt: item.createdAt,
    cardId,
  }))
}

export function knownSessionIds(store) {
  const ids = []
  for (const bucket of Object.values(store.cards || {})) {
    for (const item of bucket.sessions || []) ids.push(item.sessionId)
  }
  return ids
}
