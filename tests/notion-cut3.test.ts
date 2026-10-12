import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBlockMenu, blockMenuItems, blockSessionFromBlocks, type Block } from '../src/block-editor.ts'
import { cardAnchor, deleteCanvasNode } from '../src/canvas-commands.ts'
import { paletteHits } from '../src/command-palette.ts'
import { createCard, createDocument, duplicateCard, moveNode, serializeDocument } from '../src/document.ts'
import { createPersistController, type PersistPorts, type RemoteCanonical } from '../src/persist.ts'
import { createPersonEntity } from '../src/person-form.ts'
import { runShortcut, shortcutDecision, type KeyInfo, type ShortcutActions } from '../src/shortcuts.ts'

type Doc = ReturnType<typeof serializeDocument>

function key(partial: Partial<KeyInfo> & Pick<KeyInfo, 'key'>): KeyInfo {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    target: null,
    ...partial,
  }
}

const editor = { tagName: 'DIV', isContentEditable: true }
const canvas = { tagName: 'DIV', isContentEditable: false }
const plainInput = { tagName: 'INPUT', isContentEditable: false }

function actions(log: string[]): ShortcutActions {
  return {
    togglePalette() {
      log.push('palette')
    },
    undo() {
      log.push('undo')
    },
    redo() {
      log.push('redo')
    },
    deleteSelection() {
      log.push('delete')
    },
  }
}

function bytesOf(document: Doc): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(document))
}

function fakeServer(initial: Doc) {
  const server = { version: 1, document: initial }
  const remote: RemoteCanonical = {
    load: async () => ({ etag: `"${server.version}"`, bytes: bytesOf(server.document) }),
    save: async (bytes, etag) => {
      if (etag !== `"${server.version}"`) {
        return { ok: false, conflict: true, etag: `"${server.version}"`, bytes: bytesOf(server.document) }
      }
      server.document = JSON.parse(new TextDecoder().decode(bytes)) as Doc
      server.version += 1
      return { ok: true, etag: `"${server.version}"` }
    },
    keep: async () => ({ ok: false, message: '不用' }),
    listSnapshots: async () => [],
    rollback: async () => ({ ok: false, conflict: false, message: '不用' }),
  }
  return { server, remote }
}

function ports(remote: RemoteCanonical): PersistPorts {
  return {
    protocol: 'http:',
    hasDirectoryPicker: false,
    now: () => new Date(2026, 9, 12, 12, 0, 0),
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

function seeded() {
  let state = createCard(createDocument('cut3'), { id: 'a', layer: 'situation', x: 10, y: 20, body: '临冬城下的雪' })
  state = createCard(state, { id: 'b', layer: 'situation', x: 80, y: 20, body: '乙' })
  state = createPersonEntity(state, 'ned', '奈德')
  state = {
    ...state,
    chapters: [{ id: 'ch-1', title: '城门夜雨', scenes: [] }],
  }
  return state
}

describe('命令面板', () => {
  it('按卡标题和实体名命中，也能命中书名、章节和工作面', () => {
    const state = seeded()
    const byTitle = paletteHits({ bookName: '冰与火', state, query: '临冬' })
    expect(byTitle.some((hit) => hit.kind === 'card' && hit.targetId === 'a' && hit.label.includes('临冬'))).toBe(true)
    expect(byTitle.some((hit) => hit.kind === 'entity')).toBe(false)

    const byEntity = paletteHits({ bookName: '冰与火', state, query: '奈德' })
    expect(byEntity.some((hit) => hit.kind === 'entity' && hit.targetId === 'ned' && hit.label === '奈德')).toBe(true)
    expect(byEntity.some((hit) => hit.kind === 'card')).toBe(false)

    expect(paletteHits({ bookName: '冰与火', state, query: '冰与火' }).some((hit) => hit.kind === 'book')).toBe(true)
    expect(paletteHits({ bookName: '冰与火', state, query: '城门' }).some((hit) => hit.kind === 'chapter' && hit.targetId === 'ch-1')).toBe(true)
    expect(paletteHits({ bookName: '冰与火', state, query: '' }).filter((hit) => hit.kind === 'surface').map((hit) => hit.label)).toEqual([
      '画布',
      '人物',
      '关系',
      '百科',
      '章节',
    ])
  })
})

describe('快捷键落在哪一层', () => {
  it('编辑器焦点里 Ctrl+Z 不调用文档撤销', () => {
    for (const event of [
      key({ key: 'z', ctrlKey: true, target: editor }),
      key({ key: 'z', metaKey: true, target: editor }),
      key({ key: 'Z', ctrlKey: true, shiftKey: true, target: editor }),
      key({ key: 'y', ctrlKey: true, target: editor }),
      key({ key: 'Delete', target: editor }),
      key({ key: 'Backspace', target: editor }),
      key({ key: 'z', ctrlKey: true, target: plainInput }),
    ]) {
      const decision = shortcutDecision(event)
      expect(decision).toEqual({ type: 'ignore' })
      const log: string[] = []
      runShortcut(decision, actions(log))
      expect(log).toEqual([])
    }
  })

  it('画布焦点 Ctrl+Z 撤销，Ctrl+Shift+Z 和 Ctrl+Y 重做，Delete 删选中的卡', () => {
    const undoLog: string[] = []
    runShortcut(shortcutDecision(key({ key: 'z', ctrlKey: true, target: canvas })), actions(undoLog))
    expect(undoLog).toEqual(['undo'])

    const redoLog: string[] = []
    runShortcut(shortcutDecision(key({ key: 'Z', ctrlKey: true, shiftKey: true, target: canvas })), actions(redoLog))
    runShortcut(shortcutDecision(key({ key: 'y', metaKey: true, target: canvas })), actions(redoLog))
    expect(redoLog).toEqual(['redo', 'redo'])

    expect(shortcutDecision(key({ key: 'Delete', target: canvas })).type).toBe('delete-selection')
    expect(shortcutDecision(key({ key: 'Backspace', target: canvas })).type).toBe('delete-selection')
    const deleteLog: string[] = []
    runShortcut(shortcutDecision(key({ key: 'Delete', target: canvas })), actions(deleteLog))
    expect(deleteLog).toEqual(['delete'])
  })

  it('输入框里 Ctrl+K 仍能打开命令面板，但不抢走撤销', () => {
    const log: string[] = []
    runShortcut(shortcutDecision(key({ key: 'k', ctrlKey: true, target: plainInput })), actions(log))
    runShortcut(shortcutDecision(key({ key: 'k', metaKey: true, target: canvas })), actions(log))
    expect(log).toEqual(['palette', 'palette'])
  })
})

describe('删除走同一条撤销栈', () => {
  it('右键删除和 Delete 都调用 deleteCanvasNode，确认后删卡，撤销能回来', async () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).toContain('void deleteCanvasNode(ctlRef.current, id, (message) => window.confirm(message))')
    expect(app).toContain('removeCardRef.current(id)')
    expect(app).toContain('onSelect: () => removeCard(menu.id)')
    expect(app).toContain('onClick={() => removeCard(state.activeId)}')
    expect(app.slice(app.indexOf('label="设置"'), app.indexOf('</header>'))).not.toContain('撤销')
    expect(app.slice(app.indexOf('label="设置"'), app.indexOf('</header>'))).not.toContain('canUndo')

    const { remote } = fakeServer(serializeDocument(seeded()))
    const ctl = createPersistController(ports(remote), () => {})
    await ctl.start()
    expect(ctl.snapshot().state.snowflake.cards.b?.body).toBe('乙')

    expect(await deleteCanvasNode(ctl, 'b', () => false)).toBe(false)
    expect(ctl.snapshot().state.snowflake.cards.b?.body).toBe('乙')
    expect(ctl.snapshot().view.canUndo).toBe(false)

    expect(await deleteCanvasNode(ctl, 'b', () => true)).toBe(true)
    expect(ctl.snapshot().state.snowflake.cards.b).toBeUndefined()
    await ctl.undo()
    expect(ctl.snapshot().state.snowflake.cards.b?.body).toBe('乙')
    await ctl.redo()
    expect(ctl.snapshot().state.snowflake.cards.b).toBeUndefined()
    await ctl.undo()
    expect(ctl.snapshot().state.snowflake.cards.b?.body).toBe('乙')

    const anchor = cardAnchor('b')
    expect(anchor.startsWith('#card/')).toBe(true)
    expect(anchor).not.toContain('http')
    expect(anchor).not.toContain('://')
  })
})

