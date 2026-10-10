export const LAYERS = [
  'situation',
  '一句话',
  '一段',
  'renwubiao',
  'yiyedagang',
  'renwugushi',
  'renwudangan',
  '场景表',
  'changci',
  '正文草稿',
] as const

export type Layer = (typeof LAYERS)[number]

export const PARAGRAPH_KEYS = ['background', 'disaster1', 'disaster2', 'disaster3', 'ending'] as const

export const PERSON_KEYS = [
  'name',
  'role',
  'sentence',
  'motivation',
  'goal',
  'conflict',
  'epiphany',
  'paragraph',
  'grade',
] as const

export const YIYEDAGANG_KEYS = [...PARAGRAPH_KEYS, 'fourPages'] as const

export const RENWUGUSHI_KEYS = ['who', 'length', 'story'] as const

export const ARCHIVE_GROUPS = [
  {
    title: '身体',
    keys: ['bodyName', 'age', 'birthday', 'height', 'weight', 'ethnicity', 'hairEyes', 'looks', 'clothes'],
  },
  {
    title: '性格',
    keys: ['humor', 'personality', 'religion', 'politics', 'hobbies', 'taste', 'favColor', 'bag'],
  },
  {
    title: '环境',
    keys: ['home', 'education', 'job', 'family', 'bestFriend', 'maleFriends', 'femaleFriends', 'enemies'],
  },
  {
    title: '心理',
    keys: [
      'bestMemory',
      'worstMemory',
      'traitLine',
      'strongest',
      'weakest',
      'paradox',
      'hope',
      'fear',
      'philosophy',
      'selfView',
      'othersView',
    ],
  },
  { title: '结局', keys: ['endingChange'] },
] as const

export const RENWUDANGAN_KEYS = ARCHIVE_GROUPS.flatMap((group) => group.keys)

export const SCENE_KEYS = ['pov', 'what', 'words', 'chapter', 'title', 'conflict'] as const

export const CHANGCI_KEYS = [
  'alpha',
  'subplot',
  'happened',
  'why',
  'result',
  'insight',
  'therefore',
  'structureKind',
  'goal',
  'conflict',
  'setback',
  'reaction',
  'dilemma',
  'decision',
  'task',
] as const

export const SENTENCE_KEYS = ['sentence'] as const

export const FIELD_LABEL: Record<string, string> = {
  sentence: '这一句',
  background: '背景',
  disaster1: '灾难一',
  disaster2: '灾难二',
  disaster3: '灾难三',
  ending: '结局',
  fourPages: '四页大纲',
  name: '名字',
  role: '角色',
  motivation: '动机',
  goal: '目标',
  conflict: '冲突',
  epiphany: '顿悟',
  paragraph: '一段',
  grade: '类别',
  who: '哪个人',
  length: '篇幅',
  story: '从他眼里看的故事',
  bodyName: '名字',
  age: '年龄',
  birthday: '生日',
  height: '身高',
  weight: '体重',
  ethnicity: '族裔',
  hairEyes: '发色瞳色',
  looks: '外貌',
  clothes: '穿着',
  humor: '幽默感',
  personality: '人格类型',
  religion: '宗教',
  politics: '党派',
  hobbies: '爱好',
  taste: '喜欢的音乐书电影',
  favColor: '喜欢的颜色',
  bag: '钱包或包里有什么',
  home: '家',
  education: '教育',
  job: '工作',
  family: '家人',
  bestFriend: '最好的朋友',
  maleFriends: '男性朋友',
  femaleFriends: '女性朋友',
  enemies: '敌人',
  bestMemory: '最好的童年记忆',
  worstMemory: '最坏的童年记忆',
  traitLine: '一句性格概括',
  strongest: '最强特质',
  weakest: '最弱特质',
  paradox: '这个人的悖论',
  hope: '最大的希望',
  fear: '最大的恐惧',
  philosophy: '人生哲学',
  selfView: '他怎么看自己',
  othersView: '别人怎么看他',
  endingChange: '结局时他怎么变',
  pov: '视角',
  what: '这一场发生什么',
  words: '预计字数',
  chapter: '章号',
  title: '标题',
  alpha: '阿尔法点',
  subplot: '次要情节',
  happened: '场内发生了什么',
  why: '为什么对他重要',
  result: '场内后果',
  insight: '领悟',
  therefore: '因此',
  structureKind: '冲突结构',
  setback: '挫折',
  reaction: '反应',
  dilemma: '两难',
  decision: '决定',
  task: '本场任务',
  legacyFullSummary: '旧全文摘要',
  legacyNotes: '旧备注',
  legacySummary: '旧的更长摘要',
  adopted: '采纳',
}

