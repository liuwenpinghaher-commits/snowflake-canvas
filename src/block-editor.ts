// 一格正文的块。@@sf-blocks 仍是读旧字符串的入口。
// 单段落且没有特殊块时，字符串原样进出。
// 多块或特殊块用一行前缀，软换行写成 \n，整段以 @@sf-blocks 开头：
//   p 段落  h 标题  q 引用  t0 未完成待办  t1 已完成待办  d 分隔线
// 新正本的块数组由 document.ts 写在卡片旁边；这里不决定落不落盘。

export type BlockType = 'paragraph' | 'heading' | 'quote' | 'todo' | 'divider'

export interface Block {
  id: string
  type: BlockType
  text: string
  checked?: boolean
}

export interface SlashState {
  index: number
  query: string
}

export interface BlockComposeSession {
  blocks: Block[]
  composing: boolean
  draft: string
  active: number
  selected: number | null
  slash: SlashState | null
  past: Block[][]
}

export type BlockEvent =
  | { type: 'input'; index: number; text: string; cursor: number }
  | { type: 'enter'; index: number; cursor: number }
  | { type: 'shiftEnter'; index: number; cursor: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'slashQuery'; query: string }
  | { type: 'slashPick'; blockType: BlockType }
  | { type: 'escape' }
  | { type: 'undo' }
  | { type: 'compositionstart' }
  | { type: 'insert'; text: string }
  | { type: 'compositionend'; text: string }
  | { type: 'toggleTodo'; index: number }
  | { type: 'turn'; index: number; blockType: 'paragraph' | 'heading' | 'quote' | 'todo' }
  | { type: 'duplicate'; index: number }
  | { type: 'remove'; index: number }

export const BLOCK_WIRE_SENTINEL = '@@sf-blocks'

export const SLASH_ITEMS: readonly { type: BlockType; label: string }[] = [
  { type: 'paragraph', label: '段落' },
  { type: 'heading', label: '标题' },
  { type: 'quote', label: '引用' },
  { type: 'todo', label: '待办' },
  { type: 'divider', label: '分隔线' },
]

const BLOCK_LINE = /^(?:p|h|q|t0|t1) /

let serial = 0

function freshBlockId(): string {
  serial += 1
  return `blk-${serial}`
}

function clampCursor(cursor: number, length: number): number {
  if (!Number.isFinite(cursor)) return 0
  if (cursor < 0) return 0
  if (cursor > length) return length
  return cursor
}

function cloneBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map((block) => ({ ...block }))
}

function paragraph(text: string, id = freshBlockId()): Block {
  return { id, type: 'paragraph', text }
}

export function filterSlash(query: string): { type: BlockType; label: string }[] {
  const needle = query.trim()
  if (!needle) return SLASH_ITEMS.map((item) => ({ ...item }))
  return SLASH_ITEMS.filter((item) => item.label.includes(needle)).map((item) => ({ ...item }))
}

export function isBlockWire(text: string): boolean {
  const prefix = `${BLOCK_WIRE_SENTINEL}\n`
  if (!text.startsWith(prefix)) return false
  const lines = text.slice(prefix.length).split('\n')
  return lines.length > 0 && lines.every(isBlockLine)
}

function isBlockLine(line: string): boolean {
  return line === 'd' || BLOCK_LINE.test(line)
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

function unescapeText(source: string): string {
  let out = ''
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\\' && i + 1 < source.length) {
      const next = source[i + 1]
      if (next === 'n') {
        out += '\n'
        i += 1
        continue
      }
      if (next === 'r') {
        out += '\r'
        i += 1
        continue
      }
      if (next === '\\') {
        out += '\\'
        i += 1
        continue
      }
    }
    out += source[i]
  }
  return out
}

function encodeLine(block: Block): string {
  switch (block.type) {
    case 'paragraph':
      return `p ${escapeText(block.text)}`
    case 'heading':
      return `h ${escapeText(block.text)}`
    case 'quote':
      return `q ${escapeText(block.text)}`
    case 'todo':
      return `${block.checked ? 't1' : 't0'} ${escapeText(block.text)}`
    case 'divider':
      return 'd'
    default:
      return `p ${escapeText(block.text)}`
  }
}

