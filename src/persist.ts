import {
  applyComposition,
  collectPersonEntities,
  commitCardText,
  createDocument,
  isEdgeKind,
  isEntityType,
  isForeshadowState,
  isRelationKind,
  LAYERS,
  loadCards,
  migrateEdges,
  mirrorPhilosophy,
  reconcileProse,
  serializeDocument,
  type AppState,
  type ArcCells,
  type BookChapter,
  type BookScene,
  type Card,
  type CanvasEdge,
  type CanvasNode,
  type ComposeSession,
  type CompositionEvent,
  type Entity,
  type EntityField,
  type LooseCard,
  type PendingProseScene,
  type PendingEntity,
  type OriginAnchor,
  type SedimentEvent,
  ARC_KEYS,
  SEDIMENT_ACTIONS,
  SEDIMENT_KINDS,
  SEDIMENT_STATUSES,
} from './document.ts'
import { MSG_EXPAND_NO_CARD, buildExpandRequest, requestExpandCandidates } from './expand.ts'
import type { ExpandClientOptions, ShownCandidate } from './expand.ts'
import { isSnapshotFileName, snapshotFileName } from './snapshot.ts'

export const CANONICAL_NAME = 'snowflake.json'

export const MSG_WRITE_FAILED = '没保存到文件。刚才的改动还在这页里，先别关页面。'
export const MSG_WRITE_FAILED_SERVER = '没保存到服务器。刚才的改动还在这页里，先别关页面。'
export const MSG_VERSION_MOVED = '版本已更新，请再试'
export const MSG_CARD_CONFLICT = '有卡片两边都改过，请先选择用哪一边'
export const MSG_CANON_MISMATCH = '正本对不上，已停下'
export const CONFLICT_SUMMARY_LIMIT = 80
export const MSG_WRITING = '正在写入正本'
export const MSG_LOG_DOWN = '恢复日志不可用'
export const MSG_OTHER_TAB = '另一个标签正在写这份正本，本页只读'
export const MSG_NO_LOCK = '这个地址不能跨标签互斥。单页可以继续写。要用互斥，请改用 http://127.0.0.1 打开。'
export const MSG_RESTORED = '正本不是完整 JSON，已用恢复日志换上上一份完整稿'
export const MSG_SAVE_AS = '正本要另存'
export const MSG_FILE_PROTOCOL = '请用本机的 http://127.0.0.1 打开。从文件地址打开时，目录句柄和恢复日志都不可用。'
export const MSG_KEEP_SNAPSHOT = '留下这一版'
export const SNAPSHOT_SAVE_HINT = '这是正本旁边的一份快照。打开应用时仍读正本，不读这份快照。'
export const MSG_NEED_PERMISSION = '还没有读写授权。点一下才能继续自动保存。'
export const SAVE_AS_WARNING = '下载开始后不要在浏览器里取消；若取消了，必须停止编辑，下次打开会看到上一份正本。'
export const MSG_SNAPSHOT_FAILED = '留下这一版失败'
export const MSG_SAVE_AS_LATER = '还没另存，稍后再提示'
export const MSG_USE_LOOPBACK = '这个地址只能下载另存，不能自动保存。请改用 http://127.0.0.1:8093 打开以获得自动保存。'
// 另存模式下，自动保存两次弹下载之间至少隔这么久；间隔内的改动先记进恢复日志。
export const SAVE_AS_INTERVAL_MS = 60_000

export type StatusKind = 'error' | 'info'

export interface StatusNotice {
  text: string
  kind: StatusKind
}

const ERROR_TEXTS = new Set([MSG_WRITE_FAILED, MSG_WRITE_FAILED_SERVER, MSG_VERSION_MOVED, MSG_SNAPSHOT_FAILED, MSG_CANON_MISMATCH])

export function statusKind(text: string): StatusKind {
  if (ERROR_TEXTS.has(text)) return 'error'
  return /失败|没写上|不可用/.test(text) ? 'error' : 'info'
}

export function tempNameFor(canonicalName: string): string {
  return `.${canonicalName}.tmp`
}

export function formatLocalStart(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export interface RecoveryLog {
  read(): Promise<Uint8Array | null>
  write(bytes: Uint8Array): Promise<void>
  close?(): Promise<void>
}

export interface DirectoryAccess {
  read(name: string): Promise<Uint8Array | null>
  writeTemp(name: string, bytes: Uint8Array): Promise<void>
  move(tempName: string, canonicalName: string): Promise<void>
  remove(name: string): Promise<void>
  listNames?(): Promise<string[]>
}

export interface LockHandle {
  release(): void
}

export type ChannelMessage =
  | { type: 'writing'; fileId: string; fileName: string; startedAt: string }
  | { type: 'hello'; fileId: string }

export interface ChannelBus {
  post(message: ChannelMessage): void
  subscribe(listener: (message: ChannelMessage) => void): () => void
}

export interface ClaimStore {
  get(): string | null
  set(fileId: string): void
}

export type PermissionWord = 'granted' | 'prompt' | 'denied'

export interface RemoteCanonical {
  load(): Promise<{ etag: string; bytes: Uint8Array } | null>
  save(
    bytes: Uint8Array,
    etag: string,
  ): Promise<
    | { ok: true; etag: string }
    | { ok: false; conflict: true; etag: string; bytes?: Uint8Array }
    | { ok: false; conflict: false }
  >
  keep(
    etag: string,
  ): Promise<
    | { ok: true; etag: string; snapshotCount: number; snapshotName?: string; timeline?: 'ok' | 'skipped' }
    | { ok: false; message: string }
  >
  listSnapshots?: () => Promise<Array<{ name: string; savedAt: string }> | null>
  rollback?: (
    name: string,
    etag: string,
  ) => Promise<
    | { ok: true; etag: string; bytes: Uint8Array }
    | { ok: false; conflict: true; etag: string; bytes?: Uint8Array }
    | { ok: false; conflict: false; message: string }
  >
}

export interface SnapshotOption {
  name: string
  label: string
}

export const UNDO_LIMIT = 20
export const MSG_TIMELINE_SKIPPED = '时间线没记上'

export interface PersistPorts {
  protocol: string
  hasDirectoryPicker: boolean
  now(): Date
  loadDirectory(): Promise<DirectoryAccess | null>
  pickDirectory(): Promise<DirectoryAccess | 'abort'>
  queryPermission(): Promise<PermissionWord>
  requestPermission(): Promise<PermissionWord>
  logFactory(): Promise<RecoveryLog>
  tryAcquireLock(name: string): Promise<LockHandle | null | 'unsupported'>
  lockHeld(name: string): Promise<boolean>
  channel: ChannelBus
  claim: ClaimStore
  askSaveAs(fileName: string, bytes: Uint8Array): Promise<boolean>
  askFirstDownload(fileName: string, bytes: Uint8Array): Promise<boolean>
  askSnapshotDownload?: (fileName: string, bytes: Uint8Array) => Promise<boolean>
  remote?: RemoteCanonical
  expand?: ExpandClientOptions
  randomId?: () => string
  pauseBeforeMove?: () => Promise<void>
  pauseAfterMove?: () => Promise<void>
}

export interface PersistView {
  canEdit: boolean
  writing: boolean
  stopped: boolean
  fileProtocol: boolean
  needPermission: boolean
  needChoice: boolean
  readonlyOther: boolean
  downloadMode: boolean
  fileName: string
  messages: string[]
  notices: StatusNotice[]
  otherStartedAt: string | null
  logUnavailable: boolean
  restoredNotice: boolean
  expandNotice: string | null
  candidates: ShownCandidate[]
  snapshotNames: string[]
  snapshotOptions: SnapshotOption[]
  canUndo: boolean
  remoteVersion: string
  conflicts: CardConflictView[]
}

export type ConflictPick = 'mine' | 'server'

export interface CardConflictView {
  cardId: string
  serverText: string
  mineText: string
}

export interface PersistSnapshot {
  state: AppState
  view: PersistView
}

export interface PersistController {
  start(): Promise<void>
  refresh(): Promise<void>
  reloadRemote(): Promise<void>
  selectDirectory(): Promise<void>
  requestPermission(): Promise<void>
  claimWrite(): Promise<void>
  openLocalFile(bytes: Uint8Array, name: string): Promise<void>
  commitText(cardId: string, fieldKey: string | null, text: string): Promise<void>
  mutate(recipe: (state: AppState) => AppState, options?: { undoable?: boolean }): Promise<void>
  undo(): Promise<void>
  select(id: string | null): void
  editorComposition(
    session: ComposeSession,
    event: CompositionEvent,
    fieldKey: string | null,
  ): Promise<ComposeSession>
  requestCandidates(cardId: string, fieldKey: string | null): Promise<void>
  dismissCandidates(): void
  confirmCandidate(candidateId: string): Promise<void>
  keepVersion(): Promise<void>
  rollbackTo(name: string): Promise<void>
  rollbackToBytes(bytes: Uint8Array): Promise<void>
  resolveCardConflict(cardId: string, pick: ConflictPick): Promise<void>
  retryWrite(): Promise<void>
  snapshot(): PersistSnapshot
  readRecoveryLog(): Promise<Uint8Array | null>
  holdForSwitch(): Promise<boolean>
  releaseHold(): void
  dispose(): void
}

type OpenReason = 'refresh' | 'pick' | 'claim-button' | 'download' | 'open-file'

type WriteResult =
  | { ok: true; logged: boolean; bytes: Uint8Array; merged?: boolean }
  | { ok: false; conflict?: false; mismatch?: boolean }
  | { ok: false; conflict: true; pending: CardConflict[]; provisional: Uint8Array | null }

// 一次写入里，合并后又遇到 412 时最多再合并重发几轮。
const REMOTE_MERGE_ROUNDS = 3

let writeSeq = 0
const writeSeqByState = new WeakMap<AppState, number>()

// 编辑器自己写回产生的画布状态带一个递增编号；采纳、扩写确认、合并、拖动等产生的状态没有编号。
export function writeSeqOf(state: AppState): number {
  return writeSeqByState.get(state) ?? 0
}

export function latestWriteSeq(): number {
  return writeSeq
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

export function documentToBytes(state: AppState): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(serializeDocument(state)))
}

