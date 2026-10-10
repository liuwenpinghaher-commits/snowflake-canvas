import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BODY_LINE_CAP,
  COLUMN_GAP,
  EXPAND_CHROME_PX,
  discussCardName,
  estimateSnowCardHeight,
  shiftOverlappingCards,
  snowBodyOverflows,
  type ShiftBox,
} from '../src/card-layout.ts'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function card(partial: Partial<ShiftBox> & Pick<ShiftBox, 'id' | 'x' | 'y' | 'height' | 'prevHeight'>): ShiftBox {
  return {
    width: 280,
    kind: 'card',
    ...partial,
  }
}

describe('卡片正文按 12 行封顶', () => {
  it('收起最多约 12 行，展开不再把正文永远锁在 12 行', () => {
    expect(BODY_LINE_CAP).toBe(12)
    const css = read('src/index.css')
    expect(css).not.toContain('line-clamp')
    const bodyStart = css.indexOf('.snow-body {')
    expect(bodyStart).toBeGreaterThan(-1)
    const body = css.slice(bodyStart, css.indexOf('}', bodyStart))
    expect(body).not.toContain('max-height: 160px')
    expect(body).not.toContain('max-height: calc(1.5em * 12)')
    expect(body).not.toContain('overflow-y: auto')
    const collapsedStart = css.indexOf('.snow-body.is-collapsed')
    expect(collapsedStart).toBeGreaterThan(bodyStart)
    const collapsed = css.slice(collapsedStart, css.indexOf('}', collapsedStart))
    expect(collapsed).toContain('max-height: calc(1.5em * 12)')
    expect(collapsed).not.toContain('overflow-y: auto')
    const expandStart = css.indexOf('.snow-expand {')
    expect(expandStart).toBeGreaterThan(-1)
    const expand = css.slice(expandStart, css.indexOf('}', expandStart))
    expect(expand).toContain('min-height: 36px')
    expect(expand).toContain('width: calc(100% + 24px)')
    const title = css.slice(css.indexOf('.snow-title {'), css.indexOf('}', css.indexOf('.snow-title {')))
    expect(title).not.toContain('overflow: hidden')
  })

  it('字符行数不再决定展开条；只有实测溢出才按 12 行收起并加上展开条', () => {
    const line = '一二三四五六七八九十'
    const body = (n: number) => Array.from({ length: n }, () => line).join('\n')
    const input = (n: number, expanded = false, overflows = false) => ({
      title: '标题',
      body: body(n),
      meta: '',
      width: 280,
      expanded,
      overflows,
    })
    expect(snowBodyOverflows(252, 252)).toBe(false)
    expect(snowBodyOverflows(253, 252)).toBe(false)
    expect(snowBodyOverflows(254, 252)).toBe(true)
    const layout = read('src/card-layout.ts')
    const gate = layout.slice(layout.indexOf('export function snowBodyOverflows'), layout.indexOf('export function snowBodyLineCapPx'))
    expect(gate).not.toContain('perLine')
    expect(gate).not.toContain('innerWidth')
    expect(gate).not.toContain('fontPx')
    const h2 = estimateSnowCardHeight(input(2))
    const h12 = estimateSnowCardHeight(input(12))
    const h20 = estimateSnowCardHeight(input(20))
    expect(h2).toBeLessThan(h12)
    expect(h20).toBeGreaterThan(h12)
    expect(estimateSnowCardHeight(input(20, true))).toBe(h20)
    expect(estimateSnowCardHeight(input(12, true))).toBe(h12)
    const h20collapsed = estimateSnowCardHeight(input(20, false, true))
    const h20expanded = estimateSnowCardHeight(input(20, true, true))
    expect(h20collapsed).toBe(estimateSnowCardHeight(input(13, false, true)))
    expect(h20collapsed - h12).toBe(EXPAND_CHROME_PX)
    expect(h20expanded).toBeGreaterThan(h20collapsed)
    expect(h20expanded).toBeGreaterThan(estimateSnowCardHeight(input(13, true, true)))
  })

  it('超过 12 行才出现展开全文，按钮在卡片底部而不是再包一层', () => {
    const flow = read('src/FlowCanvas.tsx')
    const snow = flow.slice(flow.indexOf('function SnowCard('), flow.indexOf('function SnowGroup('))
    expect(snow).toContain('measureSnowBodyOverflow(')
    expect(snow).toContain('snowExpandLabel(')
    expect(snow).toContain('ref={bodyRef}')
    const labels = read('src/card-layout.ts')
    expect(labels).toContain("'展开全文'")
    expect(labels).toContain("'收起'")
    expect(snow).toContain('aria-expanded')
    expect(snow).toContain('stopPropagation()')
    expect(snow).toContain('className="snow-expand nodrag nopan nowheel"')
    expect(snow.indexOf('snow-expand')).toBeGreaterThan(snow.indexOf('snow-body'))
    expect(snow.indexOf('{expandLabel}')).toBeGreaterThan(snow.indexOf('snow-body'))
    expect(snow).not.toContain('function SnowCardBody')
    expect(flow).toContain('expandedIds')
  })

  it('节点高度跟着内容走，分组尺寸不走这套算法', () => {
    const flow = read('src/FlowCanvas.tsx')
    const fn = flow.slice(flow.indexOf('function toFlowNode('), flow.indexOf('\nexport default function'))
    expect(fn).not.toContain('176')
    expect(fn).toContain('estimateSnowCardHeight(')
    const groupBranch = fn.slice(fn.indexOf("node.type === 'group'"), fn.indexOf('const face'))
    expect(groupBranch).toContain('height: node.height')
    expect(read('src/document.ts')).toContain('const TEXT_HEIGHT = 120')
  })
})

