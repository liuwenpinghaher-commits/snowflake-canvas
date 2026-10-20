export interface BookItem {
  id: string
  name: string
  active: boolean
}

export interface BookList {
  books: BookItem[]
  activeBookId: string
}

export const DEFAULT_BOOK_NAME = '未命名书'
export const MSG_BOOK_UNSAVED = '这本书还有改动没写进去，先等它写完或选好冲突，再换书'

const SCOPED_PREFIXES = ['/api/canvas', '/api/discuss/', '/api/sediment', '/api/encyclopedia/promote', '/api/assets']

let currentBookId: string | null = null

function api(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${path}`
}

// 画布和讨论请求改走 /api/books/<id>/...；还不知道是哪本书时（没连上服务器）沿用旧路径，服务器把旧路径落到活动书。
export function bookScopedPath(path: string, bookId: string | null | undefined = currentBookId): string {
  if (!bookId) return path
  if (!SCOPED_PREFIXES.some((head) => path.startsWith(head))) return path
  return `/api/books/${encodeURIComponent(bookId)}${path.slice('/api'.length)}`
}

export function setCurrentBookId(id: string | null): void {
  currentBookId = id
}

export function getCurrentBookId(): string | null {
  return currentBookId
}

function readBook(value: unknown): BookItem | null {
  if (!value || typeof value !== 'object') return null
  const { id, name, active } = value as { id?: unknown; name?: unknown; active?: unknown }
  if (typeof id !== 'string' || !id || typeof name !== 'string') return null
  return { id, name, active: active === true }
}

export async function fetchBooks(): Promise<BookList | null> {
  try {
    const response = await fetch(api('/api/books'), { cache: 'no-store' })
    if (!response.ok) return null
    const payload = (await response.json()) as { books?: unknown; activeBookId?: unknown }
    if (!Array.isArray(payload.books) || typeof payload.activeBookId !== 'string') return null
    const books = payload.books.map(readBook).filter((item): item is BookItem => item !== null)
    if (!books.some((item) => item.id === payload.activeBookId)) return null
    return { books, activeBookId: payload.activeBookId }
  } catch {
    return null
  }
}

export async function createBookRemote(name: string): Promise<BookItem | null> {
  try {
    const response = await fetch(api('/api/books'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      cache: 'no-store',
    })
    if (!response.ok) return null
    return readBook(await response.json())
  } catch {
    return null
  }
}

export async function fetchBookConstraints(
  id: string,
): Promise<{ targetWords?: number; endingType?: string; forbidden?: string; styleSample?: string } | null> {
  try {
    const response = await fetch(api(`/api/books/${encodeURIComponent(id)}/constraints`), { cache: 'no-store' })
    if (!response.ok) return null
    const payload = (await response.json()) as { constraints?: unknown }
    if (!payload.constraints || typeof payload.constraints !== 'object') return null
    return payload.constraints as { targetWords?: number; endingType?: string; forbidden?: string; styleSample?: string }
  } catch {
    return null
  }
}

export async function saveBookConstraints(
  id: string,
  input: { targetWords?: number; endingType?: string; forbidden?: string; styleSample?: string },
): Promise<boolean> {
  try {
    const response = await fetch(api(`/api/books/${encodeURIComponent(id)}/constraints`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}

export async function renameBookRemote(id: string, name: string): Promise<BookItem | null> {
  try {
    const response = await fetch(api(`/api/books/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      cache: 'no-store',
    })
    if (!response.ok) return null
    return readBook(await response.json())
  } catch {
    return null
  }
}

export async function deleteBookRemote(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(api(`/api/books/${encodeURIComponent(id)}?confirm=1`), {
      method: 'DELETE',
      cache: 'no-store',
    })
    if (response.ok) return { ok: true }
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null
    return { ok: false, error: typeof payload?.error === 'string' ? payload.error : '没有删掉' }
  } catch {
    return { ok: false, error: '连不上服务器，没有删' }
  }
}

export const BOOK_STATUSES = ['构思中', '写作中', '修订中', '完稿', '归档'] as const
export type BookStatus = (typeof BOOK_STATUSES)[number]

export const BOOK_GENRES = ['未定', '玄幻', '仙侠', '武侠', '都市', '言情', '悬疑', '科幻', '历史', '奇幻', '现实', '其他'] as const

export const COVER_COLORS = ['#8c4a32', '#3f6b5a', '#35557a', '#7a4a6b', '#a0782c', '#5e574e'] as const

export const COVER_COLOR_NAMES: Record<(typeof COVER_COLORS)[number], string> = {
  '#8c4a32': '赭红',
  '#3f6b5a': '墨绿',
  '#35557a': '靛蓝',
  '#7a4a6b': '绛紫',
  '#a0782c': '琥珀',
  '#5e574e': '岩灰',
}

export const POV_CHOICES = ['未定', '第一人称', '第二人称', '第三人称'] as const