export function parseCompleteDocument(bytes: Uint8Array): { bytes: Uint8Array; state: AppState } | null {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const state = toAppState(value)
  if (!state) return null
  return { bytes: new Uint8Array(bytes), state }
}

function cardJson(card: AppState['snowflake']['cards'][string]): string {
  const fields: Record<string, string> = {}
  for (const key of Object.keys(card.fields).sort()) fields[key] = card.fields[key] ?? ''
  return JSON.stringify({
    layer: card.layer,
    body: card.body,
    fields,
    mergeNote: card.mergeNote ?? '',
    premise: card.premise === true,
    derivedFrom: card.derivedFrom ?? '',
  })
}

function nodeJson(node: CanvasNode): string {
  return JSON.stringify({
    id: node.id,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    text: node.text ?? '',
    color: node.color ?? '',
  })
}

function edgeJson(edge: CanvasEdge): string {
  return JSON.stringify({
    id: edge.id,
    fromNode: edge.fromNode,
    toNode: edge.toNode,
    fromSide: edge.fromSide ?? '',
    toSide: edge.toSide ?? '',
    fromEnd: edge.fromEnd ?? '',
    toEnd: edge.toEnd ?? '',
    label: edge.label ?? '',
    kind: edge.kind ?? '',
    relation: edge.relation ?? '',
    foreshadow: edge.foreshadow ?? '',
  })
}

interface ListMerge<T> {
  kept: Map<string, T>
  conflicts: Map<string, { remote: T | undefined; local: T | undefined }>
}

function mergeList<T>(
  base: readonly T[],
  remote: readonly T[],
  local: readonly T[],
  idOf: (item: T) => string,
  jsonOf: (item: T) => string,
): ListMerge<T> {
  const baseMap = new Map(base.map((item) => [idOf(item), item]))
  const remoteMap = new Map(remote.map((item) => [idOf(item), item]))
  const localMap = new Map(local.map((item) => [idOf(item), item]))
  const ids = new Set([...baseMap.keys(), ...remoteMap.keys(), ...localMap.keys()])
  const kept = new Map<string, T>()
  const conflicts = new Map<string, { remote: T | undefined; local: T | undefined }>()
  for (const id of ids) {
    const previous = baseMap.get(id)
    const incoming = remoteMap.get(id)
    const mine = localMap.get(id)
    const previousKey = previous ? jsonOf(previous) : null
    const incomingKey = incoming ? jsonOf(incoming) : null
    const mineKey = mine ? jsonOf(mine) : null
    const remoteChanged = incomingKey !== previousKey
    const localChanged = mineKey !== previousKey
    if (!remoteChanged && !localChanged) {
      if (previous) kept.set(id, previous)
      continue
    }
    if (!localChanged) {
      if (incoming) kept.set(id, incoming)
      continue
    }
    if (!remoteChanged) {
      if (mine) kept.set(id, mine)
      continue
    }
    if (incomingKey === mineKey) {
      if (mine) kept.set(id, mine)
      else if (incoming) kept.set(id, incoming)
      continue
    }
    conflicts.set(id, { remote: incoming, local: mine })
  }
  return { kept, conflicts }
}

function orderList<T>(
  kept: Map<string, T>,
  base: readonly T[],
  remote: readonly T[],
  local: readonly T[],
  idOf: (item: T) => string,
): T[] {
  const seen = new Set<string>()
  const ordered: T[] = []
  const push = (id: string) => {
    if (seen.has(id)) return
    const item = kept.get(id)
    if (!item) return
    seen.add(id)
    ordered.push(item)
  }
  for (const item of base) push(idOf(item))
  for (const item of remote) push(idOf(item))
  for (const item of local) push(idOf(item))
  return ordered
}

function setOrDelete<T>(map: Map<string, T>, id: string, item: T | null | undefined): void {
  if (item) map.set(id, item)
  else map.delete(id)
}

// 连线两端都必须是还在的卡片；节点 id 与卡片 id 相同。
export function dropDanglingEdges(
  edges: readonly CanvasEdge[],
  cards: Readonly<Record<string, unknown>>,
  also?: ReadonlySet<string>,
): CanvasEdge[] {
  const has = (id: string) => Object.prototype.hasOwnProperty.call(cards, id) || (also?.has(id) ?? false)
  return edges.filter((edge) => has(edge.fromNode) && has(edge.toNode))
}

function pickJson<T>(base: T, remote: T, local: T): T {
  const baseKey = JSON.stringify(base)
  const remoteKey = JSON.stringify(remote)
  const localKey = JSON.stringify(local)
  if (localKey === remoteKey) return local
  if (localKey === baseKey) return remote
  if (remoteKey === baseKey) return local
  return local
}

function endpointIds(entities: readonly Entity[], chapters: readonly BookChapter[]): Set<string> {
  const ids = new Set<string>()
  for (const entity of entities) ids.add(entity.id)
  for (const chapter of chapters) {
    ids.add(chapter.id)
    for (const scene of chapter.scenes) ids.add(scene.id)
  }
  return ids
}

// 一张卡在服务器那边的样子：卡片、同 id 的节点、从这张卡连出且两边改得不一样的连线。null 表示服务器上没有。
export interface ConflictSide {
  card: Card | null
  node: CanvasNode | null
  edges: Array<{ id: string; edge: CanvasEdge | null }>
}

export interface CardConflict {
  cardId: string
  serverKey: string
  server: ConflictSide
}

export interface ConflictChoiceRecord {
  pick: ConflictPick
  serverKey: string
}

export type MergeOutcome =
  | { kind: 'merged'; bytes: Uint8Array; conflicts: CardConflict[] }
  | { kind: 'mismatch' }

function sideKey(side: ConflictSide): string {
  return JSON.stringify({
    card: side.card ? cardJson(side.card) : null,
    node: side.node ? nodeJson(side.node) : null,
    edges: side.edges.map((item) => [item.id, item.edge ? edgeJson(item.edge) : null]),
  })
}

// 三方合并：base 是本页上次成功写入的正本，remote 是服务器当前正本，local 是本页画布。
// 两边都改过的卡按 choices 里作者的选择取一边；选择时看到的服务器版本已经变了，或还没选，就先留本页的，并列进 conflicts。
export function mergeDocuments(
  baseBytes: Uint8Array,
  remoteBytes: Uint8Array,
  localBytes: Uint8Array,
  choices: ReadonlyMap<string, ConflictChoiceRecord> = new Map(),
): MergeOutcome {
  const base = parseCompleteDocument(baseBytes)
  const remote = parseCompleteDocument(remoteBytes)
  const local = parseCompleteDocument(localBytes)
  if (!base || !remote || !local) return { kind: 'mismatch' }
  const fileId = base.state.snowflake.fileId
  if (remote.state.snowflake.fileId !== fileId || local.state.snowflake.fileId !== fileId) return { kind: 'mismatch' }
  const cardItems = (state: AppState) => Object.entries(state.snowflake.cards).map(([id, card]) => ({ id, card }))
  const cardBase = cardItems(base.state)
  const cardRemote = cardItems(remote.state)
  const cardLocal = cardItems(local.state)
  const cards = mergeList(cardBase, cardRemote, cardLocal, (item) => item.id, (item) => cardJson(item.card))
  const nodes = mergeList(base.state.canvas.nodes, remote.state.canvas.nodes, local.state.canvas.nodes, (node) => node.id, nodeJson)
  const edges = mergeList(base.state.canvas.edges, remote.state.canvas.edges, local.state.canvas.edges, (edge) => edge.id, edgeJson)

  const edgeUnit = new Map<string, string>()
  for (const [id, item] of edges.conflicts) {
    const edge = item.remote ?? item.local
    if (edge) edgeUnit.set(id, edge.fromNode)
  }
  const units = new Set<string>([...cards.conflicts.keys(), ...nodes.conflicts.keys(), ...edgeUnit.values()])
  const remoteNodes = new Map(remote.state.canvas.nodes.map((node) => [node.id, node]))
  const localNodes = new Map(local.state.canvas.nodes.map((node) => [node.id, node]))
  const conflicts: CardConflict[] = []
  for (const unit of [...units].sort()) {
    const edgeIds = [...edgeUnit.entries()]
      .filter(([, owner]) => owner === unit)
      .map(([id]) => id)
      .sort()
    const server: ConflictSide = {
      card: remote.state.snowflake.cards[unit] ?? null,
      node: remoteNodes.get(unit) ?? null,
      edges: edgeIds.map((id) => ({ id, edge: edges.conflicts.get(id)?.remote ?? null })),
    }
    const serverKey = sideKey(server)
    const choice = choices.get(unit)
    const pick = choice && choice.serverKey === serverKey ? choice.pick : null
    const takeServer = pick === 'server'
    const card = takeServer ? server.card : (local.state.snowflake.cards[unit] ?? null)
    setOrDelete(cards.kept, unit, card ? { id: unit, card } : null)
    setOrDelete(nodes.kept, unit, takeServer ? server.node : localNodes.get(unit))
    for (const id of edgeIds) {
      const item = edges.conflicts.get(id)
      setOrDelete(edges.kept, id, takeServer ? item?.remote : item?.local)
    }
    if (!pick) conflicts.push({ cardId: unit, serverKey, server })
  }

  const mergedCards: AppState['snowflake']['cards'] = {}
  for (const item of orderList(cards.kept, cardBase, cardRemote, cardLocal, (item) => item.id)) {
    mergedCards[item.id] = item.card
  }
  const mergedNodes = orderList(nodes.kept, base.state.canvas.nodes, remote.state.canvas.nodes, local.state.canvas.nodes, (node) => node.id)
  const entities = pickJson(base.state.entities ?? [], remote.state.entities ?? [], local.state.entities ?? [])
  const sediment = pickJson(base.state.sediment ?? [], remote.state.sediment ?? [], local.state.sediment ?? [])
  const chapters = pickJson(base.state.chapters ?? [], remote.state.chapters ?? [], local.state.chapters ?? [])
  const pendingProseScenes = pickJson(
    base.state.pendingProseScenes ?? [],
    remote.state.pendingProseScenes ?? [],
    local.state.pendingProseScenes ?? [],
  )
  const mergedEdges = dropDanglingEdges(
    orderList(edges.kept, base.state.canvas.edges, remote.state.canvas.edges, local.state.canvas.edges, (edge) => edge.id),
    mergedCards,
    endpointIds(entities, chapters),
  )
  return {
    kind: 'merged',
    bytes: documentToBytes({
      canvas: { nodes: mergedNodes, edges: mergedEdges },
      snowflake: { fileId, cards: mergedCards },
      entities,
      sediment,
      chapters,
      pendingProseScenes,
      activeId: local.state.activeId,
    }),
    conflicts,
  }
}

