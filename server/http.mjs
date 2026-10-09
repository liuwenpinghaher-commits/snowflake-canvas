import { spawn } from 'node:child_process'
import { constants as fsConstants, createReadStream } from 'node:fs'
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, utimes } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { dirname, join } from 'node:path'
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
} from './discuss-store.mjs'
import { stripMarkdown } from '../src/strip-markdown.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(repoRoot, 'dist')
const dataDir = readEnv('SNOWFLAKE_DATA_DIR') || '/home/chris/.local/share/snowflake-canvas'
const canonicalPath = join(dataDir, 'snowflake.json')
const canonicalTempPath = join(dataDir, '.snowflake.json.tmp')
const keepTempPath = join(dataDir, '.snowflake.keep.tmp')
const SNAPSHOT_STEM = 'snowflake'
const sessionPath = join(dataDir, 'session.json')
const sessionBackupPath = join(dataDir, 'session.json.bak')
const configPath = join(dataDir, 'config.json')
const gbrainFailFlag = join(dataDir, 'gbrain-force-fail')

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

function isDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const canvas = value.canvas
  const snowflake = value.snowflake
  if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas)) return false
  if (!snowflake || typeof snowflake !== 'object' || Array.isArray(snowflake)) return false
  if (!Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) return false
  if (typeof snowflake.fileId !== 'string' || snowflake.fileId.length === 0) return false
  if (!snowflake.cards || typeof snowflake.cards !== 'object' || Array.isArray(snowflake.cards)) return false
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

let queue = Promise.resolve()
let sessionQueue = Promise.resolve()

function exclusive(task) {
  const run = queue.then(task, task)
  queue = run.then(
    () => {},
    () => {},
  )
  return run
}

function exclusiveSession(task) {
  const run = sessionQueue.then(task, task)
  sessionQueue = run.then(
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

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  await rm(canonicalTempPath, { force: true })
  await rm(keepTempPath, { force: true })
  for (const name of await readdir(dataDir)) {
    if (name.startsWith(`.${SNAPSHOT_STEM}.`) && name.endsWith('.snapshot.json.tmp')) {
      await rm(join(dataDir, name), { force: true })
    }
  }
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

async function snapshotNames() {
  const names = (await readdir(dataDir)).filter(isSnapshotName)
  return names.sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))
}

async function listSnapshots() {
  const items = []
  for (const name of await snapshotNames()) {
    try {
      const info = await stat(join(dataDir, name))
      if (info.isFile()) items.push({ name, savedAt: info.mtime.toISOString() })
    } catch {
      // 列目录和取时间之间文件被移走，就不列它。
    }
  }
  return items
}

async function snapshotCount() {
  return (await snapshotNames()).length
}

