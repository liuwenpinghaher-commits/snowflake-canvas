// 作者自己选保存位置。能弹出保存框就用保存框，否则用浏览器下载。
import { suggestionFileName } from './suggest.ts'

export type SaveVia = 'picker' | 'download' | 'cancelled'

interface SuggestionWriter {
  write(data: string): Promise<void>
  close(): Promise<void>
}

interface SuggestionFileHandle {
  createWritable(): Promise<SuggestionWriter>
}

interface SavePicker {
  (options: {
    suggestedName?: string
    types?: Array<{ description?: string; accept: Record<string, string[]> }>
  }): Promise<SuggestionFileHandle>
}

function fileSaver(win: Window): SavePicker | null {
  const host = win as Window & { showSaveFilePicker?: SavePicker }
  if (typeof host.showSaveFilePicker !== 'function') return null
  return host.showSaveFilePicker.bind(host)
}

function cancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function downloadJson(fileName: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export async function saveSuggestionFile(cardId: string, json: string): Promise<SaveVia> {
  const fileName = suggestionFileName(cardId)
  const pick = fileSaver(window)
  if (pick) {
    try {
      const suggestionFile = await pick({
        suggestedName: fileName,
        types: [{ description: '建议包', accept: { 'application/json': ['.json'] } }],
      })
      const sink = await suggestionFile.createWritable()
      await sink.write(json)
      await sink.close()
      return 'picker'
    } catch (error) {
      if (cancelled(error)) return 'cancelled'
    }
  }
  downloadJson(fileName, json)
  return 'download'
}
