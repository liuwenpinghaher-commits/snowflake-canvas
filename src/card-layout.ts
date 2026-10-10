import { LAYERS, fieldKeys, layerLabel } from './document.ts'
import type { Card, Layer } from './document.ts'

// 收起时正文最多按 12 行显示，开头留在卡片上，底部留出展开条。
// 展开条出不出现只看渲染后的正文高度。下面的字数估算只给首帧占位，不决定按钮。
export const BODY_LINE_CAP = 12
export const COLUMN_GAP = 16
export const EXPAND_BAR_PX = 36
const CARD_PAD_BOTTOM = 10
export const EXPAND_CHROME_PX = EXPAND_BAR_PX - CARD_PAD_BOTTOM

const TITLE_PX = 16
const TITLE_LH = 1.25
const BODY_PX = 14
const BODY_LH = 1.5

export type ShiftBox = {
  id: string
  x: number
  y: number
  width: number
  height: number
  prevHeight: number
  kind: 'card' | 'group'
}

export function discussCardName(title: string, layerName: string): string {
  const trimmed = title.trim()
  return trimmed || layerName
}

function wrappedLines(text: string, innerWidth: number, fontPx: number, cap?: number): number {
  if (!text.trim()) return 0
  const perLine = Math.max(1, innerWidth / fontPx)
  let lines = 0
  for (const part of text.split('\n')) {
    if (part.length === 0) {
      lines += 1
      continue
    }
    let units = 0
    for (const ch of part) {
      units += (ch.codePointAt(0) ?? 0) > 255 ? 1 : 0.55
    }
    lines += Math.max(1, Math.ceil(units / perLine))
  }
  if (cap != null && lines > cap) return cap
  return lines
}

function contentWidth(width: number): number {
  return Math.max(40, width - 12 * 2 - 2)
}

// 比较的是渲染后的像素，不是字数。多 1 像素以内当成同一行，避免小数取整误开按钮。
export function snowBodyOverflows(scrollHeight: number, lineCapPx: number): boolean {
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(lineCapPx) || lineCapPx <= 0) return false
  return scrollHeight > lineCapPx + 1
}

export function snowBodyLineCapPx(fontSize: string, lineHeight: string): number {
  const size = Number.parseFloat(fontSize)
  const sizePx = Number.isFinite(size) && size > 0 ? size : BODY_PX
  const parsedLine = Number.parseFloat(lineHeight)
  const linePx = Number.isFinite(parsedLine) && parsedLine > 0 ? parsedLine : sizePx * BODY_LH
  return linePx * BODY_LINE_CAP
}

// 先去掉收起时的限高，再读全文高度。限高还在时，有的浏览器会把 scrollHeight 报成可见高度。
export function snowExpandLabel(overflows: boolean, expanded: boolean): '展开全文' | '收起' | null {
  if (!overflows) return null
  return expanded ? '收起' : '展开全文'
}

export function measureSnowBodyOverflow(bodyEl: HTMLElement): boolean {
  const style = getComputedStyle(bodyEl)
  const cap = snowBodyLineCapPx(style.fontSize, style.lineHeight)
  const previous = bodyEl.style.maxHeight
  bodyEl.style.maxHeight = 'none'
  const scrollHeight = bodyEl.scrollHeight
  bodyEl.style.maxHeight = previous
  return snowBodyOverflows(scrollHeight, cap)
}

export function estimateSnowCardHeight(input: {
  title: string
  body: string
  meta: string
  width: number
  expanded?: boolean
  // 渲染测过、确认超过 12 行之后才传入。不传就按全文估高，不加展开条。
  overflows?: boolean
}): number {
  const inner = contentWidth(input.width)
  const titleLines = Math.max(1, wrappedLines(input.title.trim() || '还没有写下内容', inner, TITLE_PX))
  const rawBodyLines = wrappedLines(input.body, inner, BODY_PX)
  const overflows = input.overflows === true
  const bodyLines = overflows && !input.expanded ? BODY_LINE_CAP : rawBodyLines
  let height = 4 + 1 + 20 + 12 * 1.4 + 8
  height += titleLines * TITLE_PX * TITLE_LH
  if (bodyLines > 0) height += 4 + bodyLines * BODY_PX * BODY_LH
  if (overflows) height += EXPAND_CHROME_PX
  return Math.ceil(height)
}

function overlapLen(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0)
}

