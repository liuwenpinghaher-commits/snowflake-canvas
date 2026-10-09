// 正文最多显示 12 行，超出在卡片里滚动。
// 12 行大约 252px，比视口 70% 矮得多，长正文不会把整屏撑满。
export const BODY_LINE_CAP = 12
export const COLUMN_GAP = 16

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

export function estimateSnowCardHeight(input: { title: string; body: string; meta: string; width: number }): number {
  const inner = Math.max(40, input.width - 12 * 2 - 2)
  const titleLines = Math.max(1, wrappedLines(input.title.trim() || '还没有写下内容', inner, TITLE_PX))
  const bodyLines = wrappedLines(input.body, inner, BODY_PX, BODY_LINE_CAP)
  let height = 4 + 1 + 20 + 12 * 1.4 + 8
  height += titleLines * TITLE_PX * TITLE_LH
  if (bodyLines > 0) height += 4 + bodyLines * BODY_PX * BODY_LH
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
