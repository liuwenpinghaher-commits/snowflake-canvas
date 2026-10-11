import { randomUUID } from 'node:crypto'

// 方案 04 里的人名投影落在这个函数上。不要另造 encyclopedia / projectBook。
// 词表按子串匹配，不新造分词器。测试夹具只要求前四个名字出现。
export const NAME_WORDS = [
  '奈德',
  '丹妮莉丝',
  '瑟曦',
  '琼恩·雪诺',
  '提利昂',
  '艾莉亚',
  '珊莎',
  '布兰',
  '凯特琳',
  '小指头',
  '劳勃',
]

const CHAPTER_LINE = /^(?:第\s*[0-9０-９一二三四五六七八九十百千零两]+\s*[章集]|[Cc]hapter\s+\d+)/
const EXCERPT_CHARS = 200

const jobs = new Map()

export function normalizeName(name) {
  return String(name).trim().replace(/\s+/gu, '').replace(/[・•．.]/gu, '·')
}

export function hanCount(text) {
  const matched = String(text).match(/\p{Script=Han}/gu)
  return matched ? matched.length : 0
}

function cardRecords(cards) {
  if (Array.isArray(cards)) {
    return cards.map((card, index) => ({
      id: card && typeof card.id === 'string' && card.id ? card.id : String(index),
      text: cardText(card),
    }))
  }
  if (cards && typeof cards === 'object') {
    return Object.entries(cards).map(([id, card]) => ({ id, text: cardText(card) }))
  }
  return []
}

function cardText(card) {
  if (!card || typeof card !== 'object') return ''
  const parts = []
  if (typeof card.body === 'string') parts.push(card.body)
  if (card.fields && typeof card.fields === 'object') {
    for (const value of Object.values(card.fields)) {
      if (typeof value === 'string') parts.push(value)
    }
  }
  return parts.join('\n')
}

// 同名（归一化后）合成一条待确认实体，带来源卡 id。不创建 Entity，不写 gbrain。
export function pendingEntities(cards) {
  const groups = new Map()
  for (const card of cardRecords(cards)) {
    const seen = new Set()
    for (const word of NAME_WORDS) {
      if (!card.text.includes(word)) continue
      const key = normalizeName(word)
      if (seen.has(key)) continue
      seen.add(key)
      const group = groups.get(key) ?? { name: word, cardIds: [] }
      if (!group.cardIds.includes(card.id)) group.cardIds.push(card.id)
      groups.set(key, group)
    }
  }
  return [...groups.values()]
}

function nid(prefix) {
  return `${prefix}-${randomUUID().replace(/-/gu, '').slice(0, 12)}`
}

function excerpt(text) {
  return Array.from(text).slice(0, EXCERPT_CHARS).join('')
}

function isChapterLine(line) {
  return CHAPTER_LINE.test(line)
}

// 连续两个空行才是场界。单独一个空行留在场内。没有空行的章就是一场。
function splitScenes(body) {
  const scenes = []
  let current = []
  let blanks = 0
  const flush = () => {
    const raw = current.join('\n').trim()
    current = []
    blanks = 0
    if (raw) scenes.push(raw)
  }
  for (const line of body.split('\n')) {
    if (line.trim() === '') {
      blanks += 1
      if (blanks >= 2) {
        flush()
        continue
      }
      if (current.length > 0) current.push('')
      continue
    }
    blanks = 0
    current.push(line)
  }
  flush()
  return scenes
}

function parseChapters(normalized) {
  const lines = normalized.split('\n')
  let seenHeading = false
  const buckets = []
  let bucket = { title: '', lines: [] }
  for (const line of lines) {
    if (isChapterLine(line)) {
      seenHeading = true
      buckets.push(bucket)
      bucket = { title: line.trim(), lines: [] }
      continue
    }
    bucket.lines.push(line)
  }
  buckets.push(bucket)
  if (!seenHeading) return [{ title: '第1章', body: normalized }]
  const chapters = []
  for (const item of buckets) {
    const body = item.lines.join('\n')
    if (!item.title) {
      if (body.trim()) chapters.push({ title: '开篇', body })
      continue
    }
    chapters.push({ title: item.title, body })
  }
  return chapters.length > 0 ? chapters : [{ title: '第1章', body: normalized }]
}

function locate(haystack, needle, cursor) {
  if (!needle) return { at: cursor, cursor }
  const at = haystack.indexOf(needle, cursor)
  if (at < 0) return { at: cursor, cursor }
  return { at, cursor: at + needle.length }
}