// 只下移雪花卡片。分组框即使被挡住也留在原地。
// 水平、垂直都重叠才算挡住。下移量是重叠高度再加 16 像素。
// 按当前 y 从上往下推，只增加 y。已经重叠过、且上面那张没被这次下移带动的，不动。
// draggingId 那张在本次计算里不改 y。
export function shiftOverlappingCards(
  boxes: readonly ShiftBox[],
  draggingId: string | null = null,
): { id: string; x: number; y: number }[] {
  const cards = boxes
    .filter((box) => box.kind === 'card')
    .map((box) => ({ ...box }))
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const originY = new Map(cards.map((card) => [card.id, card.y]))
  const limit = cards.length * cards.length + 1
  for (let step = 0; step < limit; step += 1) {
    let moved = false
    for (let i = 0; i < cards.length; i += 1) {
      const upper = cards[i]
      for (let j = 0; j < cards.length; j += 1) {
        if (i === j) continue
        const lower = cards[j]
        if (lower.id === draggingId) continue
        if (lower.y < upper.y) continue
        if (lower.y === upper.y && (lower.x < upper.x || (lower.x === upper.x && lower.id <= upper.id))) continue
        if (overlapLen(upper.x, upper.x + upper.width, lower.x, lower.x + lower.width) <= 0) continue
        const overlap = overlapLen(upper.y, upper.y + upper.height, lower.y, lower.y + lower.height)
        if (overlap <= 0) continue
        const oldUpperY = originY.get(upper.id) ?? upper.y
        const oldLowerY = originY.get(lower.id) ?? lower.y
        const oldOverlap = overlapLen(oldUpperY, oldUpperY + upper.prevHeight, oldLowerY, oldLowerY + lower.prevHeight)
        const upperMoved = upper.y !== oldUpperY
        if (oldOverlap > 0 && !upperMoved) continue
        // 下沿伸出上一张时，重叠高度 + 16 正好落到上一张底边再加 16。
        // 整张被包在里面时，按同一条间隙放到上一张底边之下，避免只挪重叠高度后仍贴着。
        const target = upper.y + upper.height + COLUMN_GAP
        if (lower.y >= target) continue
        lower.y = target
        moved = true
      }
    }
    if (!moved) break
  }

  const moves: { id: string; x: number; y: number }[] = []
  for (const card of cards) {
    const from = originY.get(card.id)
    if (from == null || card.y === from) continue
    moves.push({ id: card.id, x: card.x, y: card.y })
  }
  return moves
}

// 写作工序分组。念头不进这四组。组的顺序固定。
export const PIPELINE_GROUPS: readonly { title: string; layers: readonly Layer[] }[] = [
  { title: '立意', layers: ['一句话', '一段'] },
  { title: '人物', layers: ['renwubiao', 'renwugushi', 'renwudangan'] },
  { title: '结构', layers: ['yiyedagang', '场景表', 'changci'] },
  { title: '成稿', layers: ['正文草稿'] },
]

// 下一步按十层顺序走，跳过念头。
export const NEXT_STEP_LAYERS: readonly Layer[] = LAYERS.filter((layer) => layer !== 'situation')

// 这一层算不算写完。按该层自己的字段判断，不把「名字：」这种空标签正文当成已写。
export function cardCountsAsDone(card: Card): boolean {
  if (card.layer === 'situation' || card.layer === '正文草稿') {
    return card.body.trim().length > 0
  }
  if (card.layer === '一句话') {
    return (card.fields.sentence ?? '').trim().length > 0
  }
  return fieldKeys(card.layer).some((key) => (card.fields[key] ?? '').trim().length > 0)
}

export function layerIsDone(cards: Readonly<Record<string, Card>>, layer: Layer): boolean {
  for (const card of Object.values(cards)) {
    if (card.layer === layer && cardCountsAsDone(card)) return true
  }
  return false
}

export type PipelineGroupProgress = {
  title: string
  done: number
  total: number
  layers: readonly Layer[]
}

export function pipelineGroupProgress(cards: Readonly<Record<string, Card>>): PipelineGroupProgress[] {
  return PIPELINE_GROUPS.map((group) => ({
    title: group.title,
    layers: group.layers,
    total: group.layers.length,
    done: group.layers.filter((layer) => layerIsDone(cards, layer)).length,
  }))
}

export function pipelineGroupLabel(group: PipelineGroupProgress): string {
  return `${group.title} ${group.done}/${group.total}`
}

// 从一句话起，碰到第一层还没写完的：前一层已经写完就提示写这一层。全部写完则不提示。
export function nextStepHint(cards: Readonly<Record<string, Card>>): string | null {
  const pending = NEXT_STEP_LAYERS.findIndex((layer) => !layerIsDone(cards, layer))
  if (pending <= 0) return null
  const finished = NEXT_STEP_LAYERS[pending - 1]
  const upcoming = NEXT_STEP_LAYERS[pending]
  if (!finished || !upcoming) return null
  return `${layerLabel(finished)}写好了，下一步可以写${layerLabel(upcoming)}`
}
