import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { constants as fsConstants, createReadStream } from 'node:fs'
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Agent, fetch as undiciFetch } from 'undici'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import {
  activeSessionId,
  isLegacyRecord,
  knownSessionIds,
  loadMessagePage,
  mergeStores,
  normalizeStore,
  publicSessions,
  resolveAdoptionKey,
  sessionOwned,
  situationTarget,
  storeFromLegacy,
  withAdoption,
  withFirstAsk,
  withLast,
  withSession,
  fetchMessagePage,
} from './discuss-store.mjs'
import { getImportProgress, importPlainText, setImportProgress } from './import-book.mjs'
import { locateAdoption } from './recall.mjs'
import { writeSediment } from './sediment.mjs'
import { composeEntityPage, finalizedText, pageMissingMessage, parsePageSnapshot, promoteEntityPage, timelineBelow } from './encyclopedia.mjs'
import { loadDocumentModule } from './load-document.mjs'
import { registerAssetRoutes } from './assets.mjs'
import { stripMarkdown } from '../src/strip-markdown.mjs'
import { collectDiscussContext, discussSessionResponse, postGatewaySession, stripTimeline } from './discuss-context.mjs'
import { validateDocumentFlows } from './flow-validate.mjs'
import { draftFlow, readDraftScope, resolveDraftComplete } from './flow-draft.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(repoRoot, 'dist')
const dataDir = readEnv('SNOWFLAKE_DATA_DIR') || '/home/chris/.local/share/snowflake-canvas'
const SNAPSHOT_STEM = 'snowflake'
const configPath = join(dataDir, 'config.json')
const gbrainFailFlag = join(dataDir, 'gbrain-force-fail')
// 每本书一个目录：books/<bookId>/ 里放正本、会话、快照和 meta.json；数据根只留 active.json 和全局配置。
const booksRoot = join(dataDir, 'books')
const activePath = join(dataDir, 'active.json')
const legacyCanonicalPath = join(dataDir, 'snowflake.json')
const legacySessionPath = join(dataDir, 'session.json')
const legacySessionBackupPath = join(dataDir, 'session.json.bak')
const PRE_IMPORT_SUFFIX = '.pre-multi-import'
const DEFAULT_BOOK_NAME = '未命名书'
const BOOK_NAME_LIMIT = 200
const BOOK_ID_RE = /^[a-z0-9]{1,32}$/
const MSG_NO_BOOK = '没有这本书'

const gatewayOrigin = 'http://127.0.0.1:8642'
const expandHost = '127.0.0.1'
const expandPort = Number(readEnv('SNOWFLAKE_EXPAND_PORT')) || 18100
const expandPath = '/v1/chat/completions'
const listenHost = readEnv('SNOWFLAKE_LISTEN_HOST') || '0.0.0.0'
const listenPort = Number(readEnv('SNOWFLAKE_PORT')) || 8093

const DISCUSS_TITLE = '画布讨论'
const DISCUSS_INSTRUCTIONS = [
  '你是雪花画布的讨论助手。',
  'gbrain-first：先读脑再说话。',
  '回答用户之前，先用 gbrain 读取与问题相关的页面，默认页是 projects/snowflake-canvas，再根据读到的内容说话。',
  '讨论结论不要自动写回 gbrain。只有用户在页面上另点「写入脑」才写。',
  '不要关闭记忆，不要关闭技能，不要假装看不见日常网关里已有的记忆和技能。',
].join('')

const gatewayAgent = new Agent({
  bodyTimeout: 0,
  headersTimeout: 0,
  connectTimeout: 10_000,
})

function readEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed
}

function strongEtag(version) {
  return `"${version}"`
}

function ifMatchSatisfied(header, version) {
  if (typeof header !== 'string' || header.trim() === '') return false
  const expected = strongEtag(version)
  const bare = String(version)
  for (const part of header.split(',')) {
    const token = part.trim()
    if (token.startsWith('W/')) continue
    if (token === expected || token === bare) return true
  }
  return false
}

function flowIssueOk(value, requireRule) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.message !== 'string') return false
  if (requireRule) {
    if (typeof value.ruleId !== 'string') return false
  } else if (value.ruleId !== undefined && typeof value.ruleId !== 'string') {
    return false
  }
  if (value.elementId !== undefined && typeof value.elementId !== 'string') return false
  return true
}

function flowScopeIdOk(value, required) {
  if (value === undefined) return !required
  if (typeof value !== 'string') return false
  if (required && value.length === 0) return false
  return true
}

function flowScopeOk(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const kind = value.kind
  if (kind !== 'book' && kind !== 'chapter' && kind !== 'scene') return false
  if (!flowScopeIdOk(value.chapterId, kind === 'chapter' || kind === 'scene')) return false
  if (!flowScopeIdOk(value.sceneId, kind === 'scene')) return false
  return true
}

function flowSourceRefOk(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.kind !== 'card' && value.kind !== 'edge' && value.kind !== 'chapter' && value.kind !== 'scene' && value.kind !== 'entity') {
    return false
  }
  return typeof value.id === 'string' && value.id.length > 0
}

function flowItemOk(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  if (typeof value.title !== 'string') return false
  if (!flowScopeOk(value.scope)) return false
  if (typeof value.xml !== 'string' || typeof value.beta !== 'string') return false
  if (value.origin !== 'llm' && value.origin !== 'human') return false
  if (!Array.isArray(value.sourceRefs) || !value.sourceRefs.every(flowSourceRefOk)) return false
  const validation = value.validation
  if (!validation || typeof validation !== 'object' || Array.isArray(validation)) return false
  if (typeof validation.ranAt !== 'string' || typeof validation.valid !== 'boolean') return false
  if (!Array.isArray(validation.errors) || !validation.errors.every((item) => flowIssueOk(item, true))) return false
  if (!Array.isArray(validation.warnings) || !validation.warnings.every((item) => flowIssueOk(item, false))) return false
  return true
}

// flows 缺省放行（旧正本）。在则必须是数组；坏条目或重复 id 拒绝。不因其它未知顶层字段拒绝。
function flowsDocumentOk(flows) {
  if (flows === undefined) return true
  if (!Array.isArray(flows)) return false
  const seen = new Set()
  for (const item of flows) {
    if (!flowItemOk(item)) return false
    if (seen.has(item.id)) return false
    seen.add(item.id)
  }
  return true
}

function isDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const canvas = value.canvas
  const snowflake = value.snowflake
  if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas)) return false
  if (!snowflake || typeof snowflake !== 'object' || Array.isArray(snowflake)) return false
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) return false
  if (typeof snowflake.fileId !== 'string' || snowflake.fileId.length === 0) return false
  if (!snowflake.cards || typeof snowflake.cards !== 'object' || Array.isArray(snowflake.cards)) return false
  if (!flowsDocumentOk(value.flows)) return false
  return true
}

function emptyDocument() {
  return {
    canvas: { nodes: [], edges: [] },
    snowflake: { fileId: crypto.randomUUID(), cards: {} },
  }
}

function envelope(version, document, snapshots) {
  return { version, document, snapshots }
}

async function writeExact(path, text) {
  const handle = await open(path, 'w', 0o600)
  try {
    await handle.writeFile(text)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  return JSON.parse(text)
}

async function exists(path) {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function writeJsonAtomic(path, value) {
  const text = JSON.stringify(value)
  const temp = join(dirname(path), `.${basename(path)}.tmp`)
  await writeExact(temp, text)
  const back = await readFile(temp, 'utf8')
  if (back !== text) {
    await rm(temp, { force: true })
    throw new Error(`${path} 临时文件校验失败`)
  }
  await rename(temp, path)
}

function isBookId(value) {
  return typeof value === 'string' && BOOK_ID_RE.test(value)
}

function makeBook(id) {
  const dir = join(booksRoot, id)
  return {
    id,
    dir,
    name: DEFAULT_BOOK_NAME,
    createdAt: '',
    canonicalPath: join(dir, 'snowflake.json'),
    canonicalTempPath: join(dir, '.snowflake.json.tmp'),
    canonicalBackupPath: join(dir, 'snowflake.json.bak'),
    sessionPath: join(dir, 'session.json'),
    sessionBackupPath: join(dir, 'session.json.bak'),
    sessionTempPath: join(dir, '.session.json.tmp'),
    metaPath: join(dir, 'meta.json'),
    queue: Promise.resolve(),
    sessionQueue: Promise.resolve(),
    canonicalBroken: null,
    legacyHeld: null,
    removed: false,
  }
}

// 写入串行按书分开：同一本书的正本读改写排一条队，会话文件另排一条队；两本书互不等待。
function exclusive(book, task) {
  const run = book.queue.then(task, task)
  book.queue = run.then(
    () => {},
    () => {},
  )
  return run
}

function exclusiveSession(book, task) {
  const run = book.sessionQueue.then(task, task)
  book.sessionQueue = run.then(
    () => {},
    () => {},
  )
  return run
}

// 建书、改名、切换、删书排同一条队，active.json 和书目录列表只在这里改。
let booksQueue = Promise.resolve()

function exclusiveBooks(task) {
  const run = booksQueue.then(task, task)
  booksQueue = run.then(
    () => {},
    () => {},
  )
  return run
}

async function loadConfig() {
  try {
    const value = await readJson(configPath)
    if (value && typeof value.gbrainPage === 'string' && value.gbrainPage.trim()) {
      return { gbrainPage: value.gbrainPage.trim() }
    }
  } catch {
    // 没有配置文件就用默认页。
  }
  return { gbrainPage: 'projects/snowflake-canvas' }
}

async function removeStaleTemps(dir) {
  await rm(join(dir, '.snowflake.json.tmp'), { force: true })
  await rm(join(dir, '.snowflake.keep.tmp'), { force: true })
  for (const name of await readdir(dir)) {
    if (name.startsWith(`.${SNAPSHOT_STEM}.`) && name.endsWith('.snapshot.json.tmp')) {
      await rm(join(dir, name), { force: true })
    }
  }
}

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await removeStaleTemps(dataDir)
}

// 与 src/snapshot.ts 的 isSnapshotFileName 同一套规则。
function isSnapshotName(name) {
  if (typeof name !== 'string' || name.length > 200) return false
  if (!name.startsWith(`${SNAPSHOT_STEM}.`) || !name.endsWith('.snapshot.json')) return false
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false
  return true
}

function snapshotStamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function snapshotNameFor(date, existing) {
  const stamp = snapshotStamp(date)
  const plain = `${SNAPSHOT_STEM}.${stamp}.snapshot.json`
  if (!existing.has(plain)) return plain
  const millis = date.getMilliseconds()
  for (let step = 0; step <= 1000; step += 1) {
    const suffix = String((millis + step) % 1000).padStart(3, '0')
    const name = `${SNAPSHOT_STEM}.${stamp}${suffix}.snapshot.json`
    if (!existing.has(name)) return name
  }
  for (let extra = 1; extra < 10000; extra += 1) {
    const name = `${SNAPSHOT_STEM}.${stamp}${String(millis).padStart(3, '0')}-${extra}.snapshot.json`
    if (!existing.has(name)) return name
  }
  throw new Error('快照文件名都已占用')
}

async function snapshotNames(book) {
  const names = (await readdir(book.dir)).filter(isSnapshotName)
  return names.sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))
}

