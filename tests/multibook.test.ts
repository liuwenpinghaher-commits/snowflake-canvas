import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { bookScopedPath, setCurrentBookId } from '../src/books.ts'
import { createCard, createDocument, serializeDocument, setCardBody } from '../src/document.ts'
import { createPersistController, documentToBytes, type PersistPorts, type RemoteCanonical } from '../src/persist.ts'
import { loadRemote, saveRemote } from '../src/remote-canvas.ts'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverEntry = join(repoRoot, 'server', 'http.mjs')
const SNAPSHOT_RE = /^snowflake\..+\.snapshot\.json$/

type Doc = {
  canvas: { nodes: unknown[]; edges: unknown[] }
  snowflake: { fileId: string; cards: Record<string, unknown> }
}

function doc(fileId: string, body: string): Doc {
  return {
    canvas: {
      nodes: [{ id: 'c1', type: 'text', x: 0, y: 0, width: 240, height: 120, text: body }],
      edges: [],
    },
    snowflake: { fileId, cards: { c1: { layer: 'situation', fields: {}, body } } },
  }
}

interface Running {
  base: string
  dataDir: string
  logs: () => string
  stop: () => Promise<void>
}

const running: Running[] = []
const dirs: string[] = []

afterEach(async () => {
  while (running.length) await running.pop()?.stop()
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
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

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function startServer(dataDir: string): Promise<Running> {
  const home = await tempDir('snowflake-books-home-')
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    SNOWFLAKE_DATA_DIR: dataDir,
    SNOWFLAKE_LISTEN_HOST: '127.0.0.1',
    SNOWFLAKE_PORT: String(port),
    API_SERVER_KEY: '',
  }
  await writeFile(join(dataDir, 'gbrain-force-fail'), '')
  const child: ChildProcess = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.on('data', (chunk) => (output += String(chunk)))
  child.stderr?.on('data', (chunk) => (output += String(chunk)))
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 15_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`服务器没起来：${output}`)
    try {
      if ((await fetch(`${base}/api/health`)).ok) break
    } catch {
      // 还没开始监听。
    }
    if (Date.now() > deadline) throw new Error(`服务器起不来：${output}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const handle: Running = {
    base,
    dataDir,
    logs: () => output,
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGTERM')
        await exited
      }
      const index = running.indexOf(handle)
      if (index >= 0) running.splice(index, 1)
    },
  }
  running.push(handle)
  return handle
}

// fetch 会先把 .. 和 %2E%2E 规范化掉；路径穿越要用原样的请求行去打。
function rawStatus(server: Running, method: string, path: string): Promise<number> {
  const { hostname, port } = new URL(server.base)
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port: Number(port), method, path }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.end()
  })
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

type BookList = { books: Array<{ id: string; name: string; active: boolean }>; activeBookId: string }

async function listBooks(server: Running, prefix = ''): Promise<BookList> {
  const response = await fetch(`${server.base}${prefix}/api/books`)
  expect(response.status).toBe(200)
  return (await response.json()) as BookList
}

async function getCanvas(server: Running, path: string) {
  const response = await fetch(`${server.base}${path}`)
  return { response, body: (await response.json()) as { version: number; document: Doc } }
}

async function putCanvas(server: Running, path: string, document: Doc, etag: string) {
  return fetch(`${server.base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify(document),
  })
}

