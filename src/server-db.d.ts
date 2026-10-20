declare module '../server/db/import-text.mjs' {
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
}

declare module '../server/db/object-ops.mjs' {
  export interface ObjectOp {
    op: 'text' | 'set'
    path: (string | number)[]
    start?: number
    deleteCount?: number
    insert?: string
    value?: unknown
    missing?: boolean
  }
  export function diffDocuments(before: unknown, after: unknown): ObjectOp[]
  export function applyObjectOps(doc: unknown, ops: readonly ObjectOp[]): unknown
}