function decodeLine(line: string, index: number): Block {
  const id = `wire-${index + 1}`
  if (line === 'd') return { id, type: 'divider', text: '' }
  const mark = line.startsWith('t0 ') || line.startsWith('t1 ') ? line.slice(0, 2) : line.slice(0, 1)
  const text = unescapeText(line.slice(mark.length + 1))
  if (mark === 'h') return { id, type: 'heading', text }
  if (mark === 'q') return { id, type: 'quote', text }
  if (mark === 't0') return { id, type: 'todo', text, checked: false }
  if (mark === 't1') return { id, type: 'todo', text, checked: true }
  return { id, type: 'paragraph', text }
}

export function textToBlocks(text: string): Block[] {
  if (!isBlockWire(text)) return [paragraph(text, 'wire-1')]
  const lines = text.slice(BLOCK_WIRE_SENTINEL.length + 1).split('\n')
  return lines.map((line, index) => decodeLine(line, index))
}

export function blocksToText(blocks: readonly Block[]): string {
  if (blocks.length === 1 && blocks[0]?.type === 'paragraph') return blocks[0].text
  if (blocks.length === 0) return ''
  return [BLOCK_WIRE_SENTINEL, ...blocks.map(encodeLine)].join('\n')
}

export function visibleProse(stored: string): string {
  if (!isBlockWire(stored)) return stored
  return textToBlocks(stored)
    .map((block) => (block.type === 'divider' ? '' : block.text))
    .join('\n')
}

export function slashQueryOf(text: string, cursor: number): string | null {
  const at = clampCursor(cursor, text.length)
  const lineStart = text.lastIndexOf('\n', Math.max(0, at - 1)) + 1
  const nextBreak = text.indexOf('\n', at)
  const line = text.slice(lineStart, nextBreak === -1 ? text.length : nextBreak)
  if (!line.startsWith('/')) return null
  return line.slice(1)
}

export function insertedSlashTrigger(before: string, after: string, cursor: number): boolean {
  if (cursor < 1 || cursor > after.length) return false
  if (after[cursor - 1] !== '/') return false
  if (after.slice(0, cursor - 1) + after.slice(cursor) !== before) return false
  const prefix = before.slice(0, cursor - 1)
  if (!(prefix.length === 0 || prefix.endsWith('\n'))) return false
  const restLine = (before.slice(cursor - 1).split('\n')[0] ?? '')
  return restLine.length === 0
}

function stripSlashLine(text: string): string {
  const lines = text.split('\n')
  const index = lines.findIndex((line) => line.startsWith('/'))
  if (index < 0) return text
  lines.splice(index, 1)
  return lines.join('\n')
}

function asType(block: Block, type: BlockType, text: string): Block {
  if (type === 'divider') return { id: block.id, type, text: '' }
  if (type === 'todo') return { id: block.id, type, text, checked: false }
  return { id: block.id, type, text }
}

function withPast(session: BlockComposeSession): Block[][] {
  const past = [...session.past, cloneBlocks(session.blocks)]
  return past.length > 100 ? past.slice(past.length - 100) : past
}

function splitAt(session: BlockComposeSession, index: number, cursor: number): BlockComposeSession {
  const block = session.blocks[index]
  if (!block) return session
  const past = withPast(session)
  if (block.type === 'divider') {
    const created = paragraph('')
    const blocks = [...session.blocks.slice(0, index + 1), created, ...session.blocks.slice(index + 1)]
    return { ...session, blocks, past, active: index + 1, selected: null, slash: null }
  }
  const at = clampCursor(cursor, block.text.length)
  const left = { ...block, text: block.text.slice(0, at) }
  const rightType: BlockType = block.type === 'heading' ? 'paragraph' : block.type
  const right: Block = {
    id: freshBlockId(),
    type: rightType,
    text: block.text.slice(at),
    ...(rightType === 'todo' ? { checked: false } : {}),
  }
  const blocks = [...session.blocks.slice(0, index), left, right, ...session.blocks.slice(index + 1)]
  return { ...session, blocks, past, active: index + 1, selected: null, slash: null }
}