async function createBook(server: Running, name?: string) {
  const response = await fetch(`${server.base}/api/books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name === undefined ? {} : { name }),
  })
  return { response, body: (await response.json()) as { id: string; name: string; active: boolean } }
}

async function activate(server: Running, id: string) {
  return fetch(`${server.base}/api/books/${id}/activate`, { method: 'POST' })
}

function bodyOf(document: Doc): string {
  return (document.snowflake.cards.c1 as { body: string }).body
}

async function seedLegacy(dataDir: string) {
  const canonical = JSON.stringify({ version: 3, document: doc('legacy-file', '旧的单书正文'), snapshots: [] })
  const session = JSON.stringify({ cards: { c1: { lastSessionId: 's-old', sessions: [{ sessionId: 's-old', cardId: 'c1' }] } } })
  const sessionBak = JSON.stringify({ sessionId: 's-older' })
  const snapshotName = 'snowflake.20261008T142552.snapshot.json'
  const snapshot = JSON.stringify(doc('legacy-file', '旧快照'))
  await writeFile(join(dataDir, 'snowflake.json'), canonical)
  await writeFile(join(dataDir, 'session.json'), session)
  await writeFile(join(dataDir, 'session.json.bak'), sessionBak)
  await writeFile(join(dataDir, snapshotName), snapshot)
  return { canonical, session, sessionBak, snapshotName, snapshot }
}

describe('多本书：旧数据迁移', () => {
  it('旧顶层 snowflake.json 自动迁成第一本书，根上留下 pre-multi-import；再启动不重复迁', async () => {
    const dataDir = await tempDir('snowflake-books-data-')
    const seed = await seedLegacy(dataDir)
    const server = await startServer(dataDir)

    const list = await listBooks(server)
    expect(list.books).toHaveLength(1)
    const id = list.activeBookId
    expect(id).toMatch(/^[a-z0-9]+$/)
    expect(list.books[0]).toEqual({ id, name: '未命名书', active: true })
    const book = join(dataDir, 'books', id)

    expect(await readFile(join(book, 'snowflake.json'), 'utf8')).toBe(seed.canonical)
    expect(await readFile(join(book, 'session.json'), 'utf8')).toBe(seed.session)
    expect(await readFile(join(book, 'session.json.bak'), 'utf8')).toBe(seed.sessionBak)
    expect(await readFile(join(book, seed.snapshotName), 'utf8')).toBe(seed.snapshot)
    expect(await readFile(join(dataDir, 'snowflake.json.pre-multi-import'), 'utf8')).toBe(seed.canonical)
    expect(await readFile(join(dataDir, 'session.json.pre-multi-import'), 'utf8')).toBe(seed.session)
    expect(await exists(join(dataDir, 'snowflake.json'))).toBe(false)
    expect(await exists(join(dataDir, 'session.json'))).toBe(false)
    expect(await exists(join(dataDir, 'session.json.bak'))).toBe(false)
    expect((await readdir(dataDir)).filter((name) => SNAPSHOT_RE.test(name))).toEqual([])
    const meta = JSON.parse(await readFile(join(book, 'meta.json'), 'utf8'))
    expect(meta.id).toBe(id)
    expect(meta.name).toBe('未命名书')
    expect(typeof meta.createdAt).toBe('string')
    expect(JSON.parse(await readFile(join(dataDir, 'active.json'), 'utf8'))).toEqual({ activeBookId: id })

    const legacy = await getCanvas(server, '/api/canvas')
    expect(legacy.response.status).toBe(200)
    expect(legacy.response.headers.get('etag')).toBe('"3"')
    expect(legacy.response.headers.get('x-snapshot-count')).toBe('1')
    expect(bodyOf(legacy.body.document)).toBe('旧的单书正文')

    await server.stop()
    const preBefore = await readFile(join(dataDir, 'snowflake.json.pre-multi-import'), 'utf8')
    const again = await startServer(dataDir)
    const listAgain = await listBooks(again)
    expect(listAgain.books.map((item) => item.id)).toEqual([id])
    expect(await readdir(join(dataDir, 'books'))).toEqual([id])
    expect(await readFile(join(dataDir, 'snowflake.json.pre-multi-import'), 'utf8')).toBe(preBefore)
    expect(await exists(join(dataDir, 'snowflake.json'))).toBe(false)
  }, 60_000)

  it('正本外层带书级标题时用它当书名；读不到就落「未命名书」', async () => {
    const dataDir = await tempDir('snowflake-books-title-')
    await writeFile(
      join(dataDir, 'snowflake.json'),
      JSON.stringify({ version: 1, title: '  雪夜来客  ', document: doc('titled-file', '有标题'), snapshots: [] }),
    )
    const server = await startServer(dataDir)
    const list = await listBooks(server)
    expect(list.books.map((item) => item.name)).toEqual(['雪夜来客'])
  }, 30_000)

  it('空数据目录起服务也有一本「未命名书」，旧路径照常能读写', async () => {
    const dataDir = await tempDir('snowflake-books-empty-')
    const server = await startServer(dataDir)
    const list = await listBooks(server)
    expect(list.books).toHaveLength(1)
    expect(list.books[0]!.name).toBe('未命名书')
    expect(await exists(join(dataDir, 'snowflake.json'))).toBe(false)
    expect(await exists(join(dataDir, 'snowflake.json.pre-multi-import'))).toBe(false)
    const first = await getCanvas(server, '/api/canvas')
    expect(first.body.version).toBe(1)
    const put = await putCanvas(server, '/api/canvas', doc(first.body.document.snowflake.fileId, '空目录里写下的'), '"1"')
    expect(put.status).toBe(200)
    const onDisk = JSON.parse(await readFile(join(dataDir, 'books', list.activeBookId, 'snowflake.json'), 'utf8'))
    expect(bodyOf(onDisk.document)).toBe('空目录里写下的')
  }, 30_000)
})

describe('多本书：按书隔离', () => {
  it('两本书各自读写互不可见；快照只落在自己的书目录', async () => {
    const dataDir = await tempDir('snowflake-books-iso-')
    await seedLegacy(dataDir)
    const server = await startServer(dataDir)
    const firstId = (await listBooks(server)).activeBookId

    const created = await createBook(server, '  第二本  ')
    expect(created.response.status).toBe(201)
    expect(created.body.name).toBe('第二本')
    expect(created.body.active).toBe(true)
    const secondId = created.body.id
    expect(secondId).not.toBe(firstId)
    const list = await listBooks(server)
    expect(list.activeBookId).toBe(secondId)
    expect(list.books.map((item) => [item.id, item.active])).toEqual([
      [firstId, false],
      [secondId, true],
    ])

    const fresh = await getCanvas(server, `/api/books/${secondId}/canvas`)
    expect(fresh.body.version).toBe(1)
    expect(fresh.body.document.canvas.nodes).toEqual([])
    expect(Object.keys(fresh.body.document.snowflake.cards)).toEqual([])

    const putFirst = await putCanvas(server, `/api/books/${firstId}/canvas`, doc('legacy-file', '第一本的正文'), '"3"')
    expect(putFirst.status).toBe(200)
    const putSecond = await putCanvas(
      server,
      `/api/books/${secondId}/canvas`,
      doc(fresh.body.document.snowflake.fileId, '第二本的正文'),
      '"1"',
    )
    expect(putSecond.status).toBe(200)

    const readFirst = await getCanvas(server, `/api/books/${firstId}/canvas`)
    const readSecond = await getCanvas(server, `/api/books/${secondId}/canvas`)
    expect(bodyOf(readFirst.body.document)).toBe('第一本的正文')
    expect(bodyOf(readSecond.body.document)).toBe('第二本的正文')
    expect(JSON.stringify(readFirst.body)).not.toContain('第二本的正文')
    expect(JSON.stringify(readSecond.body)).not.toContain('第一本的正文')
    expect(readFirst.response.headers.get('etag')).toBe('"4"')
    expect(readSecond.response.headers.get('etag')).toBe('"2"')

    // 版本号按书各算各的：拿第一本的版本号去写第二本，照样 412。
    const crossed = await putCanvas(server, `/api/books/${secondId}/canvas`, doc('legacy-file', '串书'), '"4"')
    expect(crossed.status).toBe(412)

    const kept = await fetch(`${server.base}/api/books/${secondId}/canvas/keep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"2"' },
      body: '{}',
    })
    expect(kept.status).toBe(200)
    const keptName = ((await kept.json()) as { snapshotName: string }).snapshotName
    const secondFiles = (await readdir(join(dataDir, 'books', secondId))).filter((name) => SNAPSHOT_RE.test(name))
    const firstFiles = (await readdir(join(dataDir, 'books', firstId))).filter((name) => SNAPSHOT_RE.test(name))
    expect(secondFiles).toEqual([keptName])
    expect(firstFiles).not.toContain(keptName)
    expect((await readdir(dataDir)).filter((name) => SNAPSHOT_RE.test(name))).toEqual([])
    const listed = (await (await fetch(`${server.base}/api/books/${firstId}/canvas/snapshots`)).json()) as Array<{
      name: string
    }>
    expect(listed.map((item) => item.name)).not.toContain(keptName)

    const rolled = await fetch(`${server.base}/api/books/${firstId}/canvas/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"4"' },
      body: JSON.stringify({ name: keptName }),
    })
    expect(rolled.status).toBe(404)
  }, 60_000)

  it('旧路径 /api/canvas 打到活动书；切换活动书后旧路径跟着走', async () => {
    const dataDir = await tempDir('snowflake-books-legacy-')
    await seedLegacy(dataDir)
    const server = await startServer(dataDir)
    const firstId = (await listBooks(server)).activeBookId
    const secondId = (await createBook(server, '第二本')).body.id
    const fresh = await getCanvas(server, `/api/books/${secondId}/canvas`)
    expect(
      (await putCanvas(server, `/api/books/${secondId}/canvas`, doc(fresh.body.document.snowflake.fileId, '第二本'), '"1"')).status,
    ).toBe(200)

    const onSecond = await getCanvas(server, '/api/canvas')
    expect(bodyOf(onSecond.body.document)).toBe('第二本')
    const onSecondXuehua = await getCanvas(server, '/xuehua/api/canvas')
    expect(bodyOf(onSecondXuehua.body.document)).toBe('第二本')

    expect((await activate(server, firstId)).status).toBe(200)
    expect(JSON.parse(await readFile(join(dataDir, 'active.json'), 'utf8'))).toEqual({ activeBookId: firstId })
    const onFirst = await getCanvas(server, '/api/canvas')
    expect(bodyOf(onFirst.body.document)).toBe('旧的单书正文')
    expect(onFirst.response.headers.get('etag')).toBe('"3"')

    const legacyPut = await putCanvas(server, '/api/canvas', doc('legacy-file', '旧路径写进第一本'), '"3"')
    expect(legacyPut.status).toBe(200)
    expect(bodyOf((await getCanvas(server, `/api/books/${firstId}/canvas`)).body.document)).toBe('旧路径写进第一本')
    expect(bodyOf((await getCanvas(server, `/api/books/${secondId}/canvas`)).body.document)).toBe('第二本')

    const xuehua = await listBooks(server, '/xuehua')
    expect(xuehua.activeBookId).toBe(firstId)
  }, 60_000)

  it('讨论会话按书分开：第一本的会话在第二本里认不出来', async () => {
    const dataDir = await tempDir('snowflake-books-discuss-')
    await seedLegacy(dataDir)
    const server = await startServer(dataDir)
    const firstId = (await listBooks(server)).activeBookId
    const secondId = (await createBook(server, '第二本')).body.id
    // 选中已有会话只查归属、改本书的会话文件，不连网关。
    const pick = (id: string) =>
      fetch(`${server.base}/api/books/${id}/discuss/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: 'c1', sessionId: 's-old' }),
      })
    const onFirst = await pick(firstId)
    expect(onFirst.status).toBe(200)
    expect(((await onFirst.json()) as { sessionId: string }).sessionId).toBe('s-old')
    const onSecond = await pick(secondId)
    expect(onSecond.status).toBe(400)
    expect(await exists(join(dataDir, 'books', secondId, 'session.json'))).toBe(false)
    const legacyOnSecond = await fetch(`${server.base}/api/discuss/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: 'c1', sessionId: 's-old' }),
    })
    expect(legacyOnSecond.status).toBe(400)
  }, 30_000)
})

describe('多本书：改名、删书和未知书', () => {
  it('不带 confirm 的 DELETE 不删；confirm=1 才删；只剩一本时 409', async () => {
    const dataDir = await tempDir('snowflake-books-delete-')
    await seedLegacy(dataDir)
    const server = await startServer(dataDir)
    const firstId = (await listBooks(server)).activeBookId
    const secondId = (await createBook(server, '要删的书')).body.id
    const secondDir = join(dataDir, 'books', secondId)
    expect(await exists(secondDir)).toBe(true)

    for (const suffix of ['', '?confirm=0', '?confirm=yes', '?confirm=']) {
      const response = await fetch(`${server.base}/api/books/${secondId}${suffix}`, { method: 'DELETE' })
      expect(response.status, suffix).toBe(400)
      expect(await exists(join(secondDir, 'snowflake.json'))).toBe(true)
    }
    expect((await listBooks(server)).books).toHaveLength(2)

    const deleted = await fetch(`${server.base}/api/books/${secondId}?confirm=1`, { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    expect(await exists(secondDir)).toBe(false)
    const after = await listBooks(server)
    expect(after.books.map((item) => item.id)).toEqual([firstId])
    expect(after.activeBookId).toBe(firstId)
    expect(JSON.parse(await readFile(join(dataDir, 'active.json'), 'utf8'))).toEqual({ activeBookId: firstId })
    expect((await fetch(`${server.base}/api/books/${secondId}/canvas`)).status).toBe(404)

    const trashRes = await fetch(`${server.base}/api/books-trash`)
    expect(trashRes.status).toBe(200)
    const trashBody = (await trashRes.json()) as { books: Array<{ id: string; name: string }> }
    expect(trashBody.books.map((item) => item.id)).toContain(secondId)

    const restoreRes = await fetch(`${server.base}/api/books-trash/${secondId}/restore`, { method: 'POST' })
    expect(restoreRes.status).toBe(200)
    expect(await exists(secondDir)).toBe(true)
    expect((await listBooks(server)).books.map((item) => item.id)).toContain(secondId)

    const patchConstraints = await fetch(`${server.base}/api/books/${firstId}/constraints`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetWords: 120000, endingType: '悲剧', forbidden: '系统流', styleSample: '冷峻短句' }),
    })
    expect(patchConstraints.status).toBe(200)
    const getConstraints = await fetch(`${server.base}/api/books/${firstId}/constraints`)
    expect(getConstraints.status).toBe(200)
    expect(((await getConstraints.json()) as { constraints: Record<string, unknown> }).constraints).toEqual({
      targetWords: 120000,
      endingType: '悲剧',
      forbidden: '系统流',
      styleSample: '冷峻短句',
    })

    const secondCanvas = await getCanvas(server, `/api/books/${secondId}/canvas`)
    const imp = await fetch(`${server.base}/api/books/${secondId}/import-text`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': secondCanvas.response.headers.get('etag') ?? String(secondCanvas.body.version) }, body: JSON.stringify({ text: '第一章 霜降\n北风卷地白草折。' }) })
    expect(imp.status).toBe(200)
    for (const fmt of ['md', 'txt', 'docx', 'epub']) {
      const exp = await fetch(`${server.base}/api/books/${secondId}/export?format=${fmt}`)
      expect(exp.status, fmt).toBe(200)
      const buf = await exp.arrayBuffer()
      expect(buf.byteLength, fmt).toBeGreaterThan(0)
    }

    const delAgain = await fetch(`${server.base}/api/books/${secondId}?confirm=1`, { method: 'DELETE' })
    expect(delAgain.status).toBe(200)

    const last = await fetch(`${server.base}/api/books/${firstId}?confirm=1`, { method: 'DELETE' })
    expect(last.status).toBe(409)
    expect(await exists(join(dataDir, 'books', firstId, 'snowflake.json'))).toBe(true)
    expect(bodyOf((await getCanvas(server, '/api/canvas')).body.document)).toBe('旧的单书正文')
  }, 60_000)

  it('PATCH 改名；空名 400；未知或不合规的 bookId 一律 404', async () => {
    const dataDir = await tempDir('snowflake-books-rename-')
    const server = await startServer(dataDir)
    const id = (await listBooks(server)).activeBookId

    const renamed = await fetch(`${server.base}/api/books/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  长夜  ' }),
    })
    expect(renamed.status).toBe(200)
    expect(((await renamed.json()) as { name: string }).name).toBe('长夜')
    expect(JSON.parse(await readFile(join(dataDir, 'books', id, 'meta.json'), 'utf8')).name).toBe('长夜')
    expect((await listBooks(server)).books[0]!.name).toBe('长夜')

    for (const name of ['', '   ', 42]) {
      const response = await fetch(`${server.base}/api/books/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      expect(response.status, String(name)).toBe(400)
    }
    expect((await listBooks(server)).books[0]!.name).toBe('长夜')

    for (const bad of ['ffffffff', 'ABCDEF12', '..', '%2E%2E', '..%2Fbooks', 'a.b']) {
      expect(await rawStatus(server, 'GET', `/api/books/${bad}/canvas`), bad).toBe(404)
      expect(await rawStatus(server, 'POST', `/api/books/${bad}/activate`), bad).toBe(404)
      expect(await rawStatus(server, 'DELETE', `/api/books/${bad}?confirm=1`), bad).toBe(404)
    }
    expect((await listBooks(server)).books).toHaveLength(1)
    expect(await exists(join(dataDir, 'books', id, 'snowflake.json'))).toBe(true)
  }, 30_000)
})

describe('多本书：前端请求带书 id', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    setCurrentBookId(null)
  })

  it('画布和讨论路径改走 /api/books/<id>/...；脑接口和没有书 id 时不变', () => {
    expect(bookScopedPath('/api/canvas', 'ab12cd34')).toBe('/api/books/ab12cd34/canvas')
    expect(bookScopedPath('/api/canvas/keep', 'ab12cd34')).toBe('/api/books/ab12cd34/canvas/keep')
    expect(bookScopedPath('/api/discuss/runs/r1/stop?cardId=c', 'ab12cd34')).toBe(
      '/api/books/ab12cd34/discuss/runs/r1/stop?cardId=c',
    )
    expect(bookScopedPath('/api/brain/capture', 'ab12cd34')).toBe('/api/brain/capture')
    expect(bookScopedPath('/api/canvas', null)).toBe('/api/canvas')
    setCurrentBookId('ff00ff00')
    expect(bookScopedPath('/api/discuss/session')).toBe('/api/books/ff00ff00/discuss/session')
  })

  it('remote-canvas 带上书 id 时 GET/PATCH 都打到这本书', async () => {
    const urls: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${String(input)}`)
      return new Response(JSON.stringify({ document: serializeDocument(createDocument('f')) }), {
        status: 200,
        headers: { ETag: '"1"', 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    await loadRemote('ab12cd34')
    await saveRemote(documentToBytes(createDocument('f')), '"1"', 'ab12cd34')
    await loadRemote()
    expect(urls).toEqual(['GET /api/books/ab12cd34/canvas', 'PATCH /api/books/ab12cd34/canvas', 'GET /api/canvas'])
  })
})