describe('讨论标题用卡片标题，没有标题就用层名', () => {
  it('有标题用标题，空白标题退回层名', () => {
    expect(discussCardName('门口的人', '念头')).toBe('门口的人')
    expect(discussCardName('  ', '念头')).toBe('念头')
    expect(discussCardName('', '人物表')).toBe('人物表')
  })
})

describe('顶栏常用按钮留在外面，其余分进版本、书籍、设置', () => {
  const app = read('src/App.tsx')
  const header = app.slice(app.indexOf('<header className="topbar">'), app.indexOf('</header>'))
  const resident = header.slice(header.indexOf('className="top-actions"'), header.indexOf('<NamedMenu'))
  const version = header.slice(header.indexOf('label="版本"'), header.indexOf('label="书籍"'))
  const books = header.slice(header.indexOf('label="书籍"'), header.indexOf('label="设置"'))
  const settings = header.slice(header.indexOf('label="设置"'))
  const menuFn = app.slice(app.indexOf('function NamedMenu'), app.indexOf('export default function App'))

  it('顶栏一行：当前书、字数、保存状态、正本状态、新建念头，以及版本、书籍、设置', () => {
    expect(header).toContain('aria-label="当前书"')
    expect(header).toContain('className="top-words"')
    expect(header).toContain('保存状态')
    expect(header).toContain('正本状态')
    expect(resident).toContain('新建念头')
    expect(header).not.toContain('<h1>')
    expect(header).not.toContain('top-hint')
    expect(resident).not.toContain('MSG_KEEP_SNAPSHOT')
    expect(resident).not.toContain('新建分组')
    expect(resident).not.toContain('回退到这一版')
    expect(resident).not.toContain('撤销')
    expect(resident).not.toContain('选择正本')
    expect(header).toContain('label="版本"')
    expect(header).toContain('label="书籍"')
    expect(header).toContain('label="设置"')
    expect(header).not.toMatch(/>\s*更多\s*</)
    expect(version).toContain('MSG_KEEP_SNAPSHOT')
    expect(version).toContain('版本 ${version}')
    expect(books).toContain('新建书')
    expect(books).toContain('书籍管理')
    expect(settings).toContain('讨论行高')
    expect(settings).toContain('操作说明')
  })

  it('三个菜单里仍有分组、删除、快照、回退、撤销和条件按钮，键盘能开关', () => {
    for (const label of [
      '新建分组',
      '删除',
      '撤销',
      '选择一份快照',
      '回退到这一版',
      '选择正本',
      '允许读写',
      '改由本页写入',
      '打开正本',
      '选快照回退',
    ]) {
      expect(header).toContain(label)
    }
    expect(menuFn).toContain("event.key !== 'ArrowDown'")
    expect(menuFn).toContain("event.key !== 'Escape'")
    expect(menuFn).toContain("addEventListener('pointerdown'")
    expect(settings).toContain('disabled={!canEdit || !state.activeId}')
    expect(settings).toContain('disabled={!canEdit || !view.canUndo}')
    expect(version).toContain('disabled={!canEdit || snapName.length === 0}')
  })
})

