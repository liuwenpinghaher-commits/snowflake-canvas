import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

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

async function startServer(options: {
  seed?: unknown
  gbrain?: 'fail-command' | 'force-fail-flag'
} = {}): Promise<Running> {
  const dataDir = await mkdtemp(join(tmpdir(), 'snowflake-data-'))
  const home = await mkdtemp(join(tmpdir(), 'snowflake-home-'))
  if (options.seed) await writeFile(join(dataDir, 'snowflake.json'), JSON.stringify(options.seed))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    SNOWFLAKE_DATA_DIR: dataDir,
    SNOWFLAKE_LISTEN_HOST: '127.0.0.1',
    API_SERVER_KEY: '',
  }
  if (options.gbrain === 'fail-command') {
    const fake = join(home, 'gbrain-fails')
    await writeFile(fake, `#!/bin/sh\necho "$@" >> "${join(home, 'gbrain-called')}"\necho "fake gbrain down" >&2\nexit 3\n`)
    await chmod(fake, 0o755)
    env.SNOWFLAKE_GBRAIN_BIN = fake
  }
  if (options.gbrain === 'force-fail-flag') {
    await writeFile(join(dataDir, 'gbrain-force-fail'), '')
  }
  const port = await freePort()
  env.SNOWFLAKE_PORT = String(port)
  const child: ChildProcess = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.on('data', (chunk) => (output += String(chunk)))
  child.stderr?.on('data', (chunk) => (output += String(chunk)))
  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 15_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`服务器没起来：${output}`)
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) break
    } catch {
      // 还没开始监听。
    }
    if (Date.now() > deadline) throw new Error(`服务器起不来：${output}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const handle: Running = {
    base,
    dataDir,
    home,
    logs: () => output,
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGTERM')
        await exited
      }
      await rm(dataDir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    },
  }
  running.push(handle)
  return handle
}

async function snapshotFiles(dataDir: string): Promise<string[]> {
  return (await readdir(dataDir)).filter((name) => SNAPSHOT_RE.test(name)).sort()
}

async function getCanvas(server: Running) {
  const response = await fetch(`${server.base}/api/canvas`)
  const text = await response.text()
  return { response, text, body: JSON.parse(text) as { version: number; document: Doc; snapshots: unknown[] } }
}

async function keep(server: Running, etag: string) {
  const response = await fetch(`${server.base}/api/canvas/keep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: '{}',
  })
  return { response, body: (await response.json()) as Record<string, unknown> }
}

