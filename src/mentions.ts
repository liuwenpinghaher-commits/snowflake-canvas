// 反向链接不落盘。打开时从当前书的块正文现算，算法和 cardFootnotes 一样：读状态，不写 snowflake.json。
import { textToBlocks, visibleProse } from './block-editor.ts'
import { cardFace, type AppState, type Card } from './document.ts'
import { findMentionMarks, type MentionKind } from './mention-mark.ts'

export type { MentionKind } from './mention-mark.ts'
export { mentionToken } from './mention-mark.ts'

export interface MentionCandidate {
  kind: MentionKind
  id: string
  label: string
}

export interface MentionHit {
  sourceCardId: string
  fieldKey: string
  blockId: string
  targetKind: MentionKind
  targetId: string
  ordinal: number
}

export interface MentionJump {
  cardId: string
  fieldKey: string
  blockId: string
  nonce: number
}

export function mentionLabel(state: AppState, kind: MentionKind, id: string): string {
  if (kind === 'card') {
    const card = state.snowflake.cards[id]
    if (!card) return '找不到'
    return cardFace(card).title.trim() || '未命名卡片'
  }
  const entity = (state.entities ?? []).find((item) => item.id === id)
  if (!entity) return '找不到'
  return entity.name.trim() || '未命名'
}

/** 卡片摘要走 visibleProse：标记换成当前名字，没有目标时是「找不到」。 */
export function shownProse(text: string, state: AppState): string {
  return visibleProse(text, (kind, id) => mentionLabel(state, kind, id))
}

export function mentionTargets(state: AppState): MentionCandidate[] {
  const cards = Object.entries(state.snowflake.cards).map(([id, card]) => ({
    kind: 'card' as const,
    id,
    label: cardFace(card).title.trim() || '未命名卡片',
  }))
  const entities = (state.entities ?? []).map((entity) => ({
    kind: 'entity' as const,
    id: entity.id,
    label: entity.name.trim() || '未命名',
  }))
  return [...cards, ...entities]
}

export function filterMentionTargets(targets: readonly MentionCandidate[], query: string): MentionCandidate[] {
  const needle = query.trim()
  if (!needle) return targets.slice()
  return targets.filter((item) => item.label.includes(needle))
}

/**
 * 卡片和正文草稿的正文在 body。一句话写在 sentence，body 是同一份拷贝，只计一次。
 * 其它层用户写在 fields；body 是字段拼出来的摘要，再计一次会把同一处算成两处。
 * 有落盘块时按块计，不用拼回后的整段字符串。
 */
function proseCells(card: Card): { fieldKey: string; text: string }[] {
  if (card.layer === 'situation' || card.layer === '正文草稿') {
    return [{ fieldKey: 'body', text: card.body }]
  }
  if (card.layer === '一句话') {
    return [{ fieldKey: 'sentence', text: card.fields.sentence ?? card.body }]
  }
  return Object.entries(card.fields)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([fieldKey, text]) => ({ fieldKey, text }))
}

function blocksOf(card: Card, fieldKey: string, text: string): { id: string; text: string }[] {
  const stored = card.blocks?.[fieldKey]
  if (stored && stored.length > 0) {
    return stored.map((block) => ({ id: block.id, text: block.type === 'divider' ? '' : block.text }))
  }
  return textToBlocks(text).map((block) => ({ id: block.id, text: block.text }))
}

export function mentionsOf(state: AppState, targetKind: MentionKind, targetId: string): MentionHit[] {
  const hits: MentionHit[] = []
  for (const [sourceCardId, card] of Object.entries(state.snowflake.cards)) {
    for (const cell of proseCells(card)) {
      let ordinal = 0
      for (const block of blocksOf(card, cell.fieldKey, cell.text)) {
        for (const mark of findMentionMarks(block.text)) {
          if (mark.kind !== targetKind || mark.id !== targetId) continue
          hits.push({
            sourceCardId,
            fieldKey: cell.fieldKey,
            blockId: block.id,
            targetKind: mark.kind,
            targetId: mark.id,
            ordinal,
          })
          ordinal += 1
        }
      }
    }
  }
  return hits
}

/** 和侧栏「N 字」同一口径：标记本身不计，换成当前名字之后再数。 */
export function shownCharCount(text: string, state: AppState): number {
  return [...shownProse(text, state).replace(/\s/g, '')].length
}

/** 反向列表悬停一条时，预览那一块的可见正文。标记换成当前名字。 */
export function mentionPreview(state: AppState, hit: MentionHit): string {
  const card = state.snowflake.cards[hit.sourceCardId]
  if (!card) return ''
  for (const cell of proseCells(card)) {
    if (cell.fieldKey !== hit.fieldKey) continue
    for (const block of blocksOf(card, cell.fieldKey, cell.text)) {
      if (block.id !== hit.blockId) continue
      return shownProse(block.text, state)
    }
  }
  return ''
}
