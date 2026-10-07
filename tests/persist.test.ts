import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCard, createDocument, type ComposeSession } from '../src/document.ts'
import {
  CANONICAL_NAME,
  MSG_FILE_PROTOCOL,
  MSG_LOG_DOWN,
  MSG_OTHER_TAB,
  MSG_RESTORED,
  MSG_SAVE_AS,
  MSG_WRITE_FAILED,
  MSG_WRITING,
  SAVE_AS_WARNING,
  bytesEqual,
  createMemoryChannel,
  createPersistController,
  documentToBytes,
  formatLocalStart,
  parseCompleteDocument,
  tempNameFor,
  type ChannelBus,
  type DirectoryAccess,
  type PersistController,
  type PersistPorts,
  type RecoveryLog,
} from '../src/persist.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

class MemDir implements DirectoryAccess {
  files = new Map<string, Uint8Array>()
  events: string[] = []
  corruptTemp = false
  failMove = false

  async read(name: string): Promise<Uint8Array | null> {
    this.events.push(`read:${name}`)
    const found = this.files.get(name)
    return found ? found.slice() : null
  }

  async writeTemp(name: string, bytes: Uint8Array): Promise<void> {
    this.events.push(`writeTemp:${name}`)
    this.files.set(name, this.corruptTemp ? new Uint8Array([0x7b]) : bytes.slice())
  }

  async move(tempName: string, canonicalName: string): Promise<void> {
    this.events.push(`move:${tempName}->${canonicalName}`)
    if (this.failMove) throw new Error('move failed')
    const body = this.files.get(tempName)
    if (!body) throw new Error('missing temp')
    this.files.set(canonicalName, body.slice())
    this.files.delete(tempName)
  }

  async remove(name: string): Promise<void> {
    this.events.push(`remove:${name}`)
    this.files.delete(name)
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
  channel?: ChannelBus
  ports?: Partial<PersistPorts>
}) {
  const mem = options?.mem ?? new MemDir()
  const log = options?.log ?? new FakeLog()
  const channel = options?.channel ?? createMemoryChannel()
  const calls = { log: 0, request: 0, query: 0, saveAs: 0, first: 0 }
  let stored = false
  let permission: 'granted' | 'prompt' | 'denied' = 'granted'
  const claim = { value: null as string | null }
  const ports: PersistPorts = {
    protocol: 'http:',
    hasDirectoryPicker: true,
    now: () => new Date(2026, 9, 7, 12, 0, 0),
    loadDirectory: async () => (stored ? mem : null),
    pickDirectory: async () => {
      stored = true
      return mem
    },
    queryPermission: async () => {
      calls.query += 1
      return permission
    },
    requestPermission: async () => {
      calls.request += 1
      return permission
    },
    logFactory: async () => {
      calls.log += 1
      return log
    },
    tryAcquireLock: async () => ({ release() {} }),
    lockHeld: async () => false,
    channel,
    claim: {
      get: () => claim.value,
      set: (fileId) => {
        claim.value = fileId
      },
    },
    askSaveAs: async () => {
      calls.saveAs += 1
      return true
    },
    askFirstDownload: async () => {
      calls.first += 1
      return true
    },
    randomId: () => 'file-test',
    ...options?.ports,
  }
  const ctl = createPersistController(ports)
  return {
    mem,
    log,
    ctl,
    calls,
    claim,
    ports,
    setPermission(next: 'granted' | 'prompt' | 'denied') {
      permission = next
    },
    markStored() {
      stored = true
    },
  }
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

async function seedCard(ctl: PersistController, body = '原'): Promise<void> {
  await ctl.mutate((state) => createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body }))
  ctl.select('c1')
}

