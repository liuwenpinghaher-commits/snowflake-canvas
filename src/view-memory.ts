/** 表/看板/图、展开的行、目录收起、列宽、列显隐、列顺序：只记在这台浏览器，键名带上书 id。不进正本。列定制和展开的行同一套，是视图习惯，不是正文。 */

export interface ViewStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const VIEW_KEY_PREFIX = 'snowflake-view:'

export function viewStorageKey(bookId: string, slot: string): string {
  return `snowflake-view:${bookId}:${slot}`
}

function readViewItem(key: string): string | null {
  try {
    return globalThis.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeViewItem(key: string, value: string): void {
  try {
    globalThis.localStorage.setItem(key, value)
  } catch {
    // 浏览器拒绝写入时，这次选择只留在当前这一页。
  }
}

function browserGet(bookId: string, slot: string): string | null {
  return readViewItem(viewStorageKey(bookId, slot))
}

function browserSet(bookId: string, slot: string, value: string): void {
  writeViewItem(viewStorageKey(bookId, slot), value)
}

export function browserViewStore(): ViewStore {
  return {
    getItem: readViewItem,
    setItem: writeViewItem,
  }
}

export function readChoice<T extends string>(
  store: ViewStore | null,
  bookId: string,
  slot: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const raw = store ? store.getItem(viewStorageKey(bookId, slot)) : browserGet(bookId, slot)
    if (raw && (allowed as readonly string[]).includes(raw)) return raw as T
  } catch {
    return fallback
  }
  return fallback
}

export function writeChoice(store: ViewStore | null, bookId: string, slot: string, value: string): void {
  try {
    if (store) store.setItem(viewStorageKey(bookId, slot), value)
    else browserSet(bookId, slot, value)
  } catch {
    // 浏览器拒绝写入时，这次选择只留在当前这一页。
  }
}

export function readIdList(store: ViewStore | null, bookId: string, slot: string): string[] {
  try {
    const raw = store ? store.getItem(viewStorageKey(bookId, slot)) : browserGet(bookId, slot)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

export function writeIdList(store: ViewStore | null, bookId: string, slot: string, ids: readonly string[]): void {
  try {
    const payload = JSON.stringify([...ids])
    if (store) store.setItem(viewStorageKey(bookId, slot), payload)
    else browserSet(bookId, slot, payload)
  } catch {
    // 浏览器拒绝写入时，展开只留在这一次打开里。
  }
}

export function openRowRecord(ids: readonly string[], focusId?: string | null): Record<string, true> {
  const next: Record<string, true> = {}
  for (const id of ids) next[id] = true
  if (focusId) next[focusId] = true
  return next
}

export interface ColumnLayout {
  order: string[]
  hidden: string[]
  widths: Record<string, number>
}

const MIN_COL_WIDTH = 72
const MAX_COL_WIDTH = 720

export function emptyColumnLayout(ids: readonly string[]): ColumnLayout {
  return { order: [...ids], hidden: [], widths: {} }
}

function sanitizeColumnLayout(value: unknown, ids: readonly string[]): ColumnLayout {
  const fallback = emptyColumnLayout(ids)
  if (!value || typeof value !== 'object') return fallback
  const record = value as { order?: unknown; hidden?: unknown; widths?: unknown }
  const known = new Set(ids)
  const order: string[] = []
  if (Array.isArray(record.order)) {
    for (const item of record.order) {
      if (typeof item !== 'string' || !known.has(item) || order.includes(item)) continue
      order.push(item)
    }
  }
  for (const id of ids) {
    if (!order.includes(id)) order.push(id)
  }
  const hidden = Array.isArray(record.hidden)
    ? record.hidden.filter((item): item is string => typeof item === 'string' && known.has(item))
    : []
  const visible = order.filter((id) => !hidden.includes(id))
  const safeHidden = visible.length === 0 ? hidden.filter((id) => id !== order[0]) : hidden
  if (order.filter((id) => !safeHidden.includes(id)).length === 0) return fallback
  const widths: Record<string, number> = {}
  if (record.widths && typeof record.widths === 'object') {
    for (const [key, width] of Object.entries(record.widths as Record<string, unknown>)) {
      if (!known.has(key) || typeof width !== 'number' || !Number.isFinite(width)) continue
      const rounded = Math.round(width)
      if (rounded < MIN_COL_WIDTH || rounded > MAX_COL_WIDTH) continue
      widths[key] = rounded
    }
  }
  return { order, hidden: safeHidden, widths }
}

export function readColumnLayout(
  store: ViewStore | null,
  bookId: string,
  slot: string,
  ids: readonly string[],
): ColumnLayout {
  try {
    const raw = store ? store.getItem(viewStorageKey(bookId, slot)) : browserGet(bookId, slot)
    if (!raw) return emptyColumnLayout(ids)
    return sanitizeColumnLayout(JSON.parse(raw) as unknown, ids)
  } catch {
    return emptyColumnLayout(ids)
  }
}

export function writeColumnLayout(
  store: ViewStore | null,
  bookId: string,
  slot: string,
  layout: ColumnLayout,
): void {
  try {
    const payload = JSON.stringify({
      order: [...layout.order],
      hidden: [...layout.hidden],
      widths: { ...layout.widths },
    })
    if (store) store.setItem(viewStorageKey(bookId, slot), payload)
    else browserSet(bookId, slot, payload)
  } catch {
    // 浏览器拒绝写入时，列宽和列顺序只留在这一次打开里。
  }
}
