import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createDocument, serializeDocument, type Flow } from '../src/document.ts'
import { parseCompleteDocument } from '../src/persist.ts'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverEntry = join(repoRoot, 'server', 'http.mjs')
const encoder = new TextEncoder()

const MINIMAL_JSON = `{
  "canvas": { "nodes": [], "edges": [] },
  "snowflake": { "fileId": "book-flows-1", "cards": {} },
  "flows": [{
    "id": "flow-1",
    "title": "主线",
    "scope": { "kind": "book" },
    "xml": "<xml/>",
    "beta": "start",
    "origin": "human",
    "sourceRefs": [{ "kind": "card", "id": "card-1" }],
    "validation": {
      "ranAt": "2026-10-14T12:00:00.000Z",
      "valid": true,
      "errors": [],
      "warnings": []
    }
  }]
}`

type FlowDoc = {
  canvas: { nodes: unknown[]; edges: unknown[] }
  snowflake: { fileId: string; cards: Record<string, unknown> }
  flows: Flow[]
}

function minimalDoc(): FlowDoc {
  return JSON.parse(MINIMAL_JSON) as FlowDoc
}

function bytesOf(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

function legacyDocument(fileId = 'book-legacy-1') {
  return {
    canvas: { nodes: [] as unknown[], edges: [] as unknown[] },
    snowflake: { fileId, cards: {} as Record<string, unknown> },
  }
}

describe('正本 flows 数据形状', () => {
  it('最小 flow 读入再写回，字段都还在', () => {
    const source = minimalDoc()
    const parsed = parseCompleteDocument(bytesOf(source))
    expect(parsed).not.toBeNull()
    const flow = parsed!.state.flows[0]
    expect(flow?.id).toBe('flow-1')
    expect(flow?.title).toBe('主线')
    expect(flow?.scope.kind).toBe('book')
    expect(flow?.xml).toBe('<xml/>')
    expect(flow?.beta).toBe('start')
    expect(flow?.origin).toBe('human')
    expect(flow?.sourceRefs).toEqual([{ kind: 'card', id: 'card-1' }])
    expect(flow?.validation.valid).toBe(true)

    const saved = serializeDocument(parsed!.state)
    const again = saved.flows?.[0]
    expect(again?.id).toBe('flow-1')
    expect(again?.title).toBe('主线')
    expect(again?.scope).toEqual({ kind: 'book' })
    expect(again?.xml).toBe('<xml/>')
    expect(again?.beta).toBe('start')
    expect(again?.origin).toBe('human')
    expect(again?.sourceRefs).toEqual([{ kind: 'card', id: 'card-1' }])
    expect(again?.validation).toEqual({
      ranAt: '2026-10-14T12:00:00.000Z',
      valid: true,
      errors: [],
      warnings: [],
    })
  })

  it('旧正本没有 flows 键时，内存里是空数组，写回也不写出这个键', () => {
    expect(createDocument('new-book').flows).toEqual([])
    expect(serializeDocument(createDocument('new-book'))).not.toHaveProperty('flows')

    const parsed = parseCompleteDocument(bytesOf(legacyDocument()))
    expect(parsed).not.toBeNull()
    expect(parsed!.state.flows).toEqual([])
    expect(serializeDocument(parsed!.state)).not.toHaveProperty('flows')

    const explicitEmpty = { ...legacyDocument(), flows: [] as unknown[] }
    const emptyParsed = parseCompleteDocument(bytesOf(explicitEmpty))
    expect(emptyParsed!.state.flows).toEqual([])
    expect(serializeDocument(emptyParsed!.state)).not.toHaveProperty('flows')

    const missingShape = { ...legacyDocument('book-null'), flows: null }
    expect(parseCompleteDocument(bytesOf(missingShape))!.state.flows).toEqual([])
    const notArray = { ...legacyDocument('book-text'), flows: 'nope' }
    expect(parseCompleteDocument(bytesOf(notArray))!.state.flows).toEqual([])
  })

  it('坏条目或重复 id 整份失败；范围和空字符串按字段约束留下', () => {
    const badKind = minimalDoc() as { flows: Array<{ scope: { kind: string } }> }
    badKind.flows[0]!.scope.kind = 'page'
    expect(parseCompleteDocument(bytesOf(badKind))).toBeNull()

    const emptyId = minimalDoc()
    emptyId.flows[0]!.id = ''
    expect(parseCompleteDocument(bytesOf(emptyId))).toBeNull()

    const badOrigin = minimalDoc() as { flows: Array<{ origin: string }> }
    badOrigin.flows[0]!.origin = 'auto'
    expect(parseCompleteDocument(bytesOf(badOrigin))).toBeNull()

    const dup = minimalDoc()
    dup.flows.push(JSON.parse(JSON.stringify(dup.flows[0])) as Flow)
    expect(parseCompleteDocument(bytesOf(dup))).toBeNull()

    const mixed = minimalDoc()
    mixed.flows.push({ ...mixed.flows[0]!, id: '' })
    expect(parseCompleteDocument(bytesOf(mixed))).toBeNull()

    const chapter = minimalDoc()
    chapter.flows[0] = {
      ...chapter.flows[0]!,
      id: 'flow-ch',
      title: '',
      scope: { kind: 'chapter', chapterId: 'ch-1' },
      xml: '',
      beta: '  keep  ',
      origin: 'llm',
      sourceRefs: [],
      validation: {
        ranAt: '',
        valid: false,
        errors: [{ ruleId: 'r1', message: '不行' }],
        warnings: [{ message: '注意', elementId: 'n1' }],
      },
    }
    const chapterParsed = parseCompleteDocument(bytesOf(chapter))
    expect(chapterParsed).not.toBeNull()
    expect(chapterParsed!.state.flows[0]?.title).toBe('')
    expect(chapterParsed!.state.flows[0]?.xml).toBe('')
    expect(chapterParsed!.state.flows[0]?.beta).toBe('  keep  ')
    expect(chapterParsed!.state.flows[0]?.scope).toEqual({ kind: 'chapter', chapterId: 'ch-1' })
    expect(serializeDocument(chapterParsed!.state).flows?.[0]?.validation.warnings).toEqual([
      { message: '注意', elementId: 'n1' },
    ])

    const missingChapter = minimalDoc()
    missingChapter.flows[0]!.scope = { kind: 'chapter' }
    expect(parseCompleteDocument(bytesOf(missingChapter))).toBeNull()

    const scene = minimalDoc()
    scene.flows[0]!.scope = { kind: 'scene', chapterId: 'ch-1', sceneId: 'sc-1' }
    expect(parseCompleteDocument(bytesOf(scene))?.state.flows[0]?.scope).toEqual({
      kind: 'scene',
      chapterId: 'ch-1',
      sceneId: 'sc-1',
    })

    const missingScene = minimalDoc()
    missingScene.flows[0]!.scope = { kind: 'scene', chapterId: 'ch-1' }
    expect(parseCompleteDocument(bytesOf(missingScene))).toBeNull()

    const bookEmptyId = minimalDoc()
    bookEmptyId.flows[0]!.scope = { kind: 'book', chapterId: '' }
    expect(parseCompleteDocument(bytesOf(bookEmptyId))?.state.flows[0]?.scope).toEqual({
      kind: 'book',
      chapterId: '',
    })
  })
})

interface Running {
  base: string
  dataDir: string
  home: string
  logs: () => string
  stop: () => Promise<void>
}

const running: Running[] = []

afterEach(async () => {
  while (running.length) await running.pop()?.stop()
})

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await exited
}