function applyConflictSide(state: AppState, cardId: string, side: ConflictSide): AppState {
  const cards = { ...state.snowflake.cards }
  if (side.card) cards[cardId] = side.card
  else delete cards[cardId]
  let nodes = state.canvas.nodes.filter((node) => node.id !== cardId)
  if (side.node) {
    const at = state.canvas.nodes.findIndex((node) => node.id === cardId)
    nodes = [...nodes]
    nodes.splice(at < 0 ? nodes.length : at, 0, side.node)
  }
  let edges = [...state.canvas.edges]
  for (const item of side.edges) {
    const at = edges.findIndex((edge) => edge.id === item.id)
    if (item.edge) {
      if (at < 0) edges.push(item.edge)
      else edges[at] = item.edge
    } else if (at >= 0) {
      edges.splice(at, 1)
    }
  }
  edges = dropDanglingEdges(edges, cards)
  return { ...state, canvas: { nodes, edges }, snowflake: { ...state.snowflake, cards } }
}

function conflictSummary(card: Card | null | undefined, node: CanvasNode | null | undefined): string {
  if (!card && !node) return '（已删除）'
  const parts = card ? [card.body, ...Object.keys(card.fields).sort().map((key) => card.fields[key] ?? '')] : [node?.text ?? '']
  const text = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (!text) return '（空）'
  const chars = Array.from(text)
  return chars.length > CONFLICT_SUMMARY_LIMIT ? `${chars.slice(0, CONFLICT_SUMMARY_LIMIT).join('')}…` : text
}

function nodePlace(node: CanvasNode | null | undefined): string {
  return node ? `位置 ${Math.round(node.x)},${Math.round(node.y)}` : '无位置'
}

// 只接受不用作者选边就能合并的结果；有两边都改过的卡或正本对不上时返回 null。
function mergeRemoteDocuments(baseBytes: Uint8Array, remoteBytes: Uint8Array, localBytes: Uint8Array): Uint8Array | null {
  const outcome = mergeDocuments(baseBytes, remoteBytes, localBytes)
  return outcome.kind === 'merged' && outcome.conflicts.length === 0 ? outcome.bytes : null
}

export function createMemoryChannel(): ChannelBus {
  const listeners = new Set<(message: ChannelMessage) => void>()
  return {
    post(message) {
      for (const listener of [...listeners]) listener(message)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function idleSnapshot(): PersistSnapshot {
  return {
    state: createDocument('pending'),
    view: {
      canEdit: false,
      writing: false,
      stopped: false,
      fileProtocol: false,
      needPermission: false,
      needChoice: false,
      readonlyOther: false,
      downloadMode: false,
      fileName: CANONICAL_NAME,
      messages: [],
      notices: [],
      otherStartedAt: null,
      logUnavailable: false,
      restoredNotice: false,
      expandNotice: null,
      candidates: [],
      snapshotNames: [],
      snapshotOptions: [],
      canUndo: false,
      remoteVersion: '',
      conflicts: [],
    },
  }
}

function versionFromEtag(etag: string): string {
  let text = etag.trim()
  if (text.startsWith('W/')) text = text.slice(2).trim()
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) text = text.slice(1, -1)
  return text
}

export function snapshotLabel(savedAt: string, name: string): string {
  const date = new Date(savedAt)
  if (!savedAt || Number.isNaN(date.getTime())) return name
  const pad = (value: number) => String(value).padStart(2, '0')
  const shown = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `保存于 ${shown}`
}

export function openDefaultRecoveryLog(): Promise<RecoveryLog> {
  return import('./persist-log.ts').then((mod) => mod.openSahPoolRecoveryLog())
}

export function createPersistController(
  ports: PersistPorts,
  listener: (snapshot: PersistSnapshot) => void = () => {},
): PersistController {
  return new Controller(ports, listener)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredLayer(value: string): boolean {
  return (LAYERS as readonly string[]).includes(value) || value === '人物'
}

function toAppState(value: unknown): AppState | null {
  if (!isRecord(value)) return null
  const canvas = value.canvas
  const snowflake = value.snowflake
  if (!isRecord(canvas) || !isRecord(snowflake)) return null
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) return null
  if (typeof snowflake.fileId !== 'string' || snowflake.fileId.length === 0) return null
  if (!isRecord(snowflake.cards)) return null
  const nodes: CanvasNode[] = []
  for (const node of canvas.nodes) {
    const parsed = parseNode(node)
    if (!parsed) return null
    nodes.push(parsed)
  }
  const edges: CanvasEdge[] = []
  for (const edge of canvas.edges) {
    const parsed = parseEdge(edge)
    if (!parsed) return null
    edges.push(parsed)
  }
  const loose: Record<string, LooseCard> = {}
  for (const [id, card] of Object.entries(snowflake.cards)) {
    const parsed = parseCard(card)
    if (!parsed) return null
    loose[id] = parsed
  }
  const cards = loadCards(loose, edges)
  const parsedEntities = parseEntityList(value.entities)
  const sediment = parseSedimentList(value.sediment)
  const chapters = parseChapterList(value.chapters)
  let state: AppState = {
    canvas: { nodes, edges: migrateEdges(edges, cards) },
    snowflake: { fileId: snowflake.fileId, cards },
    entities: parsedEntities.length > 0 ? parsedEntities : collectPersonEntities(cards),
    sediment,
    chapters,
    pendingProseScenes: parsePendingList(value.pendingProseScenes),
    pendingEntities: parsePendingEntities(value.pendingEntities),
    activeId: null,
  }
  state = mirrorPhilosophy(state)
  state = reconcileProse(state)
  return state
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function parseArc(value: unknown): ArcCells | undefined {
  if (!isRecord(value)) return undefined
  const arc = { start: '', door: '', impact: '', deepen: '', turn: '', consequence: '' }
  let any = false
  for (const key of ARC_KEYS) {
    const cell = value[key]
    if (typeof cell === 'string') {
      arc[key] = cell
      any = true
    }
  }
  return any ? arc : undefined
}

function parseEntityField(value: unknown): EntityField | null {
  if (!isRecord(value) || typeof value.value !== 'string' || !Array.isArray(value.events)) return null
  if (!value.events.every((item) => typeof item === 'string')) return null
  return { value: value.value, events: [...value.events] }
}

function parseEntityList(value: unknown): Entity[] {
  if (!Array.isArray(value)) return []
  const entities: Entity[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) continue
    if (!isEntityType(item.entityType) || typeof item.name !== 'string') continue
    const fields: Record<string, EntityField> = {}
    if (isRecord(item.fields)) {
      for (const [key, field] of Object.entries(item.fields)) {
        if (key === 'philosophy') continue
        const parsed = parseEntityField(field)
        if (parsed) fields[key] = parsed
      }
    }
    const views: Entity['views'] = {}
    if (isRecord(item.views)) {
      if (typeof item.views.renwubiao === 'string') views.renwubiao = item.views.renwubiao
      if (typeof item.views.renwugushi === 'string') views.renwugushi = item.views.renwugushi
      if (typeof item.views.renwudangan === 'string') views.renwudangan = item.views.renwudangan
    }
    entities.push({
      id: item.id,
      entityType: item.entityType,
      name: item.name,
      views,
      fields,
      arc: parseArc(item.arc) ?? { start: '', door: '', impact: '', deepen: '', turn: '', consequence: '' },
      premise: item.premise === true,
    })
  }
  return entities
}

function parseSedimentList(value: unknown): SedimentEvent[] {
  if (!Array.isArray(value)) return []
  const events: SedimentEvent[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || typeof item.requestId !== 'string' || typeof item.ideaId !== 'string') continue
    if (typeof item.at !== 'string' || typeof item.quote !== 'string') continue
    if (typeof item.kind !== 'string' || !(SEDIMENT_KINDS as readonly string[]).includes(item.kind)) continue
    if (typeof item.action !== 'string' || !(SEDIMENT_ACTIONS as readonly string[]).includes(item.action)) continue
    if (typeof item.status !== 'string' || !(SEDIMENT_STATUSES as readonly string[]).includes(item.status)) continue
    if (!isRecord(item.target) || !isEntityType(item.target.entityType)) continue
    if (typeof item.target.entityId !== 'string' || typeof item.target.fieldKey !== 'string') continue
    if (!item.ideaId || !item.requestId) continue
    const event: SedimentEvent = {
      id: item.id,
      requestId: item.requestId,
      kind: item.kind as SedimentEvent['kind'],
      ideaId: item.ideaId,
      at: item.at,
      target: {
        entityType: item.target.entityType,
        entityId: item.target.entityId,
        fieldKey: item.target.fieldKey,
      },
      action: item.action as SedimentEvent['action'],
      quote: item.quote,
      status: item.status as SedimentEvent['status'],
    }
    if (typeof item.sessionId === 'string') event.sessionId = item.sessionId
    if (typeof item.adoptionKey === 'string') event.adoptionKey = item.adoptionKey
    if (item.superseded === true) event.superseded = true
    events.push(event)
  }
  return events
}

function parseChapterList(value: unknown): BookChapter[] {
  if (!Array.isArray(value)) return []
  const chapters: BookChapter[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.length === 0) continue
    const title = typeof item.title === 'string' ? item.title : ''
    const scenes: BookScene[] = []
    if (Array.isArray(item.scenes)) {
      for (const scene of item.scenes) {
        if (!isRecord(scene) || typeof scene.id !== 'string' || scene.id.length === 0) continue
        const next: BookScene = {
          id: scene.id,
          title: typeof scene.title === 'string' ? scene.title : '',
          ideaIds: stringList(scene.ideaIds),
          prose: typeof scene.prose === 'string' ? scene.prose : '',
          beatIds: stringList(scene.beatIds),
        }
        if (typeof scene.placeEntityId === 'string' && scene.placeEntityId.length > 0) next.placeEntityId = scene.placeEntityId
        if (scene.proseFork === true) next.proseFork = true
        scenes.push(next)
      }
    }
    chapters.push({ id: item.id, title, scenes })
  }
  return chapters
}

