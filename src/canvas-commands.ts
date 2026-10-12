import { deleteSelection, type AppState } from './document.ts'

export const CONFIRM_DELETE = '删除这张卡片？删错了可以按 Ctrl+Z 撤销。服务器模式下也可以用回退到这一版找回。'

export interface CanvasDeleteController {
  snapshot(): { state: AppState }
  mutate(recipe: (state: AppState) => AppState, options?: { undoable?: boolean }): Promise<void>
}

/** 书内锚点，只在这一本里跳，不是公网地址。 */
export function cardAnchor(cardId: string): string {
  return `#card/${encodeURIComponent(cardId)}`
}

export async function copyCardAnchor(cardId: string): Promise<boolean> {
  const text = cardAnchor(cardId)
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 剪贴板被拒绝时，改用页面上的选中复制。
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', 'true')
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    if (copied) return true
  } catch {
    // 下面把书内锚点交给作者自己复制。
  }
  window.prompt('书内链接', text)
  return false
}

export async function deleteCanvasNode(
  ctl: CanvasDeleteController | null,
  id: string,
  confirm: (message: string) => boolean,
): Promise<boolean> {
  if (!ctl || !id) return false
  const exists = ctl.snapshot().state.canvas.nodes.some((node) => node.id === id)
  if (!exists) return false
  if (!confirm(CONFIRM_DELETE)) return false
  await ctl.mutate((current) => deleteSelection(current, id), { undoable: true })
  return true
}