async function startServer(): Promise<Running> {
  const dataDir = await mkdtemp(join(tmpdir(), 'snowflake-flows-data-'))
  const home = await mkdtemp(join(tmpdir(), 'snowflake-flows-home-'))
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    SNOWFLAKE_DATA_DIR: dataDir,
    SNOWFLAKE_LISTEN_HOST: '127.0.0.1',
    SNOWFLAKE_PORT: String(port),
    API_SERVER_KEY: '',
  }
  const child: ChildProcess = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    output += String(chunk)
  })
  const base = `http://127.0.0.1:${port}`
  const fail = async (message: string) => {
    await stopChild(child)
    await rm(dataDir, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
    throw new Error(`${message}：${output}`)
  }
  const deadline = Date.now() + 15_000
  for (;;) {
    if (child.exitCode !== null) await fail('服务器没起来')
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) break
    } catch {
      // 还没开始监听。
    }
    if (Date.now() > deadline) await fail('服务器起不来')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const handle: Running = {
    base,
    dataDir,
    home,
    logs: () => output,
    stop: async () => {
      await stopChild(child)
      await rm(dataDir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
      const index = running.indexOf(handle)
      if (index >= 0) running.splice(index, 1)
    },
  }
  running.push(handle)
  return handle
}

async function getCanvas(server: Running) {
  const response = await fetch(`${server.base}/api/canvas`)
  const text = await response.text()
  return {
    response,
    text,
    body: JSON.parse(text) as { version: number; document: { flows?: Array<{ id?: string }> } },
  }
}

