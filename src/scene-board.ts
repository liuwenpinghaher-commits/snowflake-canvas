import { cardFace, commitCardText, shownFieldValue, type AppState, type Card } from './document.ts'

export type SceneGroup = 'chapter' | 'structure'

export interface SceneRow {
  id: string
  title: string
  chapter: string
  structureKind: string
  structureLabel: string
  task: string
}

export const STRUCTURE_COLUMNS = [
  { id: 'active', label: '主动', droppable: true },
  { id: 'reactive', label: '反应', droppable: true },
  { id: 'empty', label: '未填', droppable: false },
] as const

export type StructureColumnId = (typeof STRUCTURE_COLUMNS)[number]['id']

const PRESERVE_ON_STRUCTURE_DROP = ['chapter', 'title'] as const

export function sceneTitle(state: AppState, id: string, card: Card): string {
  const titled = (card.fields.title ?? '').trim()
  if (titled) return titled
  const face = cardFace(card).title.trim()
  if (face) return face
  const node = state.canvas.nodes.find((item) => item.id === id)
  const text = node?.text?.trim() ?? ''
  if (text) return text
  return '未命名场次'
}

export function listScenes(state: AppState): SceneRow[] {
  const rows: SceneRow[] = []
  for (const [id, card] of Object.entries(state.snowflake.cards)) {
    if (card.layer !== 'changci') continue
    const structureKind = (card.fields.structureKind ?? '').trim()
    rows.push({
      id,
      title: sceneTitle(state, id, card),
      chapter: (card.fields.chapter ?? '').trim(),
      structureKind,
      structureLabel: shownFieldValue('structureKind', structureKind),
      task: (card.fields.task ?? '').trim(),
    })
  }
  return rows
}

export function chapterColumnLabel(chapter: string): string {
  const text = chapter.trim()
  return text || '未分章'
}

export function chapterColumns(rows: readonly SceneRow[]): string[] {
  const labels: string[] = []
  for (const row of rows) {
    const label = chapterColumnLabel(row.chapter)
    if (!labels.includes(label)) labels.push(label)
  }
  if (!labels.includes('未分章')) labels.push('未分章')
  return labels
}

export function structureColumnId(kind: string): StructureColumnId {
  if (kind === 'active') return 'active'
  if (kind === 'reactive') return 'reactive'
  return 'empty'
}

/** 按章只展示。按冲突结构只把 active / reactive 写进字段。未填列不接收投放。 */
export function applySceneBoardDrop(state: AppState, cardId: string, group: SceneGroup, columnId: string): AppState {
  if (group !== 'structure') return state
  if (columnId !== 'active' && columnId !== 'reactive') return state
  const card = state.snowflake.cards[cardId]
  if (!card || card.layer !== 'changci') return state
  if ((card.fields.structureKind ?? '').trim() === columnId) return state
  const kept: Record<string, string> = {}
  for (const key of PRESERVE_ON_STRUCTURE_DROP) {
    const value = card.fields[key]
    if (typeof value === 'string' && value.trim()) kept[key] = value
  }
  const next = commitCardText(state, cardId, columnId, 'structureKind', false)
  if (next === state || Object.keys(kept).length === 0) return next
  const written = next.snowflake.cards[cardId]
  if (!written) return next
  return {
    ...next,
    snowflake: {
      ...next.snowflake,
      cards: {
        ...next.snowflake.cards,
        [cardId]: { ...written, fields: { ...written.fields, ...kept } },
      },
    },
  }
}
