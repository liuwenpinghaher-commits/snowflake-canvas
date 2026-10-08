import {
  applyComposition,
  commitCardText,
  createDocument,
  LAYERS,
  loadCards,
  serializeDocument,
  type AppState,
  type CanvasEdge,
  type CanvasNode,
  type ComposeSession,
  type CompositionEvent,
  type LooseCard,
} from './document.ts'
import { MSG_CANDIDATE_MISS, buildExpandRequest, requestExpandCandidates } from './expand.ts'
import type { ExpandClientOptions, ShownCandidate } from './expand.ts'
import { isSnapshotFileName, snapshotFileName } from './snapshot.ts'

export const CANONICAL_NAME = 'snowflake.json'

export const MSG_WRITE_FAILED = '文件没写上'
export const MSG_VERSION_MOVED = '版本已更新，请再试'
export const MSG_WRITING = '正在写入正本'
export const MSG_LOG_DOWN = '恢复日志不可用'
export const MSG_OTHER_TAB = '另一个标签正在写这份正本，本页只读'
export const MSG_RESTORED = '正本不是完整 JSON，已用恢复日志换上上一份完整稿'
export const MSG_SAVE_AS = '正本要另存'
export const MSG_FILE_PROTOCOL = '请用本机的 http://127.0.0.1 打开。从文件地址打开时，目录句柄和恢复日志都不可用。'
export const MSG_KEEP_SNAPSHOT = '留下这一版'
export const SNAPSHOT_SAVE_HINT = '这是正本旁边的一份快照。打开应用时仍读正本，不读这份快照。'
export const MSG_NEED_PERMISSION = '还没有读写授权。点一下才能继续自动保存。'
export const SAVE_AS_WARNING = '下载开始后不要在浏览器里取消；若取消了，必须停止编辑，下次打开会看到上一份正本。'

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
  keep(etag: string): Promise<{ ok: true; etag: string; snapshotCount: number } | { ok: false; message: string }>
}

export interface PersistPorts {
  protocol: string
  hasDirectoryPicker: boolean
  now(): Date
  loadDirectory(): Promise<DirectoryAccess | null>
  pickDirectory(): Promise<DirectoryAccess | 'abort'>
  queryPermission(): Promise<PermissionWord>
  requestPermission(): Promise<PermissionWord>
  logFactory(): Promise<RecoveryLog>
  tryAcquireLock(name: string): Promise<LockHandle | null>
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
  otherStartedAt: string | null
  logUnavailable: boolean
  restoredNotice: boolean
  expandNotice: string | null
  candidates: ShownCandidate[]
  snapshotNames: string[]
  remoteVersion: string
}

export interface PersistSnapshot {
  state: AppState
  view: PersistView
}

export interface PersistController {
  start(): Promise<void>
  refresh(): Promise<void>
  selectDirectory(): Promise<void>
  requestPermission(): Promise<void>
  claimWrite(): Promise<void>
  openLocalFile(bytes: Uint8Array, name: string): Promise<void>
  commitText(cardId: string, fieldKey: string | null, text: string): Promise<void>
  mutate(recipe: (state: AppState) => AppState): Promise<void>
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
  snapshot(): PersistSnapshot
  readRecoveryLog(): Promise<Uint8Array | null>
  dispose(): void
}

type OpenReason = 'refresh' | 'pick' | 'claim-button' | 'download' | 'open-file'

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
  return JSON.stringify({ layer: card.layer, body: card.body, fields })
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
  })
}

function mergeScalar(base: string, remote: string, local: string): string | null {
  if (remote === base) return local
  if (local === base) return remote
  if (remote === local) return local
  return null
}

function mergeList<T>(
  base: readonly T[],
  remote: readonly T[],
  local: readonly T[],
  idOf: (item: T) => string,
  jsonOf: (item: T) => string,
): T[] | null {
  const baseMap = new Map(base.map((item) => [idOf(item), item]))
  const remoteMap = new Map(remote.map((item) => [idOf(item), item]))
  const localMap = new Map(local.map((item) => [idOf(item), item]))
  const ids = new Set([...baseMap.keys(), ...remoteMap.keys(), ...localMap.keys()])
  const kept = new Map<string, T>()
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
    return null
  }
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