const LAYER_LABEL: Record<Layer, string> = {
  situation: '念头',
  一句话: '一句话',
  一段: '一段',
  renwubiao: '人物表',
  yiyedagang: '一页大纲',
  renwugushi: '人物故事',
  renwudangan: '人物档案',
  场景表: '场景表',
  changci: '场次',
  正文草稿: '正文草稿',
}

const LAYER_COLOR: Record<Layer, string> = {
  situation: '1',
  一句话: '2',
  一段: '3',
  renwubiao: '4',
  yiyedagang: '7',
  renwugushi: '8',
  renwudangan: '9',
  场景表: '5',
  changci: '10',
  正文草稿: '6',
}

export interface ChoiceOption {
  value: string
  label: string
}

export interface ChoiceField {
  key: string
  label: string
  options: ChoiceOption[]
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

export interface LooseCard {
  layer: string
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
  return LAYER_LABEL[layer]
}

export function fieldKeys(layer: Layer): readonly string[] {
  switch (layer) {
    case '一段':
      return PARAGRAPH_KEYS
    case 'renwubiao':
      return PERSON_KEYS
    case 'yiyedagang':
      return YIYEDAGANG_KEYS
    case 'renwugushi':
      return RENWUGUSHI_KEYS
    case 'renwudangan':
      return RENWUDANGAN_KEYS
    case '场景表':
      return SCENE_KEYS
    case 'changci':
      return CHANGCI_KEYS
    case '一句话':
      return SENTENCE_KEYS
    default:
      return []
  }
}

export function isChoiceField(key: string): boolean {
  return key === 'grade' || key === 'length' || key === 'structureKind'
}

export function choiceFields(layer: Layer): ChoiceField[] {
  if (layer === 'renwubiao') {
    return [
      {
        key: 'grade',
        label: '类别',
        options: [
          { value: '', label: '不填' },
          { value: '主要', label: '主要' },
          { value: '次要', label: '次要' },
          { value: 'NPC', label: 'NPC' },
          { value: '路人', label: '路人' },
        ],
      },
    ]
  }
  if (layer === 'renwugushi') {
    return [
      {
        key: 'length',
        label: '篇幅',
        options: [
          { value: '', label: '不填' },
          { value: '一页', label: '一页' },
          { value: '半页', label: '半页' },
        ],
      },
    ]
  }
  if (layer === 'changci') {
    return [
      {
        key: 'structureKind',
        label: '冲突结构',
        options: [
          { value: '', label: '不填' },
          { value: 'active', label: '主动（目标、冲突、挫折）' },
          { value: 'reactive', label: '反应（反应、两难、决定）' },
        ],
      },
    ]
  }
  return []
}

export function fieldControlLabel(layer: Layer, key: string): string {
  if (layer === '场景表' && key === 'title') return '标题（画布附加，不是雪花法原列）'
  if (layer === 'renwubiao' && key === 'sentence') return '一句'
  if (layer === 'renwubiao' && key === 'paragraph') return '一段'
  return FIELD_LABEL[key] ?? key
}

export function extraFieldKeys(card: Card): string[] {
  const keys: string[] = []
  if (card.layer === 'renwubiao') {
    if ((card.fields.legacyFullSummary ?? '').trim()) keys.push('legacyFullSummary')
    if ((card.fields.legacyNotes ?? '').trim()) keys.push('legacyNotes')
  }
  if (card.layer === '场景表' && (card.fields.legacySummary ?? '').trim()) keys.push('legacySummary')
  if (fieldKeys(card.layer).length > 0 && (card.fields.adopted ?? '').trim()) keys.push('adopted')
  return keys
}

export function fieldGroups(layer: Layer): { title: string; keys: readonly string[] }[] | null {
  if (layer !== 'renwudangan') return null
  return ARCHIVE_GROUPS.map((group) => ({ title: group.title, keys: group.keys }))
}

export function laterLayers(layer: Layer): Layer[] {
  const index = LAYERS.indexOf(layer)
  return LAYERS.slice(index + 1)
}

export function nextLayer(layer: Layer): Layer | null {
  return laterLayers(layer)[0] ?? null
}

export function defaultFieldKey(card: Card): string | null {
  const keys = fieldKeys(card.layer).filter((key) => !isChoiceField(key))
  return keys[0] ?? null
}

export function editorText(card: Card, fieldKey: string | null): string {
  if (card.layer === 'situation' || card.layer === '正文草稿') return card.body
  if (card.layer === '一句话') return card.fields.sentence ?? ''
  if (fieldKey && Object.prototype.hasOwnProperty.call(card.fields, fieldKey)) {
    return card.fields[fieldKey] ?? ''
  }
  const first = defaultFieldKey(card)
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

function paragraphFront(card: Card): string {
  const head = firstSentence(card.fields.background ?? '')
  const marks = ['disaster1', 'disaster2', 'disaster3']
    .filter((key) => (card.fields[key] ?? '').trim())
    .map(() => '「灾」')
    .join('')
  return `${head}${marks}`
}

export function frontText(card: Card): string {
  switch (card.layer) {
    case 'situation':
      return [...card.body].slice(0, 40).join('')
    case '一句话':
      return card.body
    case '正文草稿':
      return firstLine(card.body)
    case '一段':
      return paragraphFront(card)
    case 'renwubiao': {
      const name = (card.fields.name ?? '').trim()
      const sentence = firstLine(card.fields.sentence ?? '')
      if (name && sentence) return `${name}，${sentence}`
      return name || sentence
    }
    case 'yiyedagang':
      return firstSentence(card.fields.background ?? '')
    case 'renwugushi':
      return firstLine(card.fields.who ?? '')
    case 'renwudangan':
      return firstLine(card.fields.bodyName ?? '') || firstLine(card.fields.endingChange ?? '')
    case '场景表': {
      const title = (card.fields.title ?? '').trim()
      const pov = (card.fields.pov ?? '').trim()
      const what = (card.fields.what ?? '').trim()
      return [title, pov, what].filter((part) => part.length > 0).join(' ')
    }
    case 'changci':
      return firstLine(card.fields.alpha ?? '') || firstLine(card.fields.task ?? '')
    default:
      return firstLine(card.body)
  }
}

function keptExtraKey(layer: Layer, key: string): boolean {
  if (key === 'adopted' && fieldKeys(layer).length > 0) return true
  if (layer === 'renwubiao') return key === 'legacyFullSummary' || key === 'legacyNotes'
  if (layer === '场景表') return key === 'legacySummary'
  return false
}

function fieldsFor(layer: Layer, partial: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of fieldKeys(layer)) {
    out[key] = partial?.[key] ?? ''
  }
  if (!partial) return out
  for (const [key, value] of Object.entries(partial)) {
    if (!keptExtraKey(layer, key) || !value.trim()) continue
    out[key] = value
  }
  return out
}

function shownFieldValue(key: string, value: string): string {
  if (key !== 'structureKind') return value
  if (value === 'active') return '主动'
  if (value === 'reactive') return '反应'
  return value
}

export interface CardFace {
  title: string
  body: string
  meta: string
}

function cleanField(value: string | undefined): string {
  return (value ?? '').trim()
}

function proseWithoutEmptyLabels(body: string): string {
  const kept: string[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('')
      continue
    }
    const mark = trimmed.indexOf('：')
    if (mark > 0 && mark <= 24 && trimmed.slice(mark + 1).trim() === '') continue
    kept.push(trimmed)
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  return kept.join('\n').trim()
}

function splitLead(text: string): { title: string; body: string } {
  const trimmed = text.trim()
  if (!trimmed) return { title: '', body: '' }
  const line = firstLine(trimmed)
  const rest = trimmed.slice(line.length).trim()
  if (rest) return { title: line, body: rest }
  const sentence = firstSentence(trimmed)
  if (sentence && sentence.length < trimmed.length) {
    return { title: sentence, body: trimmed.slice(sentence.length).trim() }
  }
  return { title: trimmed, body: '' }
}

function countChars(text: string): number {
  return [...text.replace(/\s/g, '')].length
}

export function cardFace(card: Card): CardFace {
  const prose = proseWithoutEmptyLabels(card.body)
  switch (card.layer) {
    case 'situation':
    case '正文草稿': {
      const parts = splitLead(card.body)
      const count = countChars(card.body)
      return { ...parts, meta: count ? `${count} 字` : '' }
    }
    case '一句话':
      return { title: cleanField(card.fields.sentence) || cleanField(card.body), body: '', meta: '' }
    case '一段':
    case 'yiyedagang': {
      const background = cleanField(card.fields.background)
      const head = firstSentence(background)
      const rest = background.slice(head.length).trim()
      const ending = cleanField(card.fields.ending)
      const disasters = ['disaster1', 'disaster2', 'disaster3'].filter((key) => cleanField(card.fields[key])).length
      const body = [rest, ending].filter((part) => part.length > 0).join('\n')
      if (head || body) return { title: head, body, meta: disasters ? `${disasters} 个灾难` : '' }
      return { ...splitLead(prose), meta: '' }
    }
    case 'renwubiao': {
      const name = cleanField(card.fields.name)
      const sentence = firstLine(card.fields.sentence ?? '')
      const meta = [cleanField(card.fields.grade), cleanField(card.fields.role)].filter((part) => part.length > 0).join(' · ')
      if (name || sentence) return { title: name || sentence, body: name ? sentence : '', meta }
      return { ...splitLead(prose), meta }
    }
    case 'renwugushi': {
      const who = cleanField(card.fields.who)
      const story = cleanField(card.fields.story)
      const length = cleanField(card.fields.length)
      if (who || story) return { title: who, body: story, meta: length }
      return { ...splitLead(prose), meta: length }
    }
    case 'renwudangan': {
      const name = cleanField(card.fields.bodyName)
      const line = cleanField(card.fields.traitLine) || cleanField(card.fields.endingChange)
      const age = cleanField(card.fields.age)
      if (name || line) return { title: name || line, body: name ? line : '', meta: age ? `${age} 岁` : '' }
      return { ...splitLead(prose), meta: '' }
    }
    case '场景表': {
      const title = cleanField(card.fields.title)
      const what = cleanField(card.fields.what)
      const pov = cleanField(card.fields.pov)
      const chapter = cleanField(card.fields.chapter)
      const words = cleanField(card.fields.words)
      const meta = [pov ? `视角 ${pov}` : '', chapter ? `${chapter} 章` : '', words ? `${words} 字` : '']
        .filter((part) => part.length > 0)
        .join(' · ')
      if (title || what) {
        const lead = firstLine(what)
        return {
          title: title || lead,
          body: title ? what : what.slice(lead.length).trim(),
          meta,
        }
      }
      const parts = splitLead(prose)
      const count = countChars(prose)
      return { ...parts, meta: meta || (count ? `${count} 字` : '') }
    }
    case 'changci': {
      const alpha = cleanField(card.fields.alpha)
      const task = cleanField(card.fields.task)
      const happened = cleanField(card.fields.happened)
      const kind = shownFieldValue('structureKind', cleanField(card.fields.structureKind))
      const title = alpha || task
      const body = [happened, alpha && task ? task : ''].filter((part) => part.length > 0).join('\n')
      if (title || body) return { title, body, meta: kind }
      return { ...splitLead(prose), meta: kind }
    }
    default: {
      const count = countChars(prose)
      return { ...splitLead(prose), meta: count ? `${count} 字` : '' }
    }
  }
}

export type CardBodySource = {
  text: string
  where: 'body' | 'fields'
  fieldKey: string | null
}

// 卡片上要画进 .snow-body 的那段。卡面正文有字就用它；没有时改用字段里比标题更长的那段。
export function bodyTextForCard(card: Card): CardBodySource {
  const face = cardFace(card)
  const faceBody = face.body.trim()
  if (faceBody) {
    const fieldKey = Object.entries(card.fields).find(([, value]) => (value ?? '').includes(faceBody))?.[0] ?? null
    return { text: face.body, where: fieldKey ? 'fields' : 'body', fieldKey }
  }
  const title = face.title.trim()
  const fields = Object.entries(card.fields)
    .map(([key, value]) => ({ key, text: (value ?? '').trim() }))
    .filter((item) => item.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const top = fields[0]
  if (!top || top.text === title) return { text: '', where: top ? 'fields' : 'body', fieldKey: top?.key ?? null }
  const text = title && top.text.startsWith(title) ? top.text.slice(title.length).trim() : top.text
  return { text, where: 'fields', fieldKey: top.key }
}


function bodyFor(layer: Layer, fields: Record<string, string>, freeText: string): string {
  if (layer === 'situation' || layer === '正文草稿') return freeText
  if (layer === '一句话') return fields.sentence ?? ''
  const lines = fieldKeys(layer).map(
    (key) => `${fieldControlLabel(layer, key)}：${shownFieldValue(key, fields[key] ?? '')}`,
  )
  for (const key of extraFieldKeys({ layer, body: '', fields })) {
    lines.push(`${fieldControlLabel(layer, key)}：${fields[key] ?? ''}`)
  }
  return lines.join('\n')
}

function blankCard(layer: Layer, partial?: Record<string, string>, freeText = ''): Card {
  const fields = fieldsFor(layer, layer === '一句话' ? { sentence: partial?.sentence ?? freeText } : partial)
  const body = bodyFor(layer, fields, layer === '一句话' ? (fields.sentence ?? '') : freeText)
  return { layer, body, fields }
}

function paintCard(state: AppState, cardId: string, card: Card): AppState {
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

interface LayerMove {
  from: string
  to: string
}

interface LayerPlan {
  card: Card
  moves: LayerMove[]
}

function freeTextOf(card: Card): string {
  if (card.layer === 'situation' || card.layer === '正文草稿') return card.body.trim()
  if (card.layer === '一句话') {
    const body = card.body.trim()
    return body && body !== (card.fields.sentence ?? '').trim() ? body : ''
  }
  if (card.body === bodyFor(card.layer, card.fields, '')) return ''
  return proseWithoutEmptyLabels(card.body)
}

function planLayerChange(current: Card, layer: Layer): LayerPlan {
  const targetLabel = layerLabel(layer)
  const targetKeys = fieldKeys(layer)
  const hasAdopted = targetKeys.length > 0 && layer !== '一句话'
  const leftoverPlace = hasAdopted ? `${targetLabel}的「${FIELD_LABEL.adopted}」栏` : `${targetLabel}的正文`
  const same: Record<string, string> = {}
  const leftovers: string[] = []
  const moves: LayerMove[] = []
  const sourceKeys = [
    ...fieldKeys(current.layer),
    ...Object.keys(current.fields).filter((key) => !fieldKeys(current.layer).includes(key)),
  ]
  for (const key of sourceKeys) {
    const value = (current.fields[key] ?? '').trim()
    if (!value) continue
    const label = fieldControlLabel(current.layer, key)
    if (targetKeys.includes(key)) {
      same[key] = value
      moves.push({ from: label, to: `${targetLabel}的「${fieldControlLabel(layer, key)}」` })
      continue
    }
    if (key === 'adopted' && hasAdopted) {
      leftovers.unshift(value)
    } else {
      leftovers.push(`${label}：${shownFieldValue(key, value)}`)
    }
    moves.push({ from: label, to: leftoverPlace })
  }
  const free = freeTextOf(current)
  if (free) {
    leftovers.push(free)
    moves.push({ from: '正文', to: leftoverPlace })
  }
  const rest = leftovers.join('\n')
  if (layer === '一句话') {
    const sentence = [same.sentence ?? '', rest].filter((part) => part.length > 0).join('\n')
    return { card: blankCard(layer, { sentence }), moves }
  }
  if (!hasAdopted) return { card: blankCard(layer, undefined, rest), moves }
  const fields = fieldsFor(layer, rest ? { ...same, adopted: rest } : same)
  return { card: { layer, body: bodyFor(layer, fields, ''), fields }, moves }
}

export function describeLayerChange(current: Card, layer: Layer): string {
  const { moves } = planLayerChange(current, layer)
  const head = `要把这张${layerLabel(current.layer)}卡改成「${layerLabel(layer)}」。`
  if (moves.length === 0) return `${head}\n这张卡没有写下内容，改完是一张空白的${layerLabel(layer)}卡。`
  const lines = moves.map((move) => `· ${move.from} → ${move.to}`)
  return `${head}\n下面这些内容会挪过去：\n${lines.join('\n')}\n空着的栏目不保留。`
}

export function changeToLaterLayer(state: AppState, cardId: string, layer: Layer): AppState {
  const current = state.snowflake.cards[cardId]
  if (!current) return state
  if (LAYERS.indexOf(layer) <= LAYERS.indexOf(current.layer)) return state
  const card = planLayerChange(current, layer).card
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

function allowedFieldKey(card: Card, fieldKey: string | null): string | undefined {
  const official = fieldKeys(card.layer)
  const extras = extraFieldKeys(card)
  if (fieldKey && (official.includes(fieldKey) || extras.includes(fieldKey))) return fieldKey
  return official.find((key) => !isChoiceField(key)) ?? official[0]
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
    const key = allowedFieldKey(current, fieldKey)
    if (key) fields[key] = text
    if (keptExtraKey(current.layer, key ?? '') && !text.trim()) delete fields[key ?? '']
    card = { layer: current.layer, body: bodyFor(current.layer, fields, ''), fields }
  }
  return paintCard(state, cardId, card)
}

function additionBeyond(base: string, next: string): string {
  const trimmed = next.replace(/\s+$/u, '')
  const previous = base.replace(/\s+$/u, '')
  if (!trimmed || trimmed === previous) return ''
  if (previous && trimmed.startsWith(`${previous}\n`)) return trimmed.slice(previous.length + 1).trim()
  return trimmed
}

export function adoptFieldKey(card: Card, selectedKey: string | null): string | null {
  if (fieldKeys(card.layer).length === 0) return null
  if (selectedKey && extraFieldKeys(card).includes(selectedKey) && selectedKey !== 'adopted') return selectedKey
  return 'adopted'
}

export function adoptIntoCard(state: AppState, cardId: string, nextBody: string, selectedKey: string | null): AppState {
  const current = state.snowflake.cards[cardId]
  if (!current) return state
  const addition = additionBeyond(current.body, nextBody)
  if (!addition) return setCardBody(state, cardId, nextBody)
  if (current.layer === '一句话') {
    const sentence = current.fields.sentence?.trim() ? `${current.fields.sentence.replace(/\s+$/u, '')}\n${addition}` : addition
    return setCardBody(state, cardId, sentence)
  }
  if (fieldKeys(current.layer).length === 0) return setCardBody(state, cardId, nextBody)
  const target = adoptFieldKey(current, selectedKey) ?? 'adopted'
  const existing = (current.fields[target] ?? '').replace(/\s+$/u, '')
  const written = existing && existing !== addition && !existing.endsWith(`\n${addition}`) ? `${existing}\n${addition}` : addition || existing
  const fields = fieldsFor(current.layer, { ...current.fields, [target]: written })
  const card: Card = { layer: current.layer, body: bodyFor(current.layer, fields, ''), fields }
  if (card.body === current.body && fields[target] === (current.fields[target] ?? '')) return state
  return paintCard(state, cardId, card)
}

export function setCardBody(state: AppState, cardId: string, body: string): AppState {
  const current = state.snowflake.cards[cardId]
  if (!current || current.body === body) return state
  const card: Card =
    current.layer === '一句话'
      ? { layer: '一句话', body, fields: { ...current.fields, sentence: body } }
      : { ...current, body }
  return paintCard(state, cardId, card)
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

interface DraftCard {
  layer: string
  body: string
  fields: Record<string, string>
  rebuild: boolean
}

function mergeText(base: string, extra: string): string {
  if (!extra.trim()) return base
  if (!base.trim()) return extra
  if (base.includes(extra)) return base
  return `${base}\n\n${extra}`
}

function joinGap(left: string, right: string): string {
  if (left && right) return `${left}\n\n${right}`
  return left || right
}

function isLayerName(value: string): value is Layer {
  return (LAYERS as readonly string[]).includes(value)
}

function unknownToSituation(card: DraftCard): Card {
  const head = `原层：${card.layer}`
  const parts: string[] = [head]
  if (card.body.trim()) parts.push(card.body)
  const fieldLines = Object.entries(card.fields)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}：${value}`)
  if (fieldLines.length > 0) parts.push(fieldLines.join('\n'))
  return { layer: 'situation', body: parts.join('\n'), fields: {} }
}

function materialize(card: DraftCard): Card {
  if (!isLayerName(card.layer)) return unknownToSituation(card)
  const fields = fieldsFor(card.layer, card.fields)
  if (card.layer === 'situation' || card.layer === '正文草稿') {
    return { layer: card.layer, body: card.body, fields }
  }
  if (card.layer === '一句话') {
    const sentence = fields.sentence || card.body
    return { layer: '一句话', body: sentence, fields: { sentence } }
  }
  const body = card.rebuild ? bodyFor(card.layer, fields, '') : card.body || bodyFor(card.layer, fields, '')
  return { layer: card.layer, body, fields }
}

export function loadCards(
  loose: Record<string, LooseCard>,
  edges: ReadonlyArray<{ fromNode: string; toNode: string }>,
): Record<string, Card> {
  const drafts = new Map<string, DraftCard>()
  for (const [id, card] of Object.entries(loose)) {
    drafts.set(id, {
      layer: card.layer,
      body: card.body,
      fields: { ...card.fields },
      rebuild: false,
    })
  }

  const storyChild = (id: string): DraftCard | null => {
    for (const edge of edges) {
      if (edge.fromNode !== id) continue
      const child = drafts.get(edge.toNode)
      if (child?.layer === 'renwugushi') return child
    }
    return null
  }

  for (const [id, card] of drafts) {
    const oldPerson =
      card.layer === '人物' ||
      'phraseSummary' in card.fields ||
      'paragraphSummary' in card.fields ||
      'fullSummary' in card.fields
    if (!oldPerson) continue
    const full = card.fields.fullSummary ?? ''
    const notes = card.layer === '人物' || 'notes' in card.fields ? (card.fields.notes ?? '') : ''
    const child = storyChild(id)
    if (!child) {
      card.fields.legacyFullSummary = mergeText(card.fields.legacyFullSummary ?? '', full)
      card.fields.legacyNotes = mergeText(card.fields.legacyNotes ?? '', notes)
    } else {
      const before = child.fields.story ?? ''
      const story = mergeText(mergeText(before, full), notes)
      if (story !== before) {
        child.fields.story = story
        child.rebuild = true
      }
    }
    if (!card.fields.sentence) card.fields.sentence = card.fields.phraseSummary ?? ''
    if (!card.fields.paragraph) card.fields.paragraph = card.fields.paragraphSummary ?? ''
    delete card.fields.phraseSummary
    delete card.fields.paragraphSummary
    delete card.fields.fullSummary
    delete card.fields.notes
    card.layer = 'renwubiao'
    card.rebuild = true
  }

  for (const card of drafts.values()) {
    if (card.layer !== '场景表') continue
    const hasOld = 'summarySentence' in card.fields || 'summaryFull' in card.fields || 'notes' in card.fields
    if (!hasOld) continue
    const summaryFull = card.fields.summaryFull ?? ''
    const notes = card.fields.notes ?? ''
    let legacy = card.fields.legacySummary ?? ''
    if (!card.fields.legacySummary) legacy = joinGap(summaryFull, notes)
    else {
      legacy = mergeText(legacy, summaryFull)
      legacy = mergeText(legacy, notes)
    }
    if (legacy.trim()) card.fields.legacySummary = legacy
    if (!card.fields.what) card.fields.what = card.fields.summarySentence ?? ''
    if (!cleanField(card.fields.what)) {
      const loose = proseWithoutEmptyLabels(card.body)
      if (loose) card.fields.what = loose
    }
    delete card.fields.summarySentence
    delete card.fields.summaryFull
    delete card.fields.notes
    card.rebuild = true
  }

  const cards: Record<string, Card> = {}
  for (const [id, card] of drafts) cards[id] = materialize(card)
  return cards
}
