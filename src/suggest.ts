// 折进此场只生成一份给人看的建议包。不写进画布正本，也不向设定图查询或写入。
import type { AppState, Card } from './document.ts'

export const SUGGEST_KIND = 'she-ding-tu-suggestion'
export const SUGGEST_SOURCE = 'snowflake-canvas'
export const SUGGEST_NOTE =
  '这是给人看的建议，不会自动写进设定图。贴进哪个框、写入哪一格，以设定图现场行为为准。'

export const SUGGEST_SLOTS = ['intent', 'value_shift', 'do_text', 'say_text', 'think_text'] as const

export type SuggestSlot = (typeof SUGGEST_SLOTS)[number]
export type SuggestAction = 'existing-scene' | 'new-draft-scene'

export const SLOT_WHERE: Record<SuggestSlot, string> = {
  intent: '本场任务',
  value_shift: '价值转折',
  say_text: '对白',
  think_text: '内心',
  do_text: '动作',
}

export const REASON_SCENE_TASK = '先写一句本场任务。场景表的「这一场发生什么」和标题都是空的。'
export const REASON_DRAFT_TASK =
  '新草稿场还缺本场任务。先在相连的场次写本场任务，或在相连的场景表写这一场发生什么或标题，或在这里补一句。'
export const REASON_BEAT_TASK = '先写一句本场任务。这张场次上的本场任务是空的，相连的场景表也没有能用的一句。'
export const REASON_LAYER = '这一层不能折进此场。只有场景表、场次和正文草稿可以折出建议。'

export interface SuggestItem {
  cardId: string
  action: SuggestAction
  beatId: string | null
  slot: SuggestSlot
  text: string
  where: string
}

export interface SuggestFile {
  kind: typeof SUGGEST_KIND
  source: typeof SUGGEST_SOURCE
  note: string
  items: SuggestItem[]
}

export type FoldResult = { ok: true; json: string } | { ok: false; reason: string }

export interface FoldInput {
  cardId: string
  action: SuggestAction
  beatId?: string | null
  intentSupplement?: string
  /** 五格以外的 slot 不会进建议包。界面不传这个字段。 */
  extraSlots?: ReadonlyArray<{ slot: string; text: string }>
}

export function isSuggestSlot(slot: string): slot is SuggestSlot {
  return (SUGGEST_SLOTS as readonly string[]).includes(slot)
}

export function suggestionFileName(cardId: string): string {
  return `suggestion-${cardId}.json`
}

function blank(value: string | null | undefined): string {
  return (value ?? '').trim()
}

export function sceneCardTask(card: Card): string {
  return blank(card.fields.what) || blank(card.fields.title)
}

function parentCards(state: AppState, cardId: string): { id: string; card: Card }[] {
  const parents: { id: string; card: Card }[] = []
  for (const edge of state.canvas.edges) {
    if (edge.toNode !== cardId) continue
    const card = state.snowflake.cards[edge.fromNode]
    if (!card) continue
    parents.push({ id: edge.fromNode, card })
  }
  return parents
}

export function connectedSceneTask(state: AppState, cardId: string): { cardId: string; text: string } | null {
  const parents = parentCards(state, cardId)
  for (const parent of parents) {
    if (parent.card.layer !== 'changci') continue
    const task = blank(parent.card.fields.task)
    if (task) return { cardId: parent.id, text: task }
  }
  for (const parent of parents) {
    if (parent.card.layer !== '场景表') continue
    const text = sceneCardTask(parent.card)
    if (text) return { cardId: parent.id, text }
  }
  for (const parent of parents) {
    if (parent.card.layer !== 'changci') continue
    const upstream = parentCards(state, parent.id).find(
      (item) => item.card.layer === '场景表' && sceneCardTask(item.card),
    )
    if (upstream) return { cardId: upstream.id, text: sceneCardTask(upstream.card) }
  }
  return null
}

function beatOf(action: SuggestAction, beatId: string | null | undefined): string | null {
  if (action === 'new-draft-scene') return null
  return blank(typeof beatId === 'string' ? beatId : '') || null
}

function makeItem(
  cardId: string,
  action: SuggestAction,
  beatId: string | null,
  slot: string,
  text: string,
): SuggestItem | null {
  if (!isSuggestSlot(slot)) return null
  return {
    cardId,
    action,
    beatId,
    slot,
    text,
    where: SLOT_WHERE[slot],
  }
}

function render(items: SuggestItem[]): string {
  const file: SuggestFile = {
    kind: SUGGEST_KIND,
    source: SUGGEST_SOURCE,
    note: SUGGEST_NOTE,
    items,
  }
  return JSON.stringify(file, null, 2)
}

export function foldIntoScene(state: AppState, input: FoldInput): FoldResult {
  const action = input.action
  if (action !== 'existing-scene' && action !== 'new-draft-scene') {
    return { ok: false, reason: '请选择已有场或新草稿场。' }
  }

  const card = state.snowflake.cards[input.cardId]
  if (!card) return { ok: false, reason: '这张卡片不在画布上。' }
  if (card.layer !== '场景表' && card.layer !== 'changci' && card.layer !== '正文草稿') {
    return { ok: false, reason: REASON_LAYER }
  }

  const beatId = beatOf(action, input.beatId)
  const items: SuggestItem[] = []

  if (card.layer === '场景表') {
    const text = sceneCardTask(card)
    if (!text) return { ok: false, reason: REASON_SCENE_TASK }
    const intent = makeItem(input.cardId, action, beatId, 'intent', text)
    if (intent) items.push(intent)
  } else if (card.layer === 'changci') {
    const own = blank(card.fields.task)
    if (own) {
      const intent = makeItem(input.cardId, action, beatId, 'intent', own)
      if (intent) items.push(intent)
    } else {
      const linked = connectedSceneTask(state, input.cardId)
      if (!linked) return { ok: false, reason: REASON_BEAT_TASK }
      const intent = makeItem(linked.cardId, action, beatId, 'intent', linked.text)
      if (intent) items.push(intent)
    }
  } else {
    const motion = makeItem(input.cardId, action, beatId, 'do_text', card.body)
    if (motion) items.push(motion)
    if (action === 'new-draft-scene') {
      const linked = connectedSceneTask(state, input.cardId)
      const supplement = blank(input.intentSupplement)
      const intentText = linked?.text || supplement
      if (!intentText) return { ok: false, reason: REASON_DRAFT_TASK }
      const intentCardId = linked ? linked.cardId : input.cardId
      const intent = makeItem(intentCardId, action, beatId, 'intent', intentText)
      if (intent) items.push(intent)
    }
  }

  for (const extra of input.extraSlots ?? []) {
    if (!extra || typeof extra.slot !== 'string') continue
    if (items.some((item) => item.slot === extra.slot)) continue
    const text = typeof extra.text === 'string' ? extra.text : ''
    const made = makeItem(input.cardId, action, beatId, extra.slot, text)
    if (made) items.push(made)
  }

  if (items.length === 0) return { ok: false, reason: REASON_LAYER }
  return { ok: true, json: render(items) }
}
