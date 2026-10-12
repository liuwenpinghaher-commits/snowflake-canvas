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

export const ARC_KEYS = ['start', 'door', 'impact', 'deepen', 'turn', 'consequence'] as const
export type ArcKey = (typeof ARC_KEYS)[number]
export type ArcCells = Record<ArcKey, string>

export function emptyArc(): ArcCells {
  return { start: '', door: '', impact: '', deepen: '', turn: '', consequence: '' }
}

/** 身份与叙事功能。档案区的 key 见 personFieldZones()，仍是 ARCHIVE_GROUPS。 */
export const PERSON_ZONES = [
  { zone: '身份', keys: ['name', 'role', 'grade'] },
  { zone: '叙事功能', keys: ['sentence', 'paragraph', 'motivation', 'goal', 'conflict', 'epiphany', 'arc'] },
] as const

export const YIYEDAGANG_KEYS = [...PARAGRAPH_KEYS, 'fourPages'] as const

export const RENWUGUSHI_KEYS = ['who', 'length', 'story'] as const

export const ARCHIVE_GROUPS = [
  {
    title: '身体',
    egri: '埃格里·生理',
    keys: ['bodyName', 'age', 'birthday', 'height', 'weight', 'ethnicity', 'hairEyes', 'looks', 'clothes'],
  },
  {
    title: '性格',
    egri: '埃格里·社会',
    keys: ['humor', 'personality', 'religion', 'politics', 'hobbies', 'taste', 'favColor', 'bag'],
  },
  {
    title: '环境',
    egri: '埃格里·社会',
    keys: ['home', 'education', 'job', 'family', 'bestFriend', 'maleFriends', 'femaleFriends', 'enemies'],
  },
  {
    title: '心理',
    egri: '埃格里·心理',
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

export function personFieldZones(): { zone: '身份' | '叙事功能' | '档案'; keys: readonly string[] }[] {
  return [
    { zone: '身份', keys: PERSON_ZONES[0].keys },
    { zone: '叙事功能', keys: PERSON_ZONES[1].keys },
    { zone: '档案', keys: RENWUDANGAN_KEYS },
  ]
}

export function mapGrade(raw: string | undefined): string {
  const text = (raw ?? '').trim()
  if (!text || text === '主角' || text === '主要') return '主要'
  if (text === '配角' || text === '次要') return '次要'
  if (text.includes('NPC')) return 'NPC'
  return '路人'
}

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

export const RELATION_KINDS = ['互补', '冲突', '伏笔', '派生', '正文提到'] as const
export type RelationKind = (typeof RELATION_KINDS)[number]
export const FORESHADOW_STATES = ['计划', '埋设', '呼应', '回收'] as const
export type ForeshadowState = (typeof FORESHADOW_STATES)[number]

export const EDGE_KINDS = [
  'grows-from',
  'projects-onto',
  'relates',
  'foreshadow',
  'appears-in',
  'relates-entity',
  'chapter-in',
] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export const ENTITY_TYPES = ['person', 'place', 'org', 'concept', 'theme', 'foreshadow-line'] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

export const SEDIMENT_KINDS = ['discuss', 'manual', 'import'] as const
export type SedimentKind = (typeof SEDIMENT_KINDS)[number]
export const SEDIMENT_ACTIONS = ['append', 'replace', 'negate'] as const
export type SedimentAction = (typeof SEDIMENT_ACTIONS)[number]
export const SEDIMENT_STATUSES = ['proposed', 'written', 'failed'] as const
export type SedimentStatus = (typeof SEDIMENT_STATUSES)[number]

export interface DerivedFrom {
  sessionId: string
  adoptionKey: string
}

export interface EntityField {
  value: string
  events: string[]
}

export interface EntityViews {
  renwubiao?: string
  renwugushi?: string
  renwudangan?: string
}

export interface Entity {
  id: string
  entityType: EntityType
  name: string
  views: EntityViews
  fields: Record<string, EntityField>
  arc: ArcCells
  premise: boolean
  // 百科页名，例如 world/ned-stark。空字符串不算。
  slug?: string
}

export interface SedimentTarget {
  entityType: EntityType
  entityId: string
  fieldKey: string
}

export interface SedimentEvent {
  id: string
  requestId: string
  kind: SedimentKind
  ideaId: string
  sessionId?: string
  adoptionKey?: string
  at: string
  target: SedimentTarget
  action: SedimentAction
  quote: string
  status: SedimentStatus
  superseded?: boolean
}

export interface BookScene {
  id: string
  title: string
  ideaIds: string[]
  prose: string
  beatIds: string[]
  placeEntityId?: string
  proseFork?: boolean
}

export interface BookChapter {
  id: string
  title: string
  scenes: BookScene[]
  /** 节拍表尺长和每一格上的场 id。缺省时界面按 60 格空表显示，不另存一份。 */
  beats?: {
    length: 40 | 60 | 80 | 120
    slots: string[][]
  }
}

export interface PendingProseScene {
  cardId: string
  chapterHint: string
}

export function isRelationKind(value: unknown): value is RelationKind {
  return typeof value === 'string' && (RELATION_KINDS as readonly string[]).includes(value)
}

export function isForeshadowState(value: unknown): value is ForeshadowState {
  return typeof value === 'string' && (FORESHADOW_STATES as readonly string[]).includes(value)
}

export function isEdgeKind(value: unknown): value is EdgeKind {
  return typeof value === 'string' && (EDGE_KINDS as readonly string[]).includes(value)
}

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && (ENTITY_TYPES as readonly string[]).includes(value)
}

export interface CanvasNode {
  id: string
  type: 'text' | 'group'
  x: number
  y: number
  width: number
  height: number
  text?: string
  color?: string
  /** 有这个字段才是画布上的实体节点。坐标跟节点一起走现有保存，不另放一份。 */
  entityId?: string
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
  kind?: EdgeKind
  relation?: RelationKind
  foreshadow?: ForeshadowState
  derivedFrom?: DerivedFrom
  sedimentEvents?: string[]
}

export interface OriginAnchor {
  chapterId: string
  sceneId?: string
  charOffset?: number
}

export interface PendingEntity {
  name: string
  cardIds: string[]
}

export const PROSE_BLOCK_TYPES = ['paragraph', 'heading', 'quote', 'todo', 'divider'] as const
export type ProseBlockType = (typeof PROSE_BLOCK_TYPES)[number]

export interface ProseBlock {
  id: string
  type: ProseBlockType
  text: string
  checked?: boolean
}

export interface Card {
  layer: Layer
  body: string
  fields: Record<string, string>
  mergeNote?: string
  premise?: boolean
  /** 正文草稿指向某场的 id。边上的 derivedFrom 是讨论来源，不是这个字段。 */
  derivedFrom?: string
  arc?: ArcCells
  originAnchor?: OriginAnchor
  /** 这一格已经落盘的块，或用户拆过块后要落盘的块。键是 body，或字段名。没有这个键时，正文仍只是字符串。 */
  blocks?: Record<string, ProseBlock[]>
}

export interface LooseCard {
  layer: string
  body: string
  fields: Record<string, string>
  mergeNote?: string
  premise?: boolean
  derivedFrom?: string
  arc?: ArcCells
  originAnchor?: OriginAnchor
  blocks?: Record<string, ProseBlock[]>
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
  entities?: Entity[]
  sediment?: SedimentEvent[]
  chapters?: BookChapter[]
  pendingProseScenes?: PendingProseScene[]
  pendingEntities?: PendingEntity[]
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
  return ARCHIVE_GROUPS.map((group) => ({
    title: 'egri' in group && group.egri ? `${group.title} · ${group.egri}` : group.title,
    keys: group.keys,
  }))
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

const BLOCK_WIRE_MARK = '@@sf-blocks\n'
const BLOCK_WIRE_LINE = /^(?:p|h|q|t0|t1) /

function unescapeWire(source: string): string {
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
    out += source[i] ?? ''
  }
  return out
}

function isStoredBlockWire(text: string): boolean {
  if (!text.startsWith(BLOCK_WIRE_MARK)) return false
  const lines = text.slice(BLOCK_WIRE_MARK.length).split('\n')
  return lines.length > 0 && lines.every((line) => line === 'd' || BLOCK_WIRE_LINE.test(line))
}

// 和服务端单独加载这份文件的方式一致：这里自己认出块字符串，不引用旁边的模块。
function visibleProse(stored: string): string {
  if (!isStoredBlockWire(stored)) return stored
  return stored
    .slice(BLOCK_WIRE_MARK.length)
    .split('\n')
    .map((line) => {
      if (line === 'd') return ''
      const mark = line.startsWith('t0 ') || line.startsWith('t1 ') ? line.slice(0, 2) : line.slice(0, 1)
      return unescapeWire(line.slice(mark.length + 1))
    })
    .join('\n')
}

function isProseBlockType(value: string): value is ProseBlockType {
  return (PROSE_BLOCK_TYPES as readonly string[]).includes(value)
}

export function blocksVisibleText(blocks: readonly ProseBlock[]): string {
  return blocks.map((block) => (block.type === 'divider' ? '' : block.text)).join('\n')
}

export function cloneProseBlocks(blocks: readonly ProseBlock[]): ProseBlock[] {
  const out: ProseBlock[] = []
  for (const block of blocks) {
    if (typeof block.id !== 'string' || block.id.length === 0) continue
    if (!isProseBlockType(block.type) || typeof block.text !== 'string') continue
    if (block.type === 'divider') {
      out.push({ id: block.id, type: 'divider', text: '' })
      continue
    }
    if (block.type === 'todo') {
      out.push({ id: block.id, type: 'todo', text: block.text, checked: block.checked === true })
      continue
    }
    out.push({ id: block.id, type: block.type, text: block.text })
  }
  return out
}

export function cloneBlockMap(blocks: Record<string, ProseBlock[]> | undefined): Record<string, ProseBlock[]> | undefined {
  if (!blocks) return undefined
  const out: Record<string, ProseBlock[]> = {}
  for (const [key, list] of Object.entries(blocks)) {
    const cloned = cloneProseBlocks(list)
    if (cloned.length > 0) out[key] = cloned
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function blockStructureKey(blocks: readonly ProseBlock[]): string {
  return blocks.map((block) => (block.type === 'todo' ? `todo:${block.checked === true ? 1 : 0}` : block.type)).join('\n')
}

function storedToBlocks(text: string): ProseBlock[] {
  if (!isStoredBlockWire(text)) return [{ id: 'wire-1', type: 'paragraph', text }]
  return text
    .slice(BLOCK_WIRE_MARK.length)
    .split('\n')
    .map((line, index) => {
      const id = `wire-${index + 1}`
      if (line === 'd') return { id, type: 'divider' as const, text: '' }
      const mark = line.startsWith('t0 ') || line.startsWith('t1 ') ? line.slice(0, 2) : line.slice(0, 1)
      const body = unescapeWire(line.slice(mark.length + 1))
      if (mark === 'h') return { id, type: 'heading' as const, text: body }
      if (mark === 'q') return { id, type: 'quote' as const, text: body }
      if (mark === 't0') return { id, type: 'todo' as const, text: body, checked: false }
      if (mark === 't1') return { id, type: 'todo' as const, text: body, checked: true }
      return { id, type: 'paragraph' as const, text: body }
    })
}

function cellString(card: Card, key: string): string {
  if (key === 'body') return card.body
  return card.fields[key] ?? ''
}

export function withPersistedBlocks(card: Card): Card {
  const persisted = cloneBlockMap(card.blocks)
  if (!persisted) {
    if (!card.blocks) return card
    const next: Card = { ...card }
    delete next.blocks
    return next
  }
  const fields = { ...card.fields }
  let body = card.body
  for (const [key, list] of Object.entries(persisted)) {
    const visible = blocksVisibleText(list)
    if (key === 'body') body = visible
    else fields[key] = visible
  }
  if (card.layer === '一句话' && persisted.sentence) body = fields.sentence ?? body
  return { ...card, body, fields, blocks: persisted }
}

export function readCellBlocks(card: Card, fieldKey: string | null): ProseBlock[] | undefined {
  const key = fieldKey && card.layer !== 'situation' && card.layer !== '正文草稿' && card.layer !== '一句话' ? fieldKey : card.layer === '一句话' ? 'sentence' : 'body'
  const list = card.blocks?.[key]
  if (!list || list.length === 0) return undefined
  const cloned = cloneProseBlocks(list)
  return cloned.length > 0 ? cloned : undefined
}

function dropCellBlocks(card: Card, key: string): Card {
  if (!card.blocks?.[key]) return card
  const blocks = { ...card.blocks }
  delete blocks[key]
  if (Object.keys(blocks).length === 0) {
    const next: Card = { ...card }
    delete next.blocks
    return next
  }
  return { ...card, blocks }
}

function proseCard(card: Card): Card {
  const source = card.blocks ? withPersistedBlocks(card) : card
  const body = visibleProse(source.body)
  let changed = body !== card.body
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(source.fields)) {
    const next = visibleProse(value)
    fields[key] = next
    if (next !== (card.fields[key] ?? '')) changed = true
  }
  if (Object.keys(fields).length !== Object.keys(card.fields).length) changed = true
  if (!changed) return card
  return { ...card, body, fields }
}

export function frontText(card: Card): string {
  card = proseCard(card)
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
  if (layer === 'changci' && key === 'pov') return true
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
  card = proseCard(card)
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
    const fieldKey = Object.entries(card.fields).find(([, value]) => visibleProse(value ?? '').includes(faceBody))?.[0] ?? null
    return { text: face.body, where: fieldKey ? 'fields' : 'body', fieldKey }
  }
  const title = face.title.trim()
  const fields = Object.entries(card.fields)
    .map(([key, value]) => ({ key, text: visibleProse(value ?? '').trim() }))
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
    (key) => `${fieldControlLabel(layer, key)}：${shownFieldValue(key, visibleProse(fields[key] ?? ''))}`,
  )
  for (const key of extraFieldKeys({ layer, body: '', fields })) {
    lines.push(`${fieldControlLabel(layer, key)}：${visibleProse(fields[key] ?? '')}`)
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
    entities: [],
    sediment: [],
    chapters: [],
    pendingProseScenes: [],
    pendingEntities: [],
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
  return addEdge(state, fromId, toId, 'grows-from')
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
    kind: 'grows-from',
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
  const card = keepCardMeta(current, planLayerChange(current, layer).card)
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
  if (node.entityId) {
    return {
      ...state,
      activeId: state.activeId === id ? null : state.activeId,
      canvas: { ...state.canvas, nodes: state.canvas.nodes.filter((item) => item.id !== id) },
    }
  }
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

function commitCellKey(card: Card, fieldKey: string | null): string | null {
  if (card.layer === 'situation' || card.layer === '正文草稿') return 'body'
  if (card.layer === '一句话') return 'sentence'
  if (card.layer === 'changci' && fieldKey === 'pov') return 'pov'
  const key = allowedFieldKey(card, fieldKey)
  if (!key || key === 'philosophy') return null
  return key
}

function incomingBlocks(blocks: readonly ProseBlock[] | undefined, text: string): ProseBlock[] {
  if (blocks && blocks.length > 0) {
    const cloned = cloneProseBlocks(blocks)
    if (cloned.length > 0) return cloned
  }
  return storedToBlocks(text)
}

export function commitCardText(
  state: AppState,
  cardId: string,
  text: string,
  fieldKey: string | null,
  composing: boolean,
  blocks?: readonly ProseBlock[],
): AppState {
  if (composing) return state
  const current = state.snowflake.cards[cardId]
  if (!current) return state
  const cell = commitCellKey(current, fieldKey)
  if (!cell) return state
  const hadList = current.blocks?.[cell]
  const had = Boolean(hadList && hadList.length > 0)
  const incoming = incomingBlocks(blocks, text)
  const before = hadList && hadList.length > 0 ? hadList : storedToBlocks(cellString(current, cell))
  const keep = !isChoiceField(cell) && (had || blockStructureKey(before) !== blockStructureKey(incoming))
  const written = keep ? blocksVisibleText(incoming) : text
  const nextBlocks = keep ? { ...(cloneBlockMap(current.blocks) ?? {}), [cell]: cloneProseBlocks(incoming) } : undefined
  let card: Card
  if (current.layer === 'situation' || current.layer === '正文草稿') {
    card = { ...current, layer: current.layer, body: written, fields: {} }
  } else if (current.layer === '一句话') {
    card = { ...current, layer: '一句话', body: written, fields: { sentence: written } }
  } else {
    const fields = fieldsFor(current.layer, current.fields)
    if (current.layer === 'changci' && fieldKey === 'pov') {
      if (keep) fields.pov = written
      else if (written.trim()) fields.pov = written.trim()
      else delete fields.pov
    } else if (cell) {
      fields[cell] = written
      if (keptExtraKey(current.layer, cell) && !written.trim()) delete fields[cell]
    }
    card = { ...current, layer: current.layer, body: bodyFor(current.layer, fields, ''), fields }
  }
  if (keep && nextBlocks) card = { ...card, blocks: nextBlocks }
  const painted = paintCard(state, cardId, card)
  if (current.layer === 'renwubiao' && fieldKey === 'motivation') return mirrorPhilosophy(painted)
  return painted
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
  let card: Card = { ...current, layer: current.layer, body: bodyFor(current.layer, fields, ''), fields }
  card = dropCellBlocks(card, target)
  if (card.body === current.body && fields[target] === (current.fields[target] ?? '') && !current.blocks?.[target]) return state
  return paintCard(state, cardId, card)
}

export function setCardBody(state: AppState, cardId: string, body: string): AppState {
  const current = state.snowflake.cards[cardId]
  if (!current || current.body === body) return state
  let card: Card =
    current.layer === '一句话'
      ? { ...current, layer: '一句话', body, fields: { ...current.fields, sentence: body } }
      : { ...current, body }
  card = dropCellBlocks(card, 'body')
  if (current.layer === '一句话') card = dropCellBlocks(card, 'sentence')
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
  if (node.entityId) out.entityId = node.entityId
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
  if (edge.kind !== undefined) out.kind = edge.kind
  if (edge.relation !== undefined) out.relation = edge.relation
  if (edge.foreshadow !== undefined) out.foreshadow = edge.foreshadow
  if (edge.derivedFrom !== undefined) {
    out.derivedFrom = { sessionId: edge.derivedFrom.sessionId, adoptionKey: edge.derivedFrom.adoptionKey }
  }
  if (edge.sedimentEvents !== undefined) out.sedimentEvents = [...edge.sedimentEvents]
  return out
}

export function serializeDocument(state: AppState): {
  canvas: { nodes: CanvasNode[]; edges: CanvasEdge[] }
  snowflake: { fileId: string; cards: Record<string, Card> }
  entities?: Entity[]
  sediment?: SedimentEvent[]
  chapters?: BookChapter[]
  pendingProseScenes?: PendingProseScene[]
  pendingEntities?: PendingEntity[]
} {
  const cards: Record<string, Card> = {}
  for (const [id, card] of Object.entries(state.snowflake.cards)) {
    const fields = fieldsFor(card.layer, card.fields)
    if (card.layer === 'renwudangan') fields.philosophy = motivationForDossier(state, id)
    const aligned = withPersistedBlocks({
      ...card,
      layer: card.layer,
      body: card.layer === '一句话' ? (fields.sentence ?? card.body) : card.body,
      fields,
    })
    const stored: Card = {
      layer: aligned.layer,
      body: aligned.body,
      fields: aligned.fields,
    }
    if (aligned.blocks) stored.blocks = aligned.blocks
    if (card.mergeNote) stored.mergeNote = card.mergeNote
    if (card.premise) stored.premise = true
    if (card.derivedFrom) stored.derivedFrom = card.derivedFrom
    if (card.arc) stored.arc = normalizeArc(card.arc)
    if (card.originAnchor?.chapterId) {
      stored.originAnchor = {
        chapterId: card.originAnchor.chapterId,
        ...(card.originAnchor.sceneId ? { sceneId: card.originAnchor.sceneId } : {}),
        ...(typeof card.originAnchor.charOffset === 'number' ? { charOffset: card.originAnchor.charOffset } : {}),
      }
    }
    cards[id] = stored
  }
  const entities = (state.entities ?? []).map(cloneEntity)
  const sediment = (state.sediment ?? []).map(cloneSediment)
  const chapters = state.chapters ?? []
  const pending = state.pendingProseScenes ?? []
  const pendingEntities = (state.pendingEntities ?? []).map((item) => ({ name: item.name, cardIds: [...item.cardIds] }))
  return {
    canvas: {
      nodes: state.canvas.nodes.map(pickNode),
      edges: state.canvas.edges.map(pickEdge),
    },
    snowflake: {
      fileId: state.snowflake.fileId,
      cards,
    },
    ...(entities.length > 0 ? { entities } : {}),
    ...(sediment.length > 0 ? { sediment } : {}),
    ...(chapters.length > 0 ? { chapters } : {}),
    ...(pending.length > 0 ? { pendingProseScenes: pending } : {}),
    ...(pendingEntities.length > 0 ? { pendingEntities } : {}),
  }
}

interface DraftCard {
  layer: string
  body: string
  fields: Record<string, string>
  rebuild: boolean
  mergeNote?: string
  premise?: boolean
  derivedFrom?: string
  arc?: ArcCells
  originAnchor?: OriginAnchor
  blocks?: Record<string, ProseBlock[]>
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
  if (!isLayerName(card.layer)) return attachDraftMeta(unknownToSituation(card), card)
  const fields = fieldsFor(card.layer, card.fields)
  if (card.layer === 'renwubiao') fields.grade = mapGrade(fields.grade)
  if (card.layer === 'situation' || card.layer === '正文草稿') {
    return attachDraftMeta({ layer: card.layer, body: card.body, fields }, card)
  }
  if (card.layer === '一句话') {
    const sentence = fields.sentence || card.body
    return attachDraftMeta({ layer: '一句话', body: sentence, fields: { sentence } }, card)
  }
  const body = card.rebuild ? bodyFor(card.layer, fields, '') : card.body || bodyFor(card.layer, fields, '')
  return attachDraftMeta({ layer: card.layer, body, fields }, card)
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
      mergeNote: card.mergeNote,
      premise: card.premise,
      derivedFrom: card.derivedFrom,
      arc: card.arc,
      originAnchor: card.originAnchor,
      blocks: cloneBlockMap(card.blocks),
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

function normalizeArc(value: Partial<ArcCells> | undefined): ArcCells {
  const arc = emptyArc()
  if (!value) return arc
  for (const key of ARC_KEYS) {
    const cell = value[key]
    arc[key] = typeof cell === 'string' ? cell : ''
  }
  return arc
}

function attachDraftMeta(card: Card, draft: DraftCard): Card {
  if (draft.mergeNote) card.mergeNote = draft.mergeNote
  if (draft.premise) card.premise = true
  if (draft.derivedFrom) card.derivedFrom = draft.derivedFrom
  if (draft.arc) card.arc = normalizeArc(draft.arc)
  if (draft.originAnchor?.chapterId) {
    card.originAnchor = {
      chapterId: draft.originAnchor.chapterId,
      ...(draft.originAnchor.sceneId ? { sceneId: draft.originAnchor.sceneId } : {}),
      ...(typeof draft.originAnchor.charOffset === 'number' ? { charOffset: draft.originAnchor.charOffset } : {}),
    }
  }
  const blocks = cloneBlockMap(draft.blocks)
  if (blocks) card.blocks = blocks
  return card
}

function keepCardMeta(previous: Card, next: Card): Card {
  const card: Card = { ...next }
  if (previous.mergeNote) card.mergeNote = previous.mergeNote
  if (previous.premise) card.premise = true
  if (previous.derivedFrom) card.derivedFrom = previous.derivedFrom
  if (previous.arc) card.arc = normalizeArc(previous.arc)
  if (previous.originAnchor?.chapterId) {
    card.originAnchor = {
      chapterId: previous.originAnchor.chapterId,
      ...(previous.originAnchor.sceneId ? { sceneId: previous.originAnchor.sceneId } : {}),
      ...(typeof previous.originAnchor.charOffset === 'number' ? { charOffset: previous.originAnchor.charOffset } : {}),
    }
  }
  return card
}

export function cloneEntity(entity: Entity): Entity {
  const fields: Record<string, EntityField> = {}
  for (const [key, field] of Object.entries(entity.fields)) {
    if (key === 'philosophy') continue
    fields[key] = { value: field.value, events: [...field.events] }
  }
  const copy: Entity = {
    id: entity.id,
    entityType: entity.entityType,
    name: entity.name,
    views: { ...entity.views },
    fields,
    arc: normalizeArc(entity.arc),
    premise: entity.premise === true,
  }
  if (typeof entity.slug === 'string' && entity.slug.trim()) copy.slug = entity.slug.trim()
  return copy
}

function cloneSediment(event: SedimentEvent): SedimentEvent {
  const copy: SedimentEvent = {
    id: event.id,
    requestId: event.requestId,
    kind: event.kind,
    ideaId: event.ideaId,
    at: event.at,
    target: { ...event.target },
    action: event.action,
    quote: event.quote,
    status: event.status,
  }
  if (event.sessionId !== undefined) copy.sessionId = event.sessionId
  if (event.adoptionKey !== undefined) copy.adoptionKey = event.adoptionKey
  if (event.superseded) copy.superseded = true
  return copy
}

function motivationForDossier(state: AppState, dossierId: string): string {
  for (const entity of state.entities ?? []) {
    if (entity.entityType !== 'person' || entity.views.renwudangan !== dossierId) continue
    if (entity.fields.motivation) return entity.fields.motivation.value
    const personId = entity.views.renwubiao
    if (personId) return state.snowflake.cards[personId]?.fields.motivation ?? ''
    return ''
  }
  return state.snowflake.cards[dossierId]?.fields.philosophy ?? ''
}

function personLabel(card: Card): string {
  if (card.layer === 'renwubiao') return (card.fields.name ?? '').trim()
  if (card.layer === 'renwugushi') return (card.fields.who ?? '').trim()
  if (card.layer === 'renwudangan') return (card.fields.bodyName ?? '').trim()
  return ''
}

function seedField(fields: Record<string, EntityField>, key: string, value: string | undefined): void {
  if (key === 'philosophy') return
  const text = value ?? ''
  if (!text.trim()) return
  if (fields[key]) return
  fields[key] = { value: text, events: [] }
}

export function collectPersonEntities(cards: Readonly<Record<string, Card>>): Entity[] {
  const groups = new Map<string, { renwubiao: string[]; renwugushi: string[]; renwudangan: string[] }>()
  for (const [id, card] of Object.entries(cards)) {
    if (card.layer !== 'renwubiao' && card.layer !== 'renwugushi' && card.layer !== 'renwudangan') continue
    const name = personLabel(card)
    if (!name) continue
    const group = groups.get(name) ?? { renwubiao: [], renwugushi: [], renwudangan: [] }
    group[card.layer].push(id)
    groups.set(name, group)
  }
  const entities: Entity[] = []
  for (const [name, group] of groups) {
    const views: EntityViews = {}
    if (group.renwubiao.length === 1) views.renwubiao = group.renwubiao[0]
    if (group.renwugushi.length === 1) views.renwugushi = group.renwugushi[0]
    if (group.renwudangan.length === 1) views.renwudangan = group.renwudangan[0]
    if (!views.renwubiao && !views.renwugushi && !views.renwudangan) continue
    const fields: Record<string, EntityField> = {}
    const viewId = views.renwubiao ?? views.renwugushi ?? views.renwudangan ?? ''
    let arc = emptyArc()
    let premise = false
    for (const id of [views.renwubiao, views.renwugushi, views.renwudangan]) {
      if (!id) continue
      const card = cards[id]
      if (!card) continue
      if (card.premise) premise = true
      if (card.arc) arc = normalizeArc(card.arc)
      for (const [key, value] of Object.entries(card.fields)) seedField(fields, key, value)
    }
    entities.push({
      id: `entity-${viewId}`,
      entityType: 'person',
      name,
      views,
      fields,
      arc,
      premise,
    })
  }
  return entities
}

export function mirrorPhilosophy(state: AppState): AppState {
  const cards = { ...state.snowflake.cards }
  let changed = false
  for (const entity of state.entities ?? []) {
    if (entity.entityType !== 'person') continue
    const dossierId = entity.views.renwudangan
    if (!dossierId) continue
    const dossier = cards[dossierId]
    if (!dossier) continue
    const motivation = entity.fields.motivation?.value ?? (entity.views.renwubiao ? (cards[entity.views.renwubiao]?.fields.motivation ?? '') : '')
    if ((dossier.fields.philosophy ?? '') === motivation) continue
    changed = true
    cards[dossierId] = dropCellBlocks({ ...dossier, fields: { ...dossier.fields, philosophy: motivation } }, 'philosophy')
  }
  const entities = (state.entities ?? []).map((entity) => {
    if (!entity.fields.philosophy) return entity
    const fields = { ...entity.fields }
    delete fields.philosophy
    changed = true
    return { ...entity, fields }
  })
  if (!changed) return state
  return { ...state, entities, snowflake: { ...state.snowflake, cards } }
}

export function migrateEdges(edges: readonly CanvasEdge[], cards: Readonly<Record<string, Card>>): CanvasEdge[] {
  return edges.map((edge) => {
    if (edge.kind && isEdgeKind(edge.kind)) return edge
    if (edge.foreshadow && isForeshadowState(edge.foreshadow)) return { ...edge, kind: 'foreshadow' }
    const from = cards[edge.fromNode]
    const to = cards[edge.toNode]
    if (from?.layer === 'situation' && to?.layer === 'situation' && edge.relation && isRelationKind(edge.relation)) {
      return { ...edge, kind: 'relates' }
    }
    if ((edge.label ?? '').trim()) return { ...edge, kind: 'grows-from' }
    return edge
  })
}

export interface EdgeExtra {
  relation?: RelationKind
  foreshadow?: ForeshadowState
  derivedFrom?: DerivedFrom
}

function chapterOf(state: AppState, id: string): BookChapter | undefined {
  return (state.chapters ?? []).find((chapter) => chapter.id === id)
}

function sceneOf(state: AppState, id: string): BookScene | undefined {
  for (const chapter of state.chapters ?? []) {
    const scene = chapter.scenes.find((item) => item.id === id)
    if (scene) return scene
  }
  return undefined
}

export function edgeAllowed(state: AppState, from: string, to: string, kind: EdgeKind, extra?: EdgeExtra): boolean {
  const fromCard = state.snowflake.cards[from]
  const toCard = state.snowflake.cards[to]
  const fromEntity = (state.entities ?? []).find((entity) => entity.id === from)
  const toEntity = (state.entities ?? []).find((entity) => entity.id === to)
  if (kind === 'grows-from') return Boolean(fromCard && toCard)
  if (kind === 'projects-onto') return fromCard?.layer === 'situation' && Boolean(toEntity)
  if (kind === 'relates') {
    return fromCard?.layer === 'situation' && toCard?.layer === 'situation' && isRelationKind(extra?.relation)
  }
  if (kind === 'foreshadow') {
    const fromOk = fromCard?.layer === 'situation'
    const toOk = toCard?.layer === 'situation' || toEntity?.entityType === 'foreshadow-line'
    const mark = extra?.foreshadow ?? '计划'
    return Boolean(fromOk && toOk && isForeshadowState(mark))
  }
  if (kind === 'appears-in') {
    const fromOk = fromCard?.layer === '场景表' || fromCard?.layer === 'changci'
    const toOk = toEntity?.entityType === 'person' || toEntity?.entityType === 'place' || toEntity?.entityType === 'org'
    return Boolean(fromOk && toOk)
  }
  if (kind === 'relates-entity') return Boolean(fromEntity && toEntity)
  if (kind === 'chapter-in') {
    const chapter = chapterOf(state, from)
    const scene = sceneOf(state, to)
    if (chapter && scene && chapter.scenes.some((item) => item.id === scene.id)) return true
    const fromScene = sceneOf(state, from)
    return Boolean(fromScene && toCard?.layer === 'changci')
  }
  return false
}

export function addEdge(state: AppState, from: string, to: string, kind: 'grows-from'): AppState
export function addEdge(state: AppState, from: string, to: string, kind: 'projects-onto'): AppState
export function addEdge(state: AppState, from: string, to: string, kind: 'relates', extra: { relation: RelationKind }): AppState
export function addEdge(state: AppState, from: string, to: string, kind: 'foreshadow', extra?: { foreshadow?: ForeshadowState }): AppState
export function addEdge(state: AppState, from: string, to: string, kind: 'appears-in'): AppState
export function addEdge(state: AppState, from: string, to: string, kind: 'relates-entity'): AppState
export function addEdge(state: AppState, from: string, to: string, kind: 'chapter-in'): AppState
export function addEdge(state: AppState, from: string, to: string, kind: EdgeKind, extra?: EdgeExtra): AppState {
  if (from === to || !isEdgeKind(kind)) return state
  if (!edgeAllowed(state, from, to, kind, extra)) return state
  if (kind === 'grows-from') {
    if (state.canvas.edges.some((edge) => edge.fromNode === from && edge.toNode === to)) return state
  } else if (state.canvas.edges.some((edge) => edge.fromNode === from && edge.toNode === to && edge.kind === kind)) {
    return state
  }
  const edge: CanvasEdge = {
    id: kind === 'grows-from' ? `e-${from}-${to}` : makeId('e'),
    fromNode: from,
    toNode: to,
    kind,
  }
  if (kind === 'grows-from') {
    edge.fromSide = 'right'
    edge.toSide = 'left'
    edge.toEnd = 'arrow'
    edge.label = '连到后面的层'
  }
  if (kind === 'relates' && extra?.relation) edge.relation = extra.relation
  if (kind === 'foreshadow') edge.foreshadow = extra?.foreshadow ?? '计划'
  if (kind === 'relates' && extra?.relation === '派生' && extra.derivedFrom) edge.derivedFrom = extra.derivedFrom
  if (kind === 'projects-onto') edge.sedimentEvents = []
  return { ...state, canvas: { ...state.canvas, edges: [...state.canvas.edges, edge] } }
}

export const LINK_KIND_LABEL = {
  'grows-from': '生长',
  relates: '关系',
  foreshadow: '伏笔',
  'projects-onto': '投影',
  'appears-in': '出场',
  'relates-entity': '实体关系',
} as const

export type LinkKind = keyof typeof LINK_KIND_LABEL

const LINK_KIND_ORDER: readonly LinkKind[] = ['grows-from', 'relates', 'foreshadow', 'projects-onto', 'appears-in', 'relates-entity']

/** 拖线面板用。chapter-in 不在这里。不合法的 kind 不会出现。 */
export function legalEdgeKinds(state: AppState, from: string, to: string): LinkKind[] {
  if (!from || !to || from === to) return []
  const kinds: LinkKind[] = []
  for (const kind of LINK_KIND_ORDER) {
    if (kind === 'relates') {
      if (edgeAllowed(state, from, to, 'relates', { relation: '互补' })) kinds.push(kind)
      continue
    }
    if (kind === 'foreshadow') {
      if (edgeAllowed(state, from, to, 'foreshadow', { foreshadow: '计划' })) kinds.push(kind)
      continue
    }
    if (edgeAllowed(state, from, to, kind)) kinds.push(kind)
  }
  return kinds
}

export function chooseCanvasLink(state: AppState, from: string, to: string, kind: LinkKind, relation?: RelationKind): AppState {
  if (!legalEdgeKinds(state, from, to).includes(kind)) return state
  if (kind === 'relates') {
    if (!relation || !isRelationKind(relation)) return state
    return addEdge(state, from, to, 'relates', { relation })
  }
  if (kind === 'grows-from') return addEdge(state, from, to, 'grows-from')
  if (kind === 'projects-onto') return addEdge(state, from, to, 'projects-onto')
  if (kind === 'foreshadow') return addEdge(state, from, to, 'foreshadow')
  if (kind === 'appears-in') return addEdge(state, from, to, 'appears-in')
  return addEdge(state, from, to, 'relates-entity')
}

export function entityNodeId(entityId: string): string {
  return `entity:${entityId}`
}

export function canvasEndpointId(state: AppState, nodeId: string): string {
  const node = state.canvas.nodes.find((item) => item.id === nodeId)
  return node?.entityId ?? nodeId
}

export function placeEntityOnCanvas(state: AppState, entityId: string, x?: number, y?: number): AppState {
  const entity = (state.entities ?? []).find((item) => item.id === entityId)
  if (!entity) return state
  const id = entityNodeId(entityId)
  const existing = state.canvas.nodes.find((node) => node.id === id || node.entityId === entityId)
  if (existing) {
    if (x === undefined || y === undefined) return state
    return moveNode(state, existing.id, x, y)
  }
  const placed = state.canvas.nodes.filter((node) => node.entityId).length
  const node: CanvasNode = {
    id,
    type: 'text',
    x: x ?? 80 + placed * 36,
    y: y ?? 80 + placed * 28,
    width: 160,
    height: 160,
    text: entity.name,
    entityId,
  }
  return { ...state, canvas: { ...state.canvas, nodes: [...state.canvas.nodes, node] } }
}

export function premiseCardId(state: AppState): string | null {
  const theme = (state.entities ?? []).find((entity) => entity.entityType === 'theme' && entity.premise)
  if (!theme?.id.startsWith('premise:')) return null
  const cardId = theme.id.slice('premise:'.length)
  const card = state.snowflake.cards[cardId]
  if (!card || card.layer !== 'situation') return null
  return cardId
}

export function premiseMark(state: AppState, cardId: string): '前提' | null {
  return premiseCardId(state) === cardId ? '前提' : null
}

export function markBookPremise(state: AppState, cardId: string): AppState {
  const card = state.snowflake.cards[cardId]
  if (!card || card.layer !== 'situation') return state
  const id = `premise:${cardId}`
  const sentence = { value: card.body, events: [] as string[] }
  let found = false
  const entities = (state.entities ?? []).map((entity) => {
    if (entity.id !== id) return entity.premise ? { ...entity, premise: false } : entity
    found = true
    return {
      ...entity,
      entityType: 'theme' as const,
      name: firstLine(card.body) || '前提',
      premise: true,
      fields: { ...entity.fields, sentence: { value: card.body, events: entity.fields.sentence?.events ?? [] } },
    }
  })
  if (!found) {
    entities.push({
      id,
      entityType: 'theme',
      name: firstLine(card.body) || '前提',
      views: {},
      fields: { sentence },
      arc: emptyArc(),
      premise: true,
    })
  }
  return { ...state, entities }
}

export type FootnoteTarget =
  | { view: 'card'; cardId: string }
  | { view: 'cast'; entityId: string }
  | { view: 'relation'; focusId: string; mode: 'project' | 'relate' | 'appear' }

export interface FootnoteSegment {
  text: string
  target: FootnoteTarget
}

function entityById(state: AppState, id: string): Entity | undefined {
  return (state.entities ?? []).find((entity) => entity.id === id)
}

/**
 * 出场口径：场次卡（场景表或场次）数从这张卡连出的 appears-in；
 * 实体节点数指向这个实体的 appears-in。没有的段不写进这一行。
 */
export function cardFootnotes(state: AppState, nodeId: string): FootnoteSegment[] {
  const node = state.canvas.nodes.find((item) => item.id === nodeId)
  const entityId = node?.entityId
  const card = state.snowflake.cards[nodeId]
  const self = new Set<string>([nodeId])
  if (entityId) self.add(entityId)
  const segments: FootnoteSegment[] = []
  if (card) {
    const sources = state.canvas.edges.filter((edge) => edge.kind === 'grows-from' && edge.toNode === nodeId && state.snowflake.cards[edge.fromNode])
    if (sources.length > 0) {
      const labels = sources.map((edge) => {
        const title = cardFace(state.snowflake.cards[edge.fromNode]!).title.trim()
        return title || edge.fromNode
      })
      segments.push({ text: `生长自 ${labels.join('、')}`, target: { view: 'card', cardId: sources[0]!.fromNode } })
    }
    const projections = state.canvas.edges.filter((edge) => edge.kind === 'projects-onto' && edge.fromNode === nodeId && entityById(state, edge.toNode))
    if (projections.length > 0) {
      segments.push({
        text: `投影 ${projections.length}`,
        target: { view: 'relation', focusId: projections[0]!.toNode, mode: 'project' },
      })
    }
  }
  const sceneCard = card && (card.layer === '场景表' || card.layer === 'changci')
  if (sceneCard) {
    const appearances = state.canvas.edges.filter((edge) => edge.kind === 'appears-in' && edge.fromNode === nodeId && entityById(state, edge.toNode))
    if (appearances.length > 0) {
      const entity = entityById(state, appearances[0]!.toNode)!
      const target: FootnoteTarget =
        entity.entityType === 'person'
          ? { view: 'cast', entityId: entity.id }
          : { view: 'relation', focusId: entity.id, mode: 'appear' }
      segments.push({ text: `出场 ${appearances.length} 场`, target })
    }
  } else if (entityId) {
    const appearances = state.canvas.edges.filter((edge) => edge.kind === 'appears-in' && edge.toNode === entityId && state.snowflake.cards[edge.fromNode])
    if (appearances.length > 0) {
      segments.push({
        text: `出场 ${appearances.length} 场`,
        target: { view: 'card', cardId: appearances[0]!.fromNode },
      })
    }
  }
  const relations = state.canvas.edges.filter((edge) => {
    if (edge.kind !== 'relates' && edge.kind !== 'relates-entity') return false
    const other = self.has(edge.fromNode) ? edge.toNode : self.has(edge.toNode) ? edge.fromNode : ''
    if (!other) return false
    return Boolean(state.snowflake.cards[other] || entityById(state, other))
  })
  if (relations.length > 0) {
    const edge = relations[0]!
    const other = self.has(edge.fromNode) ? edge.toNode : edge.fromNode
    segments.push({ text: `关系 ${relations.length} 条`, target: { view: 'relation', focusId: other, mode: 'relate' } })
  }
  return segments
}

export function footnoteLine(state: AppState, nodeId: string): string {
  return cardFootnotes(state, nodeId).map((segment) => segment.text).join(' · ')
}

function personCalled(state: AppState, entity: Entity): string {
  const fieldName = entity.fields.name?.value?.trim() ?? ''
  if (fieldName) return fieldName
  const cardId = entity.views.renwubiao
  const cardName = cardId ? (state.snowflake.cards[cardId]?.fields.name ?? '').trim() : ''
  if (cardName) return cardName
  return entity.name.trim()
}

export type AppearanceDecision =
  | { kind: 'ignore' }
  | { kind: 'missing'; name: string }
  | { kind: 'offer'; cardId: string; entityId: string; name: string }

export function appearanceDecision(state: AppState, cardId: string, pov: string): AppearanceDecision {
  const card = state.snowflake.cards[cardId]
  if (!card || (card.layer !== '场景表' && card.layer !== 'changci')) return { kind: 'ignore' }
  const name = pov.trim()
  if (!name) return { kind: 'ignore' }
  const person = (state.entities ?? []).find((entity) => entity.entityType === 'person' && personCalled(state, entity) === name)
  if (!person) return { kind: 'missing', name }
  const exists = state.canvas.edges.some((edge) => edge.kind === 'appears-in' && edge.fromNode === cardId && edge.toNode === person.id)
  if (exists) return { kind: 'ignore' }
  return { kind: 'offer', cardId, entityId: person.id, name }
}

export function confirmAppearance(state: AppState, cardId: string, entityId: string): AppState {
  const card = state.snowflake.cards[cardId]
  if (!card || (card.layer !== '场景表' && card.layer !== 'changci')) return state
  return addEdge(state, cardId, entityId, 'appears-in')
}

function orderEvents(events: readonly SedimentEvent[]): SedimentEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      if (left.event.at < right.event.at) return -1
      if (left.event.at > right.event.at) return 1
      return left.index - right.index
    })
    .map((item) => item.event)
}

