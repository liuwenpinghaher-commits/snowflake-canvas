import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeStore, withAdoption, withSession } from '../server/discuss-store.mjs'
import { hanCount, importPlainText, pendingEntities } from '../server/import-book.mjs'
import { locateAdoption } from '../server/recall.mjs'
import { clearTimelineMemory, writeSediment } from '../server/sediment.mjs'
import { documentToBytes, parseCompleteDocument } from '../src/persist.ts'

const GOT_NAME_WORDS = ['奈德', '丹妮莉丝', '瑟曦', '琼恩·雪诺', '提利昂', '艾莉亚', '珊莎', '布兰', '凯特琳', '小指头', '劳勃']
const GOT_SAMPLE_NAMES = GOT_NAME_WORDS.slice(0, 4)

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverEntry = join(repoRoot, 'server', 'http.mjs')

function emptyDoc() {
  return {
    canvas: { nodes: [] as unknown[], edges: [] as unknown[] },
    snowflake: { fileId: 'import-file', cards: {} as Record<string, unknown> },
  }
}

function longText() {
  const pad = Array.from({ length: 200 }, () => '字').join(',')
  return [
    '第1章 临冬城',
    '奈德站在门口。后来奈德离开。',
    '',
    '丹妮莉丝的信到了。丹妮莉丝还在海上。',
    pad,
    '',
    '',
    '瑟曦坐在铁王座前。众人看见瑟曦。',
    '第2章 长城之外',
    '琼恩·雪诺守夜。琼恩·雪诺看着北方。',
  ].join('\n')
}

function personDocument(slug: string | null = 'world/ned-stark') {
  const entity: {
    id: string
    entityType: string
    name: string
    views: Record<string, never>
    fields: Record<string, never>
    arc: { start: string; door: string; impact: string; deepen: string; turn: string; consequence: string }
    premise: boolean
    slug?: string
  } = {
    id: 'ned',
    entityType: 'person',
    name: '奈德',
    views: {},
    fields: {},
    arc: { start: '', door: '', impact: '', deepen: '', turn: '', consequence: '' },
    premise: false,
  }
  if (typeof slug === 'string' && slug.trim()) entity.slug = slug.trim()
  return {
    canvas: {
      nodes: [{ id: 'card-1', type: 'text', x: 0, y: 0, width: 280, height: 120, text: '念头' }],
      edges: [],
    },
    snowflake: {
      fileId: 'sed-file',
      cards: { 'card-1': { layer: 'situation', body: '念头', fields: {} } },
    },
    entities: [entity],
    sediment: [],
  }
}

function sessionStore() {
  let store = withSession({ cards: {} }, 'card-1', {
    sessionId: 'sess-1',
    title: '念头讨论',
    createdAt: '2026-10-11T00:00:00.000Z',
    cardId: 'card-1',
  })
  store = withAdoption(store, 'card-1', 'sess-1', {
    key: 'id:m1',
    adoptedAt: '2026-10-11T00:00:01.000Z',
    messageId: 'm1',
  })
  return store
}

function adoptionOf(store: { cards: Record<string, { sessions: Array<{ adoptions?: Array<Record<string, string>> }> }> }) {
  return store.cards['card-1'].sessions[0].adoptions?.[0]
}

function sedimentBody(requestId: string, quote = '只记一次的句子') {
  return {
    cardId: 'card-1',
    sessionId: 'sess-1',
    entityId: 'ned',
    fieldKey: 'motivation',
    action: 'append',
    quote,
    requestId,
    adoptionKey: 'id:m1',
  }
}

beforeEach(() => {
  clearTimelineMemory()
})

