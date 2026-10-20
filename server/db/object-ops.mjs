// 把整份画布的差异收成若干小操作。按键只带改动的那一段，不带整本书。

export function diffDocuments(before, after) {
  const ops = []
  walk([], before, after, ops)
  return ops
}

export function applyObjectOps(doc, ops) {
  let next = doc === undefined ? null : structuredClone(doc)
  for (const op of ops) {
    if (!op || !Array.isArray(op.path)) continue
    if (op.op === 'set' && op.path.length === 0) {
      next = op.missing ? null : structuredClone(op.value)
      continue
    }
    if (op.op === 'text' && op.path.length === 0) {
      next = applyText(typeof next === 'string' ? next : '', op)
      continue
    }
    if (next === null || typeof next !== 'object') next = {}
    if (op.op === 'text') {
      const current = getPath(next, op.path)
      setIn(next, op.path, applyText(typeof current === 'string' ? current : '', op), false)
    } else {
      setIn(next, op.path, op.value, Boolean(op.missing))
    }
  }
  return next
}

export function textDelta(before, after) {
  const prev = typeof before === 'string' ? before : ''
  const next = typeof after === 'string' ? after : ''
  let start = 0
  const prevUnits = [...prev]
  const nextUnits = [...next]
  while (start < prevUnits.length && start < nextUnits.length && prevUnits[start] === nextUnits[start]) start += 1
  let prevEnd = prevUnits.length
  let nextEnd = nextUnits.length
  while (prevEnd > start && nextEnd > start && prevUnits[prevEnd - 1] === nextUnits[nextEnd - 1]) {
    prevEnd -= 1
    nextEnd -= 1
  }
  return {
    start,
    deleteCount: prevEnd - start,
    insert: nextUnits.slice(start, nextEnd).join(''),
  }
}

function applyText(value, op) {
  const units = [...value]
  const start = Math.max(0, Math.min(units.length, op.start || 0))
  const remove = Math.max(0, op.deleteCount || 0)
  const insert = typeof op.insert === 'string' ? [...op.insert] : []
  units.splice(start, remove, ...insert)
  return units.join('')
}

function walk(path, before, after, ops) {
  if (sameValue(before, after)) return
  if (typeof before === 'string' && typeof after === 'string') {
    const delta = textDelta(before, after)
    ops.push({ op: 'text', path, start: delta.start, deleteCount: delta.deleteCount, insert: delta.insert })
    return
  }
  if (isPlain(before) && isPlain(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of keys) walk([...path, key], before[key], after[key], ops)
    return
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    for (let index = 0; index < before.length; index += 1) walk([...path, index], before[index], after[index], ops)
    return
  }
  if (after === undefined) ops.push({ op: 'set', path, missing: true })
  else ops.push({ op: 'set', path, value: after })
}

function sameValue(before, after) {
  if (before === after) return true
  if (typeof before !== typeof after) return false
  if (before === null || after === null || typeof before !== 'object') return false
  return JSON.stringify(before) === JSON.stringify(after)
}

function isPlain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getPath(root, path) {
  let cursor = root
  for (const key of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = cursor[key]
  }
  return cursor
}

function setIn(root, path, value, missing) {
  let cursor = root
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index]
    const nextKey = path[index + 1]
    if (cursor[key] === null || typeof cursor[key] !== 'object') {
      cursor[key] = typeof nextKey === 'number' ? [] : {}
    }
    cursor = cursor[key]
  }
  const last = path[path.length - 1]
  if (missing) delete cursor[last]
  else cursor[last] = value
}
