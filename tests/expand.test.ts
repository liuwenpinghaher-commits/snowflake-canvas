import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCard, linkCards, type AppState } from '../src/document.ts'
import {
  DEFAULT_EXPAND_URL,
  EXPAND_MODEL,
  MSG_CANDIDATE_MISS,
  buildExpandRequest,
  expandTargetAllowed,
  readCpaApiKey,
  requestExpandCandidates,
  type ExpandClientOptions,
  type ExpandRequest,
} from '../src/expand.ts'
import {
  CANONICAL_NAME,
  MSG_KEEP_SNAPSHOT,
  MSG_WRITE_FAILED,
  bytesEqual,
  createMemoryChannel,
  createPersistController,
  documentToBytes,
  parseCompleteDocument,
  type DirectoryAccess,
  type PersistController,
  type PersistPorts,
  type RecoveryLog,
} from '../src/persist.ts'
import { snapshotFileName } from '../src/snapshot.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class MemDir implements DirectoryAccess {
  files = new Map<string, Uint8Array>()
  events: string[] = []

  async read(name: string): Promise<Uint8Array | null> {
    this.events.push(`read:${name}`)
    const found = this.files.get(name)
    return found ? found.slice() : null
  }

  async writeTemp(name: string, bytes: Uint8Array): Promise<void> {
    this.events.push(`writeTemp:${name}`)
    this.files.set(name, bytes.slice())
  }

  async move(tempName: string, canonicalName: string): Promise<void> {
    this.events.push(`move:${tempName}->${canonicalName}`)
    const body = this.files.get(tempName)
    if (!body) throw new Error('missing temp')
    this.files.set(canonicalName, body.slice())
    this.files.delete(tempName)
  }

  async remove(name: string): Promise<void> {
    this.events.push(`remove:${name}`)
    this.files.delete(name)
  }

  async listNames(): Promise<string[]> {
    this.events.push('list')
    return [...this.files.keys()]
  }
}

class FakeLog implements RecoveryLog {
  bytes: Uint8Array | null = null
  writes: Uint8Array[] = []

  async read(): Promise<Uint8Array | null> {
    return this.bytes ? this.bytes.slice() : null
  }

  async write(bytes: Uint8Array): Promise<void> {
    const copy = bytes.slice()
    this.bytes = copy
    this.writes.push(copy)
  }
}

function textOf(bytes: Uint8Array | undefined): string {
  return bytes ? decoder.decode(bytes) : ''
}

function harness(options?: {
  mem?: MemDir
  log?: FakeLog
  ports?: Partial<PersistPorts>
  expand?: ExpandClientOptions
  now?: () => Date
}) {
  const mem = options?.mem ?? new MemDir()
  const log = options?.log ?? new FakeLog()
  const calls = { saveAs: 0, snapshot: 0 }
  let stored = false
  const downloads: { name: string; bytes: Uint8Array }[] = []
  const ports: PersistPorts = {
    protocol: 'http:',
    hasDirectoryPicker: true,
    now: options?.now ?? (() => new Date(2026, 9, 7, 21, 22, 0)),
    loadDirectory: async () => (stored ? mem : null),
    pickDirectory: async () => {
      stored = true
      return mem
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    logFactory: async () => log,
    tryAcquireLock: async () => ({ release() {} }),
    lockHeld: async () => false,
    channel: createMemoryChannel(),
    claim: { get: () => null, set: () => {} },
    askSaveAs: async () => {
      calls.saveAs += 1
      return true
    },
    askFirstDownload: async () => true,
    askSnapshotDownload: async (name, bytes) => {
      calls.snapshot += 1
      downloads.push({ name, bytes: bytes.slice() })
      return true
    },
    randomId: () => 'file-test',
    expand: options?.expand,
    ...options?.ports,
  }
  const ctl = createPersistController(ports)
  return {
    mem,
    log,
    ctl,
    calls,
    downloads,
    ports,
    markStored() {
      stored = true
    },
  }
}

function cardText(ctl: PersistController, id = 'c1'): string {
  return JSON.stringify(ctl.snapshot().state.snowflake.cards[id])
}

function completion(content: string): unknown {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function boot(ctl: PersistController, recipe?: (state: AppState) => AppState): Promise<void> {
  await ctl.selectDirectory()
  await ctl.mutate(
    recipe ??
      ((state) => createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '原来的句子' })),
  )
  ctl.select('c1')
}