function mergeRemoteDocuments(baseBytes: Uint8Array, remoteBytes: Uint8Array, localBytes: Uint8Array): Uint8Array | null {
  const base = parseCompleteDocument(baseBytes)
  const remote = parseCompleteDocument(remoteBytes)
  const local = parseCompleteDocument(localBytes)
  if (!base || !remote || !local) return null
  const fileId = mergeScalar(
    base.state.snowflake.fileId,
    remote.state.snowflake.fileId,
    local.state.snowflake.fileId,
  )
  if (fileId === null) return null
  const cards = mergeList(
    Object.entries(base.state.snowflake.cards).map(([id, card]) => ({ id, card })),
    Object.entries(remote.state.snowflake.cards).map(([id, card]) => ({ id, card })),
    Object.entries(local.state.snowflake.cards).map(([id, card]) => ({ id, card })),
    (item) => item.id,
    (item) => cardJson(item.card),
  )
  if (!cards) return null
  const nodes = mergeList(
    base.state.canvas.nodes,
    remote.state.canvas.nodes,
    local.state.canvas.nodes,
    (node) => node.id,
    nodeJson,
  )
  if (!nodes) return null
  const edges = mergeList(
    base.state.canvas.edges,
    remote.state.canvas.edges,
    local.state.canvas.edges,
    (edge) => edge.id,
    edgeJson,
  )
  if (!edges) return null
  const mergedCards: AppState['snowflake']['cards'] = {}
  for (const item of cards) mergedCards[item.id] = item.card
  return documentToBytes({
    canvas: { nodes, edges },
    snowflake: { fileId, cards: mergedCards },
    activeId: local.state.activeId,
  })
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
      otherStartedAt: null,
      logUnavailable: false,
      restoredNotice: false,
      expandNotice: null,
      candidates: [],
      snapshotNames: [],
      remoteVersion: '',
    },
  }
}