async function listSnapshots(book) {
  const items = []
  for (const name of await snapshotNames(book)) {
    try {
      const info = await stat(join(book.dir, name))
      if (info.isFile()) items.push({ name, savedAt: info.mtime.toISOString() })
    } catch {
      // 列目录和取时间之间文件被移走，就不列它。
    }
  }
  return items
}

async function snapshotCount(book) {
  return (await snapshotNames(book)).length
}

// 快照只增不改：先写临时文件、读回比对，再改名成一个目录里还没有的名字。
async function writeSnapshotFile(book, document, date) {
  const existing = new Set(await readdir(book.dir))
  const name = snapshotNameFor(date, existing)
  const target = join(book.dir, name)
  const temp = join(book.dir, `.${name}.tmp`)
  const text = JSON.stringify(document)
  await writeExact(temp, text)
  let back
  try {
    back = await readFile(temp, 'utf8')
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  if (back !== text || !isDocument(JSON.parse(back))) {
    await rm(temp, { force: true })
    throw new Error('快照临时文件校验失败')
  }
  const taken = await stat(target).then(
    () => true,
    () => false,
  )
  if (taken) {
    await rm(temp, { force: true })
    throw new Error('快照文件名已被占用')
  }
  await rename(temp, target)
  return name
}

// 旧正本把快照正文放在 snapshots 数组里：逐份落成独立文件，全部成功后才清空数组。
async function migrateEmbeddedSnapshots(book) {
  const record = await readCanonical(book)
  if (record.snapshots.length === 0) return
  const valid = record.snapshots.every((item) => item && isDocument(item.document))
  if (!valid) {
    console.error(`书 ${book.id}：正本里的旧快照有一份不是完整画布，没有迁移，旧数组原样保留`)
    return
  }
  const before = new Set()
  for (const name of await snapshotNames(book)) {
    try {
      before.add(await readFile(join(book.dir, name), 'utf8'))
    } catch {
      // 读不出的旧文件不参与去重。
    }
  }
  for (const item of record.snapshots) {
    const text = JSON.stringify(item.document)
    if (before.has(text)) continue
    const parsed = typeof item.savedAt === 'string' ? new Date(item.savedAt) : null
    const when = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
    const name = await writeSnapshotFile(book, item.document, when)
    await utimes(join(book.dir, name), when, when)
  }
  await commitEnvelope(book, envelope(record.version, record.document, []))
  console.error(`书 ${book.id}：正本里的 ${record.snapshots.length} 份旧快照已迁成独立文件`)
}

const MSG_CANONICAL_UNREADABLE = '正本读不出来，已停止编辑'

function canonicalUnreadable() {
  return httpError(503, MSG_CANONICAL_UNREADABLE)
}

function isCanonical(value) {
  return Boolean(
    value &&
      Number.isInteger(value.version) &&
      value.version > 0 &&
      isDocument(value.document) &&
      Array.isArray(value.snapshots),
  )
}

// 正本存在却读不出：原文件改名留底后停止编辑，直到人工处理并重启。绝不写空画布。
async function quarantineCanonical(book, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const kept = join(book.dir, `snowflake.json.corrupt-${stamp}`)
  await rename(book.canonicalPath, kept)
  book.canonicalBroken = { kept, reason }
  throw canonicalUnreadable()
}

function sendUnreadable(reply) {
  reply.code(503)
  reply.header('Cache-Control', 'no-store')
  reply.type('text/plain; charset=utf-8')
  return reply.send(MSG_CANONICAL_UNREADABLE)
}

function isUnreadable(error) {
  return Boolean(error && error.statusCode === 503 && error.message === MSG_CANONICAL_UNREADABLE)
}

async function readCanonical(book) {
  if (book.removed) throw httpError(404, MSG_NO_BOOK)
  if (book.canonicalBroken) throw canonicalUnreadable()
  let text
  try {
    text = await readFile(book.canonicalPath, 'utf8')
  } catch (error) {
    if (!error || error.code !== 'ENOENT') return quarantineCanonical(book, error)
    return createCanonical(book)
  }
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    return quarantineCanonical(book, error)
  }
  if (!isCanonical(value)) return quarantineCanonical(book, new Error('正本字段校验不过'))
  return value
}

async function backupCanonical(book) {
  try {
    const value = await readJson(book.canonicalPath)
    if (!isCanonical(value)) return
  } catch {
    return
  }
  await copyFile(book.canonicalPath, book.canonicalBackupPath)
}

async function createCanonical(book) {
  const created = envelope(1, emptyDocument(), [])
  await writeExact(book.canonicalTempPath, JSON.stringify(created))
  const back = await readJson(book.canonicalTempPath)
  if (back.version !== 1 || !Array.isArray(back.snapshots)) {
    await rm(book.canonicalTempPath, { force: true })
    throw new Error('正本临时文件校验失败')
  }
  await rename(book.canonicalTempPath, book.canonicalPath)
  return back
}

async function commitEnvelope(book, next) {
  const tempPath = book.canonicalTempPath
  const text = JSON.stringify(next)
  await writeExact(tempPath, text)
  const back = await readJson(tempPath)
  if (back.version !== next.version || !Array.isArray(back.snapshots) || !isDocument(back.document)) {
    await rm(tempPath, { force: true })
    throw new Error('正本临时文件校验失败')
  }
  await backupCanonical(book)
  await rename(tempPath, book.canonicalPath)
  return back
}

// 快照正文只在独立文件里，响应里的 snapshots 恒为空数组。
async function presentDocument(document) {
  const mod = await loadDocumentModule()
  if (!mod || typeof mod.normalizeStoredDocument !== 'function') return document
  const normalized = mod.normalizeStoredDocument(document)
  return normalized && typeof normalized === 'object' ? normalized : document
}

async function sendCanvas(reply, record, extra) {
  const document = await presentDocument(record.document)
  reply.header('ETag', strongEtag(record.version))
  reply.header('Cache-Control', 'no-store')
  return reply.send({ ...envelope(record.version, document, []), ...extra })
}

