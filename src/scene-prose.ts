import type { AppState } from './document.ts'

export interface SceneEditor {
  readOnly: false
  sceneId: string
  text: string
  usesDerivedFrom: false
}

export function sceneEditor(state: AppState, sceneId: string): SceneEditor | null {
  for (const chapter of state.chapters ?? []) {
    const scene = chapter.scenes.find((item) => item.id === sceneId)
    if (!scene) continue
    return { readOnly: false, sceneId, text: scene.prose, usesDerivedFrom: false }
  }
  return null
}

export function openDraftCard(state: AppState, cardId: string): SceneEditor | null {
  const card = state.snowflake.cards[cardId]
  if (!card || card.layer !== '正文草稿') return null
  const sceneId = card.originAnchor?.sceneId
  if (!sceneId) return null
  const editor = sceneEditor(state, sceneId)
  if (!editor) return null
  return editor
}

export function proseEditorWritable(editor: SceneEditor | null): boolean {
  return editor !== null && editor.readOnly === false && editor.usesDerivedFrom === false
}
