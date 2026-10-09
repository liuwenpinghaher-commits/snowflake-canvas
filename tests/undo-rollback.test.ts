import { describe, expect, it } from 'vitest'
import { createCard, createDocument, deleteSelection, moveNode, serializeDocument } from '../src/document.ts'
import {
  MSG_TIMELINE_SKIPPED,
  UNDO_LIMIT,
  createPersistController,
  type PersistPorts,
  type RemoteCanonical,
} from '../src/persist.ts'

type Doc = ReturnType<typeof serializeDocument>

function bytesOf(document: Doc): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(document))
}

function fakeServer(initial: Doc) {
  const server = {
    version: 1,
    document: initial,
    files: new Map<string, Doc>(),
    puts: 0,
    timeline: 'ok' as 'ok' | 'skipped',
  }
  const remote: RemoteCanonical = {
    load: async () => ({ etag: `"${server.version}"`, bytes: bytesOf(server.document) }),
    save: async (bytes, etag) => {
      server.puts += 1
      if (etag !== `"${server.version}"`) {
        return { ok: false, conflict: true, etag: `"${server.version}"`, bytes: bytesOf(server.document) }
      }
      server.document = JSON.parse(new TextDecoder().decode(bytes)) as Doc
      server.version += 1
      return { ok: true, etag: `"${server.version}"` }
    },
    keep: async (etag) => {
      if (etag !== `"${server.version}"`) return { ok: false, message: '版本对不上' }
      const name = `snowflake.2026100${server.files.size + 1}T100000.snapshot.json`
      server.files.set(name, structuredClone(server.document))
      server.version += 1
      return { ok: true, etag: `"${server.version}"`, snapshotCount: server.files.size, snapshotName: name, timeline: server.timeline }
    },
    listSnapshots: async () =>
      [...server.files.keys()]
        .sort()
        .reverse()
        .map((name) => ({ name, savedAt: '2026-10-09T02:00:00.000Z' })),
    rollback: async (name, etag) => {
      if (etag !== `"${server.version}"`) {
        return { ok: false, conflict: true, etag: `"${server.version}"`, bytes: bytesOf(server.document) }
      }
      const chosen = server.files.get(name)
      if (!chosen) return { ok: false, conflict: false, message: '没有这份快照' }
      server.files.set(`snowflake.2026100${server.files.size + 1}T110000.snapshot.json`, structuredClone(server.document))
      server.document = structuredClone(chosen)
      server.version += 1
      return { ok: true, etag: `"${server.version}"`, bytes: bytesOf(server.document) }
    },
  }
  return { server, remote }
}

function ports(remote: RemoteCanonical): PersistPorts {
  return {
    protocol: 'http:',
    hasDirectoryPicker: false,
    now: () => new Date(2026, 9, 9, 12, 0, 0),
    loadDirectory: async () => null,
    pickDirectory: async () => 'abort',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    logFactory: async () => ({ read: async () => null, write: async () => {} }),
    tryAcquireLock: async () => ({ release() {} }),
    lockHeld: async () => false,
    channel: { post() {}, subscribe: () => () => {} },
    claim: { get: () => null, set() {} },
    askSaveAs: async () => false,
    askFirstDownload: async () => false,
    remote,
  }
}

function seed(): Doc {
  let state = createCard(createDocument('undo-file'), { id: 'a', layer: 'situation', x: 0, y: 0, body: '甲' })
  state = createCard(state, { id: 'b', layer: 'situation', x: 100, y: 0, body: '乙' })
  return serializeDocument(state)
}

describe('画布撤销', () => {
  it('删除后撤销把卡片找回来，并通过同一条写入队列写回服务器', async () => {
    const { server, remote } = fakeServer(seed())
    const ctl = createPersistController(ports(remote), () => {})
    await ctl.start()
    expect(ctl.snapshot().view.canUndo).toBe(false)

    await ctl.mutate((state) => deleteSelection(state, 'b'), { undoable: true })
    expect(server.document.snowflake.cards.b).toBeUndefined()
    expect(ctl.snapshot().view.canUndo).toBe(true)

    await ctl.undo()
    expect(ctl.snapshot().state.snowflake.cards.b?.body).toBe('乙')
    expect(server.document.snowflake.cards.b?.body).toBe('乙')
    expect(server.puts).toBe(2)
    expect(ctl.snapshot().view.canUndo).toBe(false)

    await ctl.undo()
    expect(server.puts).toBe(2)
  })

  it('不带 undoable 的改动不进撤销栈；栈最多留 20 步', async () => {
    const { remote } = fakeServer(seed())
    const ctl = createPersistController(ports(remote), () => {})
    await ctl.start()
    await ctl.mutate((state) => moveNode(state, 'a', 5, 5))
    expect(ctl.snapshot().view.canUndo).toBe(false)
    for (let step = 1; step <= UNDO_LIMIT + 5; step += 1) {
      await ctl.mutate((state) => moveNode(state, 'a', step * 10, 0), { undoable: true })
    }
    for (let step = 0; step < UNDO_LIMIT; step += 1) await ctl.undo()
    expect(ctl.snapshot().view.canUndo).toBe(false)
    expect(ctl.snapshot().state.canvas.nodes.find((node) => node.id === 'a')?.x).toBe(50)
  })
})

describe('服务器模式回退', () => {
  it('留下这一版后下拉框有带时间的选项，回退后内存画布换成所选快照', async () => {
    const { server, remote } = fakeServer(seed())
    server.timeline = 'skipped'
    const ctl = createPersistController(ports(remote), () => {})
    await ctl.start()
    await ctl.keepVersion()
    const view = ctl.snapshot().view
    expect(view.messages.some((line) => line.startsWith('已留下这一版，快照 1 份'))).toBe(true)
    expect(view.messages.some((line) => line.includes(MSG_TIMELINE_SKIPPED))).toBe(true)
    expect(view.snapshotOptions).toHaveLength(1)
    expect(view.snapshotOptions[0]?.label).toContain('保存于')
    const chosen = view.snapshotOptions[0]!.name

    await ctl.mutate((state) => deleteSelection(state, 'a'), { undoable: true })
    expect(server.document.snowflake.cards.a).toBeUndefined()

    await ctl.rollbackTo(chosen)
    const after = ctl.snapshot()
    expect(after.state.snowflake.cards.a?.body).toBe('甲')
    expect(after.view.remoteVersion).toBe(String(server.version))
    expect(after.view.snapshotOptions).toHaveLength(2)
    expect(after.view.canUndo).toBe(false)

    await ctl.mutate((state) => moveNode(state, 'a', 7, 7))
    expect(server.document.canvas.nodes.find((node) => node.id === 'a')?.x).toBe(7)
  })
})
