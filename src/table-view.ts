export type SortDir = 'asc' | 'desc'

export interface SortState {
  key: string
  dir: SortDir
}

export type GradeFilter = '' | '主要' | '次要' | 'NPC' | '路人'
export type BindFilter = '' | 'bound' | 'unbound'
export type StructureFilter = '' | 'active' | 'reactive' | 'empty'
export type ChapterPresenceFilter = '' | 'has' | 'none'

/** 第一次点按文字升序，再点一次改为降序。 */
export function toggleSort(current: SortState | null, key: string): SortState {
  if (!current || current.key !== key) return { key, dir: 'asc' }
  if (current.dir === 'asc') return { key, dir: 'desc' }
  return { key, dir: 'asc' }
}

export function sortByText<T>(rows: readonly T[], textOf: (row: T) => string, dir: SortDir): T[] {
  return rows
    .map((row, index) => ({ row, index, text: textOf(row) }))
    .sort((left, right) => {
      const compared = left.text.localeCompare(right.text, 'zh')
      if (compared !== 0) return dir === 'asc' ? compared : -compared
      return left.index - right.index
    })
    .map((item) => item.row)
}

/** 空查询保留全部。只看调用方交来的可见文字，不扫隐藏列，也不扫 id。 */
export function matchesSearch(parts: readonly string[], query: string): boolean {
  const needle = query.trim()
  if (!needle) return true
  return parts.some((part) => part.includes(needle))
}

export function personRowVisible(
  grade: string,
  bound: boolean,
  gradeFilter: GradeFilter,
  bindFilter: BindFilter,
): boolean {
  if (gradeFilter && grade !== gradeFilter) return false
  if (bindFilter === 'bound' && !bound) return false
  if (bindFilter === 'unbound' && bound) return false
  return true
}

export function sceneRowVisible(
  structureColumn: string,
  chapter: string,
  structureFilter: StructureFilter,
  chapterFilter: ChapterPresenceFilter,
): boolean {
  if (structureFilter && structureColumn !== structureFilter) return false
  const hasChapter = chapter.trim().length > 0
  if (chapterFilter === 'has' && !hasChapter) return false
  if (chapterFilter === 'none' && hasChapter) return false
  return true
}

export function moveColumn(order: readonly string[], from: string, to: string): string[] {
  if (!from || from === to) return [...order]
  if (!order.includes(from) || !order.includes(to)) return [...order]
  const next = order.filter((id) => id !== from)
  const index = next.indexOf(to)
  next.splice(index, 0, from)
  return next
}

export function parseGradeFilter(value: string): GradeFilter {
  if (value === '主要' || value === '次要' || value === 'NPC' || value === '路人') return value
  return ''
}

export function parseBindFilter(value: string): BindFilter {
  if (value === 'bound' || value === 'unbound') return value
  return ''
}

export function parseStructureFilter(value: string): StructureFilter {
  if (value === 'active' || value === 'reactive' || value === 'empty') return value
  return ''
}

export function parseChapterPresence(value: string): ChapterPresenceFilter {
  if (value === 'has' || value === 'none') return value
  return ''
}