// 快照只增不改：先写临时文件、读回比对，再改名成一个目录里还没有的名字。
async function writeSnapshotFile(document, date) {
  const existing = new Set(await readdir(dataDir))
  const name = snapshotNameFor(date, existing)
  const target = join(dataDir, name)
  const temp = join(dataDir, `.${name}.tmp`)
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
async function migrateEmbeddedSnapshots() {
  const record = await readCanonical()
  if (record.snapshots.length === 0) return
  const valid = record.snapshots.every((item) => item && isDocument(item.document))
  if (!valid) {
    console.error('正本里的旧快照有一份不是完整画布，没有迁移，旧数组原样保留')
    return
  }
  const before = new Set()
  for (const name of await snapshotNames()) {
    try {
      before.add(await readFile(join(dataDir, name), 'utf8'))
    } catch {
      // 读不出的旧文件不参与去重。
    }
  }
  for (const item of record.snapshots) {
    const text = JSON.stringify(item.document)
    if (before.has(text)) continue
    const parsed = typeof item.savedAt === 'string' ? new Date(item.savedAt) : null
    const when = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
    const name = await writeSnapshotFile(item.document, when)
    await utimes(join(dataDir, name), when, when)
  }
  await commitEnvelope(envelope(record.version, record.document, []), canonicalTempPath)
  console.error(`正本里的 ${record.snapshots.length} 份旧快照已迁成独立文件`)
}

const MSG_CANONICAL_UNREADABLE = '正本读不出来，已停止编辑'
const canonicalBackupPath = join(dataDir, 'snowflake.json.bak')
let canonicalBroken = null

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
async function quarantineCanonical(reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const kept = join(dataDir, `snowflake.json.corrupt-${stamp}`)
  await rename(canonicalPath, kept)
  canonicalBroken = { kept, reason }
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

async function readCanonical() {
  if (canonicalBroken) throw canonicalUnreadable()
  let text
  try {
    text = await readFile(canonicalPath, 'utf8')
  } catch (error) {
    if (!error || error.code !== 'ENOENT') return quarantineCanonical(error)
    return createCanonical()
  }
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    return quarantineCanonical(error)
  }
  if (!isCanonical(value)) return quarantineCanonical(new Error('正本字段校验不过'))
  return value
}

async function backupCanonical() {
  try {
    const value = await readJson(canonicalPath)
    if (!isCanonical(value)) return
  } catch {
    return
  }
  await copyFile(canonicalPath, canonicalBackupPath)
}

async function createCanonical() {
  const created = envelope(1, emptyDocument(), [])
  await writeExact(canonicalTempPath, JSON.stringify(created))
  const back = await readJson(canonicalTempPath)
  if (back.version !== 1 || !Array.isArray(back.snapshots)) {
    await rm(canonicalTempPath, { force: true })
    throw new Error('正本临时文件校验失败')
  }
  await rename(canonicalTempPath, canonicalPath)
  return back
}

async function commitEnvelope(next, tempPath) {
  const text = JSON.stringify(next)
  await writeExact(tempPath, text)
  const back = await readJson(tempPath)
  if (back.version !== next.version || !Array.isArray(back.snapshots) || !isDocument(back.document)) {
    await rm(tempPath, { force: true })
    throw new Error('正本临时文件校验失败')
  }
  await backupCanonical()
  await rename(tempPath, canonicalPath)
  return back
}

// 快照正文只在独立文件里，响应里的 snapshots 恒为空数组。
function sendCanvas(reply, record, extra) {
  reply.header('ETag', strongEtag(record.version))
  reply.header('Cache-Control', 'no-store')
  return reply.send({ ...envelope(record.version, record.document, []), ...extra })
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

let legacyHeld = null

async function readSessionRaw() {
  try {
    return await readJson(sessionPath)
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

async function backupLegacyOnce(original) {
  let existing = null
  try {
    existing = await readFile(sessionBackupPath)
  } catch {
    existing = null
  }
  if (existing && existing.equals(original)) return
  if (existing && backupLooksComplete(existing)) return
  const handle = await open(sessionBackupPath, 'w', 0o600)
  try {
    await handle.writeFile(original)
    await handle.sync()
  } finally {
    await handle.close()
  }
  const back = await readFile(sessionBackupPath)
  if (!back.equals(original)) {
    await rm(sessionBackupPath, { force: true })
    throw new Error('会话备份校验失败')
  }
}

async function writeSessionStore(store, mustKeep) {
  const normalized = normalizeStore(store)
  const text = JSON.stringify(normalized)
  const temp = join(dataDir, '.session.json.tmp')
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
  await rename(temp, sessionPath)
  legacyHeld = null
  return back
}

async function loadDiscussStoreInner() {
  const record = await exclusive(() => readCanonical())
  const raw = await readSessionRaw()
  if (!raw) {
    legacyHeld = null
    return { cards: {} }
  }
  if (!isLegacyRecord(raw)) {
    legacyHeld = null
    return normalizeStore(raw)
  }
  const legacy = {
    sessionId: raw.sessionId.trim(),
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : DISCUSS_TITLE,
  }
  const target = situationTarget(record.document)
  if (!target) {
    legacyHeld = legacy
    return { cards: {} }
  }
  const original = await readFile(sessionPath)
  await backupLegacyOnce(original)
  const store = storeFromLegacy(legacy, target, new Date().toISOString())
  return writeSessionStore(store, [legacy.sessionId])
}

async function saveDiscussStore(store) {
  if (legacyHeld) {
    const record = await exclusive(() => readCanonical())
    const target = situationTarget(record.document)
    if (!target) {
      throw httpError(409, '还没有念头卡，原来的讨论先留在原文件里')
    }
    const original = await readFile(sessionPath)
    await backupLegacyOnce(original)
    const migrated = storeFromLegacy(legacyHeld, target, new Date().toISOString())
    return writeSessionStore(mergeStores(migrated, store), [legacyHeld.sessionId])
  }
  return writeSessionStore(store, [])
}

async function createGatewaySession(cardId, store) {
  const key = readEnv('API_SERVER_KEY')
  if (!key) throw httpError(503, 'API_SERVER_KEY 未注入')
  const used = new Set(knownSessionIds(store))
  let lastStatus = 502
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const createdAt = new Date().toISOString()
    const nonce = Math.random().toString(36).slice(2, 8)
    const title = `念头讨论 ${createdAt} ${nonce}`
    const created = await gatewayFetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ title, system_prompt: DISCUSS_INSTRUCTIONS }),
    })
    const payload = await created.json().catch(() => ({}))
    lastStatus = created.status
    if (created.status === 201 && payload.session && typeof payload.session.id === 'string') {
      const sessionId = payload.session.id.trim()
      if (sessionId && !used.has(sessionId)) {
        return { sessionId, title, createdAt, cardId, firstAskOpen: true }
      }
    }
  }
  throw httpError(lastStatus === 503 ? 503 : 502, '画布会话没有建成')
}

