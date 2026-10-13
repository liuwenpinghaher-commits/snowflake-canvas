import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LINE_HEIGHT_DEFAULT, readLineHeight } from '../src/App.tsx'
import { readImportFile, statsOfDocument } from '../src/books.ts'
import { MarkdownText } from '../src/markdown-lite.tsx'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const md = (text: string) => renderToStaticMarkup(createElement(MarkdownText, { text }))

describe('讨论 Markdown 补表格、引用、删除线、任务列表', () => {
  it('表格整表包在可横向滚动的容器里', () => {
    const html = md('| 人物 | 动机 |\n| --- | :---: |\n| 柳岸青 | 找到 **石门** |\n| 老周 |')
    expect(html).toContain('<div class="md-table-wrap"><table>')
    expect(html).toContain('<th>人物</th><th>动机</th>')
    expect(html).toContain('<td>柳岸青</td><td>找到 <strong>石门</strong></td>')
    expect(html).toContain('<td>老周</td><td></td>')
  })

  it('引用、删除线', () => {
    const html = md('> 第一行\n> 第二行 ~~删掉~~\n\n正文')
    expect(html).toContain('<blockquote><p>第一行<br/>第二行 <del>删掉</del></p></blockquote>')
    expect(html).toContain('<p>正文</p>')
  })

  it('任务列表只显示勾没勾，不能改', () => {
    const html = md('- [x] 定主角\n- [ ] 定反派\n- 普通项')
    expect(html).toContain('<ul class="md-tasks">')
    expect(html).toMatch(/<li class="md-task is-done"><input type="checkbox" disabled="" readOnly="" aria-label="已完成" checked=""\/>/)
    expect(html).toContain('aria-label="未完成"')
    expect(html).toContain('<li>普通项</li>')
  })

  it('代码块首行语言名只当标签，链接仍只放 http/https，不出原始 HTML', () => {
    const html = md('```ts\nconst a = 1\n```\n[坏](javascript:alert(1)) <b>x</b>')
    expect(html).toContain('<span class="md-code-lang">ts</span><code>const a = 1</code>')
    expect(html).not.toContain('href="javascript')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('正文 14px，行高走可调变量，标题 16/15/14', () => {
    const css = read('src/index.css')
    const dock = css.slice(css.indexOf('.discuss-dock {'), css.indexOf('}', css.indexOf('.discuss-dock {')))
    expect(dock).toContain('font-size: 14px')
    expect(dock).toContain('line-height: var(--discuss-line-height, 1.5)')
    expect(css).toContain('.md h3 { font-size: 16px; }')
    expect(css).toContain('.md h4 { font-size: 15px; }')
    expect(css).toContain('.md h5 { font-size: 14px; }')
    expect(readLineHeight('1.7')).toBe(1.7)
    expect(readLineHeight('2')).toBe(LINE_HEIGHT_DEFAULT)
    expect(readLineHeight(null)).toBe(LINE_HEIGHT_DEFAULT)
  })
})

describe('控制卡和会话分开，字段和讨论之间不再拖高', () => {
  it('卡头和字段在左栏，讨论在右侧会话，源码里不再挂拖高把手', () => {
    const app = read('src/App.tsx')
    const control = app.slice(app.indexOf('control-pane'), app.indexOf('session-pane'))
    const session = app.slice(app.indexOf('session-pane'))
    expect(control).toContain('className="drawer-head card-head"')
    expect(control).toContain('<SideEditor')
    expect(control).not.toContain('<CardDiscuss')
    expect(session).toContain('<CardDiscuss')
    expect(session).not.toContain('<SideEditor')
    expect(app).not.toContain('<SplitResizer')
    expect(app).not.toContain('split-resizer')
    expect(app).not.toContain('aria-label="调节字段区和讨论区的高度"')
    expect(app).not.toContain('side-fields-toggle')
    expect(app).toContain('讨论行高')
  })
})

describe('书籍页统计和导入预览', () => {
  it('按卡片正文算字数，空卡单独数', () => {
    const stats = statsOfDocument({
      canvas: { nodes: [] },
      snowflake: { cards: { a: { layer: 'situation', body: '山 洞\n考古' }, b: { layer: '一句话', body: '' } } },
    })
    expect(stats.words).toBe(4)
    expect(stats.cards).toBe(2)
    expect(stats.emptyCards).toBe(1)
    expect(stats.layers).toEqual({ situation: 1, 一句话: 1 })
  })

  it('导入认信封和裸正本，读不出画布就拒绝', () => {
    const doc = { canvas: { nodes: [{ type: 'text', text: '卡片' }], edges: [] } }
    expect(readImportFile(JSON.stringify({ version: 3, document: doc }))?.stats.words).toBe(2)
    expect(readImportFile(JSON.stringify(doc))?.stats.cards).toBe(1)
    expect(readImportFile('{"a":1}')).toBeNull()
    expect(readImportFile('不是 JSON')).toBeNull()
  })

  it('新建书走四步向导，不再弹 prompt', () => {
    const app = read('src/App.tsx')
    const page = read('src/BooksPage.tsx')
    expect(app).not.toContain('window.prompt')
    expect(page).toContain("['设定导入', '默认值', '名称和题材', '建书']")
  })
})

describe('卡片默认折叠到 160px，展开后不限高', () => {
  it('.side-face 限高可滚动，.side-face.is-open 取消限高', () => {
    const css = read('src/index.css')
    const rule = (selector: string) => {
      const escaped = selector.replace(/\./g, '\\.')
      const match = css.match(new RegExp('(?:^|[\\n}])\\s*' + escaped + '\\s*\\{([^}]*)\\}'))
      return match ? match[1] : null
    }
    const face = rule('.side-face')
    const open = rule('.side-face.is-open')
    expect(face).toMatch(/max-height:\s*160px/)
    expect(face).toMatch(/overflow:\s*auto/)
    expect(open).toMatch(/max-height:\s*none/)
  })
})
