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

function chapterTitleFromOutline(state: AppState, cardId: string): string {
  for (const chapter of state.chapters ?? []) {
    if (chapter.scenes.some((scene) => scene.beatIds.includes(cardId))) {
      return chapter.title.trim()
    }
  }
  return ''
}

export function listScenes(state: AppState): SceneRow[] {
  const rows: SceneRow[] = []
  for (const [id, card] of Object.entries(state.snowflake.cards)) {
    if (card.layer !== 'changci') continue
    const structureKind = (card.fields.structureKind ?? '').trim()
    const chapter = (card.fields.chapter ?? '').trim() || chapterTitleFromOutline(state, id)
    rows.push({
      id,
      title: sceneTitle(state, id, card),
      chapter,
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

export function chapterColumns(rows: readonly SceneRow[], chapters?: readonly { title: string }[]): string[] {
  const labels: string[] = []
  if (chapters) {
    for (const item of chapters) {
      const title = item.title.trim()
      if (title && title !== '未分章' && !labels.includes(title)) labels.push(title)
    }
  }
  for (const row of rows) {
    const label = chapterColumnLabel(row.chapter)
    if (!labels.includes(label)) labels.push(label)
  }
  if (!labels.includes('未分章')) labels.push('未分章')
  return labels
}

export function syncCardToNamedChapter(state: AppState, cardId: string, columnId: string): AppState {
  const title = columnId.trim()
  if (!chapterColumnDroppable(title) || !state.chapters || state.chapters.length === 0) return state
  const targetChapter = state.chapters.find((chapter) => chapter.title.trim() === title)
  if (!targetChapter) return state
  const chapters = state.chapters.map((chapter) => {
    const cleanedScenes = chapter.scenes.map((scene) => ({
      ...scene,
      beatIds: scene.beatIds.filter((id) => id !== cardId),
    }))
    if (chapter.id !== targetChapter.id) return { ...chapter, scenes: cleanedScenes }
    if (cleanedScenes.length === 0) {
      return {
        ...chapter,
        scenes: [
          {
            id: `scene-${cardId}`,
            title: sceneTitle(state, cardId, state.snowflake.cards[cardId]!),
            ideaIds: [],
            prose: '',
            beatIds: [cardId],
          },
        ],
      }
    }
    const first = cleanedScenes[0]!
    return {
      ...chapter,
      scenes: [{ ...first, beatIds: [...first.beatIds, cardId] }, ...cleanedScenes.slice(1)],
    }
  })
  return { ...state, chapters }
}

export function structureColumnId(kind: string): StructureColumnId {
  if (kind === 'active') return 'active'
  if (kind === 'reactive') return 'reactive'
  return 'empty'
}

/** 未分章只展示，不接收投放。其它章列可以投放。 */
export function chapterColumnDroppable(label: string): boolean {
  const text = label.trim()
  return text.length > 0 && text !== '未分章'
}

function applyChapterDrop(state: AppState, cardId: string, columnId: string): AppState {
  const chapter = columnId.trim()
  if (!chapterColumnDroppable(chapter)) return state
  const card = state.snowflake.cards[cardId]
  if (!card || card.layer !== 'changci') return state
  if ((card.fields.chapter ?? '').trim() === chapter) return state
  return {
    ...state,
    snowflake: {
      ...state.snowflake,
      cards: {
        ...state.snowflake.cards,
        [cardId]: { ...card, fields: { ...card.fields, chapter } },
      },
    },
  }
}

/** 按章只改这场次卡已有的 chapter。按冲突结构只把 active / reactive 写进 structureKind。未分章、未填不接收投放。 */
export function applySceneBoardDrop(state: AppState, cardId: string, group: SceneGroup, columnId: string): AppState {
  if (group === 'chapter') return applyChapterDrop(state, cardId, columnId)
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