export interface BookMeta {
  genre: string
  penName: string
  series: string
  language: string
  intro: string
  cover: string
  status: BookStatus
  targetWords: number
  endingType: string
  forbidden: string
  styleSample: string
  pov: string
  createdAt: string
  updatedAt: string
}

export const BOOK_META_KEY = 'snowflake-book-meta'

export function defaultBookMeta(now: string = new Date().toISOString()): BookMeta {
  return {
    genre: '未定',
    penName: '',
    series: '',
    language: '中文',
    intro: '',
    cover: COVER_COLORS[0],
    status: '构思中',
    targetWords: 0,
    endingType: '',
    forbidden: '',
    styleSample: '',
    pov: '未定',
    createdAt: now,
    updatedAt: now,
  }
}

function readMetaMap(): Record<string, Partial<BookMeta>> {
  try {
    const raw = window.localStorage.getItem(BOOK_META_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Partial<BookMeta>>) : {}
  } catch {
    return {}
  }
}

export function readBookMeta(id: string): BookMeta {
  const base = defaultBookMeta('')
  const stored = readMetaMap()[id] ?? {}
  const merged = { ...base, ...stored }
  if (!(BOOK_STATUSES as readonly string[]).includes(merged.status)) merged.status = base.status
  if (!Number.isFinite(merged.targetWords) || merged.targetWords < 0) merged.targetWords = 0
  return merged
}

export function writeBookMeta(id: string, patch: Partial<BookMeta>): BookMeta {
  const map = readMetaMap()
  const next = { ...readBookMeta(id), ...patch }
  map[id] = next
  try {
    window.localStorage.setItem(BOOK_META_KEY, JSON.stringify(map))
  } catch {
    // 浏览器拒绝写入时，这次改动只在本页有效。
  }
  return next
}

export function dropBookMeta(id: string): void {
  const map = readMetaMap()
  delete map[id]
  try {
    window.localStorage.setItem(BOOK_META_KEY, JSON.stringify(map))
  } catch {
    // 同上。
  }
}

export interface BookStats {
  words: number
  cards: number
  emptyCards: number
  version: number | null
  layers: Record<string, number>
}

function countChars(text: string): number {
  return [...text.replace(/\s/g, '')].length
}

export function statsOfDocument(document: unknown, version: number | null = null): BookStats {
  const stats: BookStats = { words: 0, cards: 0, emptyCards: 0, version, layers: {} }
  if (!document || typeof document !== 'object') return stats
  const doc = document as {
    canvas?: { nodes?: { type?: string; text?: string }[] }
    snowflake?: { cards?: Record<string, { layer?: string; body?: string }> }
  }
  const cards = doc.snowflake?.cards
  if (cards && typeof cards === 'object') {
    for (const card of Object.values(cards)) {
      const body = typeof card?.body === 'string' ? card.body : ''
      const words = countChars(body)
      stats.cards += 1
      stats.words += words
      if (!words) stats.emptyCards += 1
      const layer = typeof card?.layer === 'string' ? card.layer : 'situation'
      stats.layers[layer] = (stats.layers[layer] ?? 0) + 1
    }
    return stats
  }
  for (const node of doc.canvas?.nodes ?? []) {
    if (node?.type === 'group') continue
    const words = countChars(typeof node?.text === 'string' ? node.text : '')
    stats.cards += 1
    stats.words += words
    if (!words) stats.emptyCards += 1
  }
  return stats
}

// 只读：GET 这本书的正本算字数和卡片数，不改任何东西。
export async function fetchBookStats(id: string): Promise<BookStats | null> {
  try {
    const response = await fetch(api(`/api/books/${encodeURIComponent(id)}/canvas`), { cache: 'no-store' })
    if (!response.ok) return null
    const payload = (await response.json()) as { version?: unknown; document?: unknown }
    const version = typeof payload.version === 'number' ? payload.version : null
    return statsOfDocument(payload.document, version)
  } catch {
    return null
  }
}

export interface ImportPreview {
  document: unknown
  stats: BookStats
}

export function readImportFile(text: string): ImportPreview | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const envelope = parsed as { document?: unknown }
    const document =
      envelope.document && typeof envelope.document === 'object' ? envelope.document : (parsed as Record<string, unknown>)
    const doc = document as { canvas?: { nodes?: unknown } }
    if (!doc.canvas || !Array.isArray(doc.canvas.nodes)) return null
    return { document, stats: statsOfDocument(document) }
  } catch {
    return null
  }
}

// 新书刚建好、还没人写时，用现有 PUT 接口把导入的正本整份放进去。
export async function seedBookCanvas(id: string, document: unknown): Promise<boolean> {
  try {
    const path = api(`/api/books/${encodeURIComponent(id)}/canvas`)
    const head = await fetch(path, { cache: 'no-store' })
    if (!head.ok) return false
    const etag = head.headers.get('ETag')
    const response = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
      body: JSON.stringify(document),
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}

export async function activateBookRemote(id: string): Promise<boolean> {
  try {
    const response = await fetch(api(`/api/books/${encodeURIComponent(id)}/activate`), {
      method: 'POST',
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}
