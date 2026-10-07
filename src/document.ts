export const LAYERS = ['situation', '一句话', '一段', '人物', '场景表', '正文草稿'] as const

export type Layer = (typeof LAYERS)[number]

export const PARAGRAPH_KEYS = ['background', 'disaster1', 'disaster2', 'disaster3', 'ending'] as const

export const PERSON_KEYS = [
  'name',
  'motivation',
  'goal',
  'conflict',
  'epiphany',
  'phraseSummary',
  'paragraphSummary',
  'fullSummary',
  'notes',
] as const

export const SCENE_KEYS = ['title', 'pov', 'summarySentence', 'summaryFull', 'notes'] as const

export const SENTENCE_KEYS = ['sentence'] as const

export const FIELD_LABEL: Record<string, string> = {
  sentence: '这一句',
  background: '背景',
  disaster1: '灾难一',
  disaster2: '灾难二',
  disaster3: '灾难三',
  ending: '结局',
  name: '人名',
  motivation: '动机',
  goal: '目标',
  conflict: '冲突',
  epiphany: '顿悟',
  phraseSummary: '一句摘要',
  paragraphSummary: '一段摘要',
  fullSummary: '全文摘要',
  notes: '备注',
  title: '标题',
  pov: '视角',
  summarySentence: '一句话摘要',
  summaryFull: '更长的摘要',
}

const LAYER_COLOR: Record<Layer, string> = {
  situation: '1',
  一句话: '2',
  一段: '3',
  人物: '4',
  场景表: '5',
  正文草稿: '6',
}

export type SideName = 'top' | 'right' | 'bottom' | 'left'
export type EndName = 'none' | 'arrow'

export interface CanvasNode {
  id: string
  type: 'text' | 'group'
  x: number
  y: number
  width: number
  height: number
  text?: string
  color?: string
}

export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide?: SideName
  toSide?: SideName
  fromEnd?: EndName
  toEnd?: EndName
  label?: string
}

export interface Card {
  layer: Layer
  body: string
  fields: Record<string, string>
}

export interface AppState {
  canvas: {
    nodes: CanvasNode[]
    edges: CanvasEdge[]
  }
  snowflake: {
    fileId: string
    cards: Record<string, Card>
  }
  activeId: string | null
}

export interface ComposeSession {
  cardId: string
  composing: boolean
  draft: string
}

export type CompositionEvent =
  | { type: 'compositionstart' }
  | { type: 'insert'; text: string }
  | { type: 'compositionend'; text: string }

const TEXT_WIDTH = 280
const TEXT_HEIGHT = 120

export function layerLabel(layer: Layer): string {
  if (layer === 'situation') return '念头'
  return layer
}

export function fieldKeys(layer: Layer): readonly string[] {
  switch (layer) {
    case '一段':
      return PARAGRAPH_KEYS
    case '人物':
      return PERSON_KEYS
    case '场景表':
      return SCENE_KEYS
    case '一句话':
      return SENTENCE_KEYS
    default:
      return []
  }
}

export function laterLayers(layer: Layer): Layer[] {
  const index = LAYERS.indexOf(layer)
  return LAYERS.slice(index + 1)
}

export function nextLayer(layer: Layer): Layer | null {
  return laterLayers(layer)[0] ?? null
}

export function defaultFieldKey(card: Card): string | null {
  const keys = fieldKeys(card.layer)
  return keys[0] ?? null
}

export function editorText(card: Card, fieldKey: string | null): string {
  if (card.layer === 'situation' || card.layer === '正文草稿') return card.body
  if (card.layer === '一句话') return card.fields.sentence ?? ''
  if (fieldKey && Object.prototype.hasOwnProperty.call(card.fields, fieldKey)) {
    return card.fields[fieldKey] ?? ''
  }
  const first = fieldKeys(card.layer)[0]
  return first ? (card.fields[first] ?? '') : ''
}

