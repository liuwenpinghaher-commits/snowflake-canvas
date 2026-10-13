import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MSG_WRITE_FAILED, MSG_WRITE_FAILED_SERVER, statusKind } from '../src/persist.ts'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(selector)
  expect(at).toBeGreaterThanOrEqual(0)
  return css.slice(at, css.indexOf('}', at))
}

describe('界面审查第 2 轮：保存失败、键盘、动效、换行', () => {
  const app = read('src/App.tsx')
  const css = read('src/index.css')
  const persist = read('src/persist.ts')

  it('写入失败对用户说没保存到服务器，状态条可以重试', () => {
    expect(MSG_WRITE_FAILED_SERVER).toBe('没保存到服务器。刚才的改动还在这页里，先别关页面。')
    expect(MSG_WRITE_FAILED_SERVER).not.toContain('文件')
    expect(MSG_WRITE_FAILED).not.toBe('文件没写上')
    expect(persist).not.toContain('文件没写上')
    expect(persist).toContain('this.remoteMode ? MSG_WRITE_FAILED_SERVER : MSG_WRITE_FAILED')
    expect(persist).toContain('async retryWrite()')
    expect(statusKind(MSG_WRITE_FAILED_SERVER)).toBe('error')
    expect(statusKind(MSG_WRITE_FAILED)).toBe('error')
    expect(app).toContain('重试保存')
    expect(app).toContain('retryWrite()')
    expect(app).toContain('view.stopped && (notice.text === MSG_WRITE_FAILED || notice.text === MSG_WRITE_FAILED_SERVER)')
  })

  it('讨论抽屉拖条能用键盘左右调 10 像素', () => {
    const drawer = app.slice(app.indexOf('function DrawerResizer'), app.indexOf('type SaveDialog'))
    expect(drawer).toContain('tabIndex={0}')
    expect(drawer).toContain("event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'")
    expect(drawer).toContain('clampDrawerWidth(width + (event.key === \'ArrowRight\' ? 10 : -10))')
    expect(drawer).toContain('onWidth(next)')
    expect(css).toContain('.drawer-resizer:focus-visible::after {')
    expect(css).toMatch(/\.drawer-resizer:focus-visible::after \{[^}]*background:\s*var\(--state-focus\)/)
  })

  it('窄屏滑入只在不减少动态效果时播放', () => {
    const decl = 'animation: side-drawer-in 160ms ease-out'
    const at = css.indexOf(decl)
    expect(at).toBeGreaterThan(0)
    expect(css.indexOf(decl, at + 1)).toBe(-1)
    const media = css.lastIndexOf('@media (prefers-reduced-motion: no-preference)', at)
    expect(media).toBeGreaterThan(0)
    expect(at - media).toBeLessThan(120)
  })

  it('冲突选择行可以换行，最多六行高', () => {
    const body = ruleBody(css, '.conflict-choice-line {')
    expect(body).not.toContain('nowrap')
    expect(body).not.toContain('ellipsis')
    expect(body).toContain('max-height: 6lh')
    expect(body).toContain('overflow: auto')
  })
})

describe('界面审查第 2 轮：其余条目', () => {
  const app = read('src/App.tsx')
  const css = read('src/index.css')
  const discuss = read('src/CardDiscuss.tsx')
  const side = read('src/SideEditor.tsx')
  const books = read('src/books.ts')
  const page = read('src/BooksPage.tsx')

  it('讨论区不再标成对话框，不再单独放一个关闭', () => {
    const pop = discuss.slice(discuss.indexOf('className="discuss-popover"'), discuss.indexOf('className="discuss-popover"') + 160)
    expect(pop).not.toContain('role="dialog"')
    expect(pop).not.toContain('aria-label')
    expect(discuss).not.toContain('onClick={onClose}')
    expect(discuss).not.toContain('onClick={() => requestClose()}')
  })

  it('更多面板不再标成菜单', () => {
    expect(app).not.toContain('role="menu"')
    expect(app).not.toContain('aria-haspopup')
    expect(app).toContain('aria-expanded={open}')
    expect(app).toContain('aria-controls={id}')
    expect(app).toContain('id="version-menu-pop"')
    expect(app).toContain('id="books-menu-pop"')
    expect(app).toContain('id="settings-menu-pop"')
    expect(discuss).not.toContain('role="menu"')
    expect(discuss).not.toContain('aria-haspopup')
    if (discuss.includes('history-more-pop')) {
      expect(discuss).toContain('aria-expanded={menuOpen}')
      expect(discuss).toContain('aria-controls="history-more-pop"')
    }
  })

  it('编辑器紧跟选字段，改层、折叠、扩写在编辑器下面', () => {
    const host = side.indexOf('className="cm-host"')
    expect(side.indexOf('<FieldButtons')).toBeLessThan(host)
    expect(host).toBeLessThan(side.indexOf('改成更后面的层'))
    expect(host).toBeLessThan(side.indexOf('<FoldPanel'))
    expect(side.indexOf('<FoldPanel')).toBeLessThan(side.indexOf('<ExpandPanel'))
  })

  it('四类输入边框改用更深的灰色，按钮边框不动', () => {
    for (const selector of ['.fold-field input', '.snap-select {', '.discuss-popover textarea', '.books-page textarea {']) {
      const body = ruleBody(css, selector)
      expect(body).toContain('#6b645b')
      expect(body).not.toContain('#c8bfb0')
    }
    expect(css).toContain('border: 1px solid #c8bfb0')
  })

  it('没有卡片时提示一直在，并且能新建念头', () => {
    expect(app).toContain('const noCards = Object.keys(state.snowflake.cards).length === 0')
    expect(app).toContain('{noCards || hintOpen ? (')
    const hint = app.slice(app.indexOf('className="canvas-hint"'), app.indexOf('className="canvas-hint"') + 500)
    expect(hint).toContain('新建念头')
    expect(hint).toContain('createThought')
    expect(hint).toContain('知道了')
  })

  it('封面色按钮读中文名', () => {
    expect(books).toContain("'#8c4a32': '赭红'")
    expect(books).toContain("'#3f6b5a': '墨绿'")
    expect(books).toContain("'#35557a': '靛蓝'")
    expect(books).toContain("'#7a4a6b': '绛紫'")
    expect(books).toContain("'#a0782c': '琥珀'")
    expect(books).toContain("'#5e574e': '岩灰'")
    expect(page).toContain('aria-label={COVER_COLOR_NAMES[color]}')
    expect(page).not.toContain('aria-label={color}')
  })

  it('画布主体是 main，并有当前书名的标题', () => {
    expect(app).toContain('<main className="workspace">')
    expect(app).not.toContain('<div className="workspace">')
    expect(app).toContain('<h1 className="sr-only">{currentBook?.name || \'未命名书\'}</h1>')
    const hidden = ruleBody(css, '.sr-only {')
    expect(hidden).toContain('position: absolute')
    expect(hidden).toContain('clip: rect(0, 0, 0, 0)')
    expect(hidden).not.toContain('display: none')
  })
})