function parseOriginAnchor(value: unknown): OriginAnchor | undefined {
  if (!isRecord(value) || typeof value.chapterId !== 'string' || value.chapterId.length === 0) return undefined
  const anchor: OriginAnchor = { chapterId: value.chapterId }
  if (typeof value.sceneId === 'string' && value.sceneId.length > 0) anchor.sceneId = value.sceneId
  if (typeof value.charOffset === 'number' && Number.isFinite(value.charOffset)) anchor.charOffset = value.charOffset
  return anchor
}

function parsePendingEntities(value: unknown): PendingEntity[] {
  if (!Array.isArray(value)) return []
  const pending: PendingEntity[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string' || item.name.length === 0) continue
    if (!Array.isArray(item.cardIds) || !item.cardIds.every((id) => typeof id === 'string' && id.length > 0)) continue
    pending.push({ name: item.name, cardIds: [...item.cardIds] })
  }
  return pending
}

function parsePendingList(value: unknown): PendingProseScene[] {
  if (!Array.isArray(value)) return []
  const pending: PendingProseScene[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.cardId !== 'string' || item.cardId.length === 0) continue
    pending.push({ cardId: item.cardId, chapterHint: typeof item.chapterHint === 'string' ? item.chapterHint : '' })
  }
  return pending
}

function parseNode(value: unknown): CanvasNode | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string') return null
  if (value.type !== 'text' && value.type !== 'group') return null
  if (typeof value.x !== 'number' || typeof value.y !== 'number') return null
  if (typeof value.width !== 'number' || typeof value.height !== 'number') return null
  const node: CanvasNode = {
    id: value.id,
    type: value.type,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  }
  if (value.text !== undefined) {
    if (typeof value.text !== 'string') return null
    node.text = value.text
  }
  if (value.color !== undefined) {
    if (typeof value.color !== 'string') return null
    node.color = value.color
  }
  return node
}

function parseEdge(value: unknown): CanvasEdge | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || typeof value.fromNode !== 'string' || typeof value.toNode !== 'string') {
    return null
  }
  const edge: CanvasEdge = { id: value.id, fromNode: value.fromNode, toNode: value.toNode }
  if (value.fromSide !== undefined) {
    if (!isSide(value.fromSide)) return null
    edge.fromSide = value.fromSide
  }
  if (value.toSide !== undefined) {
    if (!isSide(value.toSide)) return null
    edge.toSide = value.toSide
  }
  if (value.fromEnd !== undefined) {
    if (!isEnd(value.fromEnd)) return null
    edge.fromEnd = value.fromEnd
  }
  if (value.toEnd !== undefined) {
    if (!isEnd(value.toEnd)) return null
    edge.toEnd = value.toEnd
  }
  if (value.label !== undefined) {
    if (typeof value.label !== 'string') return null
    edge.label = value.label
  }
  if (value.kind !== undefined && isEdgeKind(value.kind)) edge.kind = value.kind
  if (value.relation !== undefined && isRelationKind(value.relation)) edge.relation = value.relation
  if (value.foreshadow !== undefined && isForeshadowState(value.foreshadow)) edge.foreshadow = value.foreshadow
  if (isRecord(value.derivedFrom) && typeof value.derivedFrom.sessionId === 'string' && typeof value.derivedFrom.adoptionKey === 'string') {
    edge.derivedFrom = { sessionId: value.derivedFrom.sessionId, adoptionKey: value.derivedFrom.adoptionKey }
  }
  if (Array.isArray(value.sedimentEvents) && value.sedimentEvents.every((item) => typeof item === 'string')) {
    edge.sedimentEvents = [...value.sedimentEvents]
  }
  return edge
}

function isSide(value: unknown): value is CanvasEdge['fromSide'] {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left'
}

function isEnd(value: unknown): value is CanvasEdge['fromEnd'] {
  return value === 'none' || value === 'arrow'
}

function parseCard(value: unknown): LooseCard | null {
  if (!isRecord(value) || typeof value.layer !== 'string') return null
  const known = isStoredLayer(value.layer)
  if (known && (typeof value.body !== 'string' || !isRecord(value.fields))) return null
  const body = typeof value.body === 'string' ? value.body : ''
  const fields: Record<string, string> = {}
  if (isRecord(value.fields)) {
    for (const [key, field] of Object.entries(value.fields)) {
      if (typeof field !== 'string') {
        if (known) return null
        continue
      }
      fields[key] = field
    }
  } else if (value.fields !== undefined && known) {
    return null
  }
  const card: LooseCard = { layer: value.layer, body, fields }
  if (typeof value.mergeNote === 'string' && value.mergeNote.length > 0) card.mergeNote = value.mergeNote
  if (value.premise === true) card.premise = true
  if (typeof value.derivedFrom === 'string' && value.derivedFrom.length > 0) card.derivedFrom = value.derivedFrom
  const arc = parseArc(value.arc)
  if (arc) card.arc = arc
  const originAnchor = parseOriginAnchor(value.originAnchor)
  if (originAnchor) card.originAnchor = originAnchor
  return card
}

function peekFileId(bytes: Uint8Array | null): string | null {
  if (!bytes) return null
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const match = text.match(/"fileId"\s*:\s*"([^"\\]+)"/)
  return match?.[1] ?? null
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'AbortError'
}

class Controller implements PersistController {
  private state: AppState
  private directory: DirectoryAccess | null = null
  private log: RecoveryLog | null = null
  private logTried = false
  private lock: LockHandle | null = null
  private unsub: (() => void) | null = null
  private fileName = CANONICAL_NAME
  private fileId = ''
  private startedAt = ''
  private otherStartedAt: string | null = null
  private lastBytes: Uint8Array | null = null
  private downloadMode = false
  private lastSaveAsAt: number | null = null
  private saveAsHeld = false
  private saveAsTimer: ReturnType<typeof setTimeout> | null = null
  private fileProtocol = false
  private needChoice = false
  private needPermission = false
  private readonlyOther = false
  private lockUnsupported = false
  private showWritingMessage = false
  private writing = false
  private canEdit = false
  private queueRun: Promise<void> | null = null
  private queueDirty = false
  private queueWaiters: Array<() => void> = []
  private stopped = false
  private failed = false
  private retrying = false
  private logUnavailable = false
  private restoredNotice = false
  private expandNotice: string | null = null
  private candidates: ShownCandidate[] = []
  private snapshotNames: string[] = []
  private remoteSnapshots: Array<{ name: string; savedAt: string }> = []
  private undoStack: AppState[] = []
  private remoteMode = false
  private remoteEtag = ''
  // 两边都改过、还等作者选边的卡。非空时本页只改内存，不发写请求。
  private readonly pendingConflicts = new Map<string, CardConflict>()
  // 作者已经选过的边，带着选择时看到的服务器版本；下一次写成功后清空。
  private readonly conflictChoices = new Map<string, ConflictChoiceRecord>()
  private canonMismatch = false
  private switchHold = false
  private actionNotice: string | null = null
  private readonly issuedSnapshotNames = new Set<string>()
  private disposed = false
  private started = false
  private readonly ports: PersistPorts
  private readonly listener: (snapshot: PersistSnapshot) => void

  constructor(ports: PersistPorts, listener: (snapshot: PersistSnapshot) => void) {
    this.ports = ports
    this.listener = listener
    this.state = createDocument('pending')
  }

  snapshot(): PersistSnapshot {
    return { state: this.state, view: this.view() }
  }

  async readRecoveryLog(): Promise<Uint8Array | null> {
    if (!this.log) return null
    try {
      const bytes = await this.log.read()
      return bytes ? bytes.slice() : null
    } catch {
      return null
    }
  }

  // 切换书之前：先停收新改动，再等写入队列走完。内存里的画布和最后写进去的那份不一致
  // （写失败、版本冲突没选边）就放开编辑并返回 false，不许切走。
  async holdForSwitch(): Promise<boolean> {
    this.switchHold = true
    this.emit()
    await this.drainQueue()
    if (this.pendingConflicts.size === 0 && this.savedMatchesState()) return true
    this.releaseHold()
    return false
  }

  releaseHold(): void {
    if (!this.switchHold) return
    this.switchHold = false
    this.emit()
  }

  private savedMatchesState(): boolean {
    if (!this.lastBytes) return true
    const saved = parseCompleteDocument(this.lastBytes)
    return saved !== null && bytesEqual(documentToBytes(saved.state), documentToBytes(this.state))
  }

  dispose(): void {
    this.disposed = true
    if (this.saveAsTimer !== null) clearTimeout(this.saveAsTimer)
    this.saveAsTimer = null
    this.unsub?.()
    this.unsub = null
    this.lock?.release()
    this.lock = null
    const closing = this.log
    this.log = null
    void closing?.close?.()
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.watchChannel()
    if (this.ports.protocol === 'file:') {
      this.enterFileProtocol()
      return
    }
    if (await this.openRemote()) return
    this.downloadMode = !this.ports.hasDirectoryPicker
    if (!this.ports.hasDirectoryPicker) {
      this.needChoice = true
      this.canEdit = false
      this.emit()
      return
    }
    await this.refresh()
  }

  async refresh(): Promise<void> {
    if (this.ports.protocol === 'file:') {
      this.enterFileProtocol()
      return
    }
    if (!this.ports.hasDirectoryPicker) {
      this.downloadMode = true
      this.needChoice = this.fileId.length === 0
      this.canEdit = false
      this.emit()
      return
    }
    const directory = await this.ports.loadDirectory()
    if (!directory) {
      this.directory = null
      this.needChoice = true
      this.needPermission = false
      this.canEdit = false
      this.emit()
      return
    }
    this.directory = directory
    this.downloadMode = false
    const permission = await this.ports.queryPermission()
    if (permission !== 'granted') {
      this.needPermission = true
      this.needChoice = false
      this.canEdit = false
      this.emit()
      return
    }
    this.needPermission = false
    this.needChoice = false
    await this.openDirectory('refresh')
  }

