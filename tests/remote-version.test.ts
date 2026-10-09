import { afterEach, describe, expect, it } from 'vitest'
import {
  createCard,
  createDocument,
  deleteSelection,
  linkCards,
  serializeDocument,
  setCardBody,
  type AppState,
} from '../src/document.ts'
import {
  MSG_CANON_MISMATCH,
  MSG_CARD_CONFLICT,
  MSG_VERSION_MOVED,
  createPersistController,
  documentToBytes,
  mergeDocuments,
  parseCompleteDocument,
  type PersistPorts,
} from '../src/persist.ts'
import { loadRemote, saveRemote } from '../src/remote-canvas.ts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function ports(): PersistPorts {
  return {
    protocol: 'http:',
    hasDirectoryPicker: false,
    now: () => new Date(2026, 9, 8, 12, 0, 0),
    loadDirectory: async () => null,
    pickDirectory: async () => 'abort',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    logFactory: async () => ({
      read: async () => null,
      write: async () => {},
    }),
    tryAcquireLock: async () => ({ release() {} }),
    lockHeld: async () => false,
    channel: {
      post() {},
      subscribe() {
        return () => {}
      },
    },
    claim: {
      get: () => null,
      set() {},
    },
    askSaveAs: async () => false,
    askFirstDownload: async () => false,
    remote: {
      load: loadRemote,
      save: saveRemote,
      keep: async () => ({ ok: false, message: '未调用' }),
    },
  }
}

function threeCards(fileId: string): AppState {
  let state = createDocument(fileId)
  state = createCard(state, { id: 'c1', layer: 'situation', x: 10, y: 10, body: '甲' })
  state = createCard(state, { id: 'c2', layer: 'situation', x: 200, y: 10, body: '乙' })
  state = createCard(state, { id: 'c3', layer: 'situation', x: 400, y: 10, body: '丙' })
  return state
}