describe('切片 B 沉淀', () => {
  it('沉淀成功：字段折一次，状态 written，会话回写，时间线只叫一次且带 requestId', async () => {
    const calls: Array<{ page: string; text: string }> = []
    const result = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-ok') },
      {
        addTimeline: async (page: string, text: string) => {
          calls.push({ page, text })
        },
        gbrainDisabled: async () => false,
        resolveQuote: async () => {
          throw new Error('已经带了 adoptionKey，不该再对消息')
        },
      },
    )
    const entity = result.document.entities[0]
    expect(entity.fields.motivation.value).toBe('只记一次的句子')
    expect(entity.fields.motivation.events).toHaveLength(1)
    expect(result.document.sediment).toHaveLength(1)
    expect(result.document.sediment[0].status).toBe('written')
    expect(result.document.sediment[0].kind).toBe('discuss')
    expect(result.document.sediment[0].ideaId).toBe('card-1')
    expect(result.document.sediment[0].requestId).toBe('req-ok')
    const kept = normalizeStore(JSON.parse(JSON.stringify(result.store)))
    expect(adoptionOf(kept)?.sedimentStatus).toBe('written')
    expect(adoptionOf(kept)?.requestId).toBe('req-ok')
    expect(calls).toHaveLength(1)
    expect(calls[0].page).toBe('world/ned-stark')
    expect(calls[0].page.startsWith('snowflake/entity/')).toBe(false)
    expect(calls[0].text).toContain('req-ok')
    expect(calls[0].text).toContain('bookId=book-1')
    expect(calls[0].text).toContain('cardId=card-1')
    expect(calls[0].text).toContain('sessionId=sess-1')
    expect(calls[0].text).toContain('adoptionKey=id:m1')
  })

  it('没有 slug 时不调用时间线，书内句子留下，重试仍然失败', async () => {
    let calls = 0
    const deps = {
      addTimeline: async () => {
        calls += 1
      },
      gbrainDisabled: async () => false,
      resolveQuote: async () => ({ adoptionKey: 'unused' }),
    }
    const first = await writeSediment(
      { document: personDocument(null), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-noslug') },
      deps,
    )
    expect(first.document.entities[0].fields.motivation.value).toBe('只记一次的句子')
    expect(first.document.sediment[0].status).toBe('failed')
    expect(first.payload.error).toBe('百科没写上')
    expect(calls).toBe(0)
    const second = await writeSediment(
      { document: first.document, store: first.store, bookId: 'book-1', body: sedimentBody('req-noslug') },
      deps,
    )
    expect(second.document.entities[0].fields.motivation.value).toBe('只记一次的句子')
    expect(second.document.sediment).toHaveLength(1)
    expect(second.document.sediment[0].status).toBe('failed')
    expect(second.payload.error).toBe('百科没写上')
    expect(calls).toBe(0)
  })

  it('实体 slug 写进文档后再读回来还在，空白字符串不当页名', () => {
    const encoded = new TextEncoder().encode(JSON.stringify(personDocument()))
    const once = parseCompleteDocument(encoded)
    expect(once?.state.entities?.[0]?.slug).toBe('world/ned-stark')
    const twice = parseCompleteDocument(documentToBytes(once!.state))
    expect(twice?.state.entities?.[0]?.slug).toBe('world/ned-stark')
    const blank = personDocument()
    blank.entities[0].slug = '   '
    const parsed = parseCompleteDocument(new TextEncoder().encode(JSON.stringify(blank)))
    expect(parsed?.state.entities?.[0]?.slug).toBeUndefined()
  })

  it('时间线抛错时书内句子还在，状态 failed，addTimeline 只被叫一次', async () => {
    let calls = 0
    const result = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-fail', '失败也留下的句子') },
      {
        addTimeline: async () => {
          calls += 1
          throw new Error('timeline down')
        },
        gbrainDisabled: async () => false,
        resolveQuote: async () => ({ adoptionKey: 'unused' }),
      },
    )
    expect(result.document.entities[0].fields.motivation.value).toBe('失败也留下的句子')
    expect(result.document.sediment[0].status).toBe('failed')
    expect(adoptionOf(result.store)?.sedimentStatus).toBe('failed')
    expect(calls).toBe(1)
    expect(result.payload.error).toBe('百科没写上')
  })

  it('同一个 requestId 重试不再折叠，状态改成 written，成功的时间线只有一次', async () => {
    let attempts = 0
    let successes = 0
    const deps = {
      addTimeline: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('timeline down')
        successes += 1
      },
      gbrainDisabled: async () => false,
      resolveQuote: async () => ({ adoptionKey: 'unused' }),
    }
    const first = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-retry') },
      deps,
    )
    expect(first.document.entities[0].fields.motivation.value).toBe('只记一次的句子')
    expect(first.document.sediment[0].status).toBe('failed')
    const second = await writeSediment(
      { document: first.document, store: first.store, bookId: 'book-1', body: sedimentBody('req-retry') },
      deps,
    )
    expect(second.document.entities[0].fields.motivation.value).toBe('只记一次的句子')
    expect(second.document.entities[0].fields.motivation.events).toHaveLength(1)
    expect(second.document.sediment).toHaveLength(1)
    expect(second.document.sediment[0].status).toBe('written')
    expect(adoptionOf(normalizeStore(JSON.parse(JSON.stringify(second.store))))?.sedimentStatus).toBe('written')
    expect(successes).toBe(1)
    expect(attempts).toBe(2)
    const third = await writeSediment(
      { document: second.document, store: second.store, bookId: 'book-1', body: sedimentBody('req-retry') },
      deps,
    )
    expect(third.document.entities[0].fields.motivation.value).toBe('只记一次的句子')
    expect(successes).toBe(1)
    expect(attempts).toBe(2)
  })

  it('书里没有这个实体时 404，不写时间线', async () => {
    let calls = 0
    const document = personDocument()
    document.entities = []
    const result = await writeSediment(
      { document, store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-missing') },
      {
        addTimeline: async () => {
          calls += 1
        },
        gbrainDisabled: async () => false,
        resolveQuote: async () => ({ adoptionKey: 'id:m1' }),
      },
    )
    expect(result.statusCode).toBe(404)
    expect(result.payload.error).toContain('ned')
    expect(calls).toBe(0)
    expect(result.document.sediment).toEqual([])
  })

  it('对不上采纳句时 400，不猜一条消息', async () => {
    const result = await writeSediment(
      {
        document: personDocument(),
        store: sessionStore(),
        bookId: 'book-1',
        body: { ...sedimentBody('req-miss'), adoptionKey: '' },
      },
      {
        addTimeline: async () => {
          throw new Error('不该写时间线')
        },
        gbrainDisabled: async () => false,
        resolveQuote: async (_sessionId: string, quote: string) => ({ error: `对不上这条消息：${quote}` }),
      },
    )
    expect(result.statusCode).toBe(400)
    expect(result.payload.error).toContain('对不上这条消息')
    expect(result.payload.error).toContain('只记一次的句子')
    expect(result.document.sediment).toEqual([])
  })
})