async function ensureCardSession(cardId) {
  if (!cardId) throw httpError(400, '缺少 cardId')
  return exclusiveSession(async () => {
    let store = await loadDiscussStoreInner()
    const existing = activeSessionId(store, cardId)
    if (existing) return { store, sessionId: existing }
    const created = await createGatewaySession(cardId, store)
    store = await saveDiscussStore(withSession(store, cardId, created))
    return { store, sessionId: created.sessionId }
  })
}

async function createCardSession(cardId) {
  if (!cardId) throw httpError(400, '缺少 cardId')
  return exclusiveSession(async () => {
    const store = await loadDiscussStoreInner()
    const created = await createGatewaySession(cardId, store)
    const saved = await saveDiscussStore(withSession(store, cardId, created))
    return { store: saved, sessionId: created.sessionId }
  })
}

async function selectCardSession(cardId, sessionId) {
  if (!cardId) throw httpError(400, '缺少 cardId')
  if (!sessionId) throw httpError(400, 'cardId 对不上该会话')
  return exclusiveSession(async () => {
    const store = await loadDiscussStoreInner()
    if (!sessionOwned(store, cardId, sessionId)) throw httpError(400, 'cardId 对不上该会话')
    const saved = await saveDiscussStore(withLast(store, cardId, sessionId))
    return { store: saved, sessionId }
  })
}

async function recordFirstAsk(cardId, sessionId, message) {
  return exclusiveSession(async () => {
    const store = await loadDiscussStoreInner()
    const { store: next, changed } = withFirstAsk(store, cardId, sessionId, message)
    if (changed) await saveDiscussStore(next)
  })
}

async function recordAdoption(cardId, sessionId, adoption) {
  return exclusiveSession(async () => {
    const store = await loadDiscussStoreInner()
    if (!sessionOwned(store, cardId, sessionId)) throw httpError(400, 'cardId 对不上该会话')
    return saveDiscussStore(withAdoption(store, cardId, sessionId, adoption))
  })
}