describe('块菜单不确认删除', () => {
  const blocks: Block[] = [
    { id: 'p', type: 'paragraph', text: '甲' },
    { id: 'q', type: 'quote', text: '乙' },
  ]

  it('变成、复制、删除、上移下移都改块本身', () => {
    const labels = blockMenuItems(1, 2, true, 'quote').map((item) => item.label)
    expect(labels).toEqual(['变成段落', '变成标题', '变成引用', '变成待办', '复制', '删除', '上移', '下移'])
    expect(blockMenuItems(1, 2, true, 'quote').find((item) => item.id === 'turn:quote')?.disabled).toBe(true)
    expect(blockMenuItems(0, 2, true, 'paragraph').find((item) => item.id === 'up')?.disabled).toBe(true)

    let session = blockSessionFromBlocks(blocks)
    session = applyBlockMenu(session, 0, 'turn:heading')
    expect(session.blocks[0]).toMatchObject({ type: 'heading', text: '甲' })
    session = applyBlockMenu(session, 0, 'duplicate')
    expect(session.blocks.map((block) => block.text)).toEqual(['甲', '甲', '乙'])
    expect(session.blocks[0]?.id).not.toBe(session.blocks[1]?.id)
    session = applyBlockMenu(session, 2, 'up')
    expect(session.blocks.map((block) => block.text)).toEqual(['甲', '乙', '甲'])
    session = applyBlockMenu(session, 1, 'remove')
    expect(session.blocks.map((block) => block.text)).toEqual(['甲', '甲'])
  })
})

describe('复制卡片不改数据形状', () => {
  it('复制出一张新卡，边不跟着复制，序列化键还是原来那些', () => {
    const state = seeded()
    const next = duplicateCard(state, 'a', 'a-copy')
    expect(next.activeId).toBe('a-copy')
    expect(next.snowflake.cards['a-copy']?.body).toBe('临冬城下的雪')
    expect(next.canvas.nodes.find((node) => node.id === 'a-copy')).toMatchObject({ x: 42, y: 52 })
    expect(next.canvas.edges).toEqual(state.canvas.edges)
    const saved = serializeDocument(next)
    expect(saved.snowflake.cards['a-copy']?.blocks).toBeUndefined()
    expect(Object.keys(saved).sort()).toEqual(Object.keys(serializeDocument(state)).sort())
    const nudged = moveNode(next, 'a-copy', 1, 1)
    expect(nudged.canvas.nodes.find((node) => node.id === 'a-copy')?.x).toBe(1)
  })
})