function gatewayHeaders(extra) {
  const key = readEnv('API_SERVER_KEY')
  const headers = {
    Accept: 'text/event-stream, application/json',
    ...extra,
  }
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

async function gatewayFetch(path, options = {}) {
  try {
    return await undiciFetch(`${gatewayOrigin}${path}`, {
      ...options,
      dispatcher: gatewayAgent,
      headers: gatewayHeaders(options.headers || {}),
    })
  } catch (error) {
    const code = error && error.cause && error.cause.code ? error.cause.code : ''
    const wrapped = new Error(code ? `网关讨论没有连上（${code}）` : '网关讨论没有连上')
    wrapped.statusCode = 502
    throw wrapped
  }
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function textField(value) {
  return typeof value === 'string' ? value.trim() : ''
}

async function readSessionRaw(book) {
  try {
    return await readJson(book.sessionPath)
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

function backupLooksComplete(bytes) {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'))
    if (isLegacyRecord(value)) return true
    if (value && value.cards && typeof value.cards === 'object') return true
  } catch {
    return false
  }
  return false
}

async function backupLegacyOnce(book, original) {
  let existing = null
  try {
    existing = await readFile(book.sessionBackupPath)
  } catch {
    existing = null
  }
  if (existing && existing.equals(original)) return
  if (existing && backupLooksComplete(existing)) return
  const handle = await open(book.sessionBackupPath, 'w', 0o600)
  try {
    await handle.writeFile(original)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const back = await readFile(book.sessionBackupPath)
  if (!back.equals(original)) {
    await rm(book.sessionBackupPath, { force: true })
    throw new Error('会话备份校验失败')
  }
}

async function writeSessionStore(book, store, mustKeep) {
  const normalized = normalizeStore(store)
  const text = JSON.stringify(normalized)
  const temp = book.sessionTempPath
  await writeExact(temp, text)
  let back
  try {
    back = normalizeStore(await readJson(temp))
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  const expected = new Set(knownSessionIds(normalized))
  const got = new Set(knownSessionIds(back))
  const same = expected.size === got.size && [...expected].every((id) => got.has(id))
  const kept = mustKeep.every((id) => got.has(id))
  if (!same || !kept) {
    await rm(temp, { force: true })
    throw new Error('会话文件校验失败')
  }
  await rename(temp, book.sessionPath)
  book.legacyHeld = null
  return back
}

async function loadDiscussStoreInner(book) {
  const record = await exclusive(book, () => readCanonical(book))
  const raw = await readSessionRaw(book)
  if (!raw) {
    book.legacyHeld = null
    return { cards: {} }
  }
  if (!isLegacyRecord(raw)) {
    book.legacyHeld = null
    return normalizeStore(raw)
  }
  const legacy = {
    sessionId: raw.sessionId.trim(),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : DISCUSS_TITLE,
  }
  const target = situationTarget(record.document)
  if (!target) {
    book.legacyHeld = legacy
    return { cards: {} }
  }
  const original = await readFile(book.sessionPath)
  await backupLegacyOnce(book, original)
  const store = storeFromLegacy(legacy, target, new Date().toISOString())
  return writeSessionStore(book, store, [legacy.sessionId])
}

async function saveDiscussStore(book, store) {
  if (book.legacyHeld) {
    const record = await exclusive(book, () => readCanonical(book))
    const target = situationTarget(record.document)
    if (!target) {
      throw httpError(409, '还没有念头卡，原来的讨论先留在原文件里')
    }
    const original = await readFile(book.sessionPath)
    await backupLegacyOnce(book, original)
    const migrated = storeFromLegacy(book.legacyHeld, target, new Date().toISOString())
    return writeSessionStore(book, mergeStores(migrated, store), [book.legacyHeld.sessionId])
  }
  return writeSessionStore(book, store, [])
}

async function discussContextText(book, cardId) {
  const record = await exclusive(book, () => readCanonical(book))
  const available = !(await gbrainDisabled()) && (await timelineReachable())
  return collectDiscussContext(record.document, cardId, {
    available,
    getPage: (slug) => runGbrain(['get', slug]),
  })
}

async function createGatewaySession(cardId, store, contextText) {
  return postGatewaySession({
    cardId,
    store,
    contextText,
    instructions: DISCUSS_INSTRUCTIONS,
    apiKey: readEnv('API_SERVER_KEY'),
    fetchImpl: gatewayFetch,
  })
}

async function ensureCardSession(book, cardId, contextText) {
  if (!cardId) throw httpError(400, '缺少 cardId')
  return exclusiveSession(book, async () => {
    let store = await loadDiscussStoreInner(book)
    const existing = activeSessionId(store, cardId)
    if (existing) return { store, sessionId: existing }
    const created = await createGatewaySession(cardId, store, contextText)
    store = await saveDiscussStore(book, withSession(store, cardId, created))
    return { store, sessionId: created.sessionId }
  })
}

async function createCardSession(book, cardId, contextText) {
  if (!cardId) throw httpError(400, '缺少 cardId')
  return exclusiveSession(book, async () => {
    const store = await loadDiscussStoreInner(book)
    const created = await createGatewaySession(cardId, store, contextText)
    const saved = await saveDiscussStore(book, withSession(store, cardId, created))
    return { store: saved, sessionId: created.sessionId }
  })
}

async function selectCardSession(book, cardId, sessionId) {
  if (!cardId) throw httpError(400, '缺少 cardId')
  if (!sessionId) throw httpError(400, 'cardId 对不上该会话')
  return exclusiveSession(book, async () => {
    const store = await loadDiscussStoreInner(book)
    if (!sessionOwned(store, cardId, sessionId)) throw httpError(400, 'cardId 对不上该会话')
    const saved = await saveDiscussStore(book, withLast(store, cardId, sessionId))
    return { store: saved, sessionId }
  })
}

async function recordFirstAsk(book, cardId, sessionId, message) {
  return exclusiveSession(book, async () => {
    const store = await loadDiscussStoreInner(book)
    const { store: next, changed } = withFirstAsk(store, cardId, sessionId, message)
    if (changed) await saveDiscussStore(book, next)
  })
}

async function recordAdoption(book, cardId, sessionId, adoption) {
  return exclusiveSession(book, async () => {
    const store = await loadDiscussStoreInner(book)
    if (!sessionOwned(store, cardId, sessionId)) throw httpError(400, 'cardId 对不上该会话')
    return saveDiscussStore(book, withAdoption(store, cardId, sessionId, adoption))
  })
}

async function assertOwned(book, cardId, sessionId, touch) {
  if (!cardId) throw httpError(400, '缺少 cardId')
  if (!sessionId) throw httpError(400, 'cardId 对不上该会话')
  return exclusiveSession(book, async () => {
    const store = await loadDiscussStoreInner(book)
    if (!sessionOwned(store, cardId, sessionId)) throw httpError(400, 'cardId 对不上该会话')
    if (!touch) return store
    return saveDiscussStore(book, withLast(store, cardId, sessionId))
  })
}

// 写入脑不按书拆：卡片和会话的归属在哪本书里都算数，先看活动书，再看其余书。
async function assertOwnedAnyBook(cardId, sessionId) {
  await ensureBooks()
  const first = activeBook()
  try {
    return await assertOwned(first, cardId, sessionId, false)
  } catch (error) {
    if (!error || error.statusCode !== 400 || error.message !== 'cardId 对不上该会话') throw error
    for (const book of sortedBooks()) {
      if (book === first) continue
      try {
        return await assertOwned(book, cardId, sessionId, false)
      } catch {
        // 别的书对不上或读不出，都按活动书的结论回。
      }
    }
    throw error
  }
}

const books = new Map()
let activeBookId = ''
let booksReady = null

// 只认书级标题字段（外层、document、snowflake 上的 title）。卡片里的场景标题不是书名。
function legacyBookName(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return DEFAULT_BOOK_NAME
  }
  const document = value && typeof value === 'object' ? value.document : null
  const snowflake = document && typeof document === 'object' ? document.snowflake : null
  for (const layer of [value, document, snowflake]) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue
    const title = typeof layer.title === 'string' ? layer.title.trim() : ''
    if (title) return title.slice(0, BOOK_NAME_LIMIT)
  }
  return DEFAULT_BOOK_NAME
}

// 已存在就不写：pre-multi-import 只在第一次迁移时留一份，之后不覆盖。
async function writeOnce(path, bytes) {
  let handle
  try {
    handle = await open(path, 'wx', 0o600)
  } catch (error) {
    if (error && error.code === 'EEXIST') return
    throw error
  }
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const back = await readFile(path)
  if (!back.equals(bytes)) throw new Error(`${path} 校验失败`)
}

async function scanBookIds() {
  let entries
  try {
    entries = await readdir(booksRoot, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const ids = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isBookId(entry.name)) continue
    const dir = join(booksRoot, entry.name)
    if ((await exists(join(dir, 'meta.json'))) || (await exists(join(dir, 'snowflake.json')))) ids.push(entry.name)
  }
  return ids
}

async function newBookId() {
  for (;;) {
    const id = randomBytes(4).toString('hex')
    if (!books.has(id) && !(await exists(join(booksRoot, id)))) return id
  }
}

// 旧版把正本和会话直接放在数据根。还没有书时搬成第一本书：先搬正本，书目录立刻可认；
// 每搬走一份，在数据根留一份迁走前的原样副本。根上已有 pre-multi-import 说明迁过，不再动。
async function migrateLegacyRoot() {
  if ((await scanBookIds()).length > 0) return
  const hasCanvas = await exists(legacyCanonicalPath)
  const hasSession = await exists(legacySessionPath)
  if (!hasCanvas && !hasSession) return
  if (
    (await exists(`${legacyCanonicalPath}${PRE_IMPORT_SUFFIX}`)) ||
    (await exists(`${legacySessionPath}${PRE_IMPORT_SUFFIX}`))
  ) {
    console.error('数据根已有 pre-multi-import，旧数据迁过一次，这次不再搬')
    return
  }
  const id = await newBookId()
  const book = makeBook(id)
  await mkdir(book.dir, { recursive: true, mode: 0o700 })
  let name = DEFAULT_BOOK_NAME
  if (hasCanvas) {
    const bytes = await readFile(legacyCanonicalPath)
    name = legacyBookName(bytes.toString('utf8'))
    await rename(legacyCanonicalPath, book.canonicalPath)
    await writeOnce(`${legacyCanonicalPath}${PRE_IMPORT_SUFFIX}`, bytes)
  }
  await writeJsonAtomic(book.metaPath, { id, name, createdAt: new Date().toISOString() })
  if (hasSession) {
    const bytes = await readFile(legacySessionPath)
    await rename(legacySessionPath, book.sessionPath)
    await writeOnce(`${legacySessionPath}${PRE_IMPORT_SUFFIX}`, bytes)
  }
  if (await exists(legacySessionBackupPath)) await rename(legacySessionBackupPath, book.sessionBackupPath)
  for (const entry of await readdir(dataDir)) {
    if (isSnapshotName(entry)) await rename(join(dataDir, entry), join(book.dir, entry))
  }
  await writeJsonAtomic(activePath, { activeBookId: id })
  console.error(`数据根的旧画布已迁成第一本书 ${id}（${name}）`)
}

async function loadBook(id) {
  const book = makeBook(id)
  let meta = null
  try {
    meta = await readJson(book.metaPath)
  } catch {
    meta = null
  }
  const name = meta && typeof meta.name === 'string' ? meta.name.trim() : ''
  const createdAt = meta && typeof meta.createdAt === 'string' ? meta.createdAt : ''
  if (name && createdAt) {
    book.name = name
    book.createdAt = createdAt
    return book
  }
  let derived = name
  if (!derived) {
    try {
      derived = legacyBookName(await readFile(book.canonicalPath, 'utf8'))
    } catch {
      derived = DEFAULT_BOOK_NAME
    }
  }
  book.name = derived
  book.createdAt = createdAt || (await stat(book.dir)).mtime.toISOString()
  await writeJsonAtomic(book.metaPath, { id, name: book.name, createdAt: book.createdAt })
  return book
}

function sortedBooks() {
  return [...books.values()].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

function activeBook() {
  return books.get(activeBookId) || sortedBooks()[0] || null
}

async function setActive(id) {
  await writeJsonAtomic(activePath, { activeBookId: id })
  activeBookId = id
}

async function createBook(name) {
  const id = await newBookId()
  const book = makeBook(id)
  await mkdir(book.dir, { recursive: true, mode: 0o700 })
  await createCanonical(book)
  book.name = name
  book.createdAt = new Date().toISOString()
  await writeJsonAtomic(book.metaPath, { id, name, createdAt: book.createdAt })
  books.set(id, book)
  return book
}

async function initBooks() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await migrateLegacyRoot()
  for (const id of await scanBookIds()) {
    if (!books.has(id)) books.set(id, await loadBook(id))
  }
  if (books.size === 0) await createBook(DEFAULT_BOOK_NAME)
  let wanted = ''
  try {
    const value = await readJson(activePath)
    if (value && isBookId(value.activeBookId)) wanted = value.activeBookId
  } catch {
    wanted = ''
  }
  if (books.has(wanted)) activeBookId = wanted
  else await setActive(sortedBooks()[0].id)
}

function ensureBooks() {
  if (!booksReady) booksReady = initBooks()
  return booksReady
}

// 旧路径（不带 bookId）落到活动书；新路径按 bookId 找，找不到或 id 不合规都算没有这本书。
async function bookFor(request) {
  await ensureBooks()
  const id = request.params ? request.params.bookId : undefined
  if (id === undefined) return activeBook()
  if (!isBookId(id)) return null
  const book = books.get(id)
  return book && !book.removed ? book : null
}

function sendNoBook(reply) {
  reply.code(404)
  reply.header('Cache-Control', 'no-store')
  return reply.send({ error: MSG_NO_BOOK })
}

function publicBook(book) {
  return { id: book.id, name: book.name, active: book.id === activeBookId }
}

function bookNameFrom(body) {
  return body && typeof body === 'object' && typeof body.name === 'string' ? body.name.trim() : ''
}

async function renameBook(book, name) {
  return exclusiveBooks(async () => {
    if (book.removed) throw httpError(404, MSG_NO_BOOK)
    await writeJsonAtomic(book.metaPath, { id: book.id, name, createdAt: book.createdAt })
    book.name = name
    return book
  })
}

async function activateBook(book) {
  return exclusiveBooks(async () => {
    if (book.removed) throw httpError(404, MSG_NO_BOOK)
    await setActive(book.id)
    return book
  })
}

// 先排进这本书的会话队列、再排正本队列（与讨论接口同一顺序），等手上的写入都落盘后才删目录。
async function deleteBook(book) {
  return exclusiveBooks(async () => {
    if (book.removed) throw httpError(404, MSG_NO_BOOK)
    if (books.size <= 1) throw httpError(409, '只剩这一本书，不能删')
    await exclusiveSession(book, () =>
      exclusive(book, async () => {
        book.removed = true
        books.delete(book.id)
        await rm(book.dir, { recursive: true, force: true })
      }),
    )
    if (activeBookId === book.id) await setActive(sortedBooks()[0].id)
  })
}

function discussFailure(reply, error, fallback) {
  reply.code(error && error.statusCode ? error.statusCode : 502)
  return reply.send({ error: error instanceof Error ? error.message : fallback })
}

function gbrainDisabled() {
  return stat(gbrainFailFlag).then(
    () => true,
    () => false,
  )
}

function gbrainDetail(err, out, code) {
  const lines = `${err}\n${out}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('UPGRADE_AVAILABLE') && !/^gbrain \d/.test(line))
  return (lines[0] || `退出码 ${code}`).slice(0, 400)
}

function runGbrainOnce(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      [
        '-lc',
        'set -a; source "$HOME/.gbrain/env"; set +a; export PATH="$HOME/.bun/bin:$PATH"; exec "${SNOWFLAKE_GBRAIN_BIN:-$HOME/.bun/bin/gbrain}" "$@"',
        'bash',
        ...args,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8')
      const err = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) {
        const error = new Error(gbrainDetail(err, out, code))
        error.exitCode = code
        reject(error)
        return
      }
      resolve(out)
    })
    if (stdin) child.stdin.end(stdin)
    else child.stdin.end()
  })
}

async function runGbrain(args, stdin) {
  let last = new Error('gbrain 没有跑成')
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await runGbrainOnce(args, stdin)
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error))
      if (!last.message.includes('storage_busy') || attempt === 7) throw last
      await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)))
    }
  }
  throw last
}

const RELATION_BACKLINK_TIMEOUT_MS = 8000
const RELATION_BACKLINK_MAX = 40
const RELATION_SLUG_MAX = 200
const RELATION_GBRAIN_STDOUT_MAX = 2_000_000

function relationBacklinkSlug(value) {
  if (typeof value !== 'string') return ''
  if (!value || value.length > RELATION_SLUG_MAX) return ''
  if (/\s/.test(value)) return ''
  if (value.includes('..')) return ''
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code <= 31 || code === 127) return ''
  }
  return value
}

// 单次只读，8 秒到点杀掉子进程。不走 runGbrain 的 storage_busy 重试。
function runGbrainBounded(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'bash',
      [
        '-lc',
        'set -a; source "$HOME/.gbrain/env"; set +a; export PATH="$HOME/.bun/bin:$PATH"; exec "${SNOWFLAKE_GBRAIN_BIN:-$HOME/.bun/bin/gbrain}" "$@"',
        'bash',
        ...args,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const stdout = []
    let size = 0
    let settled = false
    let timer = null
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn(value)
    }
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(reject, new Error('gbrain 超时'))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > RELATION_GBRAIN_STDOUT_MAX) {
        child.kill('SIGKILL')
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', () => {})
    child.on('error', (error) => finish(reject, error))
    child.on('close', (code) => {
      if (code !== 0) {
        finish(reject, new Error(`退出码 ${code}`))
        return
      }
      finish(resolve, Buffer.concat(stdout).toString('utf8'))
    })
    child.stdin.end()
  })
}

function parseCliJson(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // 前面可能有升级提示，取第一段 JSON。
  }
  const arrayAt = text.indexOf('[')
  const objectAt = text.indexOf('{')
  let start = -1
  if (arrayAt >= 0 && (objectAt < 0 || arrayAt < objectAt)) start = arrayAt
  else if (objectAt >= 0) start = objectAt
  if (start < 0) return null
  const end = text.lastIndexOf(text[start] === '[' ? ']' : '}')
  if (end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function brainEdgeLabel(value) {
  if (typeof value !== 'string') return '脑反链'
  const text = value.trim()
  if (!text || text.length > 80) return '脑反链'
  return text
}

function pushBrainEdge(bucket, seen, slug, from, to, label) {
  if (typeof from !== 'string' || typeof to !== 'string') return
  const fromSlug = from.trim()
  const toSlug = to.trim()
  if (!fromSlug || !toSlug) return
  if (fromSlug !== slug && toSlug !== slug) return
  const key = `${fromSlug}\0${toSlug}\0${label}`
  if (seen.has(key)) return
  if (bucket.length >= RELATION_BACKLINK_MAX) return
  seen.add(key)
  bucket.push({ fromSlug, toSlug, label })
}

function takeBrainLink(bucket, seen, slug, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return
  if (typeof item.depth === 'number' && item.depth > 1) return
  const from = item.from_slug ?? item.fromSlug
  const to = item.to_slug ?? item.toSlug
  if (typeof from === 'string' && typeof to === 'string') {
    pushBrainEdge(bucket, seen, slug, from, to, brainEdgeLabel(item.link_type ?? item.type))
    return
  }
  if (typeof item.slug !== 'string' || !Array.isArray(item.links)) return
  for (const link of item.links) {
    if (!link || typeof link !== 'object') continue
    if (typeof link.depth === 'number' && link.depth > 1) continue
    pushBrainEdge(bucket, seen, slug, item.slug, link.to_slug ?? link.toSlug, brainEdgeLabel(link.link_type ?? link.type))
  }
}

function collectBrainEdges(slug, parsed, bucket, seen) {
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) takeBrainLink(bucket, seen, slug, item)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const key of ['links', 'edges', 'nodes', 'paths', 'backlinks']) {
      if (Array.isArray(value[key])) visit(value[key])
    }
  }
  visit(parsed)
}

async function readRelationBacklinks(slug) {
  if (await gbrainDisabled()) return { ok: false, edges: [] }
  const commands = [
    ['backlinks', slug, '--json'],
    ['graph', slug, '--depth', '1', '--json'],
  ]
  const reads = await Promise.all(
    commands.map(async (args) => {
      try {
        return { ok: true, value: await runGbrainBounded(args, RELATION_BACKLINK_TIMEOUT_MS) }
      } catch {
        return { ok: false, value: '' }
      }
    }),
  )
  if (reads.some((item) => !item.ok)) return { ok: false, edges: [] }
  const parsed = reads.map((item) => parseCliJson(item.value))
  if (parsed.some((item) => item === null)) return { ok: false, edges: [] }
  const edges = []
  const seen = new Set()
  for (const item of parsed) collectBrainEdges(slug, item, edges, seen)
  return { ok: true, edges }
}

function flagValue(args, flag) {
  const index = args.indexOf(flag)
  if (index < 0 || index + 1 >= args.length) return ''
  return typeof args[index + 1] === 'string' ? args[index + 1] : ''
}

function isWritePending(error) {
  if (!error) return false
  if (error.exitCode === 10) return true
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('write_pending')
}

function parseJsonObject(raw) {
  const text = typeof raw === 'string' ? raw : ''
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const WRITE_DONE = new Set(['committed'])
const WRITE_FAIL = new Set(['failed', 'conflict', 'cancelled'])

async function readWriteReceipt(requestId) {
  const out = await runGbrain(['write-request', requestId, '--json'])
  const parsed = parseJsonObject(out)
  if (!parsed || typeof parsed.state !== 'string') return null
  return parsed
}

// write_pending 用同一次 request-id 重跑，或轮询 write-request。不换新 id，也不进 storage_busy 循环。
async function runGbrainCommitted(args, stdin) {
  const requestId = flagValue(args, '--request-id')
  const deadline = Date.now() + 30000
  let pending = null
  for (;;) {
    try {
      return await runGbrain(args, stdin)
    } catch (error) {
      if (!requestId || !isWritePending(error)) throw error
      pending = error instanceof Error ? error : new Error(String(error))
    }
    let receipt = null
    try {
      receipt = await readWriteReceipt(requestId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('not_found') && !message.includes('No accessible write request')) {
        pending = error instanceof Error ? error : new Error(message)
      }
    }
    if (receipt && WRITE_DONE.has(receipt.state)) return JSON.stringify(receipt)
    if (receipt && WRITE_FAIL.has(receipt.state)) {
      const detail = [receipt.write_error, receipt.write_error_message, receipt.state].filter((item) => typeof item === 'string' && item).join(' ')
      throw new Error(detail || receipt.state)
    }
    const waitRaw = receipt && Number(receipt.retry_after_ms)
    const wait = Number.isFinite(waitRaw) && waitRaw > 0 ? Math.min(waitRaw, 3000) : 500
    if (Date.now() + wait >= deadline) throw pending || new Error('write_pending')
    await sleepMs(wait)
  }
}

async function putCompiled(page, compiled) {
  if (await gbrainDisabled()) throw new Error('gbrain 不可用，没有写入')
  await runGbrain(['put', page], compiled.endsWith('\n') ? compiled : `${compiled}\n`)
}

async function addTimeline(page, text, failMessage, requestId) {
  if (await gbrainDisabled()) throw new Error(failMessage)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const args = ['timeline-add', page, date, text]
  const id = typeof requestId === 'string' ? requestId.trim() : ''
  if (id) {
    args.push('--request-id', id)
    await runGbrainCommitted(args)
    return
  }
  await runGbrain(args)
}

function captureText(cardId, content) {
  const plain = stripMarkdown(content)
  if (!plain) return ''
  return `来源：雪花画布卡片 ${cardId}\n\n${plain}\n`
}

// gbrain capture --json 只在真正落盘后给 slug；只收下请求（write_request 不是 committed）时也是退出码 0，要当没写进。
function captureSlug(out) {
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start < 0 || end < start) return ''
  let result
  try {
    result = JSON.parse(out.slice(start, end + 1))
  } catch {
    return ''
  }
  if (!result || typeof result !== 'object') return ''
  const receipt = result.write_request
  if (receipt && typeof receipt === 'object' && receipt.state !== 'committed') return ''
  return typeof result.slug === 'string' ? result.slug.trim() : ''
}

// 只跑一次：写入脑是用户当场点的，失败要马上告诉他，不走 put 那套 storage_busy 退避。
async function captureToBrain(text) {
  if (await gbrainDisabled()) throw new Error('gbrain 不可用')
  let out
  try {
    out = await runGbrainOnce(['capture', '--stdin', '--json'], text)
  } catch (error) {
    throw new Error(`gbrain 不可用：${error instanceof Error ? error.message : String(error)}`)
  }
  const slug = captureSlug(out)
  if (!slug) throw new Error('gbrain 没有给回页名，可能还没写完')
  return slug
}

function gbrainBinary() {
  return readEnv('SNOWFLAKE_GBRAIN_BIN') || join(process.env.HOME || '', '.bun', 'bin', 'gbrain')
}

async function timelineReachable() {
  if (await gbrainDisabled()) return false
  return access(gbrainBinary(), fsConstants.X_OK).then(
    () => true,
    () => false,
  )
}

// 时间线只是附带记录：不进写入队列，不等结果，失败只记日志。
function recordKeepTimeline(version) {
  void loadConfig()
    .then((config) => addTimeline(config.gbrainPage, `留下这一版 version=${version}`, 'gbrain 不可用，时间线没记上'))
    .catch((error) => {
      console.error(`留下这一版 version=${version}：时间线没记上：${error instanceof Error ? error.message : String(error)}`)
    })
}

const EXPAND_TIMEOUT_MS = 60_000
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EADDRNOTAVAIL', 'ECONNRESET'])

function expandError(reply, status, error) {
  reply.code(status)
  reply.header('Content-Type', 'application/json; charset=utf-8')
  return reply.send(JSON.stringify({ error }))
}

function upstreamReason(error) {
  const code = error && typeof error.code === 'string' ? error.code : ''
  const where = `${expandHost}:${expandPort}`
  if (UNREACHABLE_CODES.has(code)) return `连不上扩写服务（${where}，${code}）`
  return `扩写服务连接出错（${where}${code ? `，${code}` : ''}）`
}

function proxyExpand(request, reply) {
  if (request.method !== 'POST') {
    reply.header('Allow', 'POST')
    return expandError(reply, 405, '扩写只接受 POST 请求')
  }
  const body = request.body
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}))
  if (raw.length > 1_000_000) {
    return expandError(reply, 413, '扩写请求超过 1MB，没有转发')
  }
  return new Promise((resolve) => {
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': String(raw.length),
      Host: `${expandHost}:${expandPort}`,
    }
    const key = readEnv('CPA_API_KEY')
    if (key) headers.Authorization = `Bearer ${key}`
    const upstream = httpRequest(
      {
        hostname: expandHost,
        port: expandPort,
        path: expandPath,
        method: 'POST',
        headers,
      },
      (up) => {
        reply.code(up.statusCode ?? 502)
        const contentType = up.headers['content-type']
        if (typeof contentType === 'string') reply.header('Content-Type', contentType)
        resolve(reply.send(up))
      },
    )
    let timedOut = false
    upstream.setTimeout(EXPAND_TIMEOUT_MS, () => {
      timedOut = true
      upstream.destroy()
      if (!reply.sent) {
        resolve(expandError(reply, 504, `扩写服务 ${EXPAND_TIMEOUT_MS / 1000} 秒没有回复，超时`))
      }
    })
    upstream.on('error', (error) => {
      if (!reply.sent && !timedOut) {
        resolve(expandError(reply, 502, upstreamReason(error)))
      }
    })
    upstream.end(raw)
  })
}

function failRaw(raw, status, error) {
  const body = JSON.stringify({ error })
  if (!raw.headersSent) {
    raw.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'X-Content-Type-Options': 'nosniff',
    })
  }
  if (!raw.writableEnded) raw.end(body)
}

async function proxyGatewayStream(raw, upstream) {
  const headers = {
    'Content-Type': upstream.headers.get('content-type') || 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  }
  const sessionHeader = upstream.headers.get('x-hermes-session-id')
  if (sessionHeader) headers['X-Hermes-Session-Id'] = sessionHeader
  raw.writeHead(upstream.status, headers)
  if (typeof raw.flushHeaders === 'function') raw.flushHeaders()
  if (!upstream.body) {
    raw.end()
    return
  }
  const reader = upstream.body.getReader()
  let clientGone = false
  const markGone = () => {
    clientGone = true
  }
  raw.on('close', markGone)
  raw.on('error', markGone)
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (clientGone) continue
      const ok = raw.write(Buffer.from(value))
      if (!ok && !clientGone) {
        await new Promise((resolve) => raw.once('drain', resolve))
      }
    }
  } catch {
    // 上游中断时只收尾浏览器这一侧。
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // 读锁已经放开。
    }
    if (!clientGone && !raw.writableEnded) raw.end()
  }
}

async function resolveSedimentQuote(sessionId, quote) {
  const trimmed = quote.trim()
  let page
  try {
    page = await fetchMessagePage(gatewayFetch, sessionId, { limit: 60 })
  } catch {
    return { error: `对不上这条消息：${trimmed}` }
  }
  const messages = Array.isArray(page.messages) ? page.messages : []
  const hit = [...messages].reverse().find((item) => item && typeof item.content === 'string' && item.content.trim() === trimmed)
  if (!hit) return { error: `对不上这条消息：${trimmed}` }
  const resolved = await resolveAdoptionKey(gatewayFetch, sessionId, {
    role: hit.role,
    at: hit.at || '',
    content: hit.content,
    messageId: hit.id,
  })
  if (!resolved || !resolved.key) return { error: `对不上这条消息：${trimmed}` }
  return { adoptionKey: resolved.key }
}


async function readEncyclopediaSnapshot(slug) {
  try {
    const out = await runGbrain(['get', slug, '--include-content', '--content-only', '--json'])
    const parsed = parsePageSnapshot(out)
    if (!parsed) throw new Error('gbrain 没有给回页的版本')
    return parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (pageMissingMessage(message)) return null
    throw error
  }
}

async function putEncyclopediaPage(args) {
  if (await gbrainDisabled()) throw new Error('gbrain 不可用，没有写入')
  const argv = ['put', args.slug, '--request-id', args.requestId]
  // 页已存在时必须带刚读到的版本。新建页时 gbrain 不接受版本号，调用方不会带这个参数。
  if (typeof args.expectedRevision === 'string' && args.expectedRevision) {
    argv.push('--expected-revision', args.expectedRevision)
  }
  const content = args.content.endsWith('\n') ? args.content : `${args.content}\n`
  await runGbrainCommitted(argv, content)
}

function timelineCommandText(stdout) {
  const text = typeof stdout === 'string' ? stdout.trim() : ''
  if (!text || text === 'No timeline entries.') return ''
  return text
}

// 沉淀 requestId 只留给 timeline-add。缺页时用卡面 put，request-id 另造；页已在则不改正文。
async function ensureSedimentPage(document, entity, sedimentRequestId) {
  void document
  const slug = entity && typeof entity.slug === 'string' ? entity.slug.trim() : ''
  if (!slug) return { ok: false, error: '还没绑定' }
  try {
    const out = await runGbrain(['get', slug, '--include-content', '--content-only', '--json'])
    const parsed = parsePageSnapshot(out)
    if (!parsed) return { ok: false, error: 'gbrain 没有给回页的版本' }
    return { ok: true, present: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!pageMissingMessage(message)) return { ok: false, error: message }
    const body = composeEntityPage(entity, document)
    if (!body) return { ok: false, error: message }
    const putId = randomUUID()
    if (putId === sedimentRequestId) return { ok: false, error: '建页编号撞上了沉淀编号' }
    await putEncyclopediaPage({ slug, content: body, requestId: putId })
    return { ok: true, created: true }
  }
}

async function confirmSedimentTimeline(page, requestId) {
  const out = await runGbrain(['timeline', page])
  return typeof out === 'string' && out.includes(requestId)
}

function registerApi(app, prefix) {
  registerAssetRoutes(app, { prefix, bookFor, sendNoBook })
  // 画布和讨论接口各挂两份：旧路径落到活动书，/api/books/:bookId/... 落到指定的书。
  const scoped = (method, path, handler) => {
    app.route({ method, url: `${prefix}/api${path}`, handler })
    app.route({ method, url: `${prefix}/api/books/:bookId${path}`, handler })
  }

  app.get(`${prefix}/api/books`, async (_request, reply) => {
    await ensureBooks()
    reply.header('Cache-Control', 'no-store')
    return reply.send({ books: sortedBooks().map(publicBook), activeBookId })
  })

  app.post(`${prefix}/api/books`, async (request, reply) => {
    await ensureBooks()
    const name = bookNameFrom(request.body) || DEFAULT_BOOK_NAME
    if (name.length > BOOK_NAME_LIMIT) {
      reply.code(400)
      return reply.send({ error: `书名不能超过 ${BOOK_NAME_LIMIT} 个字符` })
    }
    const book = await exclusiveBooks(async () => {
      const created = await createBook(name)
      await setActive(created.id)
      return created
    })
    reply.code(201)
    reply.header('Cache-Control', 'no-store')
    return reply.send(publicBook(book))
  })

  app.patch(`${prefix}/api/books/:bookId`, async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const name = bookNameFrom(request.body)
    if (!name) {
      reply.code(400)
      return reply.send({ error: '书名不能是空的' })
    }
    if (name.length > BOOK_NAME_LIMIT) {
      reply.code(400)
      return reply.send({ error: `书名不能超过 ${BOOK_NAME_LIMIT} 个字符` })
    }
    try {
      await renameBook(book, name)
    } catch (error) {
      if (error && error.statusCode === 404) return sendNoBook(reply)
      throw error
    }
    reply.header('Cache-Control', 'no-store')
    return reply.send(publicBook(book))
  })

  app.post(`${prefix}/api/books/:bookId/activate`, async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    try {
      await activateBook(book)
    } catch (error) {
      if (error && error.statusCode === 404) return sendNoBook(reply)
      throw error
    }
    reply.header('Cache-Control', 'no-store')
    return reply.send(publicBook(book))
  })

  app.delete(`${prefix}/api/books/:bookId`, async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    if (!request.query || request.query.confirm !== '1') {
      reply.code(400)
      return reply.send({ error: '删书要带 confirm=1，这次没有删' })
    }
    try {
      await deleteBook(book)
    } catch (error) {
      if (error && error.statusCode === 404) return sendNoBook(reply)
      if (error && error.statusCode === 409) {
        reply.code(409)
        return reply.send({ error: error.message })
      }
      throw error
    }
    reply.header('Cache-Control', 'no-store')
    return reply.send({ deleted: book.id, activeBookId })
  })

  app.post(`${prefix}/api/books/:bookId/import`, async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const text = request.body && typeof request.body.text === 'string' ? request.body.text : undefined
    if (typeof text !== 'string') {
      reply.code(400)
      return reply.send({ error: '导入要带文本字段 text' })
    }
    if (text.trim() === '') {
      const progress = { status: 'failed', chapterCount: 0, ideaCount: 0, pendingCount: 0, error: '导入文本是空的，没有建章' }
      setImportProgress(book.id, progress)
      reply.code(400)
      reply.header('Cache-Control', 'no-store')
      return reply.send({ error: progress.error })
    }
    setImportProgress(book.id, { status: 'running', chapterCount: 0, ideaCount: 0, pendingCount: 0, error: '' })
    try {
      const outcome = await exclusive(book, async () => {
        const current = await readCanonical(book)
        const imported = importPlainText(current.document, text)
        const importedDocument = await presentDocument(imported.document)
        await commitEnvelope(book, envelope(current.version + 1, importedDocument, current.snapshots))
        return imported.counts
      })
      const progress = {
        status: 'done',
        chapterCount: outcome.chapterCount,
        ideaCount: outcome.ideaCount,
        pendingCount: outcome.pendingCount,
        error: '',
      }
      setImportProgress(book.id, progress)
      reply.header('Cache-Control', 'no-store')
      return reply.send(progress)
    } catch (error) {
      const progress = {
        status: 'failed',
        chapterCount: 0,
        ideaCount: 0,
        pendingCount: 0,
        error: error instanceof Error ? error.message : '导入没有完成',
      }
      setImportProgress(book.id, progress)
      reply.code(error && error.statusCode ? error.statusCode : 500)
      return reply.send({ error: progress.error })
    }
  })

  app.get(`${prefix}/api/books/:bookId/import`, async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    reply.header('Cache-Control', 'no-store')
    return reply.send(getImportProgress(book.id))
  })

  scoped('GET', '/canvas', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    let record
    try {
      record = await exclusive(book, () => readCanonical(book))
    } catch (error) {
      if (isUnreadable(error)) return sendUnreadable(reply)
      throw error
    }
    reply.header('X-Snapshot-Count', String(await snapshotCount(book)))
    return sendCanvas(reply, record)
  })

  scoped('GET', '/canvas/snapshots', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    reply.header('Cache-Control', 'no-store')
    return reply.send(await listSnapshots(book))
  })

  scoped('PUT', '/canvas', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    if (!isDocument(request.body)) {
      reply.code(400)
      return reply.send({ error: '正文不是一份完整画布 JSON' })
    }
    const document = await presentDocument(request.body)
    if (!isDocument(document)) {
      reply.code(400)
      return reply.send({ error: '正文不是一份完整画布 JSON' })
    }
    const header = request.headers['if-match']
    const ifMatch = Array.isArray(header) ? header.join(',') : header
    let outcome
    try {
      outcome = await exclusive(book, async () => {
        const current = await readCanonical(book)
        if (!ifMatchSatisfied(ifMatch, current.version)) {
          return { status: 412, record: current }
        }
        await validateDocumentFlows(document)
        const next = envelope(current.version + 1, document, current.snapshots)
        const saved = await commitEnvelope(book, next)
        return { status: 200, record: saved }
      })
    } catch (error) {
      if (isUnreadable(error)) return sendUnreadable(reply)
      throw error
    }
    reply.code(outcome.status)
    return sendCanvas(reply, outcome.record)
  })

  // 起草只返回草稿。不写 snowflake.json，不把草稿塞进 flows。
  scoped('POST', '/flows/draft', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    let scope
    try {
      scope = readDraftScope(request.body)
    } catch (error) {
      reply.code(400)
      reply.header('Cache-Control', 'no-store')
      return reply.send({ error: error instanceof Error && error.message ? error.message : '范围没有给对' })
    }
    let record
    try {
      record = await exclusive(book, () => readCanonical(book))
    } catch (error) {
      if (isUnreadable(error)) return sendUnreadable(reply)
      if (error && error.statusCode === 404) return sendNoBook(reply)
      throw error
    }
    try {
      const complete = await resolveDraftComplete()
      const draft = await draftFlow(record.document, scope, { complete })
      reply.header('Cache-Control', 'no-store')
      return reply.send(draft)
    } catch (error) {
      const status = error && error.statusCode === 400 ? 400 : 502
      reply.code(status)
      reply.header('Cache-Control', 'no-store')
      const fallback = status === 400 ? '范围没有给对' : '连不上起草服务'
      const message = error instanceof Error && error.message ? error.message : fallback
      return reply.send({ error: message })
    }
  })

  scoped('POST', '/canvas/keep', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const header = request.headers['if-match']
    const ifMatch = Array.isArray(header) ? header.join(',') : header
    let outcome
    try {
      outcome = await exclusive(book, async () => {
        const current = await readCanonical(book)
        if (!ifMatchSatisfied(ifMatch, current.version)) return { status: 412, record: current }
        const snapshotName = await writeSnapshotFile(book, current.document, new Date())
        try {
          const saved = await commitEnvelope(book, envelope(current.version + 1, current.document, current.snapshots))
          return { status: 200, record: saved, snapshotName, keptVersion: current.version }
        } catch {
          return { status: 500, snapshotName }
        }
      })
    } catch (error) {
      if (isUnreadable(error)) return sendUnreadable(reply)
      if (error && error.statusCode === 404) return sendNoBook(reply)
      reply.code(500)
      return reply.send({ error: error instanceof Error ? `快照没有存下：${error.message}` : '快照没有存下' })
    }
    if (outcome.status === 412) {
      reply.code(412)
      return sendCanvas(reply, outcome.record)
    }
    if (outcome.status === 500) {
      reply.code(500)
      return reply.send({ error: `快照已存下（${outcome.snapshotName}），但正本版本号没有更新`, snapshotName: outcome.snapshotName })
    }
    let timeline = 'skipped'
    if (await timelineReachable()) {
      recordKeepTimeline(outcome.keptVersion)
      timeline = 'ok'
    }
    const count = await snapshotCount(book)
    reply.code(200)
    reply.header('X-Snapshot-Count', String(count))
    return sendCanvas(reply, outcome.record, { snapshotCount: count, snapshotName: outcome.snapshotName, timeline })
  })

  scoped('POST', '/canvas/rollback', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const name = request.body && typeof request.body === 'object' ? request.body.name : undefined
    if (!isSnapshotName(name)) {
      reply.code(400)
      return reply.send({ error: '快照名不对' })
    }
    const header = request.headers['if-match']
    const ifMatch = Array.isArray(header) ? header.join(',') : header
    let outcome
    try {
      outcome = await exclusive(book, async () => {
        const current = await readCanonical(book)
        if (!ifMatchSatisfied(ifMatch, current.version)) return { status: 412, record: current }
        let selected
        try {
          selected = JSON.parse(await readFile(join(book.dir, name), 'utf8'))
        } catch (error) {
          if (error && error.code === 'ENOENT') return { status: 404, error: '没有这份快照' }
          return { status: 422, error: '这份快照读不出来' }
        }
        if (!isDocument(selected)) return { status: 422, error: '这份快照不是完整画布' }
        await writeSnapshotFile(book, current.document, new Date())
        const restored = await presentDocument(selected)
        if (!isDocument(restored)) return { status: 422, error: '这份快照不是完整画布' }
        const saved = await commitEnvelope(book, envelope(current.version + 1, restored, current.snapshots))
        return { status: 200, record: saved }
      })
    } catch (error) {
      if (isUnreadable(error)) return sendUnreadable(reply)
      if (error && error.statusCode === 404) return sendNoBook(reply)
      reply.code(500)
      return reply.send({ error: error instanceof Error ? `没有回退：${error.message}` : '没有回退' })
    }
    if (outcome.status === 404 || outcome.status === 422) {
      reply.code(outcome.status)
      return reply.send({ error: outcome.error })
    }
    reply.code(outcome.status)
    reply.header('X-Snapshot-Count', String(await snapshotCount(book)))
    return sendCanvas(reply, outcome.record)
  })

  app.get(`${prefix}/api/health`, async () => ({ ok: true }))

  app.get(`${prefix}/api/relation/backlinks`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const slug = relationBacklinkSlug(request.query?.slug)
    if (!slug) {
      reply.code(400)
      return reply.send({ error: '页名不合法' })
    }
    try {
      return reply.send(await readRelationBacklinks(slug))
    } catch {
      return reply.send({ ok: false, edges: [] })
    }
  })

  scoped('GET', '/discuss/session', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const cardId = textField(request.query?.cardId)
    if (!cardId) {
      reply.code(400)
      return reply.send({ error: '缺少 cardId' })
    }
    try {
      const context = await discussContextText(book, cardId)
      const { store, sessionId } = await ensureCardSession(book, cardId, context)
      reply.header('Cache-Control', 'no-store')
      return reply.send(discussSessionResponse(cardId, sessionId, publicSessions(store, cardId), context))
    } catch (error) {
      return discussFailure(reply, error, '画布会话没有建成')
    }
  })

  scoped('POST', '/discuss/session', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const cardId = textField(body.cardId)
    const sessionId = textField(body.sessionId)
    if (!cardId) {
      reply.code(400)
      return reply.send({ error: '缺少 cardId' })
    }
    try {
      const context = await discussContextText(book, cardId)
      const result = sessionId
        ? await selectCardSession(book, cardId, sessionId)
        : await createCardSession(book, cardId, context)
      reply.header('Cache-Control', 'no-store')
      return reply.send(discussSessionResponse(cardId, result.sessionId, publicSessions(result.store, cardId), context))
    } catch (error) {
      return discussFailure(reply, error, '画布会话没有建成')
    }
  })

  scoped('GET', '/discuss/messages', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const cardId = textField(request.query?.cardId)
    const sessionId = textField(request.query?.sessionId)
    try {
      const store = await assertOwned(book, cardId, sessionId, false)
      const page = await loadMessagePage(gatewayFetch, store, cardId, sessionId, {
        limit: request.query?.limit,
        offset: request.query?.offset,
      })
      reply.header('Cache-Control', 'no-store')
      return reply.send(page)
    } catch (error) {
      return discussFailure(reply, error, '讨论记录没有取到')
    }
  })

  scoped('GET', '/discuss/adoption', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const cardId = textField(request.query?.cardId)
    const sessionId = textField(request.query?.sessionId)
    const adoptionKey = textField(request.query?.adoptionKey)
    let store = { cards: {} }
    try {
      const raw = await readSessionRaw(book)
      if (raw && !isLegacyRecord(raw)) store = normalizeStore(raw)
    } catch {
      store = { cards: {} }
    }
    const hit = locateAdoption(store, cardId, sessionId, adoptionKey)
    reply.code(200)
    reply.header('Cache-Control', 'no-store')
    return reply.send(hit)
  })

  scoped('POST', '/discuss/adoptions', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const cardId = textField(body.cardId)
    const sessionId = textField(body.sessionId)
    const content = textField(body.content)
    if (!content) {
      reply.code(400)
      return reply.send({ error: '缺少采纳内容' })
    }
    try {
      await assertOwned(book, cardId, sessionId, false)
      const resolved = await resolveAdoptionKey(gatewayFetch, sessionId, {
        messageId: textField(body.messageId),
        role: textField(body.role) || 'assistant',
        at: textField(body.at),
        content,
      })
      const adoptedAt = new Date().toISOString()
      await recordAdoption(book, cardId, sessionId, { ...resolved, adoptedAt })
      reply.header('Cache-Control', 'no-store')
      return reply.send({ cardId, sessionId, key: resolved.key, adoptedAt })
    } catch (error) {
      return discussFailure(reply, error, '采纳记录没有存上')
    }
  })

  scoped('POST', '/sediment', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    let outcome
    try {
      outcome = await exclusive(book, async () => {
        const current = await readCanonical(book)
        const raw = await readSessionRaw(book)
        const store = raw && !isLegacyRecord(raw) ? normalizeStore(raw) : { cards: {} }
        const result = await writeSediment(
          { document: current.document, store, bookId: book.id, body },
          { addTimeline, gbrainDisabled, resolveQuote: resolveSedimentQuote, ensurePage: ensureSedimentPage, confirmTimeline: confirmSedimentTimeline },
        )
        if (result.statusCode >= 400) return result
        const nextText = JSON.stringify(result.document)
        if (nextText !== JSON.stringify(current.document)) {
          const stored = await presentDocument(result.document)
          await commitEnvelope(book, envelope(current.version + 1, stored, current.snapshots))
        }
        if (raw && !isLegacyRecord(raw)) {
          const before = JSON.stringify(normalizeStore(raw))
          const after = JSON.stringify(normalizeStore(result.store))
          if (before !== after) await writeSessionStore(book, result.store, knownSessionIds(normalizeStore(raw)))
        }
        return result
      })
    } catch (error) {
      return discussFailure(reply, error, '沉淀没有写上')
    }
    reply.code(outcome.statusCode)
    reply.header('Cache-Control', 'no-store')
    return reply.send(outcome.payload)
  })

  app.get(`${prefix}/api/encyclopedia/page`, async (request, reply) => {
    const slug = textField(request.query?.slug)
    if (!slug) {
      reply.code(400)
      return reply.send({ error: '缺少页名' })
    }
    reply.header('Cache-Control', 'no-store')
    try {
      if (await gbrainDisabled()) {
        reply.code(502)
        return reply.send({ error: 'gbrain 不可用' })
      }
      const raw = await runGbrain(['get', slug])
      let rowText = ''
      try {
        rowText = timelineCommandText(await runGbrain(['timeline', slug]))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`slug=${slug} requestId= encyclopedia-read ${message}`)
      }
      const timeline = [timelineBelow(raw), rowText].filter(Boolean).join('\n')
      return reply.send({ ok: true, slug, finalized: finalizedText(raw), timeline })
    } catch (error) {
      reply.code(502)
      return reply.send({ error: error instanceof Error ? error.message : 'gbrain 读取失败' })
    }
  })

  scoped('POST', '/encyclopedia/promote', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const entityId = textField(body.entityId)
    const requestId = textField(body.requestId)
    if (!entityId || !requestId) {
      reply.code(400)
      return reply.send({ error: '缺少实体或 requestId' })
    }
    let document
    try {
      const current = await exclusive(book, () => readCanonical(book))
      document = current.document
    } catch (error) {
      return discussFailure(reply, error, '升格没有写上')
    }
    try {
      const result = await promoteEntityPage(document, entityId, requestId, {
        bookId: book.id,
        readPage: (slug) => readEncyclopediaSnapshot(slug),
        putPage: (args) => putEncyclopediaPage(args),
      })
      reply.code(result.statusCode || (result.ok ? 200 : 502))
      reply.header('Cache-Control', 'no-store')
      if (!result.ok) return reply.send({ error: result.error || '升格没有写上' })
      return reply.send({ ok: true, slug: result.slug })
    } catch (error) {
      reply.code(502)
      return reply.send({ error: error instanceof Error ? error.message : '升格没有写上' })
    }
  })

  scoped('POST', '/discuss/stream', async (request, reply) => {
    // 必须在任何 await 之前接管，否则底层连接不会把后来的字节送出去。
    reply.hijack()
    const raw = reply.raw
    raw.setTimeout(0)
    if (raw.socket && typeof raw.socket.setNoDelay === 'function') raw.socket.setNoDelay(true)
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const message = textField(body.message)
    const cardId = textField(body.cardId)
    const sessionId = textField(body.sessionId)
    if (!message) {
      failRaw(raw, 400, '缺少讨论内容')
      return
    }
    if (!cardId) {
      failRaw(raw, 400, '缺少 cardId')
      return
    }
    const book = await bookFor(request)
    if (!book) {
      failRaw(raw, 404, MSG_NO_BOOK)
      return
    }
    try {
      await assertOwned(book, cardId, sessionId, true)
    } catch (error) {
      failRaw(raw, error && error.statusCode ? error.statusCode : 400, error instanceof Error ? error.message : 'cardId 对不上该会话')
      return
    }
    void recordFirstAsk(book, cardId, sessionId, message).catch(() => {})
    let upstream
    try {
      upstream = await gatewayFetch(`/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, instructions: DISCUSS_INSTRUCTIONS }),
      })
    } catch {
      failRaw(raw, 502, '网关讨论没有连上')
      return
    }
    await proxyGatewayStream(raw, upstream)
  })

  scoped('GET', '/discuss/runs/:runId', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const cardId = textField(request.query?.cardId)
    const sessionId = textField(request.query?.sessionId)
    try {
      await assertOwned(book, cardId, sessionId, false)
    } catch (error) {
      return discussFailure(reply, error, 'cardId 对不上该会话')
    }
    const runId = request.params.runId
    const upstream = await gatewayFetch(`/v1/runs/${encodeURIComponent(runId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    const text = await upstream.text()
    reply.code(upstream.status)
    reply.header('Content-Type', upstream.headers.get('content-type') || 'application/json')
    return reply.send(text)
  })

  scoped('POST', '/discuss/runs/:runId/stop', async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const cardId = textField(request.query?.cardId)
    const sessionId = textField(request.query?.sessionId)
    try {
      await assertOwned(book, cardId, sessionId, false)
    } catch (error) {
      return discussFailure(reply, error, 'cardId 对不上该会话')
    }
    const runId = request.params.runId
    const upstream = await gatewayFetch(`/v1/runs/${encodeURIComponent(runId)}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
    })
    const text = await upstream.text()
    reply.code(upstream.status)
    reply.header('Content-Type', upstream.headers.get('content-type') || 'application/json')
    return reply.send(text)
  })

  app.get(`${prefix}/api/brain/page`, async (_request, reply) => {
    try {
      const page = (await loadConfig()).gbrainPage
      if (await gbrainDisabled()) {
        reply.code(502)
        return reply.send({ error: 'gbrain 不可用，没有写入' })
      }
      const raw = await runGbrain(['get', page])
      return reply.send({ page, compiled: stripTimeline(raw) })
    } catch (error) {
      reply.code(502)
      return reply.send({ error: error instanceof Error ? error.message : 'gbrain 读取失败' })
    }
  })

  app.post(`${prefix}/api/brain/write`, async (request, reply) => {
    const compiled = request.body && typeof request.body.compiled === 'string' ? request.body.compiled : ''
    const timeline = request.body && typeof request.body.timeline === 'string' ? request.body.timeline.trim() : ''
    if (!compiled.trim()) {
      reply.code(400)
      return reply.send({ error: '定稿是空的，没有写入' })
    }
    if (!timeline) {
      reply.code(400)
      return reply.send({ error: '时间线摘要是空的，没有写入' })
    }
    if (compiled.includes(timeline)) {
      reply.code(400)
      return reply.send({ error: '时间线内容不能写进定稿正文' })
    }
    if (compiled.includes('<!-- timeline -->')) {
      reply.code(400)
      return reply.send({ error: '定稿正文里不能带时间线标记' })
    }
    try {
      const page = (await loadConfig()).gbrainPage
      await putCompiled(page, compiled)
      await addTimeline(page, timeline, 'gbrain 不可用，没有写入')
      return reply.send({ ok: true, page })
    } catch (error) {
      reply.code(502)
      return reply.send({ error: error instanceof Error ? error.message : '写入脑失败' })
    }
  })

  // 讨论里单条 AI 回复追加进 gbrain：capture 新建一页，slug 由 gbrain 生成；不碰 projects/snowflake-canvas，也不改讨论记录。
  app.post(`${prefix}/api/brain/capture`, async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const cardId = textField(body.cardId)
    const sessionId = textField(body.sessionId)
    const role = textField(body.role) || 'assistant'
    const content = typeof body.content === 'string' ? body.content : ''
    if (role !== 'assistant') {
      reply.code(400)
      return reply.send({ error: '只能把 AI 回复写入脑' })
    }
    try {
      await assertOwnedAnyBook(cardId, sessionId)
    } catch (error) {
      return discussFailure(reply, error, 'cardId 对不上该会话')
    }
    const text = captureText(cardId, content)
    if (!text) {
      reply.code(400)
      return reply.send({ error: '这条结论是空的，没有写入' })
    }
    reply.header('Cache-Control', 'no-store')
    try {
      const slug = await captureToBrain(text)
      return reply.send({ ok: true, slug })
    } catch (error) {
      reply.code(502)
      return reply.send({ error: error instanceof Error ? error.message : 'gbrain 不可用' })
    }
  })
}