describe('切片 B 导入', () => {
  it('两个章、章内双空行分场，四个人名进待确认名单，不建实体', () => {
    const text = longText()
    expect(hanCount(text)).toBeGreaterThanOrEqual(200)
    const result = importPlainText(emptyDoc(), text)
    const names = result.document.pendingEntities.map((item: { name: string }) => item.name)
    expect(result.counts.chapterCount).toBe(2)
    expect(result.counts.ideaCount).toBe(3)
    expect(result.counts.pendingCount).toBe(names.length)
    expect(result.document.chapters).toHaveLength(2)
    expect(result.document.chapters[0].scenes).toHaveLength(2)
    expect(result.document.chapters[1].scenes).toHaveLength(1)
    expect(names).toEqual(expect.arrayContaining(GOT_SAMPLE_NAMES))
    expect(result.document.entities ?? []).toEqual([])
    const cards = Object.values(result.document.snowflake.cards) as Array<{ body: string; layer: string; originAnchor: { chapterId: string; sceneId: string; charOffset: number } }>
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      expect(card.layer).toBe('situation')
      expect(Array.from(card.body).length).toBeLessThanOrEqual(200)
      expect(card.originAnchor.chapterId).toBeTruthy()
      expect(card.originAnchor.sceneId).toBeTruthy()
      expect(typeof card.originAnchor.charOffset).toBe('number')
    }
    const opened = parseCompleteDocument(new TextEncoder().encode(JSON.stringify(result.document)))
    expect(opened).not.toBeNull()
    const again = opened?.state.snowflake.cards[cards.length ? Object.keys(result.document.snowflake.cards)[0] : '']
    expect(again?.originAnchor?.chapterId).toBeTruthy()
    expect(opened?.state.pendingEntities?.map((item) => item.name)).toEqual(expect.arrayContaining(GOT_SAMPLE_NAMES))
  })

  it('阿福出现三次进待确认，王城一次不进，也不出现奈德', () => {
    const text = '阿福进了门。王城很远。阿福坐下。阿福又站起来。'
    const result = importPlainText(emptyDoc(), text)
    const names = result.document.pendingEntities.map((item: { name: string }) => item.name)
    expect(names).toContain('阿福')
    expect(names).not.toContain('王城')
    expect(names).not.toContain('奈德')
    expect(result.document.entities ?? []).toEqual([])
  })

  it('生产导入模块不再带旧人名表，时间线也不再拼占位页', async () => {
    const importer = await readFile(join(repoRoot, 'server/import-book.mjs'), 'utf8')
    const sediment = await readFile(join(repoRoot, 'server/sediment.mjs'), 'utf8')
    expect(importer).not.toContain('NAME_WORDS')
    for (const word of GOT_NAME_WORDS) expect(importer).not.toContain(word)
    expect(sediment).not.toContain('snowflake/entity/')
  })

  it('汉字少于 200 时不切分，一章一场一张卡', () => {
    const text = '第1章 雪\n\n\n第2章 夜\n奈德。'
    expect(hanCount(text)).toBeLessThan(200)
    const result = importPlainText(emptyDoc(), text)
    expect(result.counts.chapterCount).toBe(1)
    expect(result.counts.ideaCount).toBe(1)
    expect(result.document.chapters).toHaveLength(1)
    expect(result.document.chapters[0].scenes).toHaveLength(1)
    expect(Object.keys(result.document.snowflake.cards)).toHaveLength(1)
    const card = Object.values(result.document.snowflake.cards)[0] as { body: string }
    expect(card.body).toBe(text.trim())
  })

  it('空文本报错，不建章', () => {
    expect(() => importPlainText(emptyDoc(), '  \n')).toThrow(/没有建章/)
  })

  it('第 N 集和 Chapter N 也是章界', () => {
    const text = ['第1集 开篇', '甲'.repeat(200), '', '', '乙场到了。', 'Chapter 2', '丙场。'].join('\n')
    const result = importPlainText(emptyDoc(), text)
    expect(result.counts.chapterCount).toBe(2)
    expect(result.document.chapters[0].scenes.length).toBeGreaterThanOrEqual(2)
    expect(result.document.chapters[1].title).toBe('Chapter 2')
  })
})

