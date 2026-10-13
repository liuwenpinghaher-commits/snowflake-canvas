import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withAdoption, withSession } from '../server/discuss-store.mjs'
import { clearTimelineMemory, writeSediment } from '../server/sediment.mjs'

function personDocument(slug: string | null = 'world/ned-stark') {
  const entity: {
    id: string
    entityType: string
    name: string
    views: Record<string, never>
    fields: Record<string, { value?: string }>
    slug?: string
  } = {
    id: 'ned',
    entityType: 'person',
    name: '奈德',
    views: {},
    fields: {},
  }
  if (typeof slug === 'string' && slug.trim()) entity.slug = slug.trim()
  return {
    canvas: {
      nodes: [{ id: 'card-1', type: 'text', x: 0, y: 0, width: 280, height: 120, text: '卡片' }],
      edges: [],
    },
    snowflake: {
      fileId: 'sed-file',
      cards: { 'card-1': { layer: 'situation', body: '卡片', fields: {} } },
    },
    entities: [entity],
    sediment: [] as Array<Record<string, unknown>>,
  }
}

function sessionStore() {
  let store = withSession({ cards: {} }, 'card-1', {
    sessionId: 'sess-1',
    title: '卡片讨论',
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

function baseDeps(extra: Record<string, unknown> = {}) {
  return {
    addTimeline: async () => {},
    gbrainDisabled: async () => false,
    resolveQuote: async () => ({ adoptionKey: 'id:m1' }),
    ...extra,
  }
}

beforeEach(() => {
  clearTimelineMemory()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('沉淀和升格的页竞态', () => {
  it('不传 ensurePage 时页视为已在，addTimeline 仍带 requestId，成功不打失败日志', async () => {
    const calls: Array<{ page: string; text: string; requestId: string }> = []
    const result = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-plain') },
      baseDeps({
        addTimeline: async (page: string, text: string, _fail: string, requestId: string) => {
          calls.push({ page, text, requestId })
        },
      }),
    )
    expect(result.payload.status).toBe('written')
    expect(result.payload.error).toBeUndefined()
    expect(calls).toEqual([
      {
        page: 'world/ned-stark',
        text: expect.stringContaining('requestId=req-plain'),
        requestId: 'req-plain',
      },
    ])
    expect(console.error).not.toHaveBeenCalled()
  })

  it('page_not_found 时 console.error 含 slug 与 requestId，书内句子留下，重试还能再调 addTimeline', async () => {
    let calls = 0
    const deps = baseDeps({
      addTimeline: async () => {
        calls += 1
        throw new Error('Error [page_not_found]: Page not found: world/ned-stark')
      },
    })
    const first = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-missing', '失败也留下的句子') },
      deps,
    )
    expect(first.payload.status).toBe('failed')
    expect(first.payload.error).toBe('百科没写上')
    expect(first.payload.error).not.toContain('page_not_found')
    expect(first.document.entities[0].fields.motivation.value).toBe('失败也留下的句子')
    expect(calls).toBe(1)
    const logged = vi.mocked(console.error).mock.calls.map((args) => args.map(String).join(' ')).join('\n')
    expect(logged).toContain('slug=world/ned-stark')
    expect(logged).toContain('requestId=req-missing')
    expect(logged).toContain('page_not_found')
    const second = await writeSediment(
      { document: first.document, store: first.store, bookId: 'book-1', body: sedimentBody('req-missing', '失败也留下的句子') },
      deps,
    )
    expect(second.payload.status).toBe('failed')
    expect(second.document.entities[0].fields.motivation.value).toBe('失败也留下的句子')
    expect(calls).toBe(2)
  })

  it('卡片建页被拒绝时不调用 addTimeline，日志仍有 page_not_found', async () => {
    let adds = 0
    const result = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-empty') },
      baseDeps({
        ensurePage: async () => ({ ok: false, error: 'Error [page_not_found]: Page not found: world/ned-stark' }),
        addTimeline: async () => {
          adds += 1
        },
      }),
    )
    expect(result.payload.status).toBe('failed')
    expect(result.payload.error).toBe('百科没写上')
    expect(adds).toBe(0)
    const logged = vi.mocked(console.error).mock.calls.map((args) => args.map(String).join(' ')).join('\n')
    expect(logged).toContain('slug=world/ned-stark')
    expect(logged).toContain('requestId=req-empty')
    expect(logged).toContain('page_not_found')
  })

  it('页已在时不把正文当需要覆盖，读回通过才标 written，建页用的是折进书之后的卡片', async () => {
    let adds = 0
    let seenValue = ''
    const result = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-present', '新折进去的句子') },
      baseDeps({
        ensurePage: async (_document: unknown, entity: { fields: { motivation: { value: string } } }, requestId: string) => {
          seenValue = entity.fields.motivation.value
          expect(requestId).toBe('req-present')
          return { ok: true, present: true }
        },
        addTimeline: async () => {
          adds += 1
        },
        confirmTimeline: async (page: string, requestId: string) => page === 'world/ned-stark' && requestId === 'req-present',
      }),
    )
    expect(seenValue).toBe('新折进去的句子')
    expect(adds).toBe(1)
    expect(result.payload.status).toBe('written')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('读回没有这句 requestId 时不当 written，同 requestId 重试还会再写', async () => {
    let adds = 0
    let confirms = 0
    const deps = baseDeps({
      addTimeline: async () => {
        adds += 1
      },
      confirmTimeline: async () => {
        confirms += 1
        return confirms > 1
      },
    })
    const first = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-readback') },
      deps,
    )
    expect(first.payload.status).toBe('failed')
    expect(first.payload.error).toBe('百科没写上')
    expect(adds).toBe(1)
    const logged = vi.mocked(console.error).mock.calls.map((args) => args.map(String).join(' ')).join('\n')
    expect(logged).toContain('slug=world/ned-stark')
    expect(logged).toContain('requestId=req-readback')
    const second = await writeSediment(
      { document: first.document, store: first.store, bookId: 'book-1', body: sedimentBody('req-readback') },
      deps,
    )
    expect(second.payload.status).toBe('written')
    expect(second.document.entities[0].fields.motivation.value).toBe('只记一次的句子')
    expect(adds).toBe(2)
    expect(second.document.sediment).toHaveLength(1)
  })

  it('timeline-add 仍报 page_not_found 时只再补一次，已建过页就不再建第二次', async () => {
    let ensures = 0
    let adds = 0
    const result = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-once') },
      baseDeps({
        ensurePage: async () => {
          ensures += 1
          return { ok: true, created: true }
        },
        addTimeline: async () => {
          adds += 1
          if (adds === 1) throw new Error('Error [page_not_found]: Page not found: world/ned-stark')
        },
        confirmTimeline: async () => true,
      }),
    )
    expect(result.payload.status).toBe('written')
    expect(ensures).toBe(1)
    expect(adds).toBe(2)
  })

  it('第一次以为页已在但 timeline-add 仍是 page_not_found 时，再建一次页并再补一次时间线', async () => {
    let ensures = 0
    let adds = 0
    const result = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-late') },
      baseDeps({
        ensurePage: async () => {
          ensures += 1
          return ensures === 1 ? { ok: true, present: true } : { ok: true, created: true }
        },
        addTimeline: async () => {
          adds += 1
          if (adds === 1) throw new Error('Page not found: world/ned-stark')
        },
        confirmTimeline: async () => true,
      }),
    )
    expect(result.payload.status).toBe('written')
    expect(ensures).toBe(2)
    expect(adds).toBe(2)
  })

  it('没有 slug 时不调用 ensurePage 和 addTimeline', async () => {
    let ensures = 0
    let adds = 0
    const result = await writeSediment(
      { document: personDocument(null), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-noslug') },
      baseDeps({
        ensurePage: async () => {
          ensures += 1
          return { ok: true, created: true }
        },
        addTimeline: async () => {
          adds += 1
        },
      }),
    )
    expect(result.payload.status).toBe('failed')
    expect(result.payload.error).toBe('百科没写上')
    expect(ensures).toBe(0)
    expect(adds).toBe(0)
  })

  it('同一进程里确认过的 requestId 短路，clearTimelineMemory 之后重试会再写', async () => {
    let calls = 0
    const deps = baseDeps({
      addTimeline: async () => {
        calls += 1
      },
    })
    const first = await writeSediment(
      { document: personDocument(), store: sessionStore(), bookId: 'book-1', body: sedimentBody('req-memory') },
      deps,
    )
    expect(first.payload.status).toBe('written')
    expect(calls).toBe(1)
    const failedDoc = {
      ...first.document,
      sediment: first.document.sediment.map((event) => ({ ...event, status: 'failed' })),
    }
    const stuck = await writeSediment(
      { document: failedDoc, store: first.store, bookId: 'book-1', body: sedimentBody('req-memory') },
      deps,
    )
    expect(stuck.payload.status).toBe('written')
    expect(calls).toBe(1)
    clearTimelineMemory()
    const again = await writeSediment(
      { document: failedDoc, store: first.store, bookId: 'book-1', body: sedimentBody('req-memory') },
      deps,
    )
    expect(again.payload.status).toBe('written')
    expect(calls).toBe(2)
    expect(again.document.entities[0].fields.motivation.value).toBe('只记一次的句子')
  })
})