// 照服务器的 412 / If-Match 规则：版本号对得上才收，对不上回 412 并带上当前正本。
function fakeServer(initial: AppState) {
  const server = {
    version: 1,
    document: serializeDocument(initial) as ReturnType<typeof serializeDocument>,
    puts: [] as string[],
    state(): AppState {
      const parsed = parseCompleteDocument(new TextEncoder().encode(JSON.stringify(server.document)))
      if (!parsed) throw new Error('服务器正本不是完整 JSON')
      return parsed.state
    },
    edit(recipe: (state: AppState) => AppState) {
      server.document = serializeDocument(recipe(server.state()))
      server.version += 1
    },
  }
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const etag = () => `"${server.version}"`
    if (method === 'PUT') {
      const match = new Headers(init?.headers).get('If-Match') || ''
      server.puts.push(match)
      if (match !== etag()) {
        return new Response(JSON.stringify({ error: 'conflict' }), {
          status: 412,
          headers: { ETag: etag(), 'Content-Type': 'application/json' },
        })
      }
      const raw = init?.body
      const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw ?? '{}')
      server.document = JSON.parse(text) as typeof server.document
      server.version += 1
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ETag: etag(), 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ document: server.document }), {
      status: 200,
      headers: { ETag: etag(), 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return server
}

describe('连续 412 后版本号', () => {
  it('合并后服务器仍连续 412：版本号停在上次成功写入的那一版，不推进成服务器新版本', async () => {
    const document = serializeDocument(
      createCard(createDocument('etag-file'), {
        id: 'c1',
        layer: 'situation',
        x: 10,
        y: 10,
        body: '旧正文',
      }),
    )
    let version = 1
    const puts: string[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'PUT') {
        puts.push(new Headers(init?.headers).get('If-Match') || '')
        version += 1
        return new Response(JSON.stringify({ version, document }), {
          status: 412,
          headers: { ETag: `"${version}"`, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ document }), {
        status: 200,
        headers: { ETag: `"${version}"`, 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const ctl = createPersistController(ports(), () => {})
    await ctl.start()
    expect(ctl.snapshot().view.remoteVersion).toBe('1')
    await ctl.mutate((state) => setCardBody(state, 'c1', '新正文'))
    const view = ctl.snapshot().view
    expect(puts).toEqual(['"1"', '"2"', '"3"', '"4"'])
    expect(view.remoteVersion).toBe('1')
    expect(view.messages).toContain('版本 1')
    expect(view.messages).toContain(MSG_VERSION_MOVED)
    expect(view.canEdit).toBe(true)
    expect(ctl.snapshot().state.snowflake.cards.c1?.body).toBe('新正文')
  })
})

describe('一次冲突按卡片合并', () => {
  it('两边各改一张卡时，后写的人不得盖掉先写的人', async () => {
    let version = 1
    let document = serializeDocument(
      createCard(
        createCard(createDocument('merge-file'), {
          id: 'c1',
          layer: 'situation',
          x: 10,
          y: 10,
          body: '甲',
        }),
        { id: 'c2', layer: 'situation', x: 80, y: 10, body: '乙' },
      ),
    )
    const puts: string[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'PUT') {
        const match = new Headers(init?.headers).get('If-Match') || ''
        puts.push(match)
        if (match !== `"${version}"`) {
          return new Response(JSON.stringify({ error: 'conflict' }), {
            status: 412,
            headers: { ETag: `"${version}"`, 'Content-Type': 'application/json' },
          })
        }
        const raw = init?.body
        const text = raw instanceof Uint8Array ? new TextDecoder().decode(raw) : String(raw ?? '{}')
        document = JSON.parse(text) as typeof document
        version += 1
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ETag: `"${version}"`, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ document }), {
        status: 200,
        headers: { ETag: `"${version}"`, 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const ctl = createPersistController(ports(), () => {})
    await ctl.start()
    document = structuredClone(document)
    document.snowflake.cards.c2.body = '乙乙'
    const remoteNode = document.canvas.nodes.find((node) => node.id === 'c2')
    if (remoteNode) remoteNode.text = '乙乙'
    version = 2

    await ctl.mutate((state) => setCardBody(state, 'c1', '甲甲'))
    expect(puts).toEqual(['"1"', '"2"'])
    expect(document.snowflake.cards.c1?.body).toContain('甲甲')
    expect(document.snowflake.cards.c2?.body).toContain('乙乙')
    expect(ctl.snapshot().view.messages).not.toContain(MSG_VERSION_MOVED)
    expect(ctl.snapshot().view.canEdit).toBe(true)
    expect(ctl.snapshot().state.snowflake.cards.c1?.body).toContain('甲甲')
    expect(ctl.snapshot().state.snowflake.cards.c2?.body).toContain('乙乙')
  })
})

describe('同一张卡两边都改过', () => {
  it('冲突后不推进版本号：412 合并不了时版本号仍是上次成功写入的那一版，之后的改动不再写出', async () => {
    const server = fakeServer(threeCards('conflict-file'))
    const ctl = createPersistController(ports(), () => {})
    await ctl.start()
    server.edit((state) => setCardBody(setCardBody(state, 'c1', '甲-服务器'), 'c2', '乙-服务器'))

    await ctl.mutate((state) => setCardBody(state, 'c1', '甲-我的'))
    let snap = ctl.snapshot()
    expect(server.puts).toEqual(['"1"'])
    expect(snap.view.remoteVersion).toBe('1')
    expect(snap.view.messages).toContain('版本 1')
    expect(snap.view.messages).toContain(MSG_CARD_CONFLICT)
    expect(snap.view.messages).not.toContain(MSG_VERSION_MOVED)
    expect(snap.view.canEdit).toBe(true)
    expect(snap.view.conflicts.map((item) => item.cardId)).toEqual(['c1'])
    expect(snap.view.conflicts[0]?.serverText).toContain('甲-服务器')
    expect(snap.view.conflicts[0]?.mineText).toContain('甲-我的')
    expect(snap.state.snowflake.cards.c1?.body).toContain('甲-我的')
    expect(snap.state.snowflake.cards.c2?.body).toContain('乙-服务器')

    await ctl.mutate((state) => setCardBody(state, 'c3', '丙-冲突期间'))
    await ctl.commitText('c2', null, '乙-冲突期间')
    await ctl.mutate((state) => linkCards(state, 'c1', 'c3'))
    snap = ctl.snapshot()
    expect(server.puts).toEqual(['"1"'])
    expect(snap.view.remoteVersion).toBe('1')
    expect(snap.view.messages).toContain(MSG_CARD_CONFLICT)
    expect(snap.state.snowflake.cards.c3?.body).toContain('丙-冲突期间')
    expect(server.state().snowflake.cards.c1?.body).toContain('甲-服务器')
    expect(server.state().snowflake.cards.c3?.body).toBe('丙')
  })

  for (const pick of ['mine', 'server'] as const) {
    it(`选择后才写入：选「${pick === 'mine' ? '用我的' : '用服务器的'}」后才发 PUT，且仍带旧版本号`, async () => {
      const server = fakeServer(threeCards(`pick-${pick}`))
      const ctl = createPersistController(ports(), () => {})
      await ctl.start()
      server.edit((state) => setCardBody(setCardBody(state, 'c1', '甲-服务器'), 'c2', '乙-服务器'))

      await ctl.mutate((state) => setCardBody(setCardBody(state, 'c1', '甲-我的'), 'c3', '丙-我的'))
      expect(server.puts).toEqual(['"1"'])
      expect(ctl.snapshot().view.conflicts.map((item) => item.cardId)).toEqual(['c1'])

      await ctl.resolveCardConflict('c1', pick)
      expect(server.puts).toEqual(['"1"', '"1"', '"2"'])
      const final = server.state()
      expect(final.snowflake.cards.c1?.body).toContain(pick === 'mine' ? '甲-我的' : '甲-服务器')
      expect(final.snowflake.cards.c1?.body).not.toContain(pick === 'mine' ? '甲-服务器' : '甲-我的')
      expect(final.snowflake.cards.c2?.body).toContain('乙-服务器')
      expect(final.snowflake.cards.c3?.body).toContain('丙-我的')

      const snap = ctl.snapshot()
      expect(snap.view.remoteVersion).toBe('3')
      expect(snap.view.conflicts).toEqual([])
      expect(snap.view.messages).not.toContain(MSG_CARD_CONFLICT)
      expect(snap.state.snowflake.cards.c1?.body).toBe(final.snowflake.cards.c1?.body)
      expect(snap.state.snowflake.cards.c2?.body).toContain('乙-服务器')
      expect(snap.state.snowflake.cards.c3?.body).toContain('丙-我的')

      await ctl.mutate((state) => setCardBody(state, 'c3', '丙-之后'))
      expect(server.puts).toEqual(['"1"', '"1"', '"2"', '"3"'])
      expect(server.state().snowflake.cards.c3?.body).toContain('丙-之后')
    })
  }

  it('两张卡都冲突时，只选完一张不写出，两张都选完才写一次', async () => {
    const server = fakeServer(threeCards('two-conflicts'))
    const ctl = createPersistController(ports(), () => {})
    await ctl.start()
    server.edit((state) => setCardBody(setCardBody(state, 'c1', '甲-服务器'), 'c2', '乙-服务器'))

    await ctl.mutate((state) => setCardBody(setCardBody(state, 'c1', '甲-我的'), 'c2', '乙-我的'))
    expect(ctl.snapshot().view.conflicts.map((item) => item.cardId)).toEqual(['c1', 'c2'])

    await ctl.resolveCardConflict('c1', 'mine')
    expect(server.puts).toEqual(['"1"'])
    expect(ctl.snapshot().view.conflicts.map((item) => item.cardId)).toEqual(['c2'])
    expect(ctl.snapshot().view.messages).toContain(MSG_CARD_CONFLICT)

    await ctl.resolveCardConflict('c2', 'server')
    expect(server.puts).toEqual(['"1"', '"1"', '"2"'])
    expect(server.state().snowflake.cards.c1?.body).toContain('甲-我的')
    expect(server.state().snowflake.cards.c2?.body).toContain('乙-服务器')
    expect(ctl.snapshot().view.messages).not.toContain(MSG_CARD_CONFLICT)
  })

  it('选完之前服务器又改了这张卡：之前的选择作废，这张卡继续待选，不覆盖', async () => {
    const server = fakeServer(threeCards('moved-again'))
    const ctl = createPersistController(ports(), () => {})
    await ctl.start()
    server.edit((state) => setCardBody(state, 'c1', '甲-服务器'))

    await ctl.mutate((state) => setCardBody(state, 'c1', '甲-我的'))
    server.edit((state) => setCardBody(state, 'c1', '甲-服务器第二次'))

    await ctl.resolveCardConflict('c1', 'mine')
    expect(server.puts).toEqual(['"1"', '"1"'])
    expect(server.state().snowflake.cards.c1?.body).toContain('甲-服务器第二次')
    const snap = ctl.snapshot()
    expect(snap.view.remoteVersion).toBe('1')
    expect(snap.view.conflicts.map((item) => item.cardId)).toEqual(['c1'])
    expect(snap.view.conflicts[0]?.serverText).toContain('甲-服务器第二次')

    await ctl.resolveCardConflict('c1', 'mine')
    expect(server.puts).toEqual(['"1"', '"1"', '"1"', '"3"'])
    expect(server.state().snowflake.cards.c1?.body).toContain('甲-我的')
  })

  it('正本 fileId 对不上：版本号不动，停下不写，不覆盖', async () => {
    const server = fakeServer(threeCards('file-a'))
    const ctl = createPersistController(ports(), () => {})
    await ctl.start()
    server.document = serializeDocument(threeCards('file-b'))
    server.version += 1

    await ctl.mutate((state) => setCardBody(state, 'c1', '甲-我的'))
    const snap = ctl.snapshot()
    expect(server.puts).toEqual(['"1"'])
    expect(snap.view.remoteVersion).toBe('1')
    expect(snap.view.canEdit).toBe(false)
    expect(snap.view.messages).toContain(MSG_CANON_MISMATCH)
    expect(server.state().snowflake.fileId).toBe('file-b')

    await ctl.mutate((state) => setCardBody(state, 'c2', '乙-我的'))
    expect(server.puts).toEqual(['"1"'])
  })
})

describe('合并后无悬空边', () => {
  it('一边删卡、另一边从这张卡连线：合并写出后没有指向已删卡片的边', async () => {
    const server = fakeServer(threeCards('dangling-file'))
    const ctl = createPersistController(ports(), () => {})
    await ctl.start()
    server.edit((state) => deleteSelection(state, 'c2'))

    await ctl.mutate((state) => linkCards(linkCards(state, 'c1', 'c2'), 'c1', 'c3'))
    expect(server.puts).toEqual(['"1"', '"2"'])
    const final = server.state()
    expect(final.snowflake.cards.c2).toBeUndefined()
    const ends = (state: AppState) => state.canvas.edges.flatMap((edge) => [edge.fromNode, edge.toNode])
    expect(ends(final)).not.toContain('c2')
    expect(final.canvas.edges.some((edge) => edge.fromNode === 'c1' && edge.toNode === 'c3')).toBe(true)
    expect(ends(ctl.snapshot().state)).not.toContain('c2')
    expect(ctl.snapshot().view.conflicts).toEqual([])
  })

  it('作者选完边之后的合并结果里也没有悬空边', () => {
    const base = threeCards('choice-dangling')
    const remote = deleteSelection(setCardBody(base, 'c1', '甲-服务器'), 'c2')
    const local = linkCards(setCardBody(base, 'c1', '甲-我的'), 'c1', 'c2')
    const first = mergeDocuments(documentToBytes(base), documentToBytes(remote), documentToBytes(local))
    if (first.kind !== 'merged') throw new Error('应能合并')
    expect(first.conflicts.map((item) => item.cardId)).toEqual(['c1'])
    const firstState = parseCompleteDocument(first.bytes)?.state
    expect(firstState?.canvas.edges.some((edge) => edge.toNode === 'c2')).toBe(false)

    for (const pick of ['mine', 'server'] as const) {
      const choices = new Map([['c1', { pick, serverKey: first.conflicts[0]!.serverKey }]])
      const again = mergeDocuments(documentToBytes(base), documentToBytes(remote), documentToBytes(local), choices)
      if (again.kind !== 'merged') throw new Error('应能合并')
      expect(again.conflicts).toEqual([])
      const state = parseCompleteDocument(again.bytes)?.state
      expect(state?.snowflake.cards.c2).toBeUndefined()
      expect(state?.canvas.edges.some((edge) => edge.fromNode === 'c2' || edge.toNode === 'c2')).toBe(false)
      expect(state?.snowflake.cards.c1?.body).toContain(pick === 'mine' ? '甲-我的' : '甲-服务器')
    }
  })
})