describe('切片 B 待确认实体与定位', () => {
  it('两张卡都有奈德时合成一条，带来源卡', () => {
    const rows = pendingEntities([
      { id: 'c1', body: '奈德说了话' },
      { id: 'c2', body: '后来奈德离开' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('奈德')
    expect(rows[0].cardIds).toEqual(['c1', 'c2'])
  })

  it('locateAdoption 命中时带正文或下标，找不到时不抛', () => {
    const store = {
      cards: {
        c: {
          sessions: [
            {
              sessionId: 's',
              adoptions: [{ key: 'k1', text: '原文句子' }, { key: 'k2' }],
            },
          ],
        },
      },
    }
    expect(locateAdoption(store, 'c', 's', 'k1')).toEqual({
      found: true,
      sessionId: 's',
      adoptionKey: 'k1',
      index: 0,
      text: '原文句子',
    })
    expect(locateAdoption(store, 'c', 's', 'k2')).toEqual({
      found: true,
      sessionId: 's',
      adoptionKey: 'k2',
      index: 1,
    })
    expect(locateAdoption(store, 'c', 's', 'missing')).toEqual({
      found: false,
      sessionId: 's',
      adoptionKey: 'missing',
    })
    expect(locateAdoption(null, 'c', 's', 'k1')).toEqual({
      found: false,
      sessionId: 's',
      adoptionKey: 'k1',
    })
  })
})

interface Running {
  base: string
  dataDir: string
  home: string
  argsFile: string
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

async function startServer(): Promise<Running> {
  const dataDir = await mkdtemp(join(tmpdir(), 'snowflake-b-data-'))
  const home = await mkdtemp(join(tmpdir(), 'snowflake-b-home-'))
  await mkdir(join(home, '.gbrain'), { recursive: true })
  await writeFile(join(home, '.gbrain', 'env'), '')
  const argsFile = join(home, 'gbrain-args')
  const fake = join(home, 'gbrain-fake')
  await writeFile(fake, `#!/bin/sh\necho "$@" >> '${argsFile}'\nexit 0\n`)
  await chmod(fake, 0o755)
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
  child.stdout?.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    output += String(chunk)
  })
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
    home,
    argsFile,
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

async function createBook(server: Running, name: string) {
  const response = await fetch(`${server.base}/api/books`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string }
}

describe('切片 B 导入接口', () => {
  it('进度变成 done，四个人名在待确认名单里，没有调用 gbrain', async () => {
    const server = await startServer()
    const book = await createBook(server, '导入验收')
    const response = await fetch(`${server.base}/api/books/${book.id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: longText() }),
    })
    const posted = (await response.json()) as { status: string; chapterCount: number; ideaCount: number; pendingCount: number; error: string }
    expect(response.status).toBe(200)
    expect(posted.status).toBe('done')
    expect(posted.chapterCount).toBe(2)
    expect(posted.ideaCount).toBe(3)
    expect(posted.error).toBe('')
    const saved = JSON.parse(await readFile(join(server.dataDir, 'books', book.id, 'snowflake.json'), 'utf8'))
    const names = (saved.document.pendingEntities as Array<{ name: string }>).map((item) => item.name)
    expect(names).toEqual(expect.arrayContaining(GOT_SAMPLE_NAMES))
    expect(posted.pendingCount).toBe(names.length)
    const progress = await fetch(`${server.base}/api/books/${book.id}/import`)
    expect(await progress.json()).toMatchObject({ status: 'done', chapterCount: 2, pendingCount: names.length })
    expect(saved.document.entities ?? []).toEqual([])
    await expect(stat(server.argsFile)).rejects.toThrow()
  }, 30_000)

  it('短文本接口也是一章一场一张卡', async () => {
    const server = await startServer()
    const book = await createBook(server, '短文本')
    const text = '奈德在雪地里走了一段。'
    expect(hanCount(text)).toBeLessThan(200)
    const response = await fetch(`${server.base}/api/books/${book.id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    expect(response.status).toBe(200)
    const saved = JSON.parse(await readFile(join(server.dataDir, 'books', book.id, 'snowflake.json'), 'utf8'))
    expect(saved.document.chapters).toHaveLength(1)
    expect(saved.document.chapters[0].scenes).toHaveLength(1)
    expect(Object.keys(saved.document.snowflake.cards)).toHaveLength(1)
    await expect(stat(server.argsFile)).rejects.toThrow()
  }, 30_000)

  it('空文本 400，不建空章', async () => {
    const server = await startServer()
    const book = await createBook(server, '空文本')
    const response = await fetch(`${server.base}/api/books/${book.id}/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ' \n ' }),
    })
    expect(response.status).toBe(400)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toContain('没有建章')
    const saved = JSON.parse(await readFile(join(server.dataDir, 'books', book.id, 'snowflake.json'), 'utf8'))
    expect(saved.document.chapters ?? []).toEqual([])
    expect(Object.keys(saved.document.snowflake.cards)).toHaveLength(0)
  }, 30_000)
})

describe('采纳定位路由', () => {
  it('GET /discuss/adoption 只调 locateAdoption，找不到也是 200', async () => {
    const server = await startServer()
    const book = await createBook(server, '定位')
    const store = {
      cards: {
        'card-1': {
          lastSessionId: 'sess-1',
          sessions: [
            {
              sessionId: 'sess-1',
              title: '念头讨论',
              createdAt: '2026-10-11T00:00:00.000Z',
              cardId: 'card-1',
              adoptions: [{ key: 'k1', text: '原文句子', adoptedAt: '2026-10-11T00:00:01.000Z' }],
            },
          ],
        },
      },
    }
    await writeFile(join(server.dataDir, 'books', book.id, 'session.json'), JSON.stringify(store))
    const query = `cardId=card-1&sessionId=sess-1&adoptionKey=`
    const hit = await fetch(`${server.base}/api/books/${book.id}/discuss/adoption?${query}k1`)
    expect(hit.status).toBe(200)
    expect(await hit.json()).toEqual({
      found: true,
      sessionId: 'sess-1',
      adoptionKey: 'k1',
      index: 0,
      text: '原文句子',
    })
    const miss = await fetch(`${server.base}/api/books/${book.id}/discuss/adoption?${query}missing`)
    expect(miss.status).toBe(200)
    expect(await miss.json()).toEqual({ found: false, sessionId: 'sess-1', adoptionKey: 'missing' })
  }, 30_000)
})