function versionFromEtag(etag: string): string {
  let text = etag.trim()
  if (text.startsWith('W/')) text = text.slice(2).trim()
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) text = text.slice(1, -1)
  return text
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
  return {
    canvas: { nodes, edges },
    snowflake: { fileId: snowflake.fileId, cards: loadCards(loose, edges) },
    activeId: null,
  }
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
  return { layer: value.layer, body, fields }
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
  private fileProtocol = false
  private needChoice = false
  private needPermission = false
  private readonlyOther = false
  private showWritingMessage = false
  private writing = false
  private canEdit = false
  private queuedText: { cardId: string; fieldKey: string | null; text: string } | null = null
  private stopped = false
  private failed = false
  private logUnavailable = false
  private restoredNotice = false
  private expandNotice: string | null = null
  private candidates: ShownCandidate[] = []
  private snapshotNames: string[] = []
  private remoteMode = false
  private remoteEtag = ''
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

  dispose(): void {
    this.disposed = true
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
    if (this.writing) {
      if (!this.canEdit || this.stopped || this.failed || this.fileProtocol || this.readonlyOther || this.needPermission) {
        return
      }
      this.queuedText = { cardId, fieldKey, text }
      return
    }
    if (!this.editingAllowed()) return
    this.queuedText = null
    const next = commitCardText(this.state, cardId, text, fieldKey, false)
    if (next === this.state) return
    await this.persistState(next)
    await this.flushQueuedText()
  }

  async mutate(recipe: (state: AppState) => AppState): Promise<void> {
    if (!this.editingAllowed()) return
    const next = recipe(this.state)
    if (next === this.state) return
    await this.persistState(next)
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
    if (!this.editingAllowed()) return session
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
      !this.needPermission
    )
  }

  private async flushQueuedText(): Promise<void> {
    const queued = this.queuedText
    if (!queued || this.writing || this.disposed) return
    this.queuedText = null
    if (!this.editingAllowed()) return
    const next = commitCardText(this.state, queued.cardId, queued.text, queued.fieldKey, false)
    if (next === this.state) return
    await this.persistState(next)
    await this.flushQueuedText()
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
    if (this.logTried || !this.lock) return
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
    return true
  }

  private async writeRemote(
    bytes: Uint8Array,
  ): Promise<{ ok: true; logged: boolean; bytes: Uint8Array } | { ok: false; conflict?: boolean }> {
    const remote = this.ports.remote
    if (!remote) return { ok: false }
    try {
      const saved = await remote.save(bytes, this.remoteEtag)
      if (saved.ok) {
        this.remoteEtag = saved.etag
        this.lastBytes = bytes.slice()
        return { ok: true, logged: true, bytes }
      }
      if (saved.conflict && saved.etag) {
        const merged =
          saved.bytes && this.lastBytes ? mergeRemoteDocuments(this.lastBytes, saved.bytes, bytes) : null
        // 412 之后只允许再发合并结果。合并不了、或合并后再 412，都不得把冲突前的旧正文原样重发。
        if (merged) {
          const retried = await remote.save(merged, saved.etag)
          if (retried.ok) {
            this.remoteEtag = retried.etag
            this.lastBytes = merged.slice()
            const parsed = parseCompleteDocument(merged)
            if (parsed) this.state = { ...parsed.state, activeId: this.state.activeId }
            return { ok: true, logged: true, bytes: merged }
          }
          if (retried.conflict && retried.etag) {
            this.remoteEtag = retried.etag
            return { ok: false, conflict: true }
          }
          return { ok: false }
        }
        this.remoteEtag = saved.etag
        return { ok: false, conflict: true }
      }
      return { ok: false }
    } catch {
      return { ok: false }
    }
  }

  private async writeExact(
    bytes: Uint8Array,
  ): Promise<{ ok: true; logged: boolean; bytes: Uint8Array } | { ok: false }> {
    if (this.remoteMode && this.ports.remote) return this.writeRemote(bytes)
    if (this.downloadMode || !this.directory) {
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

  private async persistState(next: AppState): Promise<void> {
    this.actionNotice = null
    this.state = next
    this.writing = true
    this.emit()
    const bytes = documentToBytes(next)
    const result = await this.writeExact(bytes)
    this.writing = false
    if (this.disposed) return
    if (!result.ok) {
      if ('conflict' in result && result.conflict) {
        this.actionNotice = MSG_VERSION_MOVED
        this.failed = false
        this.stopped = false
        this.canEdit = true
        this.emit()
        return
      }
      this.failed = true
      this.stopped = true
      this.canEdit = false
      this.emit()
      return
    }
    this.failed = false
    this.stopped = false
    this.canEdit = true
    if (!result.logged) this.logUnavailable = true
    this.emit()
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
    if (!this.lock && logged) {
      const acquired = await this.tryBecomeWriter(logged.state.snowflake.fileId, reason)
      if (!acquired) {
        await this.closeLog()
        this.stopFailed()
        return
      }
    }
    if (!this.lock) {
      this.stopFailed()
      return
    }
    await this.deleteTempIfPresent()
    if (!logged) {
      this.stopFailed()
      return
    }
    const result = await this.writeExact(logged.bytes)
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
      this.expandNotice = MSG_CANDIDATE_MISS
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
      this.expandNotice = MSG_CANDIDATE_MISS
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
    await this.commitText(cardId, fieldKey, text)
  }

  async keepVersion(): Promise<void> {
    if (this.remoteMode && this.ports.remote) {
      if (!this.editingAllowed()) return
      const result = await this.ports.remote.keep(this.remoteEtag)
      if (!result.ok) {
        this.actionNotice = result.message
        this.emit()
        return
      }
      this.remoteEtag = result.etag
      this.actionNotice = `已留下这一版，快照 ${result.snapshotCount} 份`
      this.emit()
      return
    }
    if (!this.lock || !this.editingAllowed()) return
    const bytes = await this.currentCanonicalBytes()
    if (!bytes) return
    const kept = await this.copySnapshot(bytes)
    if (!kept) return
    await this.refreshSnapshotNames()
    this.emit()
  }

  async rollbackTo(name: string): Promise<void> {
    if (!this.lock || !this.editingAllowed() || !this.directory) return
    if (!isSnapshotFileName(name, this.fileName)) return
    const selected = await this.directory.read(name)
    if (!selected) return
    await this.rollbackWithBytes(selected)
  }

  async rollbackToBytes(bytes: Uint8Array): Promise<void> {
    if (!this.lock || !this.editingAllowed()) return
    await this.rollbackWithBytes(bytes)
  }

  private async rollbackWithBytes(selected: Uint8Array): Promise<void> {
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

  private view(): PersistView {
    const messages: string[] = []
    if (this.fileProtocol) messages.push(MSG_FILE_PROTOCOL)
    if (this.failed) messages.push(MSG_WRITE_FAILED)
    if (this.writing) messages.push(MSG_WRITING)
    if (this.logUnavailable) messages.push(MSG_LOG_DOWN)
    if (this.readonlyOther && this.showWritingMessage) {
      messages.push(
        this.otherStartedAt
          ? `${MSG_OTHER_TAB}。正本文件名 ${this.fileName}，从 ${this.otherStartedAt} 开始写`
          : MSG_OTHER_TAB,
      )
    }
    if (this.restoredNotice) messages.push(MSG_RESTORED)
    if (this.needPermission) messages.push(MSG_NEED_PERMISSION)
    if (this.remoteMode) {
      messages.push('正本在服务器')
      const version = versionFromEtag(this.remoteEtag)
      if (version) messages.push(`版本 ${version}`)
    }
    if (this.actionNotice) messages.push(this.actionNotice)
    return {
      canEdit: this.editingAllowed(),
      writing: this.writing,
      stopped: this.stopped || this.failed,
      fileProtocol: this.fileProtocol,
      needPermission: this.needPermission,
      needChoice: this.needChoice,
      readonlyOther: this.readonlyOther,
      downloadMode: this.downloadMode,
      fileName: this.fileName,
      messages,
      otherStartedAt: this.readonlyOther ? this.otherStartedAt : null,
      logUnavailable: this.logUnavailable,
      restoredNotice: this.restoredNotice,
      expandNotice: this.expandNotice,
      candidates: this.candidates,
      snapshotNames: this.snapshotNames,
      remoteVersion: this.remoteMode ? versionFromEtag(this.remoteEtag) : '',
    }
  }
}