function makeId(prefix: string): string {
  const rand =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${rand}`
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim()
}

function firstSentence(text: string): string {
  const line = firstLine(text)
  const match = line.match(/^.*?[。！？!?]/)
  return (match?.[0] ?? line).trim()
}

export function frontText(card: Card): string {
  if (card.layer === 'situation') return [...card.body].slice(0, 40).join('')
  if (card.layer === '一句话') return card.body
  if (card.layer === '正文草稿') return firstLine(card.body)
  if (card.layer === '一段') {
    const head = firstSentence(card.fields.background ?? '')
    const marks = ['disaster1', 'disaster2', 'disaster3']
      .filter((key) => (card.fields[key] ?? '').trim())
      .map(() => '「灾」')
      .join('')
    return `${head}${marks}`
  }
  if (card.layer === '人物') {
    const name = (card.fields.name ?? '').trim()
    const motive = firstLine(card.fields.motivation ?? '')
    if (name && motive) return `${name}，${motive}`
    return name || motive
  }
  const title = (card.fields.title ?? '').trim()
  const pov = (card.fields.pov ?? '').trim()
  const summary = (card.fields.summarySentence ?? '').trim()
  return [title, pov, summary].filter((part) => part.length > 0).join(' ')
}

function fieldsFor(layer: Layer, partial: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of fieldKeys(layer)) {
    out[key] = partial?.[key] ?? ''
  }
  return out
}

function bodyFor(layer: Layer, fields: Record<string, string>, freeText: string): string {
  if (layer === 'situation' || layer === '正文草稿') return freeText
  if (layer === '一句话') return fields.sentence ?? ''
  return fieldKeys(layer)
    .map((key) => `${FIELD_LABEL[key] ?? key}：${fields[key] ?? ''}`)
    .join('\n')
}

function blankCard(layer: Layer, partial?: Record<string, string>, freeText = ''): Card {
  const fields = fieldsFor(layer, layer === '一句话' ? { sentence: partial?.sentence ?? freeText } : partial)
  const body = bodyFor(layer, fields, layer === '一句话' ? (fields.sentence ?? '') : freeText)
  return { layer, body, fields }
}

export function createDocument(fileId: string): AppState {
  return {
    canvas: { nodes: [], edges: [] },
    snowflake: { fileId, cards: {} },
    activeId: null,
  }
}

export function createCard(
  state: AppState,
  input: {
    id?: string
    layer: Layer
    x: number
    y: number
    body?: string
    fields?: Record<string, string>
  },
): AppState {
  const id = input.id ?? makeId('n')
  if (state.canvas.nodes.some((node) => node.id === id) || state.snowflake.cards[id]) return state
  const card = blankCard(input.layer, input.fields, input.body ?? '')
  const node: CanvasNode = {
    id,
    type: 'text',
    x: input.x,
    y: input.y,
    width: TEXT_WIDTH,
    height: TEXT_HEIGHT,
    text: frontText(card),
    color: LAYER_COLOR[input.layer],
  }
  return {
    ...state,
    activeId: id,
    canvas: { ...state.canvas, nodes: [...state.canvas.nodes, node] },
    snowflake: {
      ...state.snowflake,
      cards: { ...state.snowflake.cards, [id]: card },
    },
  }
}

export function addGroup(
  state: AppState,
  input: { id?: string; x?: number; y?: number; text?: string } = {},
): AppState {
  const id = input.id ?? makeId('g')
  if (state.canvas.nodes.some((node) => node.id === id)) return state
  const node: CanvasNode = {
    id,
    type: 'group',
    x: input.x ?? 40,
    y: input.y ?? 40,
    width: 800,
    height: 220,
    text: input.text ?? '分组',
  }
  return {
    ...state,
    activeId: id,
    canvas: { ...state.canvas, nodes: [...state.canvas.nodes, node] },
  }
}

export function moveNode(state: AppState, id: string, x: number, y: number): AppState {
  let changed = false
  const nodes = state.canvas.nodes.map((node) => {
    if (node.id !== id) return node
    if (node.x === x && node.y === y) return node
    changed = true
    return { ...node, x, y }
  })
  if (!changed) return state
  return { ...state, canvas: { ...state.canvas, nodes } }
}

export function linkCards(state: AppState, fromId: string, toId: string): AppState {
  if (fromId === toId) return state
  if (!state.snowflake.cards[fromId] || !state.snowflake.cards[toId]) return state
  if (state.canvas.edges.some((edge) => edge.fromNode === fromId && edge.toNode === toId)) return state
  const edge: CanvasEdge = {
    id: `e-${fromId}-${toId}`,
    fromNode: fromId,
    toNode: toId,
    fromSide: 'right',
    toSide: 'left',
    toEnd: 'arrow',
    label: '连到后面的层',
  }
  return { ...state, canvas: { ...state.canvas, edges: [...state.canvas.edges, edge] } }
}

export function spawnChild(
  state: AppState,
  fromId: string,
  layer?: Layer,
  x?: number,
  y?: number,
  id?: string,
): AppState {
  const parent = state.snowflake.cards[fromId]
  const parentNode = state.canvas.nodes.find((node) => node.id === fromId)
  if (!parent || !parentNode || parentNode.type !== 'text') return state
  const next = layer ?? nextLayer(parent.layer)
  if (!next) return state
  if (LAYERS.indexOf(next) <= LAYERS.indexOf(parent.layer)) return state
  const childId = id ?? makeId('n')
  const withCard = createCard(state, {
    id: childId,
    layer: next,
    x: x ?? parentNode.x + parentNode.width + 48,
    y: y ?? parentNode.y,
  })
  if (withCard === state) return state
  const edge: CanvasEdge = {
    id: `e-${fromId}-${childId}`,
    fromNode: fromId,
    toNode: childId,
    fromSide: 'right',
    toSide: 'left',
    toEnd: 'arrow',
    label: `长成${layerLabel(next)}`,
  }
  return {
    ...withCard,
    canvas: { ...withCard.canvas, edges: [...withCard.canvas.edges, edge] },
  }
}

export function changeToLaterLayer(state: AppState, cardId: string, layer: Layer): AppState {
  const current = state.snowflake.cards[cardId]
  if (!current) return state
  if (LAYERS.indexOf(layer) <= LAYERS.indexOf(current.layer)) return state
  const card = blankCard(layer)
  const nodes = state.canvas.nodes.map((node) => {
    if (node.id !== cardId) return node
    return { ...node, text: frontText(card), color: LAYER_COLOR[layer] }
  })
  return {
    ...state,
    canvas: { ...state.canvas, nodes },
    snowflake: {
      ...state.snowflake,
      cards: { ...state.snowflake.cards, [cardId]: card },
    },
  }
}

export function deleteSelection(state: AppState, id: string): AppState {
  const node = state.canvas.nodes.find((item) => item.id === id)
  if (!node) return state
  if (node.type === 'group') {
    return {
      ...state,
      activeId: state.activeId === id ? null : state.activeId,
      canvas: {
        ...state.canvas,
        nodes: state.canvas.nodes.filter((item) => item.id !== id),
      },
    }
  }
  const cards = { ...state.snowflake.cards }
  delete cards[id]
  return {
    ...state,
    activeId: state.activeId === id ? null : state.activeId,
    canvas: {
      nodes: state.canvas.nodes.filter((item) => item.id !== id),
      edges: state.canvas.edges.filter((edge) => edge.fromNode !== id && edge.toNode !== id),
    },
    snowflake: { ...state.snowflake, cards },
  }
}

export function commitCardText(
  state: AppState,
  cardId: string,
  text: string,
  fieldKey: string | null,
  composing: boolean,
): AppState {
  if (composing) return state
  const current = state.snowflake.cards[cardId]
  if (!current) return state
  let card: Card
  if (current.layer === 'situation' || current.layer === '正文草稿') {
    card = { layer: current.layer, body: text, fields: {} }
  } else if (current.layer === '一句话') {
    card = { layer: '一句话', body: text, fields: { sentence: text } }
  } else {
    const fields = fieldsFor(current.layer, current.fields)
    const keys = fieldKeys(current.layer)
    const key = fieldKey && keys.includes(fieldKey) ? fieldKey : keys[0]
    if (key) fields[key] = text
    card = { layer: current.layer, body: bodyFor(current.layer, fields, ''), fields }
  }
  const front = frontText(card)
  return {
    ...state,
    canvas: {
      ...state.canvas,
      nodes: state.canvas.nodes.map((node) => (node.id === cardId ? { ...node, text: front } : node)),
    },
    snowflake: {
      ...state.snowflake,
      cards: { ...state.snowflake.cards, [cardId]: card },
    },
  }
}

export function applyComposition(
  state: AppState,
  session: ComposeSession,
  event: CompositionEvent,
  fieldKey: string | null,
): { state: AppState; session: ComposeSession } {
  if (event.type === 'compositionstart') {
    return { state, session: { ...session, composing: true } }
  }
  if (event.type === 'insert') {
    if (!session.composing) return { state, session }
    return { state, session: { ...session, draft: event.text } }
  }
  return {
    state: commitCardText(state, session.cardId, event.text, fieldKey, false),
    session: { ...session, composing: false, draft: event.text },
  }
}

function pickNode(node: CanvasNode): CanvasNode {
  const out: CanvasNode = {
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }
  if (node.text !== undefined) out.text = node.text
  if (node.color !== undefined) out.color = node.color
  return out
}

function pickEdge(edge: CanvasEdge): CanvasEdge {
  const out: CanvasEdge = {
    id: edge.id,
    fromNode: edge.fromNode,
    toNode: edge.toNode,
  }
  if (edge.fromSide !== undefined) out.fromSide = edge.fromSide
  if (edge.toSide !== undefined) out.toSide = edge.toSide
  if (edge.fromEnd !== undefined) out.fromEnd = edge.fromEnd
  if (edge.toEnd !== undefined) out.toEnd = edge.toEnd
  if (edge.label !== undefined) out.label = edge.label
  return out
}

export function serializeDocument(state: AppState): {
  canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] }
  snowflake: { fileId: string; cards: Record<string, Card> }
} {
  const cards: Record<string, Card> = {}
  for (const [id, card] of Object.entries(state.snowflake.cards)) {
    const fields = fieldsFor(card.layer, card.fields)
    cards[id] = {
      layer: card.layer,
      body: card.layer === '一句话' ? (fields.sentence ?? card.body) : card.body,
      fields,
    }
  }
  return {
    canvas: {
      nodes: state.canvas.nodes.map(pickNode),
      edges: state.canvas.edges.map(pickEdge),
    },
    snowflake: {
      fileId: state.snowflake.fileId,
      cards,
    },
  }
}
