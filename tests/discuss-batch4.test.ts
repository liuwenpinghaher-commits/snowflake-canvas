import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  adoptionText,
  applySse,
  leaveCard,
  liveRunFor,
  pointerCloses,
  prependOlder,
  sessionLabel,
  startRun,
  stopRun,
  type ReplyRun,
} from '../src/CardDiscuss.tsx'
import { stripMarkdown } from '../src/markdown-lite.tsx'
import {
  fetchMessagePage,
  loadMessagePage,
  mergeStores,
  normalizeStore,
  publicSessions,
  resolveAdoptionKey,
  withAdoption,
  withFirstAsk,
  withSession,
} from '../server/discuss-store.mjs'

const cardDiscussPath = fileURLToPath(new URL('../src/CardDiscuss.tsx', import.meta.url))

type GatewayRow = { id?: number; role: string; content: string; timestamp: number }

function gatewayRows(count: number, withIds = true): GatewayRow[] {
  const rows: GatewayRow[] = []
  for (let n = 1; n <= count; n += 1) {
    const role = n % 5 === 0 ? 'tool' : n % 2 === 1 ? 'user' : 'assistant'
    const row: GatewayRow = { role, content: `第${n}条`, timestamp: 1_760_000_000 + n }
    if (withIds) row.id = n
    rows.push(row)
  }
  return rows
}