async function rollback(server: Running, name: unknown, etag: string) {
  return fetch(`${server.base}/api/canvas/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify(name === undefined ? {} : { name }),
  })
}

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return check()
}

describe('服务器快照拆成独立文件', () => {
  it('gbrain 命令失败时，留下这一版仍写出快照文件并返回 200', async () => {
    const server = await startServer({
      seed: { version: 4, document: doc('keep-file', '要留下的这一版'), snapshots: [] },
      gbrain: 'fail-command',
    })
    const { response: first } = await getCanvas(server)
    const etag = first.headers.get('etag') || ''
    expect(etag).toBe('"4"')

    const { response, body } = await keep(server, etag)
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"5"')
    expect(body.version).toBe(5)
    expect(body.snapshots).toEqual([])
    expect(body.snapshotCount).toBe(1)
    expect(typeof body.snapshotName).toBe('string')
    expect(['ok', 'skipped']).toContain(body.timeline)

    const files = await snapshotFiles(server.dataDir)
    expect(files).toEqual([body.snapshotName])
    const saved = JSON.parse(await readFile(join(server.dataDir, files[0]!), 'utf8'))
    expect(saved).toEqual(doc('keep-file', '要留下的这一版'))
    expect(saved.version).toBeUndefined()

    const canonical = JSON.parse(await readFile(join(server.dataDir, 'snowflake.json'), 'utf8'))
    expect(canonical.version).toBe(5)
    expect(canonical.snapshots).toEqual([])

    // gbrain 命令确实跑过并失败，服务器只记日志，快照不被删。
    const logged = await waitFor(async () => server.logs().includes('时间线没记上'), 10_000)
    expect(logged).toBe(true)
    expect(await stat(join(server.home, 'gbrain-called')).then(() => true)).toBe(true)
    expect(await snapshotFiles(server.dataDir)).toEqual(files)
    const after = await getCanvas(server)
    expect(after.response.status).toBe(200)
    expect(after.body.version).toBe(5)
  }, 30_000)

  it('gbrain 不可用时 timeline 为 skipped，HTTP 仍是 200，快照照样落盘', async () => {
    const server = await startServer({
      seed: { version: 1, document: doc('skip-file', '没有时间线也要留下'), snapshots: [] },
      gbrain: 'force-fail-flag',
    })
    const { response, body } = await keep(server, '"1"')
    expect(response.status).toBe(200)
    expect(body.timeline).toBe('skipped')
    expect(body.snapshotCount).toBe(1)
    expect(await snapshotFiles(server.dataDir)).toHaveLength(1)

    const stale = await keep(server, '"1"')
    expect(stale.response.status).toBe(412)
    expect(stale.body.version).toBe(2)
    expect(stale.body.snapshots).toEqual([])
    expect(await snapshotFiles(server.dataDir)).toHaveLength(1)
  }, 30_000)

  it('启动时把正本里的旧快照迁成独立文件；GET 不再下发快照正文', async () => {
    const marker = '旧快照正文-只该在独立文件里'
    const server = await startServer({
      seed: {
        version: 7,
        document: doc('migrate-file', '当前正本'),
        snapshots: [
          { version: 5, savedAt: '2026-10-01T02:00:00.000Z', document: doc('migrate-file', `${marker}-一`) },
          { version: 6, savedAt: '2026-10-01T02:00:00.000Z', document: doc('migrate-file', `${marker}-二`) },
        ],
      },
    })
    const files = await snapshotFiles(server.dataDir)
    expect(files).toHaveLength(2)
    const bodies = await Promise.all(
      files.map(async (name) => JSON.parse(await readFile(join(server.dataDir, name), 'utf8')) as Doc),
    )
    expect(bodies.map((item) => (item.snowflake.cards.c1 as { body: string }).body).sort()).toEqual([
      `${marker}-一`,
      `${marker}-二`,
    ])
    const canonical = JSON.parse(await readFile(join(server.dataDir, 'snowflake.json'), 'utf8'))
    expect(canonical.snapshots).toEqual([])
    expect(canonical.version).toBe(7)
    const backup = JSON.parse(await readFile(join(server.dataDir, 'snowflake.json.bak'), 'utf8'))
    expect(backup.snapshots).toHaveLength(2)

    const { response, text, body } = await getCanvas(server)
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"7"')
    expect(response.headers.get('x-snapshot-count')).toBe('2')
    expect(body.snapshots).toEqual([])
    expect(text).not.toContain(marker)

    const list = await fetch(`${server.base}/api/canvas/snapshots`)
    const listText = await list.text()
    expect(list.status).toBe(200)
    expect(listText).not.toContain(marker)
    const items = JSON.parse(listText) as Array<{ name: string; savedAt: string }>
    expect(items.map((item) => item.name)).toEqual([...files].sort().reverse())
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['name', 'savedAt'])
      expect(item.savedAt).toBe('2026-10-01T02:00:00.000Z')
    }
  }, 30_000)

  it('回退先多存一份当前快照，再把正本换成所选快照', async () => {
    const server = await startServer({
      seed: { version: 1, document: doc('rollback-file', '第一版'), snapshots: [] },
      gbrain: 'force-fail-flag',
    })
    const kept = await keep(server, '"1"')
    expect(kept.response.status).toBe(200)
    const chosen = kept.body.snapshotName as string

    const put = await fetch(`${server.base}/api/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"2"' },
      body: JSON.stringify(doc('rollback-file', '第二版，后来改坏了')),
    })
    expect(put.status).toBe(200)
    expect((await put.json()).snapshots).toEqual([])
    expect(await snapshotFiles(server.dataDir)).toHaveLength(1)

    const response = await rollback(server, chosen, '"3"')
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('"4"')
    expect(response.headers.get('x-snapshot-count')).toBe('2')
    const body = (await response.json()) as { version: number; document: Doc; snapshots: unknown[] }
    expect(Object.keys(body).sort()).toEqual(['document', 'snapshots', 'version'])
    expect(body.version).toBe(4)
    expect(body.snapshots).toEqual([])
    expect(body.document).toEqual(doc('rollback-file', '第一版'))

    const files = await snapshotFiles(server.dataDir)
    expect(files).toHaveLength(2)
    const extra = files.find((name) => name !== chosen)!
    expect(JSON.parse(await readFile(join(server.dataDir, extra), 'utf8'))).toEqual(
      doc('rollback-file', '第二版，后来改坏了'),
    )

    const after = await getCanvas(server)
    expect(after.body.version).toBe(4)
    expect(after.body.document).toEqual(doc('rollback-file', '第一版'))

    const stale = await rollback(server, chosen, '"3"')
    expect(stale.status).toBe(412)
    const staleBody = (await stale.json()) as { version: number; snapshots: unknown[] }
    expect(staleBody.version).toBe(4)
    expect(staleBody.snapshots).toEqual([])
    expect(await snapshotFiles(server.dataDir)).toHaveLength(2)
  }, 30_000)

  it('回退拒绝非法快照名，找不到的快照返回 404，都不改正本', async () => {
    const server = await startServer({
      seed: { version: 3, document: doc('bad-name-file', '不能被换掉'), snapshots: [] },
    })
    await writeFile(join(server.dataDir, 'other.json'), JSON.stringify(doc('bad-name-file', '目录外的文件')))
    const bad = [
      undefined,
      '',
      42,
      'snowflake.json',
      '../snowflake.json',
      'other.20261009T100000.snapshot.json',
      'snowflake.20261009T100000.snapshot.json/../../other.json',
      'snowflake..snapshot.json',
      'snowflake.20261009T100000\\x.snapshot.json',
      '/etc/passwd',
    ]
    for (const name of bad) {
      const response = await rollback(server, name, '"3"')
      expect(response.status, String(name)).toBe(400)
    }
    const missing = await rollback(server, 'snowflake.20200101T000000.snapshot.json', '"3"')
    expect(missing.status).toBe(404)
    expect(await snapshotFiles(server.dataDir)).toEqual([])
    const after = await getCanvas(server)
    expect(after.body.version).toBe(3)
    expect(after.body.document).toEqual(doc('bad-name-file', '不能被换掉'))
  }, 30_000)
})