describe('多本书：换书前先写完当前这本', () => {
  function portsWith(remote: RemoteCanonical): PersistPorts {
    return {
      protocol: 'http:',
      hasDirectoryPicker: false,
      now: () => new Date(2026, 9, 9, 12, 0, 0),
      loadDirectory: async () => null,
      pickDirectory: async () => 'abort',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      logFactory: async () => ({ read: async () => null, write: async () => {} }),
      tryAcquireLock: async () => ({ release() {} }),
      lockHeld: async () => false,
      channel: { post() {}, subscribe: () => () => {} },
      claim: { get: () => null, set() {} },
      askSaveAs: async () => false,
      askFirstDownload: async () => false,
      remote,
    }
  }

  const start = createCard(createDocument('switch-file'), { id: 'c1', layer: 'situation', x: 0, y: 0, body: '起稿' })

  it('写入还在路上时等它落盘再放行；等待期间不收新改动', async () => {
    const saves: string[] = []
    const pending: { finish?: () => void } = {}
    const remote: RemoteCanonical = {
      load: async () => ({ etag: '"1"', bytes: documentToBytes(start) }),
      save: (bytes) =>
        new Promise((resolve) => {
          saves.push(new TextDecoder().decode(bytes))
          pending.finish = () => resolve({ ok: true, etag: `"${saves.length + 1}"` })
        }),
      keep: async () => ({ ok: false, message: '未调用' }),
    }
    const ctl = createPersistController(portsWith(remote))
    await ctl.start()
    const writing = ctl.mutate((state) => setCardBody(state, 'c1', '换书前最后一笔'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saves).toHaveLength(1)

    let released: boolean | null = null
    const hold = ctl.holdForSwitch().then((value) => {
      released = value
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(released).toBeNull()
    expect(ctl.snapshot().view.canEdit).toBe(false)
    await ctl.mutate((state) => setCardBody(state, 'c1', '等待时又改'))
    expect(ctl.snapshot().state.snowflake.cards.c1?.body).toBe('换书前最后一笔')

    pending.finish?.()
    await writing
    await hold
    expect(released).toBe(true)
    expect(saves).toHaveLength(1)
    expect(saves[0]).toContain('换书前最后一笔')
    ctl.dispose()
  })

  it('写失败时不放行，留在原书', async () => {
    const remote: RemoteCanonical = {
      load: async () => ({ etag: '"1"', bytes: documentToBytes(start) }),
      save: async () => ({ ok: false, conflict: false }),
      keep: async () => ({ ok: false, message: '未调用' }),
    }
    const ctl = createPersistController(portsWith(remote))
    await ctl.start()
    await ctl.mutate((state) => setCardBody(state, 'c1', '没写进去的'))
    expect(await ctl.holdForSwitch()).toBe(false)
    ctl.dispose()
  })
})