function supersededIds(events: readonly SedimentEvent[]): Set<string> {
  const kill = new Set<string>()
  const groups = new Map<string, SedimentEvent[]>()
  for (const event of events) {
    const key = `${event.target.entityId}\0${event.target.fieldKey}`
    const list = groups.get(key) ?? []
    list.push(event)
    groups.set(key, list)
  }
  for (const list of groups.values()) {
    const ordered = orderEvents(list)
    const seen = new Set<string>()
    for (const event of ordered) {
      if (seen.has(event.requestId)) continue
      seen.add(event.requestId)
      if (event.action !== 'negate') continue
      for (const previous of ordered) {
        if (previous.id === event.id || previous.requestId === event.requestId) continue
        if (previous.quote === event.quote) kill.add(previous.id)
      }
    }
  }
  return kill
}

export function foldFieldValue(events: readonly SedimentEvent[]): string {
  const kill = supersededIds(events)
  const ordered = orderEvents(events)
  const seen = new Set<string>()
  let value = ''
  for (const event of ordered) {
    if (seen.has(event.requestId)) continue
    seen.add(event.requestId)
    if (event.superseded || kill.has(event.id)) continue
    if (event.action === 'negate') continue
    if (event.action === 'replace') value = event.quote
    else value = value ? `${value}\n\n${event.quote}` : event.quote
  }
  return value
}