  // 讨论沉淀写在服务器上。这里把服务器上的这一版再读回来，不在页面上先改一版假成功。
  async reloadRemote(): Promise<void> {
    if (!this.remoteMode || !this.ports.remote) return
    if (this.writing || this.queueDirty) return
    let loaded: { etag: string; bytes: Uint8Array } | null
    try {
      loaded = await this.ports.remote.load()
    } catch {
      return
    }
    if (!loaded || this.writing || this.queueDirty) return
    const parsed = parseCompleteDocument(loaded.bytes)
    if (!parsed) return
    this.remoteEtag = loaded.etag
    this.lastBytes = parsed.bytes
    this.state = { ...parsed.state, activeId: this.state.activeId }
    this.emit()
  }

  async selectDirectory(): Promise<void> {
    if (this.fileProtocol) return
    if (!this.ports.hasDirectoryPicker) {
      await this.firstDownload()
      return
    }
    let picked: DirectoryAccess | 'abort'
    try {
      picked = await this.ports.pickDirectory()
    } catch (error) {
      if (isAbort(error)) {
        this.stopFailed()
        return
      }
      this.stopFailed()
      return
    }
    if (picked === 'abort') {
      this.stopFailed()
      return
    }
    this.directory = picked
    this.downloadMode = false
    this.needChoice = false
    this.needPermission = false
    this.failed = false
    this.stopped = false
    await this.openDirectory('pick')
  }

  async requestPermission(): Promise<void> {
    if (this.fileProtocol) return
    let permission: PermissionWord
    try {
      permission = await this.ports.requestPermission()
    } catch (error) {
      if (isAbort(error)) {
        this.stopFailed()
        return
      }
      this.stopFailed()
      return
    }
    if (permission !== 'granted') {
      this.stopFailed()
      return
    }
    this.needPermission = false
    const directory = this.directory ?? (await this.ports.loadDirectory())
    if (!directory) {
      this.stopFailed()
      return
    }
    this.directory = directory
    this.downloadMode = false
    this.failed = false
    this.stopped = false
    await this.openDirectory('refresh')
  }

  async claimWrite(): Promise<void> {
    if (this.fileProtocol || !this.fileId || this.lock) return
    const acquired = await this.tryBecomeWriter(this.fileId, 'claim-button')
    if (!acquired) {
      this.emit()
      return
    }
    await this.ensureLog()
    if (this.lastBytes) await this.syncLog(this.lastBytes)
    this.readonlyOther = false
    this.showWritingMessage = false
    this.stopped = false
    this.failed = false
    this.canEdit = true
    this.emit()
  }

  async openLocalFile(bytes: Uint8Array, name: string): Promise<void> {
    if (this.fileProtocol) return
    this.downloadMode = true
    this.directory = null
    this.fileName = name.trim() || CANONICAL_NAME
    const parsed = parseCompleteDocument(bytes)
    if (!parsed) {
      await this.recoverWithoutDirectory()
      return
    }
    const acquired = await this.tryBecomeWriter(parsed.state.snowflake.fileId, 'open-file')
    this.undoStack = []
    this.state = { ...parsed.state, activeId: this.state.activeId }
    this.lastBytes = parsed.bytes
    this.needChoice = false
    if (!acquired) {
      this.emit()
      return
    }
    await this.ensureLog()
    await this.syncLog(parsed.bytes)
    this.failed = false
    this.stopped = false
    this.canEdit = true
    this.readonlyOther = false
    this.emit()
  }

  async commitText(cardId: string, fieldKey: string | null, text: string): Promise<void> {
    await this.applyText(cardId, fieldKey, text, true)
  }

  private async applyText(cardId: string, fieldKey: string | null, text: string, fromEditor: boolean): Promise<void> {
    if (!this.acceptsEdits()) return
    const next = commitCardText(this.state, cardId, text, fieldKey, false)
    if (next === this.state) return
    if (fromEditor) {
      writeSeq += 1
      writeSeqByState.set(next, writeSeq)
    }
    await this.persistState(next)
  }

  async mutate(recipe: (state: AppState) => AppState, options?: { undoable?: boolean }): Promise<void> {
    if (!this.acceptsEdits()) return
    const before = this.state
    const next = recipe(before)
    if (next === before) return
    if (options?.undoable) {
      this.undoStack.push(before)
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.splice(0, this.undoStack.length - UNDO_LIMIT)
    }
    await this.persistState(next)
  }

  // 撤销只换内存里的画布，再走同一条写入队列；没有重做。
  async undo(): Promise<void> {
    if (!this.acceptsEdits()) return
    const previous = this.undoStack.pop()
    if (!previous) return
    if (previous.snowflake.fileId !== this.state.snowflake.fileId) {
      this.undoStack = []
      this.emit()
      return
    }
    const active = this.state.activeId
    await this.persistState({
      ...previous,
      activeId: active && previous.canvas.nodes.some((node) => node.id === active) ? active : previous.activeId,
    })
  }

  select(id: string | null): void {
    if (this.state.activeId === id) return
    this.state = { ...this.state, activeId: id }
    this.emit()
  }

  async editorComposition(
    session: ComposeSession,
    event: CompositionEvent,
    fieldKey: string | null,
  ): Promise<ComposeSession> {
    if (!this.acceptsEdits()) return session
    const next = applyComposition(this.state, session, event, fieldKey)
    if (event.type !== 'compositionend') return next.session
    await this.persistState(next.state)
    return next.session
  }

  private editingAllowed(): boolean {
    return (
      this.canEdit &&
      !this.stopped &&
      !this.failed &&
      !this.fileProtocol &&
      !this.readonlyOther &&
      !this.needPermission &&
      !this.canonMismatch
    )
  }

  // 切书等待期间不收新改动；已经排进写入队列的改动照常写完。
  private acceptsEdits(): boolean {
    return this.editingAllowed() && !this.switchHold
  }

  async resolveCardConflict(cardId: string, pick: ConflictPick): Promise<void> {
    const entry = this.pendingConflicts.get(cardId)
    if (!entry || !this.acceptsEdits()) return
    this.conflictChoices.set(cardId, { pick, serverKey: entry.serverKey })
    this.pendingConflicts.delete(cardId)
    if (pick === 'server') {
      this.undoStack = []
      this.state = applyConflictSide(this.state, cardId, entry.server)
    }
    if (this.pendingConflicts.size > 0) {
      this.emit()
      return
    }
    await this.persistState(this.state)
  }

  private writerHeld(): boolean {
    return Boolean(this.lock) || this.lockUnsupported
  }

  private enterFileProtocol(): void {
    this.fileProtocol = true
    this.downloadMode = false
    this.canEdit = false
    this.needChoice = false
    this.emit()
  }

  private newId(): string {
    return this.ports.randomId?.() ?? globalThis.crypto.randomUUID()
  }

  private watchChannel(): void {
    if (this.unsub) return
    this.unsub = this.ports.channel.subscribe((message) => {
      if (message.type === 'hello') {
        if (this.lock && message.fileId === this.fileId && this.startedAt) {
          this.ports.channel.post({
            type: 'writing',
            fileId: this.fileId,
            fileName: this.fileName,
            startedAt: this.startedAt,
          })
        }
        return
      }
      if (message.type === 'writing' && this.readonlyOther && message.fileId === this.fileId) {
        this.otherStartedAt = message.startedAt
        if (message.fileName) this.fileName = message.fileName
        this.showWritingMessage = true
        this.emit()
      }
    })
  }

  private noticeOtherWriter(fileId: string): Promise<Extract<ChannelMessage, { type: 'writing' }> | null> {
    this.watchChannel()
    return new Promise((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (message: Extract<ChannelMessage, { type: 'writing' }> | null) => {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        stop()
        resolve(message)
      }
      const stop = this.ports.channel.subscribe((message) => {
        if (message.type === 'writing' && message.fileId === fileId) finish(message)
      })
      this.ports.channel.post({ type: 'hello', fileId })
      if (!settled) timer = setTimeout(() => finish(null), 200)
    })
  }

  private async tryBecomeWriter(fileId: string, reason: OpenReason): Promise<boolean> {
    if (reason === 'open-file') {
      const other = await this.noticeOtherWriter(fileId)
      if (other) {
        this.fileId = fileId
        this.readonlyOther = true
        this.canEdit = false
        this.showWritingMessage = true
        this.otherStartedAt = other.startedAt
        if (other.fileName) this.fileName = other.fileName
        this.watchChannel()
        return false
      }
    }
    const lockName = `snowflake-write:${fileId}`
    const refreshClaim = reason === 'refresh' && this.ports.claim.get() === fileId
    const explicit =
      reason === 'pick' || reason === 'claim-button' || reason === 'download' || reason === 'open-file'
    if (!refreshClaim && !explicit) {
      this.fileId = fileId
      const held = await this.ports.lockHeld(lockName)
      this.readonlyOther = true
      this.canEdit = false
      this.showWritingMessage = held
      this.watchChannel()
      if (held) this.ports.channel.post({ type: 'hello', fileId })
      return false
    }
    if (this.lock && this.fileId === fileId) return true
    if (this.lock) {
      this.lock.release()
      this.lock = null
    }
    const handle = await this.ports.tryAcquireLock(lockName)
    this.fileId = fileId
    if (handle === 'unsupported') {
      this.lockUnsupported = true
      this.lock = null
      this.readonlyOther = false
      this.canEdit = true
      this.showWritingMessage = false
      this.otherStartedAt = null
      this.ports.claim.set(fileId)
      this.startedAt = formatLocalStart(this.ports.now())
      this.watchChannel()
      return true
    }
    this.lockUnsupported = false
    if (!handle) {
      this.readonlyOther = true
      this.canEdit = false
      this.showWritingMessage = true
      this.watchChannel()
      this.ports.channel.post({ type: 'hello', fileId })
      return false
    }
    this.lock = handle
    this.readonlyOther = false
    this.showWritingMessage = false
    this.otherStartedAt = null
    this.ports.claim.set(fileId)
    this.startedAt = formatLocalStart(this.ports.now())
    this.watchChannel()
    this.ports.channel.post({
      type: 'writing',
      fileId,
      fileName: this.fileName,
      startedAt: this.startedAt,
    })
    return true
  }

