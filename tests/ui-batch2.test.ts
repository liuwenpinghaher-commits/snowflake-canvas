import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pointerCloses } from '../src/CardDiscuss.tsx'
import {
  DRAWER_WIDTH_DEFAULT,
  DRAWER_WIDTH_KEY,
  DRAWER_WIDTH_MAX,
  DRAWER_WIDTH_MIN,
  readDrawerWidth,
} from '../src/App.tsx'

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

describe('历史讨论和新建讨论收在会话顶部一条', () => {
  const css = read('src/index.css')
  const discuss = read('src/CardDiscuss.tsx')

  it('同一条里放下拉和新建，不再按宽度折进更多', () => {
    expect(css).not.toContain('flex: 1 1 100%')
    const tabs = css.slice(css.indexOf('.session-tabs {'), css.indexOf('}', css.indexOf('.session-tabs {')))
    expect(tabs).toContain('flex-wrap: nowrap')
    expect(tabs).toContain('font-size: 14px')
    expect(css).toContain('.session-tabs select {')
    expect(css).toContain('text-overflow: ellipsis')
    expect(discuss).toContain('session-tabs')
    expect(discuss).toContain('历史讨论')
    expect(discuss).toContain('新建讨论')
    expect(discuss).not.toContain('history-more')
    expect(discuss).toContain('关闭')
  })
})

describe('会话是日志行，不再左右分叉', () => {
  const css = read('src/index.css')
  const discuss = read('src/CardDiscuss.tsx')

  it('没有气泡和圆头像，人名仍是我和 AI', () => {
    expect(discuss).not.toContain('bubble-row')
    expect(discuss).not.toContain('bubble-actions')
    expect(discuss).not.toContain('className="bubble"')
    expect(discuss).not.toContain('className="avatar"')
    expect(discuss).toContain('className="log-row"')
    expect(discuss).toContain("mine ? '我' : 'AI'")
    expect(discuss).toContain('采纳进本卡片')
    expect(discuss).toContain('写入脑')
    expect(discuss).toContain('重试')
    expect(discuss).toContain('已采纳')
    expect(css).not.toContain('.bubble')
    expect(css).not.toContain('.avatar')
    expect(css).not.toContain('row-reverse')
  })
})

describe('抽屉宽度记在 snowflake-drawer-width', () => {
  const css = read('src/index.css')
  const app = read('src/App.tsx')

  it('键名、范围和非法值', () => {
    expect(DRAWER_WIDTH_KEY).toBe('snowflake-drawer-width')
    expect(DRAWER_WIDTH_MIN).toBe(380)
    expect(DRAWER_WIDTH_MAX).toBe(520)
    expect(DRAWER_WIDTH_DEFAULT).toBe(380)
    expect(app).toContain("localStorage.setItem(DRAWER_WIDTH_KEY")
    expect(app).toContain('调节讨论抽屉宽度')
    expect(app).toContain('closeDrawer')
    expect(readDrawerWidth(null)).toBe(380)
    expect(readDrawerWidth(undefined)).toBe(380)
    expect(readDrawerWidth('')).toBe(380)
    expect(readDrawerWidth('   ')).toBe(380)
    expect(readDrawerWidth('abc')).toBe(380)
    expect(readDrawerWidth('NaN')).toBe(380)
    expect(readDrawerWidth('520px')).toBe(380)
    expect(readDrawerWidth('10')).toBe(380)
    expect(readDrawerWidth('319')).toBe(380)
    expect(readDrawerWidth('521')).toBe(380)
    expect(readDrawerWidth('721')).toBe(380)
    expect(readDrawerWidth('900')).toBe(380)
    expect(readDrawerWidth('379')).toBe(380)
    expect(readDrawerWidth('380')).toBe(380)
    expect(readDrawerWidth('520')).toBe(520)
    expect(readDrawerWidth('720')).toBe(380)
    expect(readDrawerWidth(' 400 ')).toBe(400)
    expect(readDrawerWidth('519.6')).toBe(520)
  })

  it('拖左缘不算点到会话外面', () => {
    const edge = {
      closest: (selector: string) =>
        selector === '.drawer-resizer' || selector === '.session-pane' ? { getAttribute: () => null } : null,
    }
    expect(pointerCloses(edge, 'card-a')).toBe(false)
  })

  it('窄屏控制条在底部且不出现拖条，宽屏会话面板相对定位', () => {
    const narrow = mediaBlock(css, '(max-width: 760px)')
    expect(narrow).toContain('.control-pane')
    expect(narrow).toContain('order: 2')
    expect(narrow).not.toContain('position: absolute')
    expect(narrow).not.toContain('drawer-resizer')
    const wide = mediaBlock(css, '(min-width: 761px)')
    expect(wide).toContain('position: relative')
  })
})
