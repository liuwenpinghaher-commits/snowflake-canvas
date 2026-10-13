import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { withAdoption, withSession } from '../server/discuss-store.mjs'
import {
  clearPromoteMemory,
  composeEntityPage,
  pageMissingMessage,
  parsePageSnapshot,
  promoteEntityPage,
  replaceAboveTimeline,
} from '../server/encyclopedia.mjs'
import { clearTimelineMemory, writeSediment } from '../server/sediment.mjs'
import EncyclopediaPage from '../src/EncyclopediaPage.tsx'
import { createCard, createDocument, emptyArc, serializeDocument, type Entity } from '../src/document.ts'
import { bindEntitySlug, pullFinalized } from '../src/encyclopedia.ts'
import { entityForPersonCard } from '../src/person-form.ts'
import { documentToBytes, parseCompleteDocument } from '../src/persist.ts'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const REVISION = '11111111-1111-4111-8111-111111111111'

function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

function person(id: string, name: string, type: Entity['entityType'] = 'person', slug?: string): Entity {
  const entity: Entity = {
    id,
    entityType: type,
    name,
    views: {},
    fields: { motivation: { value: '守住临冬城', events: [] } },
    arc: emptyArc(),
    premise: false,
  }
  if (slug) entity.slug = slug
  return entity
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

function sedimentDocument(slug: string | null) {
  const entity: {
    id: string
    entityType: string
    name: string
    views: Record<string, never>
    fields: Record<string, { value: string; events: string[] }>
    arc: ReturnType<typeof emptyArc>
    premise: boolean
    slug?: string
  } = {
    id: 'ned',
    entityType: 'person',
    name: '奈德',
    views: {},
    fields: {},
    arc: emptyArc(),
    premise: false,
  }
  if (slug && slug.trim()) entity.slug = slug.trim()
  return {
    canvas: { nodes: [], edges: [] },
    snowflake: {
      fileId: 'sed-file',
      cards: { 'card-1': { layer: 'situation', body: '卡片', fields: {} } },
    },
    entities: [entity],
    sediment: [],
  }
}

beforeEach(() => {
  clearTimelineMemory()
  clearPromoteMemory()
})

describe('百科绑定', () => {
  it('确认绑定后 slug 进入实体，空字符串不落盘', () => {
    const base = { ...createDocument('bind'), entities: [person('ned', '奈德')] }
    const bound = bindEntitySlug(base, 'ned', '  world/ned-stark  ')
    expect(bound.entities?.[0]?.slug).toBe('world/ned-stark')
    const cleared = bindEntitySlug(bound, 'ned', '   ')
    expect(cleared.entities?.[0]?.slug).toBeUndefined()
    expect(JSON.stringify(serializeDocument(cleared))).not.toContain('"slug"')
    const emptied = bindEntitySlug(bound, 'ned', '')
    expect(emptied.entities?.[0]?.slug).toBeUndefined()
  })

  it('保存再加载 slug 还在', () => {
    const bound = bindEntitySlug(
      { ...createDocument('round'), entities: [person('ned', '奈德')] },
      'ned',
      'world/ned-stark',
    )
    const loaded = parseCompleteDocument(documentToBytes(bound))
    expect(loaded?.state.entities?.[0]?.slug).toBe('world/ned-stark')
    const again = parseCompleteDocument(documentToBytes(loaded!.state))
    expect(again?.state.entities?.[0]?.slug).toBe('world/ned-stark')
  })

  it('有 slug 时沉淀时间线打的是这个页名', async () => {
    const calls: string[] = []
    const result = await writeSediment(
      {
        document: sedimentDocument('world/ned-stark'),
        store: sessionStore(),
        bookId: 'book-1',
        body: {
          cardId: 'card-1',
          sessionId: 'sess-1',
          entityId: 'ned',
          fieldKey: 'motivation',
          action: 'append',
          quote: '新句子',
          requestId: 'req-slug',
          adoptionKey: 'id:m1',
        },
      },
      {
        addTimeline: async (page: string) => {
          calls.push(page)
        },
        gbrainDisabled: async () => false,
        resolveQuote: async () => {
          throw new Error('不该再对消息')
        },
      },
    )
    expect(result.payload.status).toBe('written')
    expect(calls).toEqual(['world/ned-stark'])
  })

  it('无 slug 时沉淀失败文案仍是百科没写上，书内句子还在', async () => {
    let calls = 0
    const result = await writeSediment(
      {
        document: sedimentDocument(null),
        store: sessionStore(),
        bookId: 'book-1',
        body: {
          cardId: 'card-1',
          sessionId: 'sess-1',
          entityId: 'ned',
          fieldKey: 'motivation',
          action: 'append',
          quote: '新句子',
          requestId: 'req-noslug',
          adoptionKey: 'id:m1',
        },
      },
      {
        addTimeline: async () => {
          calls += 1
        },
        gbrainDisabled: async () => false,
        resolveQuote: async () => ({ adoptionKey: 'unused' }),
      },
    )
    expect(result.payload.status).toBe('failed')
    expect(result.payload.error).toBe('百科没写上')
    expect(result.document.entities[0].fields.motivation.value).toBe('新句子')
    expect(calls).toBe(0)
  })

  it('百科页列出绑定态，不再写占位文案，两个按钮用原文', () => {
    const state = {
      ...createDocument('page'),
      entities: [person('ned', '奈德', 'person', 'world/ned-stark'), person('winter', '临冬城', 'place')],
    }
    const html = renderToStaticMarkup(
      createElement(EncyclopediaPage, {
        state,
        canEdit: true,
        bookId: 'book-1',
        focusId: 'ned',
        onApply: () => undefined,
      }),
    )
    expect(html).toContain('奈德')
    expect(html).toContain('人物')
    expect(html).toContain('已绑定 world/ned-stark')
    expect(html).toContain('临冬城')
    expect(html).toContain('地点')
    expect(html).toContain('还没绑定')
    expect(html).toContain('把卡片写入定稿')
    expect(html).toContain('用定稿覆盖卡片正文')
    expect(html).not.toContain('百科页还没做')
    const source = read('src/EncyclopediaPage.tsx')
    expect(source).not.toContain('百科页还没做')
    expect(read('src/App.tsx')).not.toContain('百科页还没做')
    expect(read('src/App.tsx')).toContain('EncyclopediaPage')
    expect(read('src/RelationPage.tsx')).toContain('onOpenEncyclopedia?.(entity.id)')
    expect(read('src/CastPage.tsx')).toContain('bindLabel(')
  })

  it('用定稿覆盖卡片正文在没有卡片时拒绝', () => {
    let state = createDocument('pull')
    state = createCard(state, { id: 'idea-1', layer: 'situation', x: 0, y: 0, body: '卡片' })
    state = createCard(state, {
      id: 'card-ned',
      layer: 'renwubiao',
      x: 80,
      y: 0,
      fields: { name: '奈德', sentence: '旧一句' },
    })
    state = {
      ...state,
      entities: [{ ...person('ned', '奈德', 'person', 'world/ned-stark'), views: { renwubiao: 'card-ned' } }],
    }
    const refused = pullFinalized(state, {
      entityId: 'ned',
      ideaId: '   ',
      text: '定稿正文',
      requestId: 'req-pull',
      at: '2026-10-11T00:00:00.000Z',
    })
    expect(refused.saved).toBe(false)
    expect(refused.state).toBe(state)
    expect(refused.state.sediment ?? []).toHaveLength(0)
    expect(refused.state.snowflake.cards['card-ned']?.fields.sentence).toBe('旧一句')

    const saved = pullFinalized(state, {
      entityId: 'ned',
      ideaId: 'idea-1',
      text: '定稿正文',
      requestId: 'req-pull',
      at: '2026-10-11T00:00:00.000Z',
    })
    expect(saved.saved).toBe(true)
    expect(saved.state.sediment?.[0]?.kind).toBe('manual')
    expect(saved.state.sediment?.[0]?.action).toBe('replace')
    expect(saved.state.sediment?.[0]?.ideaId).toBe('idea-1')
    expect(saved.state.entities?.[0]?.fields.sentence?.value).toBe('定稿正文')
    expect(saved.state.snowflake.cards['card-ned']?.fields.sentence).toBe('定稿正文')
  })

  it('没有真实实体时不合成假实体', () => {
    const state = createCard(createDocument('fake'), {
      id: 'card-ned',
      layer: 'renwubiao',
      x: 0,
      y: 0,
      fields: { name: '奈德' },
    })
    expect(entityForPersonCard(state, 'card-ned')).toBeUndefined()
    expect(read('src/person-form.ts')).not.toContain('entity-${cardId}')
    const linked = {
      ...state,
      entities: [{ ...person('ned', '奈德', 'person', 'world/ned-stark'), views: { renwubiao: 'card-ned' } }],
    }
    expect(entityForPersonCard(linked, 'card-ned')?.id).toBe('ned')
    expect(entityForPersonCard(linked, 'card-ned')?.slug).toBe('world/ned-stark')
  })

  it('升格把卡片整页 put，带上读到的版本，同一个 requestId 不写第二次', async () => {
    const existing = '---\ntitle: 奈德\n---\n\n旧定稿\n\n<!-- timeline -->\n10-11 旧时间线\n'
    const puts: Array<{ expectedRevision?: string; requestId: string; content: string; slug: string }> = []
    const document = {
      entities: [
        {
          id: 'ned',
          name: '奈德',
          slug: 'world/ned-stark',
          fields: { motivation: { value: '守住临冬城', events: [] } },
        },
      ],
    }
    const deps = {
      bookId: 'book-1',
      readPage: async () => ({ revision: REVISION, content: existing }),
      putPage: async (args: { expectedRevision?: string; requestId: string; content: string; slug: string }) => {
        puts.push(args)
      },
    }
    const first = await promoteEntityPage(document, 'ned', 'req-promote', deps)
    expect(first.ok).toBe(true)
    expect(puts).toHaveLength(1)
    expect(puts[0]?.slug).toBe('world/ned-stark')
    expect(puts[0]?.expectedRevision).toBe(REVISION)
    expect(puts[0]?.requestId).toBe('req-promote')
    expect(puts[0]?.content).toContain('奈德')
    expect(puts[0]?.content).toContain('动机：守住临冬城')
    expect(puts[0]?.content).toContain('<!-- timeline -->')
    expect(puts[0]?.content).toContain('10-11 旧时间线')
    expect(puts[0]?.content).not.toContain('旧定稿')
    expect(puts[0]?.content).toContain('title: 奈德')
    const second = await promoteEntityPage(document, 'ned', 'req-promote', deps)
    expect(second.ok).toBe(true)
    expect(second.skipped).toBe(true)
    expect(puts).toHaveLength(1)
    const together = await Promise.all([
      promoteEntityPage(document, 'ned', 'req-parallel', deps),
      promoteEntityPage(document, 'ned', 'req-parallel', deps),
    ])
    expect(together.every((item) => item.ok)).toBe(true)
    expect(puts).toHaveLength(2)
  })

  it('页不存在时新建不带版本；put 失败会说出来，同一个 requestId 还能再试', async () => {
    const document = {
      entities: [{ id: 'ned', name: '奈德', slug: 'world/ned-stark', fields: { motivation: { value: '守住临冬城', events: [] } } }],
    }
    const created: Array<{ expectedRevision?: string }> = []
    const createdResult = await promoteEntityPage(document, 'ned', 'req-create', {
      bookId: 'book-1',
      readPage: async () => null,
      putPage: async (args: { expectedRevision?: string }) => {
        created.push(args)
      },
    })
    expect(createdResult.ok).toBe(true)
    expect(created[0]?.expectedRevision).toBeUndefined()
    expect(composeEntityPage(document.entities[0])).toContain('守住临冬城')

    let calls = 0
    const deps = {
      bookId: 'book-1',
      readPage: async () => ({ revision: REVISION, content: '旧\n<!-- timeline -->\n线' }),
      putPage: async () => {
        calls += 1
        if (calls === 1) throw new Error('写入失败')
      },
    }
    const failed = await promoteEntityPage(document, 'ned', 'req-fail', deps)
    expect(failed.ok).toBe(false)
    expect(failed.error).toContain('写入失败')
    const retried = await promoteEntityPage(document, 'ned', 'req-fail', deps)
    expect(retried.ok).toBe(true)
    expect(calls).toBe(2)

    const missing = await promoteEntityPage(
      { entities: [{ id: 'ned', name: '奈德', fields: {} }] },
      'ned',
      'req-open',
      { bookId: 'book-1', readPage: async () => null, putPage: async () => undefined },
    )
    expect(missing.ok).toBe(false)
    expect(missing.error).toBe('还没绑定')
  })

  it('读页快照能跳过升级提示，缺页文案认得出', () => {
    const parsed = parsePageSnapshot(
      `UPGRADE_AVAILABLE 1\n{"revision":"${REVISION}","content":"页\\n<!-- timeline -->\\n线\\n"}\n`,
    )
    expect(parsed?.revision).toBe(REVISION)
    expect(parsed?.content).toContain('<!-- timeline -->')
    expect(pageMissingMessage('Error [page_not_found]: Page not found: world/ned-stark')).toBe(true)
    const replaced = replaceAboveTimeline('旧定稿\n\n<!-- timeline -->\n线', '新定稿')
    expect(replaced).toContain('新定稿')
    expect(replaced).toContain('<!-- timeline -->')
    expect(replaced).not.toContain('旧定稿')
  })
})
