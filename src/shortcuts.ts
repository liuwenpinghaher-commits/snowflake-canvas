export interface KeyInfo {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat: boolean
  isComposing: boolean
  target: object | null
}

export type ShortcutDecision =
  | { type: 'ignore' }
  | { type: 'toggle-palette' }
  | { type: 'document-undo' }
  | { type: 'document-redo' }
  | { type: 'delete-selection' }

export interface ShortcutActions {
  togglePalette: () => void
  undo: () => void
  redo: () => void
  deleteSelection: () => void
}

interface ShortcutElement {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?: (name: string) => string | null
  closest?: (selector: string) => unknown
  nodeType?: number
  parentElement?: ShortcutElement | null
}

function asElement(target: object | null): ShortcutElement | null {
  if (!target) return null
  const node = target as ShortcutElement
  if (node.nodeType === 3 && node.parentElement) return node.parentElement
  return node
}

export function isTypingTarget(target: object | null): boolean {
  const el = asElement(target)
  if (!el) return false
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  if (typeof el.closest === 'function' && el.closest('.cm-editor, .sf-editor, [contenteditable="true"]')) return true
  return false
}

function isMenuChrome(target: object | null): boolean {
  const el = asElement(target)
  if (!el || typeof el.closest !== 'function') return false
  return Boolean(el.closest('.action-menu'))
}

function modified(event: KeyInfo): boolean {
  return event.ctrlKey || event.metaKey
}

export function shortcutDecision(event: KeyInfo): ShortcutDecision {
  if (event.isComposing || event.repeat || event.altKey) return { type: 'ignore' }
  const key = event.key.toLowerCase()
  // Ctrl+K / Meta+K 是命令面板自己的快捷键。别的快捷键在输入框里不抢。
  if (modified(event) && key === 'k' && !event.shiftKey) return { type: 'toggle-palette' }
  if (isTypingTarget(event.target) || isMenuChrome(event.target)) return { type: 'ignore' }
  if (modified(event) && key === 'z' && !event.shiftKey) return { type: 'document-undo' }
  if (modified(event) && ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey))) {
    return { type: 'document-redo' }
  }
  if (!modified(event) && !event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace')) {
    return { type: 'delete-selection' }
  }
  return { type: 'ignore' }
}

export function runShortcut(decision: ShortcutDecision, actions: ShortcutActions): void {
  if (decision.type === 'toggle-palette') actions.togglePalette()
  else if (decision.type === 'document-undo') actions.undo()
  else if (decision.type === 'document-redo') actions.redo()
  else if (decision.type === 'delete-selection') actions.deleteSelection()
}

export function isBlockMenuShortcut(event: KeyInfo, insideBlockEditor: boolean): boolean {
  if (!insideBlockEditor || event.isComposing || event.repeat || event.altKey) return false
  if (!modified(event) || event.key !== '/') return false
  return true
}
