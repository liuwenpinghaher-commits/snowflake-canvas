import { afterEach, describe, expect, it } from 'vitest'
import { createCard, createDocument, serializeDocument, setCardBody } from '../src/document.ts'
import { MSG_VERSION_MOVED, createPersistController, type PersistPorts } from '../src/persist.ts'
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

describe('连续 412 后版本号', () => {
  it('两次冲突后，前端持有的 etag 变成服务器当前版本，并让用户看见', async () => {
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
    expect(puts).toEqual(['"1"', '"2"'])
    expect(view.remoteVersion).toBe('3')
    expect(view.messages).toContain('版本 3')
    expect(view.messages).toContain(MSG_VERSION_MOVED)
    expect(view.messages.join('\n')).not.toContain('版本 1')
    expect(view.messages.join('\n')).not.toContain('版本 2')
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