export function blockSessionFromText(text: string): BlockComposeSession {
  const blocks = textToBlocks(text)
  return {
    blocks,
    composing: false,
    draft: blocks[0]?.text ?? '',
    active: 0,
    selected: null,
    slash: null,
    past: [],
  }
}

export function blockSessionFromBlocks(blocks: readonly Block[], past: readonly Block[][] = []): BlockComposeSession {
  const next = cloneBlocks(blocks)
  return {
    blocks: next.length > 0 ? next : [paragraph('')],
    composing: false,
    draft: next[0]?.text ?? '',
    active: 0,
    selected: null,
    slash: null,
    past: past.map((entry) => cloneBlocks(entry)),
  }
}

export function applyBlockEvent(session: BlockComposeSession, event: BlockEvent): BlockComposeSession {
  if (event.type === 'compositionstart') {
    const current = session.blocks[session.active]?.text ?? ''
    return { ...session, composing: true, draft: current }
  }
  if (event.type === 'insert') {
    if (!session.composing) return session
    return { ...session, draft: event.text }
  }
  if (event.type === 'compositionend') {
    const blocks = session.blocks.map((block, index) =>
      index === session.active ? { ...block, text: event.text } : block,
    )
    return { ...session, composing: false, draft: event.text, blocks, slash: null }
  }
  if (session.composing) return session

  if (event.type === 'input') {
    const block = session.blocks[event.index]
    if (!block || block.type === 'divider') return session
    const before = block.text
    const blocks = session.blocks.map((item, index) => (index === event.index ? { ...item, text: event.text } : item))
    let slash = session.slash
    if (slash && slash.index === event.index) {
      const query = slashQueryOf(event.text, event.cursor)
      slash = query === null ? null : { index: event.index, query }
    } else if (!slash && insertedSlashTrigger(before, event.text, event.cursor)) {
      slash = { index: event.index, query: slashQueryOf(event.text, event.cursor) ?? '' }
    }
    return { ...session, blocks, slash, active: event.index }
  }

  if (event.type === 'slashQuery') {
    if (!session.slash) return session
    return { ...session, slash: { index: session.slash.index, query: event.query } }
  }

  if (event.type === 'slashPick') {
    if (!session.slash) return session
    const index = session.slash.index
    const block = session.blocks[index]
    if (!block) return { ...session, slash: null }
    const past = withPast(session)
    const next = asType(block, event.blockType, stripSlashLine(block.text))
    const blocks = session.blocks.map((item, itemIndex) => (itemIndex === index ? next : item))
    return { ...session, blocks, past, slash: null, active: index, selected: null }
  }

  if (event.type === 'escape') {
    if (session.slash) return { ...session, slash: null }
    return { ...session, selected: session.active }
  }

  if (event.type === 'undo') {
    if (session.past.length === 0) return session
    const blocks = cloneBlocks(session.past[session.past.length - 1] ?? [])
    return {
      ...session,
      blocks: blocks.length > 0 ? blocks : [paragraph('')],
      past: session.past.slice(0, -1),
      slash: null,
      selected: null,
    }
  }

  if (event.type === 'enter') {
    if (session.slash) {
      const items = filterSlash(session.slash.query)
      if (items.length === 0) return { ...session, slash: null }
      const picked = items[0]
      if (!picked) return { ...session, slash: null }
      return applyBlockEvent(session, { type: 'slashPick', blockType: picked.type })
    }
    return splitAt(session, event.index, event.cursor)
  }

  if (event.type === 'shiftEnter') {
    const block = session.blocks[event.index]
    if (!block || block.type === 'divider') return session
    const at = clampCursor(event.cursor, block.text.length)
    const text = `${block.text.slice(0, at)}\n${block.text.slice(at)}`
    const blocks = session.blocks.map((item, index) => (index === event.index ? { ...item, text } : item))
    return { ...session, blocks, active: event.index }
  }

  if (event.type === 'move') {
    if (event.from === event.to) return session
    if (event.from < 0 || event.to < 0 || event.from >= session.blocks.length || event.to >= session.blocks.length) {
      return session
    }
    const past = withPast(session)
    const blocks = session.blocks.slice()
    const [item] = blocks.splice(event.from, 1)
    if (!item) return session
    blocks.splice(event.to, 0, item)
    return { ...session, blocks, past, active: event.to, slash: null, selected: null }
  }

  if (event.type === 'toggleTodo') {
    const block = session.blocks[event.index]
    if (!block || block.type !== 'todo') return session
    const past = withPast(session)
    const blocks = session.blocks.map((item, index) =>
      index === event.index ? { ...item, checked: !item.checked } : item,
    )
    return { ...session, blocks, past, active: event.index }
  }

  if (event.type === 'turn') {
    const block = session.blocks[event.index]
    if (!block || block.type === event.blockType) return session
    const past = withPast(session)
    const text = block.type === 'divider' ? '' : block.text
    const next = asType(block, event.blockType, text)
    const blocks = session.blocks.map((item, index) => (index === event.index ? next : item))
    return { ...session, blocks, past, slash: null, active: event.index, selected: event.index }
  }

  if (event.type === 'duplicate') {
    const block = session.blocks[event.index]
    if (!block) return session
    const past = withPast(session)
    const copy: Block =
      block.type === 'todo'
        ? { id: freshBlockId(), type: 'todo', text: block.text, checked: block.checked === true }
        : block.type === 'divider'
          ? { id: freshBlockId(), type: 'divider', text: '' }
          : { id: freshBlockId(), type: block.type, text: block.text }
    const blocks = [...session.blocks.slice(0, event.index + 1), copy, ...session.blocks.slice(event.index + 1)]
    return { ...session, blocks, past, slash: null, active: event.index + 1, selected: event.index + 1 }
  }

  if (event.type === 'remove') {
    const block = session.blocks[event.index]
    if (!block) return session
    if (session.blocks.length === 1 && block.type === 'paragraph' && block.text.length === 0) return session
    const past = withPast(session)
    const rest = session.blocks.filter((_, index) => index !== event.index)
    const blocks = rest.length > 0 ? rest : [paragraph('')]
    const active = Math.min(event.index, blocks.length - 1)
    return { ...session, blocks, past, slash: null, active, selected: active }
  }

  return session
}

