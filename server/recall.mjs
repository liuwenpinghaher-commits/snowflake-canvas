// 沉淀面板要按 adoptionKey 回到那场讨论里的那条采纳。找不到就返回 found:false，不抛。
export function locateAdoption(store, cardId, sessionId, adoptionKey) {
  const miss = { found: false, sessionId, adoptionKey }
  try {
    const cards = store && store.cards
    const bucket = cards && typeof cards === 'object' ? cards[cardId] : null
    const sessions = bucket && Array.isArray(bucket.sessions) ? bucket.sessions : null
    if (!sessions) return miss
    const session = sessions.find((item) => item && item.sessionId === sessionId)
    if (!session || !Array.isArray(session.adoptions)) return miss
    const index = session.adoptions.findIndex((item) => item && item.key === adoptionKey)
    if (index < 0) return miss
    const record = session.adoptions[index]
    const text = adoptionText(record)
    const hit = { found: true, sessionId, adoptionKey, index }
    if (text) hit.text = text
    return hit
  } catch {
    return miss
  }
}

function adoptionText(record) {
  if (!record || typeof record !== 'object') return ''
  if (typeof record.text === 'string' && record.text) return record.text
  if (typeof record.content === 'string' && record.content) return record.content
  return ''
}