async function putCanvas(server: Running, document: unknown, etag: string) {
  const response = await fetch(`${server.base}/api/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify(document),
  })
  const text = await response.text()
  return { response, text }
}

async function canonicalDocument(server: Running): Promise<{ flows?: Array<{ id?: string; xml?: string; beta?: string }> }> {
  const active = JSON.parse(await readFile(join(server.dataDir, 'active.json'), 'utf8')) as { activeBookId: string }
  const stored = JSON.parse(await readFile(join(server.dataDir, 'books', active.activeBookId, 'snowflake.json'), 'utf8')) as {
    document: { flows?: Array<{ id?: string; xml?: string; beta?: string }> }
  }
  return stored.document
}

describe('服务端放行 flows', () => {
  it('合法 flow 往返留在 snowflake.json；旧正本和坏字段按约束放行或拒绝', async () => {
    const server = await startServer()
    const opened = await getCanvas(server)
    expect(opened.response.status).toBeLessThan(400)
    expect(opened.body.document.flows).toBeUndefined()

    const legacy = await putCanvas(server, legacyDocument(), opened.response.headers.get('etag') ?? '')
    expect(legacy.response.status, legacy.text).toBeLessThan(400)
    const afterLegacy = await getCanvas(server)
    expect(afterLegacy.response.status).toBeLessThan(400)
    expect(afterLegacy.body.document.flows).toBeUndefined()

    const saved = await putCanvas(server, minimalDoc(), afterLegacy.response.headers.get('etag') ?? '')
    expect(saved.response.status, saved.text).toBe(200)
    const onDisk = await canonicalDocument(server)
    expect(onDisk.flows?.[0]?.id).toBe('flow-1')
    expect(onDisk.flows?.[0]?.xml).toBe('<xml/>')
    // <xml/> 没有流程节点。保存时按 xml 重投影，beta 变成空字符串。
    expect(onDisk.flows?.[0]?.beta).toBe('')

    const etag = (await getCanvas(server)).response.headers.get('etag') ?? ''
    const notArray = { ...minimalDoc(), flows: { id: 'flow-1' } }
    const badKind = minimalDoc()
    badKind.flows[0]!.scope = { kind: 'page' } as Flow['scope']
    const emptyId = minimalDoc()
    emptyId.flows[0]!.id = ''
    const badOrigin = minimalDoc()
    ;(badOrigin.flows[0] as { origin: string }).origin = 'auto'
    const duplicate = minimalDoc()
    duplicate.flows.push(JSON.parse(JSON.stringify(duplicate.flows[0])) as Flow)

    for (const document of [notArray, badKind, emptyId, badOrigin, duplicate]) {
      const rejected = await putCanvas(server, document, etag)
      expect(rejected.response.status, rejected.text).toBe(400)
    }
    expect((await canonicalDocument(server)).flows?.[0]?.id).toBe('flow-1')

    const extra = { ...minimalDoc(), note: '旁注' }
    const accepted = await putCanvas(server, extra, etag)
    expect(accepted.response.status, accepted.text).toBe(200)
    expect((await canonicalDocument(server)).flows?.[0]?.id).toBe('flow-1')
  }, 30_000)
})
