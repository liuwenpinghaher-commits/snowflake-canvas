import type { AppState } from './document.ts'

export interface ExportIssue {
  sceneId: string
  message: string
}

export function exportIssues(state: AppState): ExportIssue[] {
  const issues: ExportIssue[] = []
  for (const [chapterIndex, chapter] of (state.chapters ?? []).entries()) {
    if (chapter.title === '未归场') {
      for (const scene of chapter.scenes) {
        if (scene.prose.trim()) issues.push({ sceneId: scene.id, message: '未归场还有草稿' })
      }
    }
    for (const [sceneIndex, scene] of chapter.scenes.entries()) {
      if (!scene.prose.trim()) {
        issues.push({ sceneId: scene.id, message: `第 ${chapterIndex + 1} 章第 ${sceneIndex + 1} 场是空的` })
      }
    }
  }
  return issues
}

export function locateExportIssue(issues: readonly ExportIssue[], message: string): string | null {
  return issues.find((issue) => issue.message === message)?.sceneId ?? null
}
