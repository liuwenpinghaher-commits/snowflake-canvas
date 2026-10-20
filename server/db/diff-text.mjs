export function diffTextParts(before, after) {
  const prev = [...String(before ?? '')]
  const next = [...String(after ?? '')]
  let start = 0
  while (start < prev.length && start < next.length && prev[start] === next[start]) start += 1
  let prevEnd = prev.length
  let nextEnd = next.length
  while (prevEnd > start && nextEnd > start && prev[prevEnd - 1] === next[nextEnd - 1]) {
    prevEnd -= 1
    nextEnd -= 1
  }
  const parts = []
  if (start > 0) parts.push({ kind: 'same', text: prev.slice(0, start).join('') })
  if (prevEnd > start) parts.push({ kind: 'del', text: prev.slice(start, prevEnd).join('') })
  if (nextEnd > start) parts.push({ kind: 'add', text: next.slice(start, nextEnd).join('') })
  if (prevEnd < prev.length) parts.push({ kind: 'same', text: prev.slice(prevEnd).join('') })
  return parts
}
