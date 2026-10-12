// 块正文里的引用标记。只存目标 id，不新增块类型。
// id 里有 ] 或换行就拒绝，不另做转义。

export type MentionKind = 'card' | 'entity'

export interface MentionMark {
  kind: MentionKind
  id: string
  start: number
  end: number
}

function mentionPattern(): RegExp {
  return /\[\[sf:(card|entity):([^\]\r\n]+)\]\]/g
}

export function mentionToken(kind: MentionKind, id: string): string | null {
  if (kind !== 'card' && kind !== 'entity') return null
  if (typeof id !== 'string' || id.length === 0) return null
  if (id.includes(']') || id.includes('\n') || id.includes('\r')) return null
  return `[[sf:${kind}:${id}]]`
}

export function findMentionMarks(text: string): MentionMark[] {
  const out: MentionMark[] = []
  for (const match of text.matchAll(mentionPattern())) {
    const kind = match[1]
    const id = match[2]
    if ((kind !== 'card' && kind !== 'entity') || !id) continue
    const start = match.index ?? 0
    out.push({ kind, id, start, end: start + match[0].length })
  }
  return out
}

export function replaceMentionMarks(
  text: string,
  labelOf: (kind: MentionKind, id: string) => string,
): string {
  return text.replace(mentionPattern(), (full, kind: string, id: string) => {
    if ((kind !== 'card' && kind !== 'entity') || !id) return full
    return labelOf(kind, id)
  })
}

function queryBreaks(query: string): boolean {
  return query.includes('[') || query.includes(']') || query.includes('\n') || query.includes('\r')
}

/** 光标前最近的 [[。前一个字符是 [ 时不算，避免 [[[。过滤词里出现 ] 或换行就关掉。 */
export function mentionAtCursor(text: string, cursor: number): { start: number; query: string } | null {
  if (!Number.isFinite(cursor)) return null
  const at = Math.max(0, Math.min(cursor, text.length))
  const head = text.slice(0, at)
  const start = head.lastIndexOf('[[')
  if (start < 0) return null
  if (start > 0 && head[start - 1] === '[') return null
  const query = head.slice(start + 2)
  if (queryBreaks(query)) return null
  return { start, query }
}

export function trackMention(
  text: string,
  start: number,
  cursor: number,
): { start: number; query: string } | null {
  if (!Number.isFinite(start) || !Number.isFinite(cursor)) return null
  if (start < 0 || cursor < start + 2 || start + 2 > text.length) return null
  if (text.slice(start, start + 2) !== '[[') return null
  if (start > 0 && text[start - 1] === '[') return null
  const at = Math.min(cursor, text.length)
  const query = text.slice(start + 2, at)
  if (queryBreaks(query)) return null
  return { start, query }
}

/** 这次输入刚把 [[ 放到光标前。组字期间的 input 不会走到这里。 */
export function insertedMentionTrigger(before: string, after: string, cursor: number): boolean {
  const found = mentionAtCursor(after, cursor)
  if (!found) return false
  const second = found.start + 1
  if (second < 0 || second >= cursor || second >= after.length) return false
  if (after[cursor - 1] === '[' && after.slice(0, cursor - 1) + after.slice(cursor) === before) {
    return second === cursor - 1
  }
  const suffix = after.slice(cursor)
  if (suffix.length > 0 && !before.endsWith(suffix)) return false
  const beforeHead = before.slice(0, before.length - suffix.length)
  const afterHead = after.slice(0, cursor)
  if (!afterHead.startsWith(beforeHead)) return false
  const insertFrom = beforeHead.length
  return second >= insertFrom && second < cursor
}
