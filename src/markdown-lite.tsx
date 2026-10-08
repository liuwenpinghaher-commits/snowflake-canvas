import type { ReactNode } from 'react'

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*[^*]+\*)/g
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

function paragraph(text: string, key: string): ReactNode {
  const lines = text.split('\n')
  const children: ReactNode[] = []
  lines.forEach((line, index) => {
    if (index > 0) children.push(<br key={`${key}-br-${index}`} />)
    children.push(...inline(line, `${key}-l${index}`))
  })
  return <p key={key}>{children}</p>
}

export function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let cursor = 0
  let serial = 0
  const nextKey = () => `md-${serial++}`
  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    if (line.startsWith('```')) {
      const buf: string[] = []
      cursor += 1
      while (cursor < lines.length && !lines[cursor].startsWith('```')) {
        buf.push(lines[cursor] ?? '')
        cursor += 1
      }
      if (cursor < lines.length) cursor += 1
      blocks.push(
        <pre key={nextKey()} className="md-code">
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
    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (cursor < lines.length && /^[-*]\s+/.test(lines[cursor] ?? '')) {
        const key = nextKey()
        items.push(<li key={key}>{inline((lines[cursor] ?? '').replace(/^[-*]\s+/, ''), key)}</li>)
        cursor += 1
      }
      blocks.push(<ul key={nextKey()}>{items}</ul>)
      continue
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (cursor < lines.length && /^\d+\.\s+/.test(lines[cursor] ?? '')) {
        const key = nextKey()
        items.push(<li key={key}>{inline((lines[cursor] ?? '').replace(/^\d+\.\s+/, ''), key)}</li>)
        cursor += 1
      }
      blocks.push(<ol key={nextKey()}>{items}</ol>)
      continue
    }
    const para = [line]
    cursor += 1
    while (
      cursor < lines.length &&
      (lines[cursor] ?? '').trim() &&
      !(lines[cursor] ?? '').startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[cursor] ?? '') &&
      !/^[-*]\s+/.test(lines[cursor] ?? '') &&
      !/^\d+\.\s+/.test(lines[cursor] ?? '')
    ) {
      para.push(lines[cursor] ?? '')
      cursor += 1
    }
    blocks.push(paragraph(para.join('\n'), nextKey()))
  }
  return <div className="md">{blocks}</div>
}