function markSuperseded(events: readonly SedimentEvent[]): SedimentEvent[] {
  const kill = supersededIds(events)
  return events.map((event) => {
    if (!kill.has(event.id)) {
      if (!event.superseded) return event
      const next = { ...event }
      delete next.superseded
      return next
    }
    return event.superseded ? event : { ...event, superseded: true }
  })
}

function isSedimentKind(value: unknown): value is SedimentKind {
  return typeof value === 'string' && (SEDIMENT_KINDS as readonly string[]).includes(value)
}

function isSedimentAction(value: unknown): value is SedimentAction {
  return typeof value === 'string' && (SEDIMENT_ACTIONS as readonly string[]).includes(value)
}

function isSedimentStatus(value: unknown): value is SedimentStatus {
  return typeof value === 'string' && (SEDIMENT_STATUSES as readonly string[]).includes(value)
}

export function applySediment(state: AppState, input: SedimentEvent): AppState {
  if (!input || typeof input.ideaId !== 'string' || input.ideaId.trim() === '') return state
  if (typeof input.requestId !== 'string' || input.requestId.trim() === '') return state
  if (typeof input.quote !== 'string' || input.quote.trim() === '') return state
  if (!isSedimentKind(input.kind) || !isSedimentAction(input.action) || !isSedimentStatus(input.status)) return state
  if (!input.target || !isEntityType(input.target.entityType)) return state
  if (typeof input.target.entityId !== 'string' || input.target.entityId.trim() === '') return state
  if (typeof input.target.fieldKey !== 'string' || input.target.fieldKey.trim() === '') return state
  if (input.target.fieldKey === 'philosophy') return state
  const entities = state.entities ?? []
  if (!entities.some((entity) => entity.id === input.target.entityId)) return state
  if ((state.sediment ?? []).some((event) => event.requestId === input.requestId)) return state
  const event = cloneSediment({ ...input, id: input.id || makeId('sed'), superseded: undefined })
  const sediment = markSuperseded([...(state.sediment ?? []), event])
  const nextEntities = entities.map((entity) => {
    if (entity.id !== event.target.entityId) return entity
    const list = sediment.filter((item) => item.target.entityId === entity.id && item.target.fieldKey === event.target.fieldKey)
    const ordered = orderEvents(list)
    return {
      ...entity,
      fields: {
        ...entity.fields,
        [event.target.fieldKey]: { value: foldFieldValue(ordered), events: ordered.map((item) => item.id) },
      },
    }
  })
  const edges = state.canvas.edges.map((edge) => {
    if (edge.kind !== 'projects-onto' || edge.fromNode !== event.ideaId || edge.toNode !== event.target.entityId) return edge
    const ids = edge.sedimentEvents ?? []
    if (ids.includes(event.id)) return edge
    return { ...edge, sedimentEvents: [...ids, event.id] }
  })
  return { ...state, entities: nextEntities, sediment, canvas: { ...state.canvas, edges } }
}

