import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantActions, adoptionText, brainFailure, captureToBrain, type ChatMessage } from '../src/CardDiscuss.tsx'
import { stripMarkdown } from '../src/markdown-lite.tsx'
import { withSession } from '../server/discuss-store.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverEntry = join(repoRoot, 'server', 'http.mjs')
const cardDiscussPath = join(repoRoot, 'src', 'CardDiscuss.tsx')
const FAKE_SLUG = 'inbox/2026-10-09-fake1234'

const MARKDOWN_REPLY = [
  '## 结论',
  '',
  '**主角**在门口犹豫，是因为 `旧账` 没还。',
  '',
  '- 先补一场对质',
  '- 再写离开',
  '',
  '参考 [前一章](https://example.com/ch1)。',
].join('\n')

type GbrainMode = 'ok' | 'accepted' | 'fail-command' | 'storage-busy' | 'force-fail-flag'

interface Running {
  base: string
  home: string
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

function fakeGbrain(home: string, mode: GbrainMode): string {
  const record = `echo "$@" >> "${join(home, 'gbrain-args')}"\ncat > "${join(home, 'gbrain-stdin')}"\n`
  if (mode === 'ok') {
    return `#!/bin/sh\n${record}echo "UPGRADE_AVAILABLE 9.9.9"\nprintf '{\\n  "slug": "${FAKE_SLUG}",\\n  "status": "created"\\n}\\n'\n`
  }
  if (mode === 'accepted') {
    return `#!/bin/sh\n${record}printf '{"write_request":{"state":"accepted","request_id":"r1"}}\\n'\n`
  }
  if (mode === 'storage-busy') {
    return `#!/bin/sh\n${record}echo "storage_busy: brain is locked" >&2\nexit 1\n`
  }
  return `#!/bin/sh\n${record}echo "fake gbrain down" >&2\nexit 3\n`
}

async function startServer(mode: GbrainMode): Promise<Running> {
  const dataDir = await mkdtemp(join(tmpdir(), 'snowflake-capture-data-'))
  const home = await mkdtemp(join(tmpdir(), 'snowflake-capture-home-'))
  const store = withSession({ cards: {} }, 'card-a', {
    sessionId: 's1',
    title: '念头讨论',
    createdAt: '2026-10-09T02:00:00.000Z',
    cardId: 'card-a',
  })
  await writeFile(join(dataDir, 'session.json'), JSON.stringify(store))
  await mkdir(join(home, '.gbrain'))
  await writeFile(join(home, '.gbrain', 'env'), '')
  const fake = join(home, 'gbrain-fake')
  await writeFile(fake, fakeGbrain(home, mode))
  await chmod(fake, 0o755)
  if (mode === 'force-fail-flag') await writeFile(join(dataDir, 'gbrain-force-fail'), '')
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    SNOWFLAKE_DATA_DIR: dataDir,
    SNOWFLAKE_LISTEN_HOST: '127.0.0.1',
    SNOWFLAKE_PORT: String(port),
    SNOWFLAKE_GBRAIN_BIN: fake,
    API_SERVER_KEY: '',
  }
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
    home,
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

async function capture(server: Running, body: Record<string, unknown>) {
  const response = await fetch(`${server.base}/api/brain/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { response, payload: (await response.json()) as { ok?: boolean; slug?: string; error?: string } }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

function reply(extra: Partial<ChatMessage> = {}): ChatMessage {
  return { key: 'srv-id:8', serverKey: 'id:8', id: '8', role: 'assistant', content: MARKDOWN_REPLY, at: '2026-10-09T02:10:00.000Z', ...extra }
}

function actions(item: ChatMessage, extra: { writing?: boolean; finished?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(AssistantActions, {
      item,
      copied: false,
      writing: extra.writing ?? false,
      finished: extra.finished ?? true,
      onAdopt: () => {},
      onCopy: () => {},
      onWriteBrain: () => {},
    }),
  )
}

describe('写入脑按钮在 AI 回复上', () => {
  it('写完的 AI 回复：采纳、复制旁边有「写入脑」', () => {
    const html = actions(reply())
    expect(html).toContain('采纳进本念头')
    expect(html).toContain('复制')
    expect(html).toMatch(/<button[^>]*>写入脑<\/button>/)
    expect(html.indexOf('写入脑')).toBeGreaterThan(html.indexOf('复制'))
  })

  it('用户消息、空白回复没有按钮；正在回复的那条先不给写入脑', () => {
    expect(actions(reply({ role: 'user' }))).toBe('')
    expect(actions(reply({ content: '  \n ' }))).toBe('')
    const streaming = actions(reply(), { finished: false })
    expect(streaming).toContain('采纳进本念头')
    expect(streaming).not.toContain('写入脑')
  })

  it('写入中按钮不可点；成功后气泡显示「已写入脑：<slug>」', () => {
    expect(actions(reply(), { writing: true })).toMatch(/<button[^>]*disabled=""[^>]*>写入脑<\/button>/)
    expect(actions(reply())).not.toContain('已写入脑')
    expect(actions(reply({ brainSlug: FAKE_SLUG }))).toContain(`已写入脑：${FAKE_SLUG}`)
  })

  it('浮窗走 /api/brain/capture，不调整页覆盖的 /api/brain/write；讨论指令那句不变', () => {
    const source = readFileSync(cardDiscussPath, 'utf8')
    expect(source).toContain("api('/api/brain/capture')")
    expect(source).not.toContain('/api/brain/write')
    const server = readFileSync(serverEntry, 'utf8')
    expect(server).toContain('讨论结论不要自动写回 gbrain。只有用户在页面上另点「写入脑」才写。')
  })
})

describe('浮窗发出的写入脑请求', () => {
  it('只送 cardId、sessionId、messageId、role、at 和去 Markdown 的正文，成功带回 slug', async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, slug: FAKE_SLUG }), { status: 200 }))
    const outcome = await captureToBrain('card-a', 's1', reply(), fakeFetch as unknown as typeof fetch)
    expect(outcome).toEqual({ ok: true, slug: FAKE_SLUG })
    const [url, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url, 'http://canvas.local').pathname.endsWith('/api/brain/capture')).toBe(true)
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(Object.keys(body).sort()).toEqual(['at', 'cardId', 'content', 'messageId', 'role', 'sessionId'])
    expect(body).toMatchObject({ cardId: 'card-a', sessionId: 's1', messageId: '8', role: 'assistant' })
    expect(body.content).toBe(adoptionText(MARKDOWN_REPLY))
    expect(body.content).not.toMatch(/##|\*\*|`|\]\(/)
  })

  it('接口非 200 时不给 slug，浮窗文案是「没写入脑：…」', async () => {
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'gbrain 不可用' }), { status: 502 }))
    const outcome = await captureToBrain('card-a', 's1', reply(), fakeFetch as unknown as typeof fetch)
    expect(outcome).toEqual({ ok: false, error: 'gbrain 不可用' })
    expect(brainFailure(outcome.ok ? '' : outcome.error)).toBe('没写入脑：gbrain 不可用')
    const broken = vi.fn(async () => {
      throw new TypeError('network')
    })
    expect((await captureToBrain('card-a', 's1', reply(), broken as unknown as typeof fetch)).ok).toBe(false)
  })

  it('写入失败的分支先报错并 return，之后才给气泡记 slug', () => {
    const source = readFileSync(cardDiscussPath, 'utf8')
    const start = source.indexOf('async function writeBrain(item: ChatMessage)')
    const body = source.slice(start, source.indexOf('const selected =', start))
    const failBranch = body.indexOf('if (!outcome.ok)')
    const failBody = body.slice(failBranch, body.indexOf('}', failBranch))
    expect(failBranch).toBeGreaterThan(0)
    expect(failBody).toContain('setNotice(brainFailure(outcome.error))')
    expect(failBody).toContain('return')
    expect(body.indexOf('brainSlug: outcome.slug')).toBeGreaterThan(failBranch)
    expect(body).not.toMatch(/halt\(|abort\(|requestClose\(|onClose/)
  })
})

describe('POST /api/brain/capture', () => {
  it('gbrain capture 收到的是去 Markdown 的纯文本，第一行是来源；成功响应带 gbrain 给的 slug', async () => {
    const server = await startServer('ok')
    const { response, payload } = await capture(server, {
      cardId: 'card-a',
      sessionId: 's1',
      messageId: '8',
      role: 'assistant',
      at: '2026-10-09T02:10:00.000Z',
      content: MARKDOWN_REPLY,
    })
    expect(response.status).toBe(200)
    expect(payload).toEqual({ ok: true, slug: FAKE_SLUG })
    const args = (await readFile(join(server.home, 'gbrain-args'), 'utf8')).trim().split('\n')
    expect(args).toEqual(['capture --stdin --json'])
    const text = await readFile(join(server.home, 'gbrain-stdin'), 'utf8')
    const lines = text.split('\n')
    expect(lines[0]).toBe('来源：雪花画布卡片 card-a')
    expect(text).toContain(stripMarkdown(MARKDOWN_REPLY))
    expect(text).not.toMatch(/##|\*\*|`|\]\(|https?:/)
    expect(text).toContain('主角在门口犹豫，是因为 旧账 没还。')
  })

  it('浏览器传来的还是 Markdown 也会再洗一次；空结论 400 且不调 gbrain', async () => {
    const server = await startServer('ok')
    const empty = await capture(server, { cardId: 'card-a', sessionId: 's1', role: 'assistant', content: '---\n\n  ' })
    expect(empty.response.status).toBe(400)
    expect(empty.payload.error).toBe('这条结论是空的，没有写入')
    expect(await exists(join(server.home, 'gbrain-args'))).toBe(false)
  })

  it('卡片和会话对不上、或者不是 AI 回复，都不写', async () => {
    const server = await startServer('ok')
    const wrongCard = await capture(server, { cardId: 'card-b', sessionId: 's1', role: 'assistant', content: '一句结论' })
    expect(wrongCard.response.status).toBe(400)
    const mine = await capture(server, { cardId: 'card-a', sessionId: 's1', role: 'user', content: '一句结论' })
    expect(mine.response.status).toBe(400)
    expect(await exists(join(server.home, 'gbrain-args'))).toBe(false)
  })

  it('gbrain-force-fail 旗标在时 HTTP 非 200，不给 slug，不跑 gbrain', async () => {
    const server = await startServer('force-fail-flag')
    const { response, payload } = await capture(server, { cardId: 'card-a', sessionId: 's1', role: 'assistant', content: '一句结论' })
    expect(response.status).not.toBe(200)
    expect(payload.ok).toBeUndefined()
    expect(payload.slug).toBeUndefined()
    expect(payload.error).toBe('gbrain 不可用')
    expect(await exists(join(server.home, 'gbrain-args'))).toBe(false)
  })

  it('gbrain 命令失败时 HTTP 非 200，错误里写明 gbrain 不可用', async () => {
    const server = await startServer('fail-command')
    const { response, payload } = await capture(server, { cardId: 'card-a', sessionId: 's1', role: 'assistant', content: '一句结论' })
    expect(response.status).not.toBe(200)
    expect(payload.slug).toBeUndefined()
    expect(payload.error).toContain('gbrain 不可用')
    expect(payload.error).toContain('fake gbrain down')
  })

  it('storage_busy 只试一次就返回，不进 put 的退避循环', async () => {
    const server = await startServer('storage-busy')
    const started = Date.now()
    const { response, payload } = await capture(server, { cardId: 'card-a', sessionId: 's1', role: 'assistant', content: '一句结论' })
    expect(response.status).not.toBe(200)
    expect(payload.error).toContain('storage_busy')
    expect(Date.now() - started).toBeLessThan(2500)
    const args = (await readFile(join(server.home, 'gbrain-args'), 'utf8')).trim().split('\n')
    expect(args).toHaveLength(1)
  })

  it('gbrain 只收下请求、还没写完（没有 slug）时也算失败', async () => {
    const server = await startServer('accepted')
    const { response, payload } = await capture(server, { cardId: 'card-a', sessionId: 's1', role: 'assistant', content: '一句结论' })
    expect(response.status).not.toBe(200)
    expect(payload.slug).toBeUndefined()
  })
})