const app = Fastify({
  logger: false,
  bodyLimit: 32 * 1024 * 1024,
  requestTimeout: 0,
  connectionTimeout: 0,
  trustProxy: false,
})

app.addContentTypeParser(/^multipart\/form-data/i, { parseAs: 'buffer', bodyLimit: 10 * 1024 * 1024 + 256 * 1024 }, (request, body, done) => {
  done(null, body)
})

app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
  if (request.url === '/__snowflake/expand') {
    done(null, body)
    return
  }
  try {
    done(null, JSON.parse(body))
  } catch (error) {
    error.statusCode = 400
    done(error, undefined)
  }
})

app.addHook('onRequest', async (request, reply) => {
  delete request.headers.authorization
  for (const name of Object.keys(request.headers)) {
    if (name.toLowerCase().startsWith('x-hermes-')) delete request.headers[name]
  }
  reply.header('X-Content-Type-Options', 'nosniff')
})

registerApi(app, '')
registerApi(app, '/xuehua')

app.route({
  method: ['GET', 'POST'],
  url: '/__snowflake/expand',
  handler: proxyExpand,
})

await ensureDataDir()
await ensureBooks()
for (const book of sortedBooks()) {
  await removeStaleTemps(book.dir)
  try {
    await exclusive(book, () => readCanonical(book))
  } catch (error) {
    if (!isUnreadable(error)) throw error
    console.error(`书 ${book.id}：${MSG_CANONICAL_UNREADABLE}：原文件已改名为 ${book.canonicalBroken?.kept ?? ''}`)
  }
  if (!book.canonicalBroken) {
    try {
      await exclusive(book, () => migrateEmbeddedSnapshots(book))
    } catch (error) {
      console.error(
        `书 ${book.id}：旧快照迁移失败，正本里的旧数组原样保留：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

function staticCacheHeader(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/')
  const base = normalized.split('/').pop() || ''
  if (base === 'index.html' || base.endsWith('.html')) return 'no-store'
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(normalized)) {
    return 'public, max-age=31536000, immutable'
  }
  return 'no-cache'
}

await app.register(fastifyStatic, {
  root: distDir,
  prefix: '/',
  decorateReply: false,
  index: ['index.html'],
  cacheControl: false,
  setHeaders(reply, filePath) {
    reply.header('Cache-Control', staticCacheHeader(filePath))
  },
})

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/') || request.url.startsWith('/xuehua/api/')) {
    reply.code(404)
    return reply.send({ error: '没有这个接口' })
  }
  if (request.url === '/' || request.url.startsWith('/xuehua')) {
    const file = request.url.startsWith('/xuehua') ? join(distDir, 'xuehua', 'index.html') : join(distDir, 'index.html')
    reply.header('Cache-Control', 'no-store')
    reply.type('text/html')
    return reply.send(createReadStream(file))
  }
  reply.code(404)
  return reply.send()
})

await app.listen({ host: listenHost, port: listenPort })