function appendParagraph(base: string, extra: string): string {
  if (!extra) return base
  if (!base) return extra
  return `${base}\n\n${extra}`
}

export function mergeCards(state: AppState, targetId: string, dropIds: readonly string[]): AppState {
  const target = state.snowflake.cards[targetId]
  if (!target) return state
  const drops = [...new Set(dropIds.filter((id) => id && id !== targetId && state.snowflake.cards[id]))]
  if (drops.length === 0) return state
  const dropSet = new Set(drops)
  let body = target.body
  let premise = target.premise === true
  for (const id of drops) {
    const card = state.snowflake.cards[id]
    if (!card) continue
    body = appendParagraph(body, card.body)
    if (card.premise) premise = true
  }
  for (const entity of state.entities ?? []) {
    if (!entity.premise) continue
    const viewIds = [entity.views.renwubiao, entity.views.renwugushi, entity.views.renwudangan]
    if (viewIds.some((id) => id !== undefined && dropSet.has(id))) premise = true
  }
  const noteIds = (target.mergeNote ?? '').split(',').map((item) => item.trim()).filter((item) => item.length > 0)
  for (const id of drops) {
    if (!noteIds.includes(id)) noteIds.push(id)
  }
  const cards: Record<string, Card> = {}
  for (const [id, card] of Object.entries(state.snowflake.cards)) {
    if (dropSet.has(id)) continue
    if (id === targetId) {
      let next: Card = { ...card, body, mergeNote: noteIds.join(',') }
      if (body !== card.body) {
        next = dropCellBlocks(next, 'body')
        if (card.layer === '一句话') next = dropCellBlocks(next, 'sentence')
      }
      if (premise) next.premise = true
      else delete next.premise
      cards[id] = next
      continue
    }
    if (premise && card.premise) {
      const next = { ...card }
      delete next.premise
      cards[id] = next
      continue
    }
    cards[id] = card
  }
  const seen = new Set<string>()
  const edges: CanvasEdge[] = []
  for (const edge of state.canvas.edges) {
    const fromNode = dropSet.has(edge.fromNode) ? targetId : edge.fromNode
    const toNode = dropSet.has(edge.toNode) ? targetId : edge.toNode
    if (fromNode === toNode) continue
    const key = `${edge.kind ?? ''}\0${fromNode}\0${toNode}\0${edge.relation ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(fromNode === edge.fromNode && toNode === edge.toNode ? edge : { ...edge, fromNode, toNode })
  }
  const sediment = (state.sediment ?? []).map((event) => {
    const ideaId = dropSet.has(event.ideaId) ? targetId : event.ideaId
    const entityId = dropSet.has(event.target.entityId) ? targetId : event.target.entityId
    if (ideaId === event.ideaId && entityId === event.target.entityId) return event
    return { ...event, ideaId, target: { ...event.target, entityId } }
  })
  const entities = (state.entities ?? []).map((entity) => {
    const views: EntityViews = { ...entity.views }
    for (const key of ['renwubiao', 'renwugushi', 'renwudangan'] as const) {
      const viewId = views[key]
      if (viewId && dropSet.has(viewId)) views[key] = cards[targetId]?.layer === key ? targetId : undefined
    }
    return { ...entity, views, premise: premise ? false : entity.premise }
  })
  return {
    ...state,
    activeId: state.activeId && dropSet.has(state.activeId) ? targetId : state.activeId,
    canvas: {
      nodes: state.canvas.nodes.filter((node) => !dropSet.has(node.id)),
      edges,
    },
    snowflake: { ...state.snowflake, cards },
    entities,
    sediment,
  }
}

export function outlineProgress(chapters: readonly BookChapter[] | undefined): { filled: number; total: number } {
  let filled = 0
  let total = 0
  for (const chapter of chapters ?? []) {
    for (const scene of chapter.scenes) {
      total += 1
      if ((scene.beatIds ?? []).some((id) => id.trim().length > 0)) filled += 1
    }
  }
  return { filled, total }
}

export function reconcileProse(state: AppState): AppState {
  const chapters = (state.chapters ?? []).map((chapter) => ({
    ...chapter,
    scenes: chapter.scenes.map((scene) => ({ ...scene, beatIds: [...(scene.beatIds ?? [])], ideaIds: [...(scene.ideaIds ?? [])] })),
  }))
  const sceneAt = new Map<string, { chapterIndex: number; sceneIndex: number }>()
  chapters.forEach((chapter, chapterIndex) => {
    chapter.scenes.forEach((scene, sceneIndex) => sceneAt.set(scene.id, { chapterIndex, sceneIndex }))
  })
  const cards = { ...state.snowflake.cards }
  const pending = [...(state.pendingProseScenes ?? [])]
  const pendingIds = new Set(pending.map((item) => item.cardId))
  let changed = false
  for (const [id, card] of Object.entries(cards)) {
    if (card.layer !== '正文草稿') continue
    const sceneId = (card.derivedFrom ?? '').trim()
    const loc = sceneId ? sceneAt.get(sceneId) : undefined
    if (!loc) {
      if (!pendingIds.has(id)) {
        pending.push({ cardId: id, chapterHint: '' })
        pendingIds.add(id)
        changed = true
      }
      continue
    }
    const scene = chapters[loc.chapterIndex].scenes[loc.sceneIndex]
    const prose = scene.prose ?? ''
    const body = card.body ?? ''
    const proseEmpty = prose.trim() === ''
    const bodyEmpty = body.trim() === ''
    if (proseEmpty && !bodyEmpty) {
      chapters[loc.chapterIndex].scenes[loc.sceneIndex] = { ...scene, prose: body }
      cards[id] = dropCellBlocks({ ...card, body: '' }, 'body')
      changed = true
      continue
    }
    if (!proseEmpty && !bodyEmpty && prose !== body && !scene.proseFork) {
      chapters[loc.chapterIndex].scenes[loc.sceneIndex] = { ...scene, proseFork: true }
      changed = true
    }
  }
  if (!changed) return state
  return { ...state, chapters, pendingProseScenes: pending, snowflake: { ...state.snowflake, cards } }
}

export function resolveProseFork(state: AppState, sceneId: string, keep: 'scene' | 'card'): AppState {
  const chapters = state.chapters ?? []
  let chapterIndex = -1
  let sceneIndex = -1
  for (let index = 0; index < chapters.length; index += 1) {
    const found = chapters[index]?.scenes.findIndex((scene) => scene.id === sceneId) ?? -1
    if (found >= 0) {
      chapterIndex = index
      sceneIndex = found
      break
    }
  }
  if (chapterIndex < 0 || sceneIndex < 0) return state
  const scene = chapters[chapterIndex]?.scenes[sceneIndex]
  if (!scene?.proseFork) return state
  const drafts = Object.entries(state.snowflake.cards).filter(
    ([, card]) => card.layer === '正文草稿' && (card.derivedFrom ?? '').trim() === sceneId,
  )
  let prose = scene.prose ?? ''
  if (keep === 'card') {
    const source = drafts.find(([, card]) => (card.body ?? '') !== '')
    if (source) prose = source[1].body ?? ''
  }
  let next = state
  for (const [id, card] of drafts) {
    if ((card.body ?? '') === '') continue
    next = setCardBody(next, id, '')
  }
  const nextChapters = (next.chapters ?? []).map((chapter, index) => {
    if (index !== chapterIndex) return chapter
    return {
      ...chapter,
      scenes: chapter.scenes.map((item, index2) => {
        if (index2 !== sceneIndex) return item
        const cleared: BookScene = { ...item, prose }
        delete cleared.proseFork
        return cleared
      }),
    }
  })
  return { ...next, chapters: nextChapters }
}
