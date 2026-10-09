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

describe('讨论按钮单行，放不下才收进这一排的更多', () => {
  const css = read('src/index.css')
  const discuss = read('src/CardDiscuss.tsx')

  it('下拉可缩，两个按钮不换行也不收缩', () => {
    expect(css).not.toContain('flex: 1 1 100%')
    const buttons = css.slice(css.indexOf('.discuss-history > .history-btn'), css.indexOf('.history-more {'))
    expect(buttons).toContain('flex: none')
    expect(buttons).toContain('white-space: nowrap')
    const shrink = '.discuss-history select {\n  min-width: 0;'
    expect(css).toContain(shrink)
    expect(css.indexOf('text-overflow: ellipsis')).toBeGreaterThan(css.indexOf(shrink))
    expect(discuss).toContain('新建讨论')
    expect(discuss).toContain('history-more')
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
    expect(discuss).toContain('采纳进本念头')
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

  it('拖左缘不算点到抽屉外面', () => {
    const edge = {
      closest: (selector: string) =>
        selector === '.drawer-resizer' || selector === '.side-stack' ? { getAttribute: () => null } : null,
    }
    expect(pointerCloses(edge, 'card-a')).toBe(false)
  })

  it('窄屏仍盖住画布且不出现拖条，宽屏抽屉才相对定位', () => {
    const narrow = mediaBlock(css, '(max-width: 760px)')
    expect(narrow).toContain('position: absolute')
    expect(narrow).toContain('width: min(380px, 100%)')
    expect(narrow).toContain('right: 0')
    expect(narrow).not.toContain('drawer-resizer')
    const wide = mediaBlock(css, '(min-width: 761px)')
    expect(wide).toContain('position: relative')
  })
})
