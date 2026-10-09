import type { ReactNode } from 'react'

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*[^*]+\*)/g
  let last = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > last) nodes.push(text.slice(last, start))
    const token = match[0]
    const key = `${keyPrefix}-${index}`
    index += 1
    if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={key}>{token.slice(2, -2)}</del>)
    } else if (token.startsWith('[')) {
      const linked = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
      if (linked) {
        nodes.push(
          <a key={key} href={linked[2]} target="_blank" rel="noreferrer">
            {linked[1]}
          </a>,
        )
      } else {
        nodes.push(token)
      }
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    last = start + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export { stripMarkdown } from './strip-markdown.mjs'

function paragraph(text: string, key: string): ReactNode {
  const lines = text.split('\n')
  const children: ReactNode[] = []
  lines.forEach((line, index) => {
    if (index > 0) children.push(<br key={`${key}-br-${index}`} />)
    children.push(...inline(line, `${key}-l${index}`))
  })
  return <p key={key}>{children}</p>
}

const BULLET = /^[-*]\s+/
const ORDERED = /^\d+\.\s+/
const HEADING = /^(#{1,3})\s+/
const QUOTE = /^>\s?/
const TASK = /^\[([ xX])\]\s+/
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

function tableCells(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map((cell) => cell.trim())
}

function startsTable(lines: string[], cursor: number): boolean {
  const head = lines[cursor] ?? ''
  const rule = lines[cursor + 1] ?? ''
  return head.includes('|') && TABLE_RULE.test(rule) && rule.includes('-')
}

function startsBlock(lines: string[], cursor: number): boolean {
  const line = lines[cursor] ?? ''
  return (
    line.startsWith('```') ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    QUOTE.test(line) ||
    startsTable(lines, cursor)
  )
}

function renderBlocks(lines: string[], nextKey: () => string): ReactNode[] {
  const blocks: ReactNode[] = []
  let cursor = 0
  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const buf: string[] = []
      cursor += 1
      while (cursor < lines.length && !lines[cursor].startsWith('```')) {
        buf.push(lines[cursor] ?? '')
        cursor += 1
      }
      if (cursor < lines.length) cursor += 1
      blocks.push(
        <pre key={nextKey()} className="md-code">
          {lang ? <span className="md-code-lang">{lang}</span> : null}
          <code>{buf.join('\n')}</code>
        </pre>,
      )
      continue
    }
    if (!line.trim()) {
      cursor += 1
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const content = inline(heading[2] ?? '', nextKey())
      const key = nextKey()
      if (level === 1) blocks.push(<h3 key={key}>{content}</h3>)
      else if (level === 2) blocks.push(<h4 key={key}>{content}</h4>)
      else blocks.push(<h5 key={key}>{content}</h5>)
      cursor += 1
      continue
    }
    if (QUOTE.test(line)) {
      const inner: string[] = []
      while (cursor < lines.length && QUOTE.test(lines[cursor] ?? '')) {
        inner.push((lines[cursor] ?? '').replace(QUOTE, ''))
        cursor += 1
      }
      blocks.push(<blockquote key={nextKey()}>{renderBlocks(inner, nextKey)}</blockquote>)
      continue
    }
    if (startsTable(lines, cursor)) {
      const head = tableCells(line)
      cursor += 2
      const rows: string[][] = []
      while (cursor < lines.length && (lines[cursor] ?? '').includes('|') && (lines[cursor] ?? '').trim()) {
        rows.push(tableCells(lines[cursor] ?? ''))
        cursor += 1
      }
      const tableKey = nextKey()
      blocks.push(
        <div key={tableKey} className="md-table-wrap">
          <table>
            <thead>
              <tr>
                {head.map((cell, index) => (
                  <th key={`${tableKey}-h${index}`}>{inline(cell, `${tableKey}-h${index}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${tableKey}-r${rowIndex}`}>
                  {head.map((_, cellIndex) => (
                    <td key={`${tableKey}-r${rowIndex}-${cellIndex}`}>
                      {inline(row[cellIndex] ?? '', `${tableKey}-r${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    if (BULLET.test(line)) {
      const items: ReactNode[] = []
      let tasks = false
      while (cursor < lines.length && BULLET.test(lines[cursor] ?? '')) {
        const key = nextKey()
        const rest = (lines[cursor] ?? '').replace(BULLET, '')
        const task = TASK.exec(rest)
        if (task) {
          tasks = true
          const done = task[1] !== ' '
          // 讨论记录不是待办清单：只显示勾没勾，不能在这里改。
          items.push(
            <li key={key} className={done ? 'md-task is-done' : 'md-task'}>
              <input type="checkbox" checked={done} disabled readOnly aria-label={done ? '已完成' : '未完成'} />
              <span>{inline(rest.replace(TASK, ''), key)}</span>
            </li>,
          )
        } else {
          items.push(<li key={key}>{inline(rest, key)}</li>)
        }
        cursor += 1
      }
      blocks.push(
        <ul key={nextKey()} className={tasks ? 'md-tasks' : undefined}>
          {items}
        </ul>,
      )
      continue
    }
    if (ORDERED.test(line)) {
      const items: ReactNode[] = []
      while (cursor < lines.length && ORDERED.test(lines[cursor] ?? '')) {
        const key = nextKey()
        items.push(<li key={key}>{inline((lines[cursor] ?? '').replace(ORDERED, ''), key)}</li>)
        cursor += 1
      }
      blocks.push(<ol key={nextKey()}>{items}</ol>)
      continue
    }
    const para = [line]
    cursor += 1
    while (cursor < lines.length && (lines[cursor] ?? '').trim() && !startsBlock(lines, cursor)) {
      para.push(lines[cursor] ?? '')
      cursor += 1
    }
    blocks.push(paragraph(para.join('\n'), nextKey()))
  }
  return blocks
}

export function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let serial = 0
  const nextKey = () => `md-${serial++}`
  return <div className="md">{renderBlocks(lines, nextKey)}</div>
}