describe('落盘链路', () => {
  it('临时文件名是正本前面加点和后面加 .tmp', () => {
    expect(CANONICAL_NAME).toBe('snowflake.json')
    expect(tempNameFor(CANONICAL_NAME)).toBe('.snowflake.json.tmp')
  })

  it('中文句子在组合结束后进入正本字节；组合中途的半截拼音不进入正本', async () => {
    const h = harness()
    await h.ctl.selectDirectory()
    await seedCard(h.ctl, '原')

    const canonical = () => textOf(h.mem.files.get(CANONICAL_NAME))
    expect(canonical()).toContain('原')
    expect(canonical()).not.toContain('di')
    const writesBefore = h.log.writes.length

    let session: ComposeSession = { cardId: 'c1', composing: false, draft: '原' }
    session = await h.ctl.editorComposition(session, { type: 'compositionstart' }, null)
    session = await h.ctl.editorComposition(session, { type: 'insert', text: 'di' }, null)
    expect(session.composing).toBe(true)
    expect(session.draft).toBe('di')
    expect(h.ctl.snapshot().state.snowflake.cards.c1?.body).toBe('原')
    expect(canonical()).not.toContain('di')
    expect(h.log.writes).toHaveLength(writesBefore)

    const pending = h.ctl.editorComposition(session, { type: 'compositionend', text: '门口那个人其实是弟弟。' }, null)
    expect(h.ctl.snapshot().view.writing).toBe(true)
    expect(h.ctl.snapshot().view.canEdit).toBe(false)
    expect(h.ctl.snapshot().view.messages).toContain(MSG_WRITING)
    await pending

    const after = canonical()
    expect(after).toContain('门口那个人其实是弟弟。')
    expect(after).not.toContain('di')
    expect(textOf(h.log.bytes ?? undefined)).toContain('门口那个人其实是弟弟。')
    expect(textOf(h.log.bytes ?? undefined)).not.toContain('di')
    expect(h.ctl.snapshot().view.canEdit).toBe(true)
    expect(h.ctl.snapshot().view.messages).not.toContain(MSG_WRITING)
  })

  it('改名前失败：正本仍是上一份完整 JSON，临时文件被删，恢复日志没有这一笔', async () => {
    const h = harness()
    await h.ctl.selectDirectory()
    await seedCard(h.ctl, '上一份')
    const before = h.mem.files.get(CANONICAL_NAME)!.slice()
    const writesBefore = h.log.writes.length
    h.mem.corruptTemp = true
    h.mem.events = []

    await h.ctl.commitText('c1', null, '这一笔不该落盘')

    expect(bytesEqual(h.mem.files.get(CANONICAL_NAME)!, before)).toBe(true)
    expect(h.mem.files.has(tempNameFor(CANONICAL_NAME))).toBe(false)
    expect(h.log.writes).toHaveLength(writesBefore)
    expect(textOf(h.log.bytes ?? undefined)).not.toContain('这一笔不该落盘')
    expect(h.mem.events.some((event) => event.startsWith('move:'))).toBe(false)
    expect(h.ctl.snapshot().view.canEdit).toBe(false)
    expect(h.ctl.snapshot().view.messages).toContain(MSG_WRITE_FAILED)
    expect(h.ctl.snapshot().state.snowflake.cards.c1?.body).toContain('这一笔不该落盘')

    const moved = harness()
    await moved.ctl.selectDirectory()
    await seedCard(moved.ctl, '上一份')
    const previous = moved.mem.files.get(CANONICAL_NAME)!.slice()
    const logged = moved.log.writes.length
    moved.mem.failMove = true
    await moved.ctl.commitText('c1', null, '改名失败也不记日志')
    expect(bytesEqual(moved.mem.files.get(CANONICAL_NAME)!, previous)).toBe(true)
    expect(moved.mem.files.has(tempNameFor(CANONICAL_NAME))).toBe(false)
    expect(moved.log.writes).toHaveLength(logged)
    expect(textOf(moved.log.bytes ?? undefined)).not.toContain('改名失败也不记日志')
    expect(moved.ctl.snapshot().view.canEdit).toBe(false)
    expect(moved.ctl.snapshot().view.messages).toContain(MSG_WRITE_FAILED)
    expect(moved.ctl.snapshot().state.snowflake.cards.c1?.body).toContain('改名失败也不记日志')
  })

  it('改名成功后日志才写入；日志字节与正本一致', async () => {
    const h = harness()
    const order: string[] = []
    const realMove = h.mem.move.bind(h.mem)
    h.mem.move = async (tempName, canonicalName) => {
      order.push('move')
      await realMove(tempName, canonicalName)
    }
    const realWrite = h.log.write.bind(h.log)
    h.log.write = async (bytes) => {
      order.push('log')
      await realWrite(bytes)
    }
    await h.ctl.selectDirectory()
    order.length = 0
    await seedCard(h.ctl, '落盘之后才记日志')
    const moveAt = order.indexOf('move')
    const logAt = order.indexOf('log')
    expect(moveAt).toBeGreaterThanOrEqual(0)
    expect(logAt).toBeGreaterThan(moveAt)
    const canonical = h.mem.files.get(CANONICAL_NAME)!
    expect(bytesEqual(h.log.bytes!, canonical)).toBe(true)
    expect(textOf(canonical)).toContain('落盘之后才记日志')
  })

  it('正本损坏且日志有上一份完整 JSON：用日志换上，换上过程仍是临时文件、校验、改名', async () => {
    const previous = documentToBytes(
      createCard(createDocument('file-prev'), {
        id: 'c1',
        layer: 'situation',
        x: 1,
        y: 2,
        body: '上一份完整稿',
      }),
    )
    const decoy = documentToBytes(
      createCard(createDocument('file-decoy'), {
        id: 'c1',
        layer: 'situation',
        x: 4,
        y: 5,
        body: '临时文件不能当正本',
      }),
    )
    const h = harness()
    h.mem.files.set(CANONICAL_NAME, encoder.encode('NOT JSON'))
    h.mem.files.set(tempNameFor(CANONICAL_NAME), decoy)
    h.log.bytes = previous.slice()
    await h.ctl.selectDirectory()

    const canonical = h.mem.files.get(CANONICAL_NAME)!
    expect(bytesEqual(canonical, previous)).toBe(true)
    expect(bytesEqual(canonical, decoy)).toBe(false)
    expect(h.mem.files.has(tempNameFor(CANONICAL_NAME))).toBe(false)
    expect(bytesEqual(h.log.bytes!, canonical)).toBe(true)
    expect(h.mem.events.some((event) => event.startsWith('writeTemp:'))).toBe(true)
    expect(h.mem.events.some((event) => event.startsWith(`move:${tempNameFor(CANONICAL_NAME)}->${CANONICAL_NAME}`))).toBe(true)
    expect(parseCompleteDocument(canonical)?.state.snowflake.cards.c1?.body).toBe('上一份完整稿')
    expect(h.ctl.snapshot().view.messages).toContain(MSG_RESTORED)
    expect(h.ctl.snapshot().view.canEdit).toBe(true)
  })

  it('正本损坏且日志也没有能解析的 JSON：停止编辑，临时文件不升成正本', async () => {
    const decoy = documentToBytes(
      createCard(createDocument('file-decoy'), {
        id: 'c1',
        layer: 'situation',
        x: 0,
        y: 0,
        body: '不能升成正本',
      }),
    )
    const h = harness()
    h.mem.files.set(CANONICAL_NAME, encoder.encode('%%%'))
    h.mem.files.set(tempNameFor(CANONICAL_NAME), decoy)
    h.log.bytes = encoder.encode('{')
    await h.ctl.selectDirectory()

    expect(textOf(h.mem.files.get(CANONICAL_NAME))).toBe('%%%')
    expect(bytesEqual(h.mem.files.get(CANONICAL_NAME)!, decoy)).toBe(false)
    expect(h.mem.events.some((event) => event.startsWith('move:'))).toBe(false)
    expect(h.ctl.snapshot().view.canEdit).toBe(false)
    expect(h.ctl.snapshot().view.messages).toContain(MSG_WRITE_FAILED)
  })

  it('拿不到锁：只读，文案含「另一个标签正在写这份正本，本页只读」', async () => {
    let logCalls = 0
    const h = harness({
      ports: {
        tryAcquireLock: async () => null,
        lockHeld: async () => true,
        logFactory: async () => {
          logCalls += 1
          return new FakeLog()
        },
      },
    })
    const before = documentToBytes(
      createCard(createDocument('file-held'), {
        id: 'c1',
        layer: 'situation',
        x: 0,
        y: 0,
        body: '别人正在写',
      }),
    )
    h.mem.files.set(CANONICAL_NAME, before)
    await h.ctl.selectDirectory()
    expect(logCalls).toBe(0)
    expect(h.ctl.snapshot().view.canEdit).toBe(false)
    expect(h.ctl.snapshot().view.readonlyOther).toBe(true)
    expect(h.ctl.snapshot().view.messages.join('\n')).toContain(MSG_OTHER_TAB)
    expect(h.ctl.snapshot().view.otherStartedAt).toBeNull()
    expect(h.ctl.snapshot().view.messages.join('\n')).not.toContain('开始写')

    await h.ctl.commitText('c1', null, '只读页不该写下')
    expect(bytesEqual(h.mem.files.get(CANONICAL_NAME)!, before)).toBe(true)

    let acquired = false
    h.ports.tryAcquireLock = async () => {
      acquired = true
      return { release() {} }
    }
    await h.ctl.claimWrite()
    expect(acquired).toBe(true)
    expect(h.ctl.snapshot().view.canEdit).toBe(true)
    expect(logCalls).toBe(1)
  })

  it('开始时间不出现在正本 JSON、也不出现在日志字节里', async () => {
    const channel = createMemoryChannel()
    const mem = new MemDir()
    const writerLog = new FakeLog()
    const writerNow = new Date(2099, 7, 8, 8, 8, 8)
    const readerNow = new Date(2001, 0, 1, 1, 1, 1)
    const writerLabel = formatLocalStart(writerNow)
    const readerLabel = formatLocalStart(readerNow)
    const seeded = documentToBytes(
      createCard(createDocument('file-time'), {
        id: 'c1',
        layer: 'situation',
        x: 3,
        y: 4,
        body: '原句',
      }),
    )
    mem.files.set(CANONICAL_NAME, seeded)

    const writer = harness({
      mem,
      log: writerLog,
      channel,
      ports: { now: () => writerNow },
    })
    writer.markStored()
    let readerLogs = 0
    const reader = harness({
      mem,
      channel,
      ports: {
        now: () => readerNow,
        loadDirectory: async () => mem,
        tryAcquireLock: async () => null,
        lockHeld: async () => true,
        logFactory: async () => {
          readerLogs += 1
          return new FakeLog()
        },
      },
    })

    await writer.ctl.selectDirectory()
    await reader.ctl.start()

    const canonical = textOf(mem.files.get(CANONICAL_NAME))
    const logged = textOf(writerLog.bytes ?? undefined)
    expect(canonical).not.toContain(writerLabel)
    expect(canonical).not.toContain(readerLabel)
    expect(canonical).not.toContain('startedAt')
    expect(logged).not.toContain(writerLabel)
    expect(logged).not.toContain('startedAt')
    expect(logged).not.toContain('开始写')
    const readerText = reader.ctl.snapshot().view.messages.join('\n')
    expect(readerText).toContain(MSG_OTHER_TAB)
    expect(readerText).toContain(writerLabel)
    expect(readerText).toContain(CANONICAL_NAME)
    expect(readerText).not.toContain(readerLabel)
    expect(readerLogs).toBe(0)
    expect(reader.ctl.snapshot().view.canEdit).toBe(false)
  })

  it('无 showDirectoryPicker：自动保存路径会要求「正本要另存」；取消则停止编辑且不更新日志', async () => {
    let saveAs = 0
    let first = 0
    const h = harness({
      ports: {
        hasDirectoryPicker: false,
        askFirstDownload: async () => {
          first += 1
          return true
        },
        askSaveAs: async () => {
          saveAs += 1
          return false
        },
      },
    })
    await h.ctl.selectDirectory()
    expect(first).toBe(1)
    expect(saveAs).toBe(0)
    expect(h.ctl.snapshot().view.canEdit).toBe(true)
    const writes = h.log.writes.length
    await h.ctl.mutate((state) => createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '另存这一笔' }))
    expect(saveAs).toBe(1)
    expect(h.log.writes).toHaveLength(writes)
    expect(textOf(h.log.bytes ?? undefined)).not.toContain('另存这一笔')
    expect(h.ctl.snapshot().view.canEdit).toBe(false)
    expect(h.ctl.snapshot().view.messages).toContain(MSG_WRITE_FAILED)
    expect(h.ctl.snapshot().state.snowflake.cards.c1?.body).toContain('另存这一笔')
    expect(MSG_SAVE_AS).toBe('正本要另存')
    expect(SAVE_AS_WARNING).toContain('下载开始后不要在浏览器里取消')
    expect(SAVE_AS_WARNING).toContain('必须停止编辑，下次打开会看到上一份正本')
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).toContain('MSG_SAVE_AS')
    expect(app).toContain('SAVE_AS_WARNING')
  })

  it('日志初始化失败：正本改名或下载已成功时，编辑仍可在再次授权后继续，且界面有「恢复日志不可用」', async () => {
    let logCalls = 0
    const h = harness({
      ports: {
        logFactory: async () => {
          logCalls += 1
          throw new Error('sahpool failed')
        },
      },
    })
    const requestsBefore = h.calls.request
    await h.ctl.selectDirectory()
    expect(logCalls).toBe(1)
    expect(parseCompleteDocument(h.mem.files.get(CANONICAL_NAME)!)).not.toBeNull()
    expect(h.mem.events.some((event) => event.startsWith('move:'))).toBe(true)
    expect(h.log.writes).toHaveLength(0)
    expect(h.ctl.snapshot().view.canEdit).toBe(true)
    expect(h.ctl.snapshot().view.messages).toContain(MSG_LOG_DOWN)
    expect(h.ctl.snapshot().view.messages).not.toContain(MSG_WRITE_FAILED)

    h.setPermission('prompt')
    await h.ctl.refresh()
    expect(h.calls.request).toBe(requestsBefore)
    expect(h.ctl.snapshot().view.needPermission).toBe(true)
    expect(h.ctl.snapshot().view.canEdit).toBe(false)

    h.setPermission('granted')
    await h.ctl.requestPermission()
    expect(h.calls.request).toBe(requestsBefore + 1)
    expect(h.ctl.snapshot().view.canEdit).toBe(true)
    expect(h.ctl.snapshot().view.messages).toContain(MSG_LOG_DOWN)
    expect(h.ctl.snapshot().view.messages).not.toContain(MSG_WRITE_FAILED)
    expect(parseCompleteDocument(h.mem.files.get(CANONICAL_NAME)!)).not.toBeNull()

    const downloaded = harness({
      ports: {
        hasDirectoryPicker: false,
        logFactory: async () => {
          throw new Error('sahpool failed')
        },
        askFirstDownload: async () => true,
      },
    })
    await downloaded.ctl.selectDirectory()
    expect(downloaded.ctl.snapshot().view.canEdit).toBe(true)
    expect(downloaded.ctl.snapshot().view.messages).toContain(MSG_LOG_DOWN)
    expect(downloaded.log.writes).toHaveLength(0)
  })

  it('file:// 拒绝进入编辑，并说明要用 http://127.0.0.1 打开', async () => {
    let logs = 0
    const h = harness({
      ports: {
        protocol: 'file:',
        logFactory: async () => {
          logs += 1
          return new FakeLog()
        },
      },
    })
    await h.ctl.start()
    expect(h.ctl.snapshot().view.canEdit).toBe(false)
    expect(h.ctl.snapshot().view.fileProtocol).toBe(true)
    expect(h.ctl.snapshot().view.messages.join('\n')).toContain('http://127.0.0.1')
    expect(h.ctl.snapshot().view.messages.join('\n')).toContain(MSG_FILE_PROTOCOL)
    expect(logs).toBe(0)
    await h.ctl.selectDirectory()
    expect(h.mem.files.size).toBe(0)
  })

  it('另存模式第二个标签打开同一份正本时只读，即使本标签还能拿到锁', async () => {
    const channel = createMemoryChannel()
    const bytes = documentToBytes(
      createCard(createDocument('same-file'), {
        id: 'c1',
        layer: 'situation',
        x: 0,
        y: 0,
        body: '已有',
      }),
    )
    const first = harness({
      channel,
      ports: { hasDirectoryPicker: false },
    })
    const second = harness({
      channel,
      ports: {
        hasDirectoryPicker: false,
        tryAcquireLock: async () => ({ release() {} }),
      },
    })
    await first.ctl.openLocalFile(bytes, 'snowflake.json')
    expect(first.ctl.snapshot().view.canEdit).toBe(true)
    await second.ctl.openLocalFile(bytes, 'snowflake.json')
    expect(second.ctl.snapshot().view.readonlyOther).toBe(true)
    expect(second.ctl.snapshot().view.canEdit).toBe(false)
    expect(second.ctl.snapshot().view.messages.join('\n')).toContain(MSG_OTHER_TAB)
    await second.ctl.commitText('c1', null, '第二页不该写下')
    expect(second.ctl.snapshot().state.snowflake.cards.c1?.body).toBe('已有')
    expect(first.ctl.snapshot().view.canEdit).toBe(true)
  })

  it('源码不得对正本调用 createWritable，也不把 localStorage 当恢复日志', () => {
    const source = readSources()
    const receivers = [...source.matchAll(/(\w+)\.createWritable\s*\(/g)].map((match) => match[1])
    // 正本仍只经 tempHandle 写入。suggestionFile 是作者另存的建议包，不是画布正本。
    expect(receivers.filter((name) => name === 'tempHandle')).toEqual(['tempHandle'])
    expect(receivers.filter((name) => name === 'suggestionFile')).toEqual(['suggestionFile'])
    expect(receivers).toHaveLength(2)
    expect(source).not.toContain('fileHandle.createWritable')
    expect(source).not.toMatch(/localStorage/)
    expect(source).not.toMatch(/\bpauseVfs\b/)
    expect(source).not.toMatch(/\bunpauseVfs\b/)
    expect(source).not.toMatch(/['"]opfs['"]/)
    expect(source).not.toMatch(/oo1\.OpfsDb/)
    expect(source).not.toMatch(/\/api\/commit|\/api\/paste|\/api\/suggest|\/api\/drafts\/patch/)
    expect(source).toContain('installOpfsSAHPoolVfs')
    expect(source).toContain('opfs-sahpool')
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).not.toMatch(/<SideEditor[^>]*key=/)
  })
})