describe('同列卡片变高后，被挡住的往下让', () => {
  it('新的重叠下移重叠高度再加 16，原来就叠着的不动', () => {
    expect(COLUMN_GAP).toBe(16)
    const pushed = shiftOverlappingCards([
      card({ id: 'a', x: 0, y: 0, height: 180, prevHeight: 100 }),
      card({ id: 'b', x: 0, y: 150, height: 100, prevHeight: 100 }),
    ])
    expect(pushed).toEqual([{ id: 'b', x: 0, y: 150 + 30 + COLUMN_GAP }])

    const already = shiftOverlappingCards([
      card({ id: 'a', x: 0, y: 0, height: 180, prevHeight: 160 }),
      card({ id: 'b', x: 0, y: 80, height: 40, prevHeight: 40 }),
    ])
    expect(already).toEqual([])
  })

  it('从上往下连带下移，分组框留在原地，正在拖的那张不改 y', () => {
    const boxes: ShiftBox[] = [
      card({ id: 'a', x: 0, y: 0, height: 200, prevHeight: 80 }),
      card({ id: 'b', x: 0, y: 100, height: 40, prevHeight: 40 }),
      card({ id: 'c', x: 0, y: 150, height: 40, prevHeight: 40 }),
      { id: 'g', x: 0, y: 0, width: 400, height: 300, prevHeight: 300, kind: 'group' },
    ]
    const moves = shiftOverlappingCards(boxes, 'b')
    expect(moves.find((item) => item.id === 'b')).toBeUndefined()
    expect(moves.find((item) => item.id === 'g')).toBeUndefined()
    expect(moves.find((item) => item.id === 'a')).toBeUndefined()
    const c = moves.find((item) => item.id === 'c')
    expect(c).toBeDefined()
    expect(c!.y).toBeGreaterThan(150)
    expect(c!.y).toBe(200 + COLUMN_GAP)

    const cascade = shiftOverlappingCards([
      card({ id: 'a', x: 0, y: 0, height: 200, prevHeight: 80 }),
      card({ id: 'b', x: 0, y: 100, height: 40, prevHeight: 40 }),
      card({ id: 'c', x: 0, y: 150, height: 40, prevHeight: 40 }),
    ])
    expect(cascade.find((item) => item.id === 'a')).toBeUndefined()
    const movedB = cascade.find((item) => item.id === 'b')
    const movedC = cascade.find((item) => item.id === 'c')
    expect(movedB?.y).toBe(200 + COLUMN_GAP)
    expect(movedC!.y).toBeGreaterThan(movedB!.y)
    expect(movedC!.y).toBe(movedB!.y + 40 + COLUMN_GAP)
  })

  it('左右没叠上的不动；高度没变出新重叠时也不动', () => {
    expect(
      shiftOverlappingCards([
        card({ id: 'a', x: 0, y: 0, height: 200, prevHeight: 80 }),
        card({ id: 'b', x: 400, y: 40, height: 80, prevHeight: 80 }),
      ]),
    ).toEqual([])
    expect(
      shiftOverlappingCards([
        card({ id: 'a', x: 0, y: 0, height: 100, prevHeight: 100 }),
        card({ id: 'b', x: 0, y: 140, height: 80, prevHeight: 80 }),
      ]),
    ).toEqual([])
  })
})