export function blockMenuItems(
  index: number,
  count: number,
  canType: boolean,
  current: BlockType | undefined,
): { id: string; label: string; disabled: boolean }[] {
  const turns = [
    ['paragraph', '变成段落'],
    ['heading', '变成标题'],
    ['quote', '变成引用'],
    ['todo', '变成待办'],
  ] as const
  return [
    ...turns.map(([type, label]) => ({
      id: `turn:${type}`,
      label,
      disabled: !canType || current === type,
    })),
    { id: 'duplicate', label: '复制', disabled: !canType },
    { id: 'remove', label: '删除', disabled: !canType },
    { id: 'up', label: '上移', disabled: !canType || index <= 0 },
    { id: 'down', label: '下移', disabled: !canType || index < 0 || index >= count - 1 },
  ]
}

export function applyBlockMenu(session: BlockComposeSession, index: number, command: string): BlockComposeSession {
  if (command === 'duplicate') return applyBlockEvent(session, { type: 'duplicate', index })
  if (command === 'remove') return applyBlockEvent(session, { type: 'remove', index })
  if (command === 'up') return applyBlockEvent(session, { type: 'move', from: index, to: index - 1 })
  if (command === 'down') return applyBlockEvent(session, { type: 'move', from: index, to: index + 1 })
  if (command.startsWith('turn:')) {
    const blockType = command.slice('turn:'.length)
    if (blockType === 'paragraph' || blockType === 'heading' || blockType === 'quote' || blockType === 'todo') {
      return applyBlockEvent(session, { type: 'turn', index, blockType })
    }
  }
  return session
}
