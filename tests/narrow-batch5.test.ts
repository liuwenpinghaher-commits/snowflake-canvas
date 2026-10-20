import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCard, createDocument } from '../src/document.ts'
import {
  MSG_CANON_MISMATCH,
  MSG_LOG_DOWN,
  MSG_SAVE_AS_LATER,
  MSG_SNAPSHOT_FAILED,
  MSG_USE_LOOPBACK,
  MSG_VERSION_MOVED,
  MSG_WRITE_FAILED,
  MSG_WRITING,
  SAVE_AS_INTERVAL_MS,
  createMemoryChannel,
  createPersistController,
  documentToBytes,
  statusKind,
  type PersistPorts,
  type RecoveryLog,
} from '../src/persist.ts'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media ${query}`)
  expect(start).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(start, i + 1)
    }
  }
  throw new Error('media 块没有闭合')
}

function ruleBody(block: string, selector: string): string {
  const at = block.indexOf(`${selector} {`)
  expect(at).toBeGreaterThanOrEqual(0)
  return block.slice(at, block.indexOf('}', at))
}

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = source.indexOf('\nfunction ', start + 1)
  const nextExport = source.indexOf('\nexport ', start + 1)
  const ends = [next, nextExport].filter((at) => at > 0)
  return source.slice(start, ends.length > 0 ? Math.min(...ends) : undefined)
}

describe('窄屏画布不再被钉成 160px', () => {
  it('max-width 760px 下画布不再被钉成 160px，控制区在底部，会话不盖住整块画布', () => {
    const narrow = mediaBlock(read('src/index.css'), '(max-width: 760px)')
    const canvas = ruleBody(narrow, '.canvas-wrap')
    expect(canvas).not.toMatch(/160px/)
    expect(canvas).not.toMatch(/55vh|55dvh/)
    expect(canvas).toMatch(/min-height:\s*0/)
    expect(canvas).not.toContain('position: absolute')
    const control = ruleBody(narrow, '.control-pane')
    expect(control).toContain('order: 2')
    expect(control).toContain('width: 100%')
    expect(control).not.toContain('position: absolute')
    const session = ruleBody(narrow, '.session-pane')
    expect(session).toContain('order: 1')
    expect(session).toContain('width: 100%')
    expect(session).not.toContain('position: absolute')
  })

  it('打开页面卡片量好尺寸后自动看一次全稿，只看一次', () => {
    const flow = read('src/FlowCanvas.tsx')
    expect(flow).toContain('state.nodeLookup.size')
    const effect = flow.slice(flow.indexOf('const fittedOnce'), flow.indexOf('}, [nodesReady'))
    expect(effect).toContain('fittedOnce.current = true')
    expect(effect).toContain('getViewportForBounds(')
    expect(effect).toContain('nodes.length === 0')
  })
})

describe('讨论在右侧抽屉里，不再贴着卡片', () => {
  const flow = read('src/FlowCanvas.tsx')
  const app = read('src/App.tsx')
  const css = read('src/index.css')

  it('SnowCard 里没有讨论浮窗，节点数据里也不再带讨论', () => {
    const card = functionBody(flow, 'SnowCard')
    expect(card).not.toContain('DiscussDock')
    expect(card).not.toContain('data.discuss')
    expect(flow).not.toContain('DiscussDock')
    expect(flow).not.toContain('createPortal')
  })

  it('双击卡片不再把讨论挂到 document.body，讨论渲染在抽屉里', () => {
    expect(flow).not.toContain("from 'react-dom'")
    const dbl = flow.slice(flow.indexOf('onNodeDoubleClick'), flow.indexOf('onConnect='))
    expect(dbl).not.toContain('onOpenDiscuss')
    expect(dbl).toContain('preventDefault()')
    expect(app).toContain('<CardDiscuss')
    expect(app).toContain('className="discuss-dock"')
    expect(app).toContain('aria-label={`讨论：${discussName}`}')
    expect(app).toContain('state.activeId !== dismissedId')
    const dock = ruleBody(css, '.discuss-dock')
    expect(dock).not.toContain('position: absolute')
    expect(dock).not.toContain('position: fixed')
    expect(dock).toContain('flex: 1 1 auto')
    expect(css).not.toContain('discuss-sheet')
  })

  it('窄屏会话单独一块，控制区仍能关闭', () => {
    const narrow = mediaBlock(css, '(max-width: 760px)')
    expect(narrow).toContain('side-drawer-in')
    expect(narrow).not.toContain('position: absolute')
    expect(css).toContain('translateX(100%)')
    expect(app).toContain('关闭')
    expect(app).toContain('closeDrawer')
    expect(app).toContain('control-pane')
    expect(app).toContain('session-pane')
  })
})

describe('报错按类型着色', () => {
  it('SideEditor 不再监听整页改文字', () => {
    const side = read('src/SideEditor.tsx')
    expect(side).not.toMatch(/new\s+MutationObserver/)
    expect(side).not.toContain('.status-line')
  })

  it('写入控制器给状态分出错和普通两类', () => {
    for (const text of [MSG_WRITE_FAILED, MSG_VERSION_MOVED, MSG_SNAPSHOT_FAILED, MSG_LOG_DOWN, MSG_CANON_MISMATCH]) {
      expect(statusKind(text)).toBe('error')
    }
    expect(statusKind('回退失败')).toBe('error')
    expect(statusKind('gbrain 不可用，稍后再试')).toBe('error')
    expect(statusKind('留下这一版失败：磁盘满了')).toBe('error')
    for (const text of [MSG_WRITING, '正本在服务器', '版本 12', '已留下这一版，快照 3 份', MSG_SAVE_AS_LATER, MSG_USE_LOOPBACK]) {
      expect(statusKind(text)).toBe('info')
    }
  })

  it('App 按类型渲染：出错行加 is-error 和「出错：」前缀，普通行不加', () => {
    const app = read('src/App.tsx')
    expect(app).toContain('view.notices.map(')
    expect(app).toMatch(/notice\.kind === 'error'[\s\S]*className="status-line is-error"[\s\S]*出错：\{notice\.text\}/)
    expect(app).not.toContain('view.messages.map(')
  })
})

class FakeLog implements RecoveryLog {
  bytes: Uint8Array | null = null
  writes = 0
  async read(): Promise<Uint8Array | null> {
    return this.bytes ? this.bytes.slice() : null
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes.slice()
    this.writes += 1
  }
}

function downloadHarness() {
  const clock = { at: new Date(2026, 9, 9, 12, 0, 0).getTime() }
  const log = new FakeLog()
  let saveAs = 0
  const ports: PersistPorts = {
    protocol: 'http:',
    hasDirectoryPicker: false,
    now: () => new Date(clock.at),
    loadDirectory: async () => null,
    pickDirectory: async () => 'abort',
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    logFactory: async () => log,
    tryAcquireLock: async () => ({ release() {} }),
    lockHeld: async () => false,
    channel: createMemoryChannel(),
    claim: { get: () => null, set: () => {} },
    askSaveAs: async () => {
      saveAs += 1
      return true
    },
    askFirstDownload: async () => true,
    randomId: () => 'file-batch5',
  }
  const ctl = createPersistController(ports)
  return { ctl, log, clock, saveAsCount: () => saveAs }
}

describe('另存模式自动保存按间隔提示下载', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('60 秒内连续自动保存只弹一次下载；间隔内状态行说明稍后再提示，并请作者改用 127.0.0.1:8093', async () => {
    expect(SAVE_AS_INTERVAL_MS).toBeGreaterThanOrEqual(60_000)
    const h = downloadHarness()
    const doc = createCard(createDocument('file-batch5'), { id: 'c1', layer: 'situation', x: 0, y: 0, body: '甲' })
    await h.ctl.openLocalFile(documentToBytes(doc), 'snowflake.json')
    // 打开文件时有一个 200ms 的跨标签探测计时器，打开之后再换成假计时器。
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect(h.ctl.snapshot().view.downloadMode).toBe(true)
    expect(h.ctl.snapshot().view.messages.join('\n')).toContain('http://127.0.0.1:8093')
    const before = h.saveAsCount()

    await h.ctl.commitText('c1', null, '乙')
    expect(h.saveAsCount()).toBe(before + 1)

    h.clock.at += 5_000
    await h.ctl.commitText('c1', null, '丙')
    h.clock.at += 20_000
    await h.ctl.commitText('c1', null, '丁')
    expect(h.saveAsCount()).toBe(before + 1)
    const view = h.ctl.snapshot().view
    expect(view.canEdit).toBe(true)
    expect(view.messages).toContain(MSG_SAVE_AS_LATER)
    expect(view.messages).not.toContain(MSG_WRITE_FAILED)
    expect(view.notices.find((item) => item.text === MSG_SAVE_AS_LATER)?.kind).toBe('info')
    expect(new TextDecoder().decode(h.log.bytes ?? undefined)).toContain('丁')

    // 到点后自己再提示一次，按最新画布下载。
    h.clock.at += SAVE_AS_INTERVAL_MS
    await vi.advanceTimersByTimeAsync(SAVE_AS_INTERVAL_MS)
    for (let i = 0; i < 20 && h.ctl.snapshot().view.writing; i += 1) await Promise.resolve()
    expect(h.saveAsCount()).toBe(before + 2)
    expect(h.ctl.snapshot().view.messages).not.toContain(MSG_SAVE_AS_LATER)
    h.ctl.dispose()
  })
})

describe('README 不再是 Vite 模板', () => {
  it('第一行是雪花画布，写清开发页、8093、正本和讨论会话，不留模板段落', () => {
    const readme = read('README.md')
    const first = readme.split('\n')[0]
    expect(first).not.toMatch(/React \+ TypeScript \+ Vite/)
    expect(first).toContain('雪花画布')
    expect(readme).toContain('npm run dev')
    expect(readme).toContain('8093')
    expect(readme).toContain('~/.local/share/snowflake-canvas/')
    expect(readme).toContain('snowflake.json')
    expect(readme).toContain('session.json')
    expect(readme).not.toContain('React Compiler')
    expect(readme).not.toMatch(/Oxlint/i)
  })
})

describe('验收脚本收尾删掉自己建的讨论会话', () => {
  it('accept-discuss / accept-mem 结束时都调用清理脚本', () => {
    for (const path of ['scripts/accept-discuss.sh', 'scripts/accept-mem.sh']) {
      const script = read(path)
      expect(script).toContain('drop_accept_sessions.py')
      expect(script).toMatch(/finally:\n\s+drop_accept_sessions\(\)/)
    }
    const helper = read('scripts/drop_accept_sessions.py')
    expect(helper).toContain('ACCEPT_PREFIXES = ("n-discuss-accept-", "n-mem-accept-")')
  })

  it('清理脚本只删名单里、带验收前缀、正本里已没有的卡片会话', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-batch5-'))
    const bucket = (id: string) => ({ lastSessionId: `s-${id}`, sessions: [{ sessionId: `s-${id}`, cardId: id }] })
    writeFileSync(
      join(dir, 'snowflake.json'),
      JSON.stringify({ document: { canvas: { nodes: [{ id: 'n-discuss-accept-c' }] }, snowflake: { cards: {} } } }),
    )
    writeFileSync(
      join(dir, 'session.json'),
      JSON.stringify({
        cards: {
          n1: bucket('n1'),
          'n-discuss-accept-a': bucket('n-discuss-accept-a'),
          'n-discuss-accept-c': bucket('n-discuss-accept-c'),
          'n-mem-accept-situation': bucket('n-mem-accept-situation'),
        },
      }),
    )
    const out = execFileSync(
      'python3',
      ['scripts/drop_accept_sessions.py', 'n1', 'n-discuss-accept-a', 'n-discuss-accept-c', 'n-mem-accept-situation'],
      { cwd: root, env: { ...process.env, SNOWFLAKE_DATA_DIR: dir }, encoding: 'utf8' },
    )
    expect(out).toContain('n-discuss-accept-a')
    const left = Object.keys(JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')).cards).sort()
    expect(left).toEqual(['n-discuss-accept-c', 'n1'])
    rmSync(dir, { recursive: true, force: true })
  })
})