// 照 api_server.py _handle_session_messages + hermes_state_messages.get_messages 的分页语义：
// 带 limit 不带 order 时按 oldest；latest 从最新往前，offset 跳过最新的若干条，返回仍按时间正序。
function fakeGateway(rows: GatewayRow[]) {
  const calls: string[] = []
  const gatewayFetch = vi.fn(async (path: string) => {
    calls.push(path)
    const url = new URL(path, 'http://gateway.local')
    const rawLimit = url.searchParams.get('limit')
    const offset = Number(url.searchParams.get('offset') || '0')
    const order = url.searchParams.get('order')
    const defaultPage = rawLimit === null
    const latest = order === 'latest' || (order === null && defaultPage)
    const limit = defaultPage ? 500 : Math.min(Number(rawLimit), 500)
    const ordered = latest ? rows.slice().reverse() : rows.slice()
    const page = ordered.slice(offset, offset + limit)
    if (latest) page.reverse()
    return new Response(JSON.stringify({ object: 'list', data: page }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return { gatewayFetch, calls }
}

function storeWith(cardId: string, sessionId: string, extra: Record<string, unknown> = {}) {
  return withSession({ cards: {} }, cardId, {
    sessionId,
    title: '念头讨论',
    createdAt: '2026-10-09T02:00:00.000Z',
    cardId,
    ...extra,
  })
}

describe('讨论历史取最新一页，能往前翻', () => {
  it('网关按 oldest 会先给开头；8093 消息接口给最新一页，带 offset 再取到更早的一页', async () => {
    const rows = gatewayRows(100)
    const { gatewayFetch, calls } = fakeGateway(rows)

    const oldWay = await (await gatewayFetch('/api/sessions/s1/messages?limit=80&order=oldest')).json()
    expect(oldWay.data[0].content).toBe('第1条')

    const store = storeWith('card-a', 's1')
    const first = await loadMessagePage(gatewayFetch, store, 'card-a', 's1', { limit: '10' })
    expect(calls[calls.length - 1]).toContain('order=latest')
    expect(calls[calls.length - 1]).toContain('limit=11')
    expect(first.messages.map((item: { content: string }) => item.content)).toEqual([
      '第91条',
      '第92条',
      '第93条',
      '第94条',
      '第96条',
      '第97条',
      '第98条',
      '第99条',
    ])
    expect(first.messages.every((item: { role: string }) => item.role === 'user' || item.role === 'assistant')).toBe(true)
    expect(first.hasMore).toBe(true)
    expect(first.nextOffset).toBe(10)

    const second = await loadMessagePage(gatewayFetch, store, 'card-a', 's1', { limit: '10', offset: String(first.nextOffset) })
    expect(calls[calls.length - 1]).toContain('offset=10')
    expect(second.messages[0].content).toBe('第81条')
    expect(second.messages[second.messages.length - 1].content).toBe('第89条')
    expect(second.hasMore).toBe(true)
    expect(second.nextOffset).toBe(20)

    const tail = await fetchMessagePage(gatewayFetch, 's1', { limit: 10, offset: 95 })
    expect(tail.hasMore).toBe(false)
    expect(tail.messages[0].content).toBe('第1条')
  })

  it('往前翻接在前面，不盖掉已显示的最新消息，重叠的按消息键去掉', () => {
    const current = [
      { key: 'srv-id:9', serverKey: 'id:9', role: 'user' as const, content: '第9条' },
      { key: 'srv-id:10', serverKey: 'id:10', role: 'assistant' as const, content: '第10条' },
      { key: 'local-1', role: 'user' as const, content: '刚发的' },
    ]
    const older = [
      { key: 'srv-id:7', serverKey: 'id:7', role: 'user' as const, content: '第7条' },
      { key: 'srv-id:9', serverKey: 'id:9', role: 'user' as const, content: '第9条' },
    ]
    const merged = prependOlder(current, older)
    expect(merged.map((item) => item.content)).toEqual(['第7条', '第9条', '第10条', '刚发的'])
  })
})

function fakeTarget(hits: Record<string, { 'data-id'?: string }>) {
  return {
    closest: (selector: string) => {
      const hit = hits[selector]
      if (!hit) return null
      return { getAttribute: (name: string) => (name === 'data-id' ? (hit['data-id'] ?? null) : null) }
    },
  }
}

describe('浮窗与右侧编辑器共存，关浮窗不中断回复', () => {
  it('点 .side 不关浮窗；点画布空白、别的卡、顶栏仍关', () => {
    const onClose = vi.fn()
    const handle = (target: unknown) => {
      if (pointerCloses(target, 'card-a')) onClose()
    }
    handle(fakeTarget({ '.side': {} }))
    handle(fakeTarget({ '[data-discuss-popover]': {} }))
    handle(fakeTarget({ '.react-flow__node': { 'data-id': 'card-a' } }))
    expect(onClose).not.toHaveBeenCalled()
    handle(fakeTarget({}))
    handle(fakeTarget({ '.react-flow__node': { 'data-id': 'card-b' } }))
    handle(fakeTarget({ '.topbar': {} }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('卸载浮窗不 abort 进行中的请求；同卡再开能接上；换卡才断浏览器连接', async () => {
    let seenSignal: AbortSignal | undefined
    let finish: () => void = () => {}
    const fakeFetch = vi.fn((_url: string, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined
      return new Promise<Response>((resolve) => {
        finish = () => resolve(new Response('event: assistant.completed\ndata: {"content":"收完的全文"}\n\n'))
      })
    })
    const run = startRun('card-a', 's1', async (r) => {
      await fakeFetch('/api/discuss/stream', { signal: r.controller.signal })
    })
    expect(fakeFetch).toHaveBeenCalledTimes(1)

    expect(leaveCard(run, 'card-a')).toBe(false)
    expect(seenSignal?.aborted).toBe(false)
    expect(run.controller.signal.aborted).toBe(false)
    expect(liveRunFor('card-a')).toBe(run)

    finish()
    await run.done
    expect(seenSignal?.aborted).toBe(false)
    expect(liveRunFor('card-a')).toBeUndefined()

    const other = startRun('card-a', 's1', () => new Promise<void>(() => {}))
    expect(leaveCard(other, 'card-b')).toBe(true)
    expect(other.controller.signal.aborted).toBe(true)
    expect(liveRunFor('card-a')).toBeUndefined()
  })

  it('浮窗卸载时的清理只摘监听，不调 halt / abort', () => {
    const source = readFileSync(cardDiscussPath, 'utf8')
    const start = source.indexOf("document.addEventListener('pointerdown', onPointer, true)")
    const cleanup = source.slice(start, source.indexOf('}, [cardId])', start))
    expect(cleanup).toContain("removeEventListener('pointerdown'")
    expect(cleanup).not.toMatch(/halt\(|abort\(/)
  })
})

describe('停止真正停网关任务', () => {
  function runFor(): ReplyRun {
    return { cardId: 'card-a', sessionId: 's1', runId: '', controller: new AbortController(), done: Promise.resolve() }
  }

  it('收到 run_id 后点停止，POST /api/discuss/runs/<id>/stop 且带 cardId、sessionId', async () => {
    const run = runFor()
    applySse(
      'event: run.started\ndata: {"run_id":"run-42"}',
      () => {},
      () => {},
      (id) => {
        run.runId = id
      },
    )
    expect(run.runId).toBe('run-42')
    const fakeFetch = vi.fn(async () => new Response('{}', { status: 200 }))
    const outcome = await stopRun(run, fakeFetch as unknown as typeof fetch)
    expect(outcome).toBe('stopped')
    expect(run.controller.signal.aborted).toBe(true)
    expect(fakeFetch).toHaveBeenCalledTimes(1)
    const [url, init] = fakeFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    const parsed = new URL(url, 'http://canvas.local')
    expect(parsed.pathname.endsWith('/api/discuss/runs/run-42/stop')).toBe(true)
    expect(parsed.searchParams.get('cardId')).toBe('card-a')
    expect(parsed.searchParams.get('sessionId')).toBe('s1')
  })

  it('还没有 run_id 时只断浏览器流，不发 POST', async () => {
    const run = runFor()
    const fakeFetch = vi.fn(async () => new Response('{}'))
    const outcome = await stopRun(run, fakeFetch as unknown as typeof fetch)
    expect(outcome).toBe('local')
    expect(run.controller.signal.aborted).toBe(true)
    expect(fakeFetch).not.toHaveBeenCalled()
  })

  it('停止接口失败时如实报失败，不假装已停', async () => {
    const run = { ...runFor(), runId: 'run-7' }
    const fakeFetch = vi.fn(async () => new Response('{"error":"x"}', { status: 502 }))
    expect(await stopRun(run, fakeFetch as unknown as typeof fetch)).toBe('failed')
    const broken = vi.fn(async () => {
      throw new TypeError('network')
    })
    expect(await stopRun({ ...runFor(), runId: 'run-8' }, broken as unknown as typeof fetch)).toBe('failed')
  })
})

describe('采纳去掉 Markdown 标记', () => {
  it('标题、加粗、列表、行内代码、链接、围栏都不进卡片', () => {
    const source = [
      '## 标题',
      '',
      '**粗** 和 *斜* 还有 `代码`',
      '',
      '- 项一',
      '- 项二',
      '1. 第一步',
      '',
      '看 [这篇](https://example.com/a) 说明',
      '```js',
      'const a = 1',
      '```',
    ].join('\n')
    const plain = adoptionText(source)
    expect(plain).toBe(stripMarkdown(source))
    expect(plain).not.toContain('##')
    expect(plain).not.toContain('**')
    expect(plain).not.toMatch(/^- /m)
    expect(plain).not.toContain('`')
    expect(plain).not.toContain('](')
    expect(plain).not.toContain('https://example.com')
    expect(plain).toContain('标题')
    expect(plain).toContain('粗 和 斜 还有 代码')
    expect(plain).toContain('项一\n项二')
    expect(plain).toContain('1. 第一步')
    expect(plain).toContain('看 这篇 说明')
    expect(plain).toContain('const a = 1')
  })

  it('浮窗的采纳走 adoptionText，复制仍用原文', () => {
    const source = readFileSync(cardDiscussPath, 'utf8')
    expect(source).toContain('const cleaned = adoptionText(item.content)')
    expect(source).toContain('copyText(item.content, item.key)')
  })
})

describe('采纳来源持久', () => {
  it('写入 adoptions 后重新加载消息，对应气泡仍标已采纳', async () => {
    const rows = gatewayRows(12)
    const { gatewayFetch } = fakeGateway(rows)
    let store = storeWith('card-a', 's1')
    const resolved = await resolveAdoptionKey(gatewayFetch, 's1', { role: 'assistant', content: '第8条', at: 'local-clock' })
    expect(resolved).toEqual({ key: 'id:8', messageId: '8' })
    store = withAdoption(store, 'card-a', 's1', { ...resolved, adoptedAt: '2026-10-09T02:30:00.000Z' })

    const reloaded = normalizeStore(JSON.parse(JSON.stringify(store)))
    const kept = mergeStores(reloaded, storeWith('card-a', 's2'))
    const page = await loadMessagePage(gatewayFetch, kept, 'card-a', 's1', { limit: '40' })
    const adopted = page.messages.filter((item: { adopted: boolean }) => item.adopted)
    expect(adopted.map((item: { content: string }) => item.content)).toEqual(['第8条'])
    expect(page.messages.find((item: { content: string }) => item.content === '第6条').adopted).toBe(false)
    expect(publicSessions(kept, 'card-a')[0]).not.toHaveProperty('adoptions')
  })

  it('网关消息没有 id 时用 role+at+正文 指纹，重开也认得', async () => {
    const rows = gatewayRows(6, false)
    const { gatewayFetch } = fakeGateway(rows)
    let store = storeWith('card-a', 's1')
    const resolved = await resolveAdoptionKey(gatewayFetch, 's1', { role: 'assistant', content: '第4条' })
    expect(resolved.key.startsWith('fp:assistant|')).toBe(true)
    store = withAdoption(store, 'card-a', 's1', resolved)
    const page = await loadMessagePage(gatewayFetch, normalizeStore(JSON.parse(JSON.stringify(store))), 'card-a', 's1', {})
    expect(page.messages.find((item: { content: string }) => item.content === '第4条').adopted).toBe(true)
    expect(page.messages.find((item: { content: string }) => item.content === '第2条').adopted).toBe(false)
  })

  it('采纳记录写不进去时浮窗不把气泡标成已采纳', () => {
    const source = readFileSync(cardDiscussPath, 'utf8')
    const start = source.indexOf('async function adopt(item: ChatMessage)')
    const body = source.slice(start, source.indexOf('const selected =', start))
    const failBranch = body.indexOf('if (!response.ok || !payload.key)')
    const markAdopted = body.indexOf('adopted: true')
    expect(failBranch).toBeGreaterThan(0)
    expect(body.slice(failBranch, body.indexOf('}', failBranch))).toContain('return')
    expect(markAdopted).toBeGreaterThan(failBranch)
  })
})

describe('历史下拉显示每条首句', () => {
  it('有首问的选项文本包含首句；没有首问的只有时间', () => {
    const createdAt = '2026-10-09T02:00:00.000Z'
    const withAsk = sessionLabel({ sessionId: 's1', title: 't', createdAt, cardId: 'card-a', firstAsk: '主角为什么在门口犹豫' })
    const plain = sessionLabel({ sessionId: 's2', title: 't', createdAt, cardId: 'card-a' })
    expect(withAsk).toContain('主角为什么在门口犹豫')
    expect(plain.startsWith('念头讨论 ')).toBe(true)
    expect(plain).not.toContain('主角')
    const when = plain.slice('念头讨论 '.length)
    expect(withAsk).toBe(`${when} 主角为什么在门口犹豫`)
  })

  it('新建会话发出第一条后存首问（截到 24 字）；旧会话不编；不覆盖已有首问', () => {
    let store = storeWith('card-a', 'new', { firstAskOpen: true })
    store = withSession(store, 'card-a', { sessionId: 'old', title: '念头讨论', createdAt: '2026-10-01T00:00:00.000Z', cardId: 'card-a' })
    const long = '这一段我想问问看主角在门口犹豫的那一刻到底是在怕什么还有后面的事'
    const first = withFirstAsk(store, 'card-a', 'new', `  ${long}  `)
    expect(first.changed).toBe(true)
    const preview = publicSessions(first.store, 'card-a').find((item: { sessionId: string }) => item.sessionId === 'new').firstAsk
    expect(Array.from(preview.replace(/…$/u, '')).length).toBe(24)
    expect(preview.endsWith('…')).toBe(true)

    const again = withFirstAsk(normalizeStore(JSON.parse(JSON.stringify(first.store))), 'card-a', 'new', '第二句')
    expect(again.changed).toBe(false)
    expect(publicSessions(again.store, 'card-a').find((item: { sessionId: string }) => item.sessionId === 'new').firstAsk).toBe(preview)

    const old = withFirstAsk(first.store, 'card-a', 'old', '后来才说的话')
    expect(old.changed).toBe(false)
    expect(publicSessions(old.store, 'card-a').find((item: { sessionId: string }) => item.sessionId === 'old')).not.toHaveProperty('firstAsk')
  })
})
