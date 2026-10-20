export interface ImportScene {
  title: string
  text: string
  start?: number
}
export interface ImportChapter {
  title: string
  scenes: ImportScene[]
}
export interface ImportPreview {
  ok: boolean
  error: string
  chapters: ImportChapter[]
}
export function previewImport(text: string): ImportPreview
export function applyPlan(preview: ImportPreview, plan?: { merges?: number[][] }): ImportPreview
