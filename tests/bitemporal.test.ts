import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverEntry = join(repoRoot, 'server', 'http.mjs')

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

describe('双时态页面与接口', () => {
  it('导航、页面和接口接在同一套服务上', async () => {
    const app = await readFile(join(repoRoot, 'src', 'App.tsx'), 'utf8')
    const page = await readFile(join(repoRoot, 'src', 'BitemporalPage.tsx'), 'utf8')
    const http = await readFile(join(repoRoot, 'server', 'http.mjs'), 'utf8')
    const api = await readFile(join(repoRoot, 'server', 'bitemporal.mjs'), 'utf8')
    expect(app).toContain('时序/设定演进（Bitemporal）')
    expect(app).toContain("page === 'bitemporal'")
    expect(page).toContain('客观正史 (Canon Truth)')
    expect(page).toContain('角色主观认知 (POV Belief)')
    expect(page).toContain('新替旧 (Supersede)')
    expect(page).toContain('分域共存 (Coexist)')
    expect(page).toContain('驳回 (Reject)')
    expect(page).toContain('/api/bitemporal/narrative')
    expect(page).toContain('/api/bitemporal/conflicts')
    expect(page).toContain('/api/bitemporal/resolve')
    expect(http).toContain('registerBitemporalRoutes')
    expect(api).toContain('LEDGER_OK')
    expect(api).toContain('narrative_scene_no_overlap')
  })
})

describe('双时态接口对着生产库', () => {
  let base = ''
  let child: ChildProcess | null = null
  let dataDir = ''
  let home = ''

  beforeAll(async () => {
    const seedScript = process.env.SNOWFLAKE_BITEMPORAL_SEED || join(userInfo().homedir, '.hermes/scripts/seed-bitemporal-demo.sh')
    const seeded = spawn('bash', [seedScript], { stdio: ['ignore', 'pipe', 'pipe'] })
    const seedOut = await new Promise<string>((resolve, reject) => {
      let out = ''
      let err = ''
      seeded.stdout?.on('data', (chunk) => { out += String(chunk) })
      seeded.stderr?.on('data', (chunk) => { err += String(chunk) })
      seeded.on('error', reject)
      seeded.on('close', (code) => {
        if (code !== 0) reject(new Error(err || out || `seed ${code}`))
        else resolve(out)
      })
    })
    expect(seedOut).toContain('SEED_OK')
    expect(seedOut).toContain('LEDGER_OK')

    dataDir = await mkdtemp(join(tmpdir(), 'snowflake-bitemporal-data-'))
    home = await mkdtemp(join(tmpdir(), 'snowflake-bitemporal-home-'))
    const port = await freePort()
    child = spawn(process.execPath, [serverEntry], {
      env: {
        ...process.env,
        HOME: home,
        SNOWFLAKE_DATA_DIR: dataDir,
        SNOWFLAKE_LISTEN_HOST: '127.0.0.1',
        SNOWFLAKE_PORT: String(port),
        SNOWFLAKE_PG_MIRROR: '0',
        API_SERVER_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout?.on('data', (chunk) => { output += String(chunk) })
    child.stderr?.on('data', (chunk) => { output += String(chunk) })
    base = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 20000
    for (;;) {
      if (child.exitCode !== null) throw new Error(`服务器没起来：${output}`)
      try {
        const response = await fetch(`${base}/api/health`)
        if (response.ok) break
      } catch {
        // 端口还没打开。
      }
      if (Date.now() > deadline) throw new Error(`服务器起不来：${output}`)
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }, 90000)

  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child?.once('exit', resolve))
      child.kill('SIGTERM')
      await exited
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
    if (home) await rm(home, { recursive: true, force: true })
  })

  it('第 10 场和第 30 场生效的设定不一样，正史和角色认知都在', async () => {
    const early = await fetch(`${base}/api/bitemporal/narrative?book_ref=got-s1&scene_seq=10`)
    const late = await fetch(`${base}/api/bitemporal/narrative?book_ref=got-s1&scene_seq=30`)
    expect(early.status).toBe(200)
    expect(late.status).toBe(200)
    const scene10 = await early.json() as {
      active_canon: Array<{ subject_ref: string; phrase: string; literal_value: string }>
      active_pov_beliefs: Array<{ pov_entity_id: string; subject_ref: string; literal_value: string; layer: string }>
    }
    const scene30 = await late.json() as typeof scene10
    const canonAt = (payload: typeof scene10, subject: string) =>
      payload.active_canon.filter((row) => row.subject_ref === subject).map((row) => row.literal_value)
    expect(canonAt(scene10, 'eddard-stark').join(' ')).toContain('尚未察觉')
    expect(canonAt(scene30, 'eddard-stark').join(' ')).toContain('已查出')
    expect(canonAt(scene30, 'eddard-stark').join(' ')).not.toContain('尚未察觉')
    expect(scene10.active_canon.some((row) => row.phrase === '真实血脉')).toBe(true)
    expect(scene10.active_pov_beliefs.some((row) => row.pov_entity_id === 'jon-snow' && row.literal_value.includes('私生子'))).toBe(true)
    expect(scene30.active_pov_beliefs.some((row) => row.pov_entity_id === 'eddard-stark' && row.literal_value.includes('詹姆'))).toBe(true)
  })

  it('台账校验是 LEDGER_OK', async () => {
    const response = await fetch(`${base}/api/bitemporal/conflicts`)
    expect(response.status).toBe(200)
    const body = await response.json() as {
      conflicts: unknown[]
      ledger: unknown[]
      ledger_verification: { status: string; count: number }
    }
    expect(body.conflicts.length).toBeGreaterThanOrEqual(5)
    expect(body.ledger.length).toBeGreaterThanOrEqual(3)
    expect(body.ledger_verification.status).toBe('LEDGER_OK')
  })

  it('新断言可以写入，重叠区间会被排他约束拒绝', async () => {
    const created = await fetch(`${base}/api/bitemporal/narrative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_ref: 'vitest-bt',
        layer: 'canon',
        subject_ref: 'probe',
        phrase: '验收探针',
        literal_value: '甲',
        valid_from_scene_seq: 60,
        valid_to_scene_seq: 70,
        chapter_ord: 0,
        scene_ord: 60,
      }),
    })
    expect(created.status).toBe(200)
    const overlap = await fetch(`${base}/api/bitemporal/narrative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        book_ref: 'vitest-bt',
        layer: 'canon',
        subject_ref: 'probe',
        phrase: '验收探针',
        literal_value: '乙',
        valid_from_scene_seq: 65,
        valid_to_scene_seq: 75,
        chapter_ord: 0,
        scene_ord: 65,
      }),
    })
    expect(overlap.status).toBe(409)
    const body = await overlap.json() as { constraint?: string }
    expect(body.constraint).toBe('narrative_scene_no_overlap')
  })
})