function oneChapter(normalized) {
  const body = normalized.trim()
  const found = locate(normalized, body, 0)
  return [
    {
      title: '第1章',
      scenes: [{ title: '第1场', text: body, charOffset: found.at }],
    },
  ]
}

function manyChapters(normalized) {
  let cursor = 0
  return parseChapters(normalized).map((chapter) => {
    const pieces = splitScenes(chapter.body)
    const scenes = (pieces.length > 0 ? pieces : ['']).map((text, index) => {
      const found = locate(normalized, text, cursor)
      cursor = found.cursor
      return { title: `第${index + 1}场`, text, charOffset: found.at }
    })
    return { title: chapter.title, scenes }
  })
}

function mergePending(existing, extra) {
  const out = []
  const index = new Map()
  for (const item of [...(Array.isArray(existing) ? existing : []), ...extra]) {
    if (!item || typeof item.name !== 'string' || !item.name) continue
    const key = normalizeName(item.name)
    const ids = Array.isArray(item.cardIds) ? item.cardIds.filter((id) => typeof id === 'string' && id) : []
    const found = index.get(key)
    if (!found) {
      const next = { name: item.name, cardIds: [...ids] }
      index.set(key, next)
      out.push(next)
      continue
    }
    for (const id of ids) {
      if (!found.cardIds.includes(id)) found.cardIds.push(id)
    }
  }
  return out
}

// 汉字少于 200：不切章、不切场，整段一张念头。空文本由调用方拒绝，这里也不造章。
export function importPlainText(document, text) {
  if (!document || !document.snowflake || typeof document.snowflake.fileId !== 'string') {
    const error = new Error('这本书还没有正文，不能导入')
    error.statusCode = 400
    throw error
  }
  if (typeof text !== 'string' || text.trim() === '') {
    const error = new Error('导入文本是空的，没有建章')
    error.statusCode = 400
    throw error
  }
  const normalized = text.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n')
  // 现有卡模型没有 workflow 字段。有「种子」这一档时才写；这刀不新造该字段。
  const short = hanCount(text) < 200
  const planned = short ? oneChapter(normalized) : manyChapters(normalized)
  const cards = { ...(document.snowflake.cards || {}) }
  const nodes = Array.isArray(document.canvas?.nodes) ? [...document.canvas.nodes] : []
  const madeChapters = []
  const scanCards = []
  planned.forEach((chapter, chapterIndex) => {
    const chapterId = nid('ch')
    const scenes = chapter.scenes.map((scene, sceneIndex) => {
      const sceneId = nid('sc')
      const cardId = nid('idea')
      const full = scene.text.trim()
      const body = short ? full : excerpt(full)
      const originAnchor = { chapterId, sceneId, charOffset: scene.charOffset }
      cards[cardId] = {
        layer: 'situation',
        body,
        fields: {},
        originAnchor,
      }
      nodes.push({
        id: cardId,
        type: 'text',
        x: 40 + chapterIndex * 48,
        y: 40 + sceneIndex * 160,
        width: 280,
        height: 120,
        text: body,
      })
      scanCards.push({ id: cardId, body: full })
      return {
        id: sceneId,
        title: scene.title,
        ideaIds: [cardId],
        prose: '',
        beatIds: [],
      }
    })
    madeChapters.push({ id: chapterId, title: chapter.title, scenes })
  })
  const createdPending = pendingEntities(scanCards)
  const pending = mergePending(document.pendingEntities, createdPending)
  return {
    document: {
      ...document,
      canvas: {
        nodes,
        edges: Array.isArray(document.canvas?.edges) ? document.canvas.edges : [],
      },
      snowflake: { ...document.snowflake, cards },
      chapters: [...(Array.isArray(document.chapters) ? document.chapters : []), ...madeChapters],
      pendingEntities: pending,
    },
    counts: {
      chapterCount: madeChapters.length,
      ideaCount: madeChapters.reduce((sum, chapter) => sum + chapter.scenes.length, 0),
      pendingCount: createdPending.length,
    },
  }
}

export function getImportProgress(bookId) {
  return (
    jobs.get(bookId) ?? {
      status: 'queued',
      chapterCount: 0,
      ideaCount: 0,
      pendingCount: 0,
      error: '',
    }
  )
}

export function setImportProgress(bookId, progress) {
  jobs.set(bookId, progress)
}