function readSources(): string {
  const root = join(process.cwd(), 'src')
  const chunks: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.ts') || name.endsWith('.tsx')) chunks.push(readFileSync(full, 'utf8'))
    }
  }
  walk(root)
  return chunks.join('\n')
}

const sampleRequest = (): ExpandRequest => ({
  cardId: 'c1',
  layer: '一段',
  text: '这张卡片里已经写下的文字',
  parentSummary: '',
  neighborSummaries: [],
})

describe('AI 扩写候选和本地快照回退', () => {
  it('候选出现时卡片字节与请求前一致', async () => {
    let seen = ''
    let auth = ''
    const h = harness({
      expand: {
        apiKey: () => 'unit-test-key',
        fetch: async (_url, init) => {
          seen = String(init?.body ?? '')
          auth = new Headers(init?.headers).get('Authorization') ?? ''
          return jsonResponse(
            completion(JSON.stringify({ candidates: [{ id: 'cand-1', text: '尚未写回的候选甲' }] })),
          )
        },
      },
    })
    await boot(h.ctl, (state) => {
      let next = createCard(state, { id: 'parent', layer: 'situation', x: 0, y: 0, body: '父卡片短文' })
      next = createCard(next, {
        id: 'c1',
        layer: '一段',
        x: 200,
        y: 0,
        fields: { background: '这张卡片里已经写下的文字' },
      })
      next = createCard(next, {
        id: 'near',
        layer: '一段',
        x: 200,
        y: 120,
        fields: { background: '相邻短文' },
      })
      next = createCard(next, {
        id: 'far',
        layer: '人物',
        x: 480,
        y: 0,
        fields: { notes: '全书不该出现MARKER' },
      })
      return linkCards(next, 'parent', 'c1')
    })
    const beforeCard = cardText(h.ctl)
    const beforeFile = h.mem.files.get(CANONICAL_NAME)!.slice()
    const writes = h.log.writes.length
    const events = h.mem.events.length
    await h.ctl.requestCandidates('c1', 'background')
    expect(h.ctl.snapshot().view.candidates.map((item) => item.text)).toEqual(['尚未写回的候选甲'])
    expect(h.ctl.snapshot().view.expandNotice).toBeNull()
    expect(cardText(h.ctl)).toBe(beforeCard)
    expect(bytesEqual(h.mem.files.get(CANONICAL_NAME)!, beforeFile)).toBe(true)
    expect(h.log.writes.length).toBe(writes)
    expect(h.mem.events.length).toBe(events)
    expect(textOf(beforeFile)).not.toContain('尚未写回的候选甲')
    const body = JSON.parse(seen) as { model: string; messages: { role: string; content: string }[] }
    expect(body.model).toBe(EXPAND_MODEL)
    expect(body.model).toBe('deepseek-flash')
    const user = JSON.parse(body.messages.find((item) => item.role === 'user')!.content) as ExpandRequest
    expect(Object.keys(user).sort()).toEqual(
      ['cardId', 'layer', 'neighborSummaries', 'parentSummary', 'text'].sort(),
    )
    expect(user.text).toBe('这张卡片里已经写下的文字')
    expect(user.parentSummary).toContain('父卡片短文')
    expect(user.neighborSummaries).toContain('相邻短文')
    expect(seen).not.toContain('全书不该出现MARKER')
    expect(seen).not.toContain('应用到设定图')
    expect(auth).toBe('Bearer unit-test-key')
    expect(textOf(h.mem.files.get(CANONICAL_NAME))).not.toContain('unit-test-key')
  })

  it('点确认之后卡片才变成候选文本，并走正本写入', async () => {
    const h = harness({
      expand: {
        fetch: async () =>
          jsonResponse(completion(JSON.stringify({ candidates: [{ id: 'cand-1', text: '尚未写回的候选甲' }] }))),
      },
    })
    await boot(h.ctl)
    const before = cardText(h.ctl)
    await h.ctl.requestCandidates('c1', null)
    expect(cardText(h.ctl)).toBe(before)
    expect(textOf(h.mem.files.get(CANONICAL_NAME))).not.toContain('尚未写回的候选甲')
    const trail: string[] = []
    const origMove = h.mem.move.bind(h.mem)
    h.mem.move = async (tempName, canonicalName) => {
      trail.push(`move:${canonicalName}`)
      await origMove(tempName, canonicalName)
    }
    const origWrite = h.log.write.bind(h.log)
    h.log.write = async (bytes) => {
      trail.push('log')
      await origWrite(bytes)
    }
    await h.ctl.confirmCandidate('cand-1')
    expect(h.ctl.snapshot().state.snowflake.cards.c1?.body).toBe('尚未写回的候选甲')
    expect(textOf(h.mem.files.get(CANONICAL_NAME))).toContain('尚未写回的候选甲')
    expect(trail).toEqual(['move:snowflake.json', 'log'])
    const parsed = parseCompleteDocument(h.mem.files.get(CANONICAL_NAME)!)
    expect(parsed?.state.snowflake.cards.c1?.body).toBe('尚未写回的候选甲')
    expect(bytesEqual(h.log.bytes!, h.mem.files.get(CANONICAL_NAME)!)).toBe(true)
  })

  it('不点确认，卡片字节与请求前一致', async () => {
    const h = harness({
      expand: {
        fetch: async () =>
          jsonResponse(completion(JSON.stringify({ candidates: [{ id: 'cand-1', text: '尚未写回的候选甲' }] }))),
      },
    })
    await boot(h.ctl)
    const beforeCard = cardText(h.ctl)
    const beforeFile = h.mem.files.get(CANONICAL_NAME)!.slice()
    await h.ctl.requestCandidates('c1', null)
    h.ctl.dismissCandidates()
    expect(h.ctl.snapshot().view.candidates).toEqual([])
    expect(h.ctl.snapshot().view.expandNotice).toBeNull()
    expect(cardText(h.ctl)).toBe(beforeCard)
    expect(bytesEqual(h.mem.files.get(CANONICAL_NAME)!, beforeFile)).toBe(true)
    expect(textOf(beforeFile)).not.toContain('尚未写回的候选甲')
    console.log(
      '冲突句：任务书把「作者没点确认」和界面文案「候选没取到」写在一起。方案第12节第7条写明不点确认就关掉候选，卡片字节与请求前一致；请求失败时才显示「候选没取到」。以方案为准，不确认不显示「候选没取到」。',
    )
  })

  it('baseURL 改成非 127.0.0.1 或非 18100 时请求不发出（注入的 fetch/connect 计数为 0）', async () => {
    const blocked = [
      'http://10.144.144.1:18100/v1/chat/completions',
      'http://127.0.0.1:18101/v1/chat/completions',
      'http://localhost:18100/v1/chat/completions',
      'http://0.0.0.0:18100/v1/chat/completions',
      'http://127.0.0.1/v1/chat/completions',
    ]
    for (const baseURL of blocked) {
      let fetchCount = 0
      let connectCount = 0
      const result = await requestExpandCandidates(sampleRequest(), {
        baseURL,
        fetch: async () => {
          fetchCount += 1
          throw new Error('sent')
        },
        connect: () => {
          connectCount += 1
        },
      })
      expect(result.ok).toBe(false)
      expect(fetchCount).toBe(0)
      expect(connectCount).toBe(0)
    }
    let fetchCount = 0
    let connectCount = 0
    const h = harness({
      expand: {
        baseURL: 'http://127.0.0.1:80/v1/chat/completions',
        fetch: async () => {
          fetchCount += 1
          throw new Error('sent')
        },
        connect: () => {
          connectCount += 1
        },
      },
    })
    await boot(h.ctl)
    const before = h.mem.files.get(CANONICAL_NAME)!.slice()
    await h.ctl.requestCandidates('c1', null)
    expect(fetchCount).toBe(0)
    expect(connectCount).toBe(0)
    expect(bytesEqual(h.mem.files.get(CANONICAL_NAME)!, before)).toBe(true)
    expect(h.ctl.snapshot().view.expandNotice).toBe(MSG_CANDIDATE_MISS)
    expect(expandTargetAllowed(DEFAULT_EXPAND_URL)).toBe(true)
    expect(DEFAULT_EXPAND_URL).toBe('http://127.0.0.1:18100/v1/chat/completions')
  })

  it('模拟 5xx 或连接失败时卡片字节不变，界面文案是「候选没取到」', async () => {
    const failures: ExpandClientOptions['fetch'][] = [
      async () => new Response('no', { status: 503 }),
      async () => {
        throw new TypeError('connect failed')
      },
      async () => jsonResponse({ error: 'not-candidates' }),
    ]
    for (const fetchImpl of failures) {
      const h = harness({ expand: { fetch: fetchImpl } })
      await boot(h.ctl)
      const beforeCard = cardText(h.ctl)
      const beforeFile = h.mem.files.get(CANONICAL_NAME)!.slice()
      await h.ctl.requestCandidates('c1', null)
      expect(cardText(h.ctl)).toBe(beforeCard)
      expect(bytesEqual(h.mem.files.get(CANONICAL_NAME)!, beforeFile)).toBe(true)
      expect(h.ctl.snapshot().view.expandNotice).toBe('候选没取到')
      expect(h.ctl.snapshot().view.expandNotice).toBe(MSG_CANDIDATE_MISS)
      expect(h.ctl.snapshot().view.messages.join('\n')).not.toContain('503')
      expect(h.ctl.snapshot().view.messages.join('\n')).not.toContain('连接')
      expect(h.ctl.snapshot().view.candidates).toEqual([])
    }
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    const panel = readFileSync(join(process.cwd(), 'src/ExpandPanel.tsx'), 'utf8')
    expect(app).toContain('expandNotice={view.expandNotice}')
    expect(panel).toContain('{notice}')
    expect(panel).not.toContain('扩写失败')
    expect(panel).not.toContain('网络错误')
  })

  it('快照文件名匹配正本主名 + YYYYMMDDTHHmmss + .snapshot.json；同秒冲突加毫秒且不覆盖', async () => {
    const fixed = new Date(2026, 9, 7, 21, 22, 0)
    expect(snapshotFileName('snowflake.json', fixed, new Set())).toBe('snowflake.20261007T212200.snapshot.json')
    const h = harness({ now: () => fixed })
    await boot(h.ctl)
    await h.ctl.keepVersion()
    const plain = 'snowflake.20261007T212200.snapshot.json'
    expect(plain).toMatch(/^snowflake\.\d{8}T\d{6}\.snapshot\.json$/)
    expect(h.mem.files.has(plain)).toBe(true)
    const marker = encoder.encode('旧快照保留')
    h.mem.files.set(plain, marker)
    await h.ctl.keepVersion()
    expect(textOf(h.mem.files.get(plain))).toBe('旧快照保留')
    const created = [...h.mem.files.keys()].filter((name) => name.includes('.snapshot.json') && name !== plain)
    expect(created).toEqual(['snowflake.20261007T212200000.snapshot.json'])
    expect(created[0]).toMatch(/^snowflake\.\d{8}T\d{6}\d{3}\.snapshot\.json$/)
    expect(parseCompleteDocument(h.mem.files.get(created[0])!)).not.toBeNull()
    expect(h.mem.events.some((event) => event.startsWith('remove:') && event.includes('.snapshot.json'))).toBe(false)
  })

  it('回退三步：回退前先有一份当前正本的快照；回退后正本能解析且内容等于选中的旧快照', async () => {
    let second = 0
    const h = harness({ now: () => new Date(2026, 9, 7, 21, 22, second++) })
    await boot(h.ctl, (state) => createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '旧稿' }))
    await h.ctl.keepVersion()
    const oldNames = [...h.mem.files.keys()].filter((name) => name.endsWith('.snapshot.json'))
    expect(oldNames).toHaveLength(1)
    const oldName = oldNames[0]!
    const oldBytes = h.mem.files.get(oldName)!.slice()
    expect(textOf(oldBytes)).toContain('旧稿')
    await h.ctl.commitText('c1', null, '新稿')
    expect(textOf(h.mem.files.get(CANONICAL_NAME))).toContain('新稿')
    const trail: string[] = []
    const origMove = h.mem.move.bind(h.mem)
    h.mem.move = async (tempName, canonicalName) => {
      trail.push(`move:${canonicalName}`)
      await origMove(tempName, canonicalName)
    }
    const origWrite = h.log.write.bind(h.log)
    h.log.write = async (bytes) => {
      trail.push('log')
      await origWrite(bytes)
    }
    const logsBefore = h.log.writes.length
    await h.ctl.rollbackTo(oldName)
    const preNames = [...h.mem.files.keys()].filter((name) => name.endsWith('.snapshot.json') && name !== oldName)
    expect(preNames).toHaveLength(1)
    const preName = preNames[0]!
    expect(h.mem.files.has(preName)).toBe(true)
    expect(textOf(h.mem.files.get(preName))).toContain('新稿')
    expect(bytesEqual(h.mem.files.get(oldName)!, oldBytes)).toBe(true)
    const canonical = h.mem.files.get(CANONICAL_NAME)!
    expect(parseCompleteDocument(canonical)).not.toBeNull()
    expect(bytesEqual(canonical, oldBytes)).toBe(true)
    expect(h.ctl.snapshot().state.snowflake.cards.c1?.body).toBe('旧稿')
    expect(h.ctl.snapshot().view.fileName).toBe(CANONICAL_NAME)
    expect(trail).toEqual([`move:${preName}`, 'move:snowflake.json', 'log'])
    expect(h.log.writes.length).toBe(logsBefore + 1)
    expect(bytesEqual(h.log.bytes!, canonical)).toBe(true)
    expect(h.calls.saveAs).toBe(0)
  })

  it('快照不是打开时的真源', async () => {
    const mem = new MemDir()
    const first = harness({ mem, now: () => new Date(2026, 9, 7, 21, 22, 0) })
    await boot(first.ctl, (state) => createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '正本里的句子' }))
    const snap = buildExpandRequest(first.ctl.snapshot().state, 'c1', null)
    expect(snap?.text).toBe('正本里的句子')
    const other = documentToBytes(
      createCard(
        { canvas: { nodes: [], edges: [] }, snowflake: { fileId: 'file-test', cards: {} }, activeId: null },
        { id: 'c1', layer: 'situation', x: 0, y: 0, body: '快照里的句子' },
      ),
    )
    mem.files.set('snowflake.20261008T010101.snapshot.json', other)
    const readsBefore = mem.events.filter((event) => event.includes('snapshot') && event.startsWith('read:')).length
    const second = harness({ mem, now: () => new Date(2026, 9, 8, 1, 1, 1) })
    second.markStored()
    await second.ctl.start()
    expect(second.ctl.snapshot().state.snowflake.cards.c1?.body).toBe('正本里的句子')
    expect(second.ctl.snapshot().state.snowflake.cards.c1?.body).not.toBe('快照里的句子')
    expect(textOf(mem.files.get('snowflake.20261008T010101.snapshot.json'))).toContain('快照里的句子')
    const readsAfter = mem.events.filter((event) => event.includes('snapshot') && event.startsWith('read:')).length
    expect(readsAfter).toBe(readsBefore)
  })

  it('另存取消则停止，正本保持回退前的那一份，第 1 步快照已经留下', async () => {
    let rollback = false
    const order: string[] = []
    const downloads: { name: string; bytes: Uint8Array }[] = []
    const h = harness({
      now: () => new Date(2026, 9, 7, 21, 22, 2),
      ports: {
        hasDirectoryPicker: false,
        askSnapshotDownload: async (name, bytes) => {
          order.push('snap')
          downloads.push({ name, bytes: bytes.slice() })
          return true
        },
        askSaveAs: async () => {
          if (!rollback) return true
          order.push('save')
          return false
        },
      },
    })
    await h.ctl.selectDirectory()
    await h.ctl.mutate((state) => createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '回退前正文' }))
    const oldBytes = documentToBytes(h.ctl.snapshot().state)
    await h.ctl.commitText('c1', null, '新正文')
    const mid = cardText(h.ctl)
    const logsBefore = h.log.writes.length
    rollback = true
    await h.ctl.rollbackToBytes(oldBytes)
    expect(order).toEqual(['snap', 'save'])
    expect(downloads[0]?.name).toBe('snowflake.20261007T212202.snapshot.json')
    expect(textOf(downloads[0]?.bytes)).toContain('新正文')
    expect(cardText(h.ctl)).toBe(mid)
    expect(h.ctl.snapshot().state.snowflake.cards.c1?.body).toBe('新正文')
    expect(h.ctl.snapshot().view.canEdit).toBe(false)
    expect(h.ctl.snapshot().view.messages).toContain(MSG_WRITE_FAILED)
    expect(h.log.writes.length).toBe(logsBefore)
  })

  it('密钥来自环境变量，未落盘', () => {
    const source = readSources()
    expect(source).toContain('CPA_API_KEY')
    expect(source).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
    expect(source).not.toContain('应用到设定图')
    const previous = process.env.CPA_API_KEY
    process.env.CPA_API_KEY = 'unit-test-key'
    try {
      expect(readCpaApiKey()).toBe('unit-test-key')
    } finally {
      if (previous === undefined) delete process.env.CPA_API_KEY
      else process.env.CPA_API_KEY = previous
    }
    const appSource = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(MSG_KEEP_SNAPSHOT).toBe('留下这一版')
    expect(appSource).toContain('MSG_KEEP_SNAPSHOT')
    expect(appSource).toContain('回退到这一版')
    console.log('密钥来自环境变量，未落盘')
  })

  it('对 127.0.0.1:18100 的真实扩写在有密钥时发出很小的请求', async () => {
    const key = readCpaApiKey()
    if (!key) {
      console.log('SKIP_LIVE')
      return
    }
    let status = 0
    const h = harness({
      expand: {
        maxTokens: 32,
        fetch: async (input, init) => {
          const payload = JSON.parse(String(init?.body ?? '{}')) as { model?: string; max_tokens?: number }
          if (payload.model !== 'deepseek-flash') throw new Error('model')
          if (payload.max_tokens !== 32) throw new Error('max_tokens')
          const headers = new Headers(init?.headers)
          const authorization = headers.get('Authorization')
          if (!authorization || !authorization.startsWith('Bearer ') || authorization.trim() === 'Bearer') {
            throw new Error('live request missing bearer')
          }
          const response = await fetch(input, init)
          status = response.status
          return response
        },
      },
    })
    await boot(h.ctl)
    const beforeCard = cardText(h.ctl)
    const beforeFile = h.mem.files.get(CANONICAL_NAME)!.slice()
    await h.ctl.requestCandidates('c1', null)
    const view = h.ctl.snapshot().view
    if (view.candidates.length === 0) throw new Error(`live expand empty status ${status}`)
    expect(cardText(h.ctl)).toBe(beforeCard)
    expect(bytesEqual(h.mem.files.get(CANONICAL_NAME)!, beforeFile)).toBe(true)
    console.log(`候选 id ${view.candidates[0]?.id}`)
    console.log('卡片字节未改')
  }, 20000)
})