  private async ensureLog(): Promise<void> {
    if (this.logTried || !this.writerHeld()) return
    this.logTried = true
    try {
      this.log = await this.ports.logFactory()
    } catch {
      this.log = null
      this.logUnavailable = true
    }
  }

  private async ensureLogForRecovery(): Promise<void> {
    if (this.logTried) return
    this.logTried = true
    try {
      this.log = await this.ports.logFactory()
    } catch {
      this.log = null
      this.logUnavailable = true
    }
  }

  private async closeLog(): Promise<void> {
    const current = this.log
    this.log = null
    this.logTried = false
    try {
      await current?.close?.()
    } catch {
      // 关掉失败的日志句柄不影响正本。
    }
  }

  private async readLogParsed(): Promise<{ bytes: Uint8Array; state: AppState } | null> {
    if (!this.log) return null
    try {
      const bytes = await this.log.read()
      if (!bytes) return null
      return parseCompleteDocument(bytes)
    } catch {
      this.logUnavailable = true
      this.log = null
      return null
    }
  }

  private async syncLog(canonicalBytes: Uint8Array): Promise<void> {
    if (!this.log) return
    try {
      const existing = await this.log.read()
      if (existing && bytesEqual(existing, canonicalBytes)) return
      await this.log.write(canonicalBytes.slice())
    } catch {
      this.logUnavailable = true
      this.log = null
    }
  }

  private async appendLog(bytes: Uint8Array): Promise<boolean> {
    if (!this.log) {
      if (this.logTried) this.logUnavailable = true
      return false
    }
    try {
      await this.log.write(bytes.slice())
      return true
    } catch {
      this.logUnavailable = true
      this.log = null
      return false
    }
  }

  private async removeQuiet(name: string): Promise<void> {
    if (!this.directory) return
    try {
      await this.directory.remove(name)
    } catch {
      // 临时文件已经不在，忽略。
    }
  }

  private async deleteTempIfPresent(): Promise<void> {
    if (!this.directory) return
    const name = tempNameFor(this.fileName)
    const existing = await this.directory.read(name)
    if (existing) await this.removeQuiet(name)
  }

  private async openRemote(): Promise<boolean> {
    if (!this.ports.remote) return false
    let loaded: { etag: string; bytes: Uint8Array } | null
    try {
      loaded = await this.ports.remote.load()
    } catch {
      return false
    }
    if (!loaded) return false
    const parsed = parseCompleteDocument(loaded.bytes)
    if (!parsed) return false
    this.remoteMode = true
    this.remoteEtag = loaded.etag
    this.undoStack = []
    this.state = parsed.state
    this.lastBytes = parsed.bytes
    this.fileId = parsed.state.snowflake.fileId
    this.fileName = CANONICAL_NAME
    this.downloadMode = false
    this.needChoice = false
    this.needPermission = false
    this.readonlyOther = false
    this.failed = false
    this.stopped = false
    this.canEdit = true
    this.emit()
    await this.refreshRemoteSnapshots()
    this.emit()
    return true
  }

  // remoteEtag 与 lastBytes 只在服务器接受写入时一起前进。412 之后两者都停在上次成功写入的那一版，
  // 只把合并结果带着服务器刚给的版本号重发；合并不了就交给作者选边，不重发冲突前的旧画布。
  private async writeRemote(bytes: Uint8Array): Promise<WriteResult> {
    const remote = this.ports.remote
    if (!remote) return { ok: false }
    try {
      let sending = bytes
      let base = this.lastBytes
      let saved = await remote.save(sending, this.remoteEtag)
      for (let round = 0; ; round += 1) {
        if (saved.ok) {
          this.remoteEtag = saved.etag
          this.lastBytes = sending.slice()
          this.conflictChoices.clear()
          return { ok: true, logged: true, bytes: sending, merged: sending !== bytes }
        }
        if (!saved.conflict || !saved.etag) return { ok: false }
        if (!saved.bytes || !base || round >= REMOTE_MERGE_ROUNDS) {
          return { ok: false, conflict: true, pending: [], provisional: null }
        }
        const outcome = mergeDocuments(base, saved.bytes, sending, this.conflictChoices)
        if (outcome.kind === 'mismatch') return { ok: false, mismatch: true }
        if (outcome.conflicts.length > 0) {
          return { ok: false, conflict: true, pending: outcome.conflicts, provisional: outcome.bytes }
        }
        base = saved.bytes
        sending = outcome.bytes
        saved = await remote.save(sending, saved.etag)
      }
    } catch {
      return { ok: false }
    }
  }

  private async writeExact(bytes: Uint8Array): Promise<WriteResult> {
    if (this.remoteMode && this.ports.remote) return this.writeRemote(bytes)
    if (this.downloadMode || !this.directory) {
      this.lastSaveAsAt = this.ports.now().getTime()
      this.saveAsHeld = false
      const accepted = await this.ports.askSaveAs(this.fileName, bytes)
      if (!accepted) return { ok: false }
      const logged = await this.appendLog(bytes)
      this.lastBytes = bytes.slice()
      return { ok: true, logged, bytes }
    }
    const tempName = tempNameFor(this.fileName)
    let verified: Uint8Array
    try {
      await this.directory.writeTemp(tempName, bytes)
      const back = await this.directory.read(tempName)
      if (!back || !parseCompleteDocument(back)) {
        await this.removeQuiet(tempName)
        return { ok: false }
      }
      verified = back
      await this.ports.pauseBeforeMove?.()
      await this.directory.move(tempName, this.fileName)
      await this.ports.pauseAfterMove?.()
    } catch {
      await this.removeQuiet(tempName)
      return { ok: false }
    }
    const logged = await this.appendLog(verified)
    this.lastBytes = verified.slice()
    return { ok: true, logged, bytes: verified }
  }

  // 同一标签的所有写入走这一条队列：同一时间只有一个写请求在路上；
  // 排队期间的多次改动只记在内存里，轮到时按最后一份画布发一次。
  private persistState(next: AppState): Promise<void> {
    this.actionNotice = null
    this.state = next
    if (this.pendingConflicts.size > 0) {
      this.emit()
      return Promise.resolve()
    }
    this.queueDirty = true
    this.writing = true
    this.emit()
    const done = new Promise<void>((resolve) => this.queueWaiters.push(resolve))
    if (!this.queueRun) this.queueRun = this.runQueue()
    return done
  }

  private async runQueue(): Promise<void> {
    try {
      while (this.queueDirty && !this.disposed) {
        this.queueDirty = false
        const waiters = this.queueWaiters
        this.queueWaiters = []
        const keepGoing =
          this.editingAllowed() && this.pendingConflicts.size === 0 ? await this.writeOnce(this.state) : false
        for (const resolve of waiters) resolve()
        if (!keepGoing) {
          this.queueDirty = false
          break
        }
      }
    } finally {
      this.queueRun = null
      this.writing = false
      const rest = this.queueWaiters
      this.queueWaiters = []
      for (const resolve of rest) resolve()
      this.emit()
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.queueRun) await this.queueRun
  }

  private saveAsOnly(): boolean {
    if (this.remoteMode && this.ports.remote) return false
    return this.downloadMode || !this.directory
  }

  // 另存模式下自动保存不每次弹下载：距上次弹出不足 SAVE_AS_INTERVAL_MS 时只记恢复日志，
  // 到点再按最新画布弹一次。作者主动的打开正本、回退、留下这一版不走这里。
  private holdSaveAs(bytes: Uint8Array, last: number): Promise<boolean> {
    this.saveAsHeld = true
    if (this.saveAsTimer === null) {
      const wait = Math.max(0, last + SAVE_AS_INTERVAL_MS - this.ports.now().getTime())
      this.saveAsTimer = setTimeout(() => {
        this.saveAsTimer = null
        if (this.disposed || !this.saveAsHeld || !this.saveAsOnly()) return
        this.queueDirty = true
        this.writing = true
        this.emit()
        if (!this.queueRun) this.queueRun = this.runQueue()
      }, wait)
    }
    return this.appendLog(bytes).then((logged) => {
      this.lastBytes = bytes.slice()
      if (!logged) this.logUnavailable = true
      this.failed = false
      this.stopped = false
      this.canEdit = true
      this.emit()
      return true
    })
  }

  private async writeOnce(sent: AppState): Promise<boolean> {
    const bytes = documentToBytes(sent)
    const last = this.lastSaveAsAt
    if (this.saveAsOnly() && last !== null && this.ports.now().getTime() - last < SAVE_AS_INTERVAL_MS) {
      return this.holdSaveAs(bytes, last)
    }
    const result = await this.writeExact(bytes)
    if (this.disposed) return false
    if (!result.ok) {
      if ('mismatch' in result && result.mismatch) {
        this.canonMismatch = true
        this.stopped = true
        this.canEdit = false
        this.emit()
        return false
      }
      if ('conflict' in result && result.conflict) {
        this.takeConflict(sent, bytes, result.pending, result.provisional)
        if (this.pendingConflicts.size === 0) this.actionNotice = MSG_VERSION_MOVED
        this.failed = false
        this.stopped = false
        this.canEdit = true
        this.emit()
        return false
      }
      this.failed = true
      this.stopped = true
      this.canEdit = false
      this.emit()
      return false
    }
    if (result.merged) this.takeMerged(sent, bytes, result.bytes)
    this.failed = false
    this.stopped = false
    this.canEdit = true
    if (!result.logged) this.logUnavailable = true
    this.emit()
    return true
  }

