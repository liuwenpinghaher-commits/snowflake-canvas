export interface SearchRow {
  kind: 'card' | 'scene' | 'entity' | 'discussion' | 'suggestion'
  id: string
  label: string
  text: string
  chapterIndex?: number
  sceneIndex?: number
}

export function searchBook(rows: readonly SearchRow[], query: string): SearchRow[] {
  const needle = query.trim()
  if (!needle) return []
  return rows
    .filter((row) => row.text.includes(needle) || row.label.includes(needle))
    .sort((left, right) => {
      const leftScene = left.kind === 'scene' ? 0 : 1
      const rightScene = right.kind === 'scene' ? 0 : 1
      if (leftScene !== rightScene) return leftScene - rightScene
      const leftExact = left.text.includes(needle) ? 0 : 1
      const rightExact = right.text.includes(needle) ? 0 : 1
      return leftExact - rightExact
    })
}