async function assertOwned(cardId, sessionId, touch) {
  if (!cardId) throw httpError(400, '缺少 cardId')
  if (!sessionId) throw httpError(400, 'cardId 对不上该会话')
  return exclusiveSession(async () => {
    const store = await loadDiscussStoreInner()
    if (!sessionOwned(store, cardId, sessionId)) throw httpError(400, 'cardId 对不上该会话')
    if (!touch) return store
    return saveDiscussStore(withLast(store, cardId, sessionId))
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
        reject(new Error(gbrainDetail(err, out, code)))
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

function stripTimeline(markdown) {
  const marker = markdown.indexOf('<!-- timeline -->')
  if (marker < 0) return markdown.trimEnd()
  return markdown.slice(0, marker).trimEnd()
}

async function putCompiled(page, compiled) {
  if (await gbrainDisabled()) throw new Error('gbrain 不可用，没有写入')
  await runGbrain(['put', page], compiled.endsWith('\n') ? compiled : `${compiled}\n`)
}

async function addTimeline(page, text, failMessage) {
  if (await gbrainDisabled()) throw new Error(failMessage)
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  await runGbrain(['timeline-add', page, date, text])
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

function registerApi(app, prefix) {
  app.get(`${prefix}/api/canvas`, async (_request, reply) => {
    let record
    try {
      record = await exclusive(() => readCanonical())
    } catch (error) {
      if (isUnreadable(error)) return sendUnreadable(reply)
      throw error
    }
    reply.header('X-Snapshot-Count', String(await snapshotCount()))
    return sendCanvas(reply, record)
  })

  app.get(`${prefix}/api/canvas/snapshots`, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    return reply.send(await listSnapshots())
  })

  app.put(`${prefix}/api/canvas`, async (request, reply) => {
    const document = request.body
    if (!isDocument(document)) {
      reply.code(400)
      return reply.send({ error: '正文不是一份完整画布 JSON' })
    }
    const header = request.headers['if-match']
    const ifMatch = Array.isArray(header) ? header.join(',') : header
    let outcome
    try {
      outcome = await exclusive(async () => {
        const current = await readCanonical()
        if (!ifMatchSatisfied(ifMatch, current.version)) {
          return { status: 412, record: current }
        }
        const next = envelope(current.version + 1, document, current.snapshots)
        const saved = await commitEnvelope(next, canonicalTempPath)
        return { status: 200, record: saved }
      })
    } catch (error) {
      if (isUnreadable(error)) return sendUnreadable(reply)
      throw error
    }
    reply.code(outcome.status)
    return sendCanvas(reply, outcome.record)
  })

  app.post(`${prefix}/api/canvas/keep`, async (request, reply) => {
    const header = request.headers['if-match']
    const ifMatch = Array.isArray(header) ? header.join(',') : header
    let outcome
    try {
      outcome = await exclusive(async () => {
        const current = await readCanonical()
        if (!ifMatchSatisfied(ifMatch, current.version)) return { status: 412, record: current }
        const snapshotName = await writeSnapshotFile(current.document, new Date())
        try {
          const saved = await commitEnvelope(
            envelope(current.version + 1, current.document, current.snapshots),
            canonicalTempPath,
          )
          return { status: 200, record: saved, snapshotName, keptVersion: current.version }
        } catch {
          return { status: 500, snapshotName }
        }
      })
    } catch (error) {
      if (isUnreadable(error)) return sendUnreadable(reply)
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
    const count = await snapshotCount()
    reply.code(200)
    reply.header('X-Snapshot-Count', String(count))
    return sendCanvas(reply, outcome.record, { snapshotCount: count, snapshotName: outcome.snapshotName, timeline })
  })

  app.post(`${prefix}/api/canvas/rollback`, async (request, reply) => {
    const name = request.body && typeof request.body === 'object' ? request.body.name : undefined
    if (!isSnapshotName(name)) {
      reply.code(400)
      return reply.send({ error: '快照名不对' })
    }
    const header = request.headers['if-match']
    const ifMatch = Array.isArray(header) ? header.join(',') : header
    let outcome
    try {
      outcome = await exclusive(async () => {
        const current = await readCanonical()
        if (!ifMatchSatisfied(ifMatch, current.version)) return { status: 412, record: current }
        let selected
        try {
          selected = JSON.parse(await readFile(join(dataDir, name), 'utf8'))
        } catch (error) {
          if (error && error.code === 'ENOENT') return { status: 404, error: '没有这份快照' }
          return { status: 422, error: '这份快照读不出来' }
        }
        if (!isDocument(selected)) return { status: 422, error: '这份快照不是完整画布' }
        await writeSnapshotFile(current.document, new Date())
        const saved = await commitEnvelope(envelope(current.version + 1, selected, current.snapshots), canonicalTempPath)
        return { status: 200, record: saved }
      })
    } catch (error) {
      if (isUnreadable(error)) return sendUnreadable(reply)
      reply.code(500)
      return reply.send({ error: error instanceof Error ? `没有回退：${error.message}` : '没有回退' })
    }
    if (outcome.status === 404 || outcome.status === 422) {
      reply.code(outcome.status)
      return reply.send({ error: outcome.error })
    }
    reply.code(outcome.status)
    reply.header('X-Snapshot-Count', String(await snapshotCount()))
    return sendCanvas(reply, outcome.record)
  })

  app.get(`${prefix}/api/health`, async () => ({ ok: true }))

  app.get(`${prefix}/api/discuss/session`, async (request, reply) => {
    const cardId = textField(request.query?.cardId)
    if (!cardId) {
      reply.code(400)
      return reply.send({ error: '缺少 cardId' })
    }
    try {
      const { store, sessionId } = await ensureCardSession(cardId)
      reply.header('Cache-Control', 'no-store')
      return reply.send({ cardId, sessionId, sessions: publicSessions(store, cardId) })
    } catch (error) {
      return discussFailure(reply, error, '画布会话没有建成')
    }
  })

  app.post(`${prefix}/api/discuss/session`, async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const cardId = textField(body.cardId)
    const sessionId = textField(body.sessionId)
    if (!cardId) {
      reply.code(400)
      return reply.send({ error: '缺少 cardId' })
    }
    try {
      const result = sessionId ? await selectCardSession(cardId, sessionId) : await createCardSession(cardId)
      reply.header('Cache-Control', 'no-store')
      return reply.send({ cardId, sessionId: result.sessionId, sessions: publicSessions(result.store, cardId) })
    } catch (error) {
      return discussFailure(reply, error, '画布会话没有建成')
    }
  })

  app.get(`${prefix}/api/discuss/messages`, async (request, reply) => {
    const cardId = textField(request.query?.cardId)
    const sessionId = textField(request.query?.sessionId)
    try {
      const store = await assertOwned(cardId, sessionId, false)
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

  app.post(`${prefix}/api/discuss/adoptions`, async (request, reply) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const cardId = textField(body.cardId)
    const sessionId = textField(body.sessionId)
    const content = textField(body.content)
    if (!content) {
      reply.code(400)
      return reply.send({ error: '缺少采纳内容' })
    }
    try {
      await assertOwned(cardId, sessionId, false)
      const resolved = await resolveAdoptionKey(gatewayFetch, sessionId, {
        messageId: textField(body.messageId),
        role: textField(body.role) || 'assistant',
        at: textField(body.at),
        content,
      })
      const adoptedAt = new Date().toISOString()
      await recordAdoption(cardId, sessionId, { ...resolved, adoptedAt })
      reply.header('Cache-Control', 'no-store')
      return reply.send({ cardId, sessionId, key: resolved.key, adoptedAt })
    } catch (error) {
      return discussFailure(reply, error, '采纳记录没有存上')
    }
  })

  app.post(`${prefix}/api/discuss/stream`, async (request, reply) => {
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
    try {
      await assertOwned(cardId, sessionId, true)
    } catch (error) {
      failRaw(raw, error && error.statusCode ? error.statusCode : 400, error instanceof Error ? error.message : 'cardId 对不上该会话')
      return
    }
    void recordFirstAsk(cardId, sessionId, message).catch(() => {})
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

  app.get(`${prefix}/api/discuss/runs/:runId`, async (request, reply) => {
    const cardId = textField(request.query?.cardId)
    const sessionId = textField(request.query?.sessionId)
    try {
      await assertOwned(cardId, sessionId, false)
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

  app.post(`${prefix}/api/discuss/runs/:runId/stop`, async (request, reply) => {
    const cardId = textField(request.query?.cardId)
    const sessionId = textField(request.query?.sessionId)
    try {
      await assertOwned(cardId, sessionId, false)
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
      await assertOwned(cardId, sessionId, false)
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
try {
  await exclusive(() => readCanonical())
} catch (error) {
  if (!isUnreadable(error)) throw error
  console.error(`${MSG_CANONICAL_UNREADABLE}：原文件已改名为 ${canonicalBroken?.kept ?? ''}`)
}
if (!canonicalBroken) {
  try {
    await exclusive(() => migrateEmbeddedSnapshots())
  } catch (error) {
    console.error(`旧快照迁移失败，正本里的旧数组原样保留：${error instanceof Error ? error.message : String(error)}`)
  }
}

await app.register(fastifyStatic, {
  root: distDir,
  prefix: '/',
  decorateReply: false,
  index: ['index.html'],
})

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/') || request.url.startsWith('/xuehua/api/')) {
    reply.code(404)
    return reply.send({ error: '没有这个接口' })
  }
  if (request.url === '/' || request.url.startsWith('/xuehua')) {
    const file = request.url.startsWith('/xuehua') ? join(distDir, 'xuehua', 'index.html') : join(distDir, 'index.html')
    reply.type('text/html')
    return reply.send(createReadStream(file))
  }
  reply.code(404)
  return reply.send()
})

await app.listen({ host: listenHost, port: listenPort })