  private takeMerged(sent: AppState, sentBytes: Uint8Array, merged: Uint8Array): void {
    // 合进了别处的改动，旧的撤销步骤会把它们一起抹掉。
    this.undoStack = []
    if (this.state === sent) {
      const parsed = parseCompleteDocument(merged)
      if (parsed) this.state = { ...parsed.state, activeId: this.state.activeId }
      return
    }
    // 请求在路上时本页又改了画布：把这些新改动叠到合并结果上，留给队列下一轮发出。
    // 服务器那边也改过的卡交给作者选边。
    const again = mergeDocuments(sentBytes, merged, documentToBytes(this.state))
    if (again.kind !== 'merged') return
    const parsed = parseCompleteDocument(again.bytes)
    if (parsed) this.state = { ...parsed.state, activeId: this.state.activeId }
    for (const conflict of again.conflicts) this.pendingConflicts.set(conflict.cardId, conflict)
  }

  private takeConflict(
    sent: AppState,
    sentBytes: Uint8Array,
    pending: CardConflict[],
    provisional: Uint8Array | null,
  ): void {
    this.pendingConflicts.clear()
    for (const conflict of pending) this.pendingConflicts.set(conflict.cardId, conflict)
    if (!provisional) return
    // 合进了别处的改动，旧的撤销步骤会把它们一起抹掉。
    this.undoStack = []
    let next = provisional
    if (this.state !== sent) {
      const again = mergeDocuments(sentBytes, provisional, documentToBytes(this.state))
      if (again.kind === 'merged') {
        next = again.bytes
        for (const conflict of again.conflicts) {
          if (!this.pendingConflicts.has(conflict.cardId)) this.pendingConflicts.set(conflict.cardId, conflict)
        }
      }
    }
    const parsed = parseCompleteDocument(next)
    if (parsed) this.state = { ...parsed.state, activeId: this.state.activeId }
  }

  private async openDirectory(reason: OpenReason): Promise<void> {
    try {
      await this.openDirectoryInner(reason)
    } catch {
      this.stopFailed()
    }
  }

  private async openDirectoryInner(reason: OpenReason): Promise<void> {
    if (!this.directory) return
    this.fileName = CANONICAL_NAME
    const raw = await this.directory.read(this.fileName)
    if (!raw) {
      if (reason !== 'pick') {
        this.canEdit = false
        this.needChoice = true
        this.emit()
        return
      }
      await this.createNew(reason)
      return
    }
    const parsed = parseCompleteDocument(raw)
    if (!parsed) {
      await this.recoverCorrupt(reason)
      return
    }
    const acquired = await this.tryBecomeWriter(parsed.state.snowflake.fileId, reason)
    this.undoStack = []
    this.state = parsed.state
    this.lastBytes = parsed.bytes
    this.needChoice = false
    if (!acquired) {
      if (!this.showWritingMessage) await this.deleteTempIfPresent()
      await this.refreshSnapshotNames()
      this.emit()
      return
    }
    await this.ensureLog()
    await this.deleteTempIfPresent()
    await this.syncLog(parsed.bytes)
    this.canEdit = true
    this.stopped = false
    this.failed = false
    this.readonlyOther = false
    await this.refreshSnapshotNames()
    this.emit()
  }

  private async createNew(reason: OpenReason): Promise<void> {
    const fresh = createDocument(this.newId())
    const acquired = await this.tryBecomeWriter(fresh.snowflake.fileId, reason)
    this.state = fresh
    this.needChoice = false
    if (!acquired) {
      this.emit()
      return
    }
    await this.deleteTempIfPresent()
    await this.ensureLog()
    const bytes = documentToBytes(fresh)
    const result = await this.writeExact(bytes)
    if (!result.ok) {
      this.stopFailed()
      return
    }
    this.canEdit = true
    this.failed = false
    this.stopped = false
    if (!result.logged) this.logUnavailable = true
    this.emit()
  }

  private async recoverCorrupt(reason: OpenReason): Promise<void> {
    if (!this.directory) return
    const raw = await this.directory.read(this.fileName)
    const peeked = peekFileId(raw)
    const claimedId = reason === 'refresh' ? this.ports.claim.get() : null
    const hinted = peeked || claimedId
    if (hinted) {
      const acquired = await this.tryBecomeWriter(hinted, reason)
      if (!acquired) {
        this.stopFailed()
        return
      }
      await this.ensureLog()
    } else if (reason === 'pick' || reason === 'open-file') {
      await this.ensureLogForRecovery()
    } else {
      this.stopFailed()
      return
    }
    const logged = await this.readLogParsed()
    if (!this.writerHeld() && logged) {
      const acquired = await this.tryBecomeWriter(logged.state.snowflake.fileId, reason)
      if (!acquired) {
        await this.closeLog()
        this.stopFailed()
        return
      }
    }
    if (!this.writerHeld()) {
      this.stopFailed()
      return
    }
    await this.deleteTempIfPresent()
    if (!logged) {
      this.stopFailed()
      return
    }
    const result = await this.writeExact(logged.bytes)
    this.undoStack = []
    this.state = logged.state
    this.fileId = logged.state.snowflake.fileId
    this.lastBytes = result.ok ? result.bytes : logged.bytes
    if (!result.ok) {
      this.restoredNotice = false
      this.stopFailed()
      return
    }
    this.restoredNotice = true
    this.failed = false
    this.stopped = false
    this.canEdit = true
    this.readonlyOther = false
    this.needChoice = false
    if (!result.logged) this.logUnavailable = true
    this.emit()
  }

  private async recoverWithoutDirectory(): Promise<void> {
    await this.ensureLogForRecovery()
    const logged = await this.readLogParsed()
    if (!logged) {
      this.stopFailed()
      return
    }
    const acquired = await this.tryBecomeWriter(logged.state.snowflake.fileId, 'open-file')
    this.undoStack = []
    this.state = logged.state
    if (!acquired) {
      await this.closeLog()
      this.stopFailed()
      return
    }
    const accepted = await this.ports.askSaveAs(this.fileName, logged.bytes)
    if (!accepted) {
      this.restoredNotice = false
      this.stopFailed()
      return
    }
    const loggedAgain = await this.appendLog(logged.bytes)
    this.lastBytes = logged.bytes
    this.restoredNotice = true
    this.failed = false
    this.stopped = false
    this.canEdit = true
    this.needChoice = false
    if (!loggedAgain) this.logUnavailable = true
    this.emit()
  }

  private async firstDownload(): Promise<void> {
    const fresh = createDocument(this.newId())
    this.fileName = CANONICAL_NAME
    this.downloadMode = true
    this.directory = null
    const acquired = await this.tryBecomeWriter(fresh.snowflake.fileId, 'download')
    this.state = fresh
    if (!acquired) {
      this.emit()
      return
    }
    await this.ensureLog()
    const bytes = documentToBytes(fresh)
    const accepted = await this.ports.askFirstDownload(this.fileName, bytes)
    if (!accepted) {
      this.stopFailed()
      return
    }
    const logged = await this.appendLog(bytes)
    this.lastBytes = bytes.slice()
    this.needChoice = false
    this.failed = false
    this.stopped = false
    this.canEdit = true
    if (!logged) this.logUnavailable = true
    this.emit()
  }

  private stopFailed(): void {
    this.failed = true
    this.stopped = true
    this.canEdit = false
    this.writing = false
    this.emit()
  }

  private emit(): void {
    if (this.disposed) return
    this.listener(this.snapshot())
  }


  async requestCandidates(cardId: string, fieldKey: string | null): Promise<void> {
    const request = buildExpandRequest(this.state, cardId, fieldKey)
    if (!request) {
      this.expandNotice = MSG_EXPAND_NO_CARD
      this.candidates = []
      this.emit()
      return
    }
    const extra = this.ports.expand
    const result = await requestExpandCandidates(request, {
      baseURL: extra?.baseURL,
      apiKey: extra?.apiKey,
      fetch: extra?.fetch,
      connect: extra?.connect,
      maxTokens: extra?.maxTokens,
    })
    if (this.disposed) return
    if (!result.ok || !this.state.snowflake.cards[cardId]) {
      this.expandNotice = result.ok ? MSG_EXPAND_NO_CARD : result.reason
      this.candidates = []
      this.emit()
      return
    }
    this.expandNotice = null
    this.candidates = result.candidates.map((item) => ({
      id: item.id,
      text: item.text,
      cardId,
      fieldKey,
    }))
    this.emit()
  }

  dismissCandidates(): void {
    if (this.candidates.length === 0) return
    this.candidates = []
    this.expandNotice = null
    this.emit()
  }

  async confirmCandidate(candidateId: string): Promise<void> {
    const found = this.candidates.find((item) => item.id === candidateId)
    if (!found) return
    const { cardId, fieldKey, text } = found
    this.candidates = []
    this.expandNotice = null
    this.emit()
    await this.applyText(cardId, fieldKey, text, false)
  }

  async keepVersion(): Promise<void> {
    await this.drainQueue()
    if (this.pendingConflicts.size > 0) return
    if (this.remoteMode && this.ports.remote) {
      if (!this.acceptsEdits()) return
      const result = await this.ports.remote.keep(this.remoteEtag)
      if (!result.ok) {
        this.actionNotice = result.message
        this.emit()
        return
      }
      this.remoteEtag = result.etag
      this.actionNotice =
        result.timeline === 'skipped'
          ? `已留下这一版，快照 ${result.snapshotCount} 份。${MSG_TIMELINE_SKIPPED}`
          : `已留下这一版，快照 ${result.snapshotCount} 份`
      await this.refreshRemoteSnapshots()
      this.emit()
      return
    }
    if (!this.writerHeld() || !this.acceptsEdits()) return
    const bytes = await this.currentCanonicalBytes()
    if (!bytes) return
    const kept = await this.copySnapshot(bytes)
    if (!kept) return
    await this.refreshSnapshotNames()
    this.emit()
  }

  private async refreshRemoteSnapshots(): Promise<void> {
    const list = this.ports.remote?.listSnapshots
    if (!this.remoteMode || !list) {
      this.remoteSnapshots = []
      return
    }
    try {
      this.remoteSnapshots = (await list()) ?? []
    } catch {
      this.remoteSnapshots = []
    }
  }

  // 服务器先把当前画布另存一份快照，再换正本；这里只接回服务器给的结果。
  private async rollbackRemote(name: string): Promise<void> {
    const rollback = this.ports.remote?.rollback
    if (!rollback || !this.acceptsEdits()) return
    await this.drainQueue()
    if (!this.acceptsEdits() || this.pendingConflicts.size > 0) return
    this.writing = true
    this.canEdit = false
    this.actionNotice = null
    this.emit()
    let result: Awaited<ReturnType<typeof rollback>>
    try {
      result = await rollback(name, this.remoteEtag)
    } catch {
      result = { ok: false, conflict: false, message: '回退失败' }
    }
    this.writing = false
    this.canEdit = true
    if (this.disposed) return
    if (result.ok) {
      const parsed = parseCompleteDocument(result.bytes)
      if (parsed) {
        const active = this.state.activeId
        this.undoStack = []
        this.state = {
          ...parsed.state,
          activeId: active && parsed.state.canvas.nodes.some((node) => node.id === active) ? active : null,
        }
        this.lastBytes = parsed.bytes
        this.fileId = parsed.state.snowflake.fileId
        this.candidates = []
        this.expandNotice = null
        this.actionNotice = '已回退到所选快照，回退前的画布也留了一份快照'
      } else {
        this.actionNotice = '回退结果读不出来，请刷新页面'
      }
      this.remoteEtag = result.etag
    } else if (result.conflict) {
      const merged =
        result.bytes && this.lastBytes
          ? mergeRemoteDocuments(this.lastBytes, result.bytes, documentToBytes(this.state))
          : null
      const parsed = merged ? parseCompleteDocument(merged) : null
      if (parsed && result.bytes) {
        this.undoStack = []
        this.state = { ...parsed.state, activeId: this.state.activeId }
        this.lastBytes = result.bytes.slice()
        this.remoteEtag = result.etag
      }
      this.actionNotice = MSG_VERSION_MOVED
    } else {
      this.actionNotice = result.message
    }
    await this.refreshRemoteSnapshots()
    this.emit()
  }

  async rollbackTo(name: string): Promise<void> {
    if (this.remoteMode) {
      await this.rollbackRemote(name)
      return
    }
    if (!this.writerHeld() || !this.acceptsEdits() || !this.directory) return
    if (!isSnapshotFileName(name, this.fileName)) return
    const selected = await this.directory.read(name)
    if (!selected) return
    await this.rollbackWithBytes(selected)
  }

  async rollbackToBytes(bytes: Uint8Array): Promise<void> {
    if (!this.writerHeld() || !this.acceptsEdits()) return
    await this.rollbackWithBytes(bytes)
  }

  private async rollbackWithBytes(selected: Uint8Array): Promise<void> {
    await this.drainQueue()
    if (this.pendingConflicts.size > 0) return
    const parsed = parseCompleteDocument(selected)
    if (!parsed) return
    const current = await this.currentCanonicalBytes()
    if (!current) return
    this.writing = true
    this.canEdit = false
    this.emit()
    const kept = await this.copySnapshot(current)
    if (!kept) {
      this.writing = false
      this.canEdit = true
      this.failed = false
      this.stopped = false
      this.emit()
      return
    }
    await this.refreshSnapshotNames()
    const result = await this.writeExact(parsed.bytes)
    this.writing = false
    if (this.disposed) return
    if (!result.ok) {
      this.failed = true
      this.stopped = true
      this.canEdit = false
      this.emit()
      return
    }
    const active = this.state.activeId
    this.state = {
      ...parsed.state,
      activeId: active && parsed.state.snowflake.cards[active] ? active : null,
    }
    this.fileId = parsed.state.snowflake.fileId
    this.candidates = []
    this.expandNotice = null
    this.failed = false
    this.stopped = false
    this.canEdit = true
    this.readonlyOther = false
    if (!result.logged) this.logUnavailable = true
    await this.refreshSnapshotNames()
    this.emit()
  }

  private async currentCanonicalBytes(): Promise<Uint8Array | null> {
    if (this.directory) {
      const raw = await this.directory.read(this.fileName)
      if (raw && parseCompleteDocument(raw)) return raw
    }
    if (this.lastBytes && parseCompleteDocument(this.lastBytes)) return this.lastBytes.slice()
    return null
  }

  private async allocateSnapshotName(date: Date): Promise<string> {
    const existing = new Set<string>(this.issuedSnapshotNames)
    if (this.directory?.listNames) {
      try {
        for (const name of await this.directory.listNames()) existing.add(name)
      } catch {
        // 目录列不出来时，下面仍用 read 确认目标名是空的。
      }
    }
    for (let guard = 0; guard < 2005; guard += 1) {
      const name = snapshotFileName(this.fileName, date, existing)
      if (!this.directory) return name
      const found = await this.directory.read(name)
      if (!found) return name
      existing.add(name)
    }
    throw new Error('快照文件名都已占用')
  }

  private async copySnapshot(bytes: Uint8Array): Promise<boolean> {
    let name: string
    try {
      name = await this.allocateSnapshotName(this.ports.now())
    } catch {
      return false
    }
    if (this.directory) {
      const occupied = await this.directory.read(name)
      if (occupied) return false
      const tempName = `.${name}.tmp`
      try {
        await this.directory.writeTemp(tempName, bytes)
        const back = await this.directory.read(tempName)
        if (!back || !parseCompleteDocument(back)) {
          await this.removeQuiet(tempName)
          return false
        }
        await this.directory.move(tempName, name)
      } catch {
        await this.removeQuiet(tempName)
        return false
      }
      this.issuedSnapshotNames.add(name)
      return true
    }
    const ask = this.ports.askSnapshotDownload
    if (!ask) return false
    const accepted = await ask(name, bytes)
    if (!accepted) return false
    this.issuedSnapshotNames.add(name)
    return true
  }

  private async refreshSnapshotNames(): Promise<void> {
    if (!this.directory?.listNames) {
      this.snapshotNames = []
      return
    }
    try {
      const stem = this.fileName.endsWith('.json') ? this.fileName.slice(0, -'.json'.length) : this.fileName
      const prefix = `${stem}.`
      const names = await this.directory.listNames()
      this.snapshotNames = names.filter((name) => name.startsWith(prefix) && name.endsWith('.snapshot.json')).sort()
    } catch {
      this.snapshotNames = []
    }
  }

  async retryWrite(): Promise<void> {
    if (this.disposed || !this.failed || this.retrying) return
    this.retrying = true
    this.writing = true
    this.emit()
    try {
      await this.drainQueue()
      if (this.disposed || !this.failed || this.pendingConflicts.size > 0) return
      await this.writeOnce(this.state)
    } finally {
      this.retrying = false
      this.writing = false
      if (!this.disposed) this.emit()
    }
  }

  private view(): PersistView {
    const messages: string[] = []
    if (this.fileProtocol) messages.push(MSG_FILE_PROTOCOL)
    if (this.failed) messages.push(this.remoteMode ? MSG_WRITE_FAILED_SERVER : MSG_WRITE_FAILED)
    if (this.writing) messages.push(MSG_WRITING)
    if (this.logUnavailable) messages.push(MSG_LOG_DOWN)
    if (this.readonlyOther && this.showWritingMessage) {
      messages.push(
        this.otherStartedAt
          ? `${MSG_OTHER_TAB}。正本文件名 ${this.fileName}，从 ${this.otherStartedAt} 开始写`
          : MSG_OTHER_TAB,
      )
    }
    if (this.lockUnsupported && this.editingAllowed()) messages.push(MSG_NO_LOCK)
    if (this.restoredNotice) messages.push(MSG_RESTORED)
    if (this.needPermission) messages.push(MSG_NEED_PERMISSION)
    if (this.downloadMode && !this.fileProtocol && !this.remoteMode) messages.push(MSG_USE_LOOPBACK)
    if (this.saveAsHeld && this.saveAsOnly()) messages.push(MSG_SAVE_AS_LATER)
    if (this.remoteMode) {
      messages.push('正本在服务器')
      const version = versionFromEtag(this.remoteEtag)
      if (version) messages.push(`版本 ${version}`)
    }
    if (this.canonMismatch) messages.push(MSG_CANON_MISMATCH)
    if (this.pendingConflicts.size > 0) messages.push(MSG_CARD_CONFLICT)
    if (this.actionNotice) messages.push(this.actionNotice)
    return {
      canEdit: this.acceptsEdits(),
      writing: this.writing,
      stopped: this.stopped || this.failed,
      fileProtocol: this.fileProtocol,
      needPermission: this.needPermission,
      needChoice: this.needChoice,
      readonlyOther: this.readonlyOther,
      downloadMode: this.downloadMode,
      fileName: this.fileName,
      messages,
      notices: messages.map((text) => ({ text, kind: statusKind(text) })),
      otherStartedAt: this.readonlyOther ? this.otherStartedAt : null,
      logUnavailable: this.logUnavailable,
      restoredNotice: this.restoredNotice,
      expandNotice: this.expandNotice,
      candidates: this.candidates,
      snapshotNames: this.snapshotNames,
      snapshotOptions: this.remoteMode
        ? this.remoteSnapshots.map((item) => ({ name: item.name, label: snapshotLabel(item.savedAt, item.name) }))
        : this.snapshotNames.map((name) => ({ name, label: name })),
      canUndo: this.acceptsEdits() && this.undoStack.length > 0,
      remoteVersion: this.remoteMode ? versionFromEtag(this.remoteEtag) : '',
      conflicts: this.conflictViews(),
    }
  }

  private conflictViews(): CardConflictView[] {
    const views: CardConflictView[] = []
    for (const conflict of this.pendingConflicts.values()) {
      const mineCard = this.state.snowflake.cards[conflict.cardId]
      const mineNode = this.state.canvas.nodes.find((node) => node.id === conflict.cardId)
      let serverText = conflictSummary(conflict.server.card, conflict.server.node)
      let mineText = conflictSummary(mineCard, mineNode)
      if (serverText === mineText && (conflict.server.node || mineNode)) {
        serverText = `${serverText} · ${nodePlace(conflict.server.node)}`
        mineText = `${mineText} · ${nodePlace(mineNode)}`
      }
      views.push({ cardId: conflict.cardId, serverText, mineText })
    }
    return views
  }
}
