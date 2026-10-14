// BPMN XML 与 bpmn-beta 互相投影，并检查自环、从起点走不到终点。

const KIND_BY_TAG = {
  startEvent: 'start',
  endEvent: 'end',
  task: 'task',
  userTask: 'task',
  serviceTask: 'task',
  exclusiveGateway: 'xor',
  parallelGateway: 'and',
  inclusiveGateway: 'or',
}

const TAG_BY_KIND = {
  start: 'startEvent',
  end: 'endEvent',
  task: 'task',
  xor: 'exclusiveGateway',
  and: 'parallelGateway',
  or: 'inclusiveGateway',
}

function localName(qname) {
  const index = qname.lastIndexOf(':')
  return index < 0 ? qname : qname.slice(index + 1)
}

function prefixOf(qname) {
  const index = qname.indexOf(':')
  return index < 0 ? '' : qname.slice(0, index)
}

function attribute(element, name) {
  if (Object.prototype.hasOwnProperty.call(element.attrs, name)) return element.attrs[name]
  for (const [key, value] of Object.entries(element.attrs)) {
    if (localName(key) === name) return value
  }
  return ''
}

function decodeXml(raw) {
  let out = ''
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] !== '&') {
      out += raw[index]
      continue
    }
    const semi = raw.indexOf(';', index + 1)
    if (semi < 0 || semi - index > 12) {
      out += '&'
      continue
    }
    const entity = raw.slice(index + 1, semi)
    if (entity === 'amp') out += '&'
    else if (entity === 'lt') out += '<'
    else if (entity === 'gt') out += '>'
    else if (entity === 'quot') out += '"'
    else if (entity === 'apos') out += "'"
    else if (/^#x[0-9a-fA-F]+$/.test(entity)) out += String.fromCodePoint(parseInt(entity.slice(2), 16))
    else if (/^#\d+$/.test(entity)) out += String.fromCodePoint(parseInt(entity.slice(1), 10))
    else {
      out += raw.slice(index, semi + 1)
      index = semi
      continue
    }
    index = semi
  }
  return out
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeBeta(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function parseDocument(xml) {
  const source = String(xml ?? '').replace(/^\uFEFF/, '')
  let index = 0

  function eof() {
    return index >= source.length
  }

  function starts(literal) {
    return source.startsWith(literal, index)
  }

  function skipWs() {
    while (index < source.length && /\s/.test(source[index])) index += 1
  }

  function skipUntil(marker) {
    const at = source.indexOf(marker, index)
    if (at < 0) throw new Error(`XML 里的 ${marker} 没有闭合`)
    index = at + marker.length
  }

  function skipDoctype() {
    let quote = ''
    while (index < source.length) {
      const char = source[index]
      if (quote) {
        if (char === quote) quote = ''
        index += 1
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        index += 1
        continue
      }
      if (char === '>') {
        index += 1
        return
      }
      index += 1
    }
  }

  function readName() {
    const start = index
    while (index < source.length && /[A-Za-z0-9_:\-.]/.test(source[index])) index += 1
    if (index === start) throw new Error(`XML 在第 ${start} 个字符读不到名称`)
    return source.slice(start, index)
  }

  function parseElement() {
    if (source[index] !== '<') throw new Error('XML 缺少起始标签')
    index += 1
    const name = readName()
    const attrs = {}
    while (true) {
      skipWs()
      if (starts('/>')) {
        index += 2
        return { type: 'element', name, attrs, children: [] }
      }
      if (starts('>')) {
        index += 1
        break
      }
      if (eof()) throw new Error('XML 标签没有闭合')
      const attrName = readName()
      skipWs()
      if (source[index] !== '=') throw new Error(`XML 属性 ${attrName} 缺少等号`)
      index += 1
      skipWs()
      const quote = source[index]
      if (quote !== '"' && quote !== "'") throw new Error(`XML 属性 ${attrName} 缺少引号`)
      index += 1
      let raw = ''
      while (index < source.length && source[index] !== quote) {
        raw += source[index]
        index += 1
      }
      if (source[index] !== quote) throw new Error(`XML 属性 ${attrName} 的引号没有闭合`)
      index += 1
      attrs[attrName] = decodeXml(raw)
    }

    const children = []
    while (true) {
      if (eof()) throw new Error(`XML 元素 ${name} 没有闭合`)
      if (starts('</')) {
        index += 2
        const endName = readName()
        skipWs()
        if (source[index] !== '>') throw new Error(`XML 结束标签 ${endName} 没有闭合`)
        index += 1
        if (endName !== name) throw new Error(`XML 结束标签 ${endName} 与 ${name} 不匹配`)
        break
      }
      if (starts('<!--')) {
        skipUntil('-->')
        continue
      }
      if (starts('<?')) {
        skipUntil('?>')
        continue
      }
      if (starts('<![CDATA[')) {
        index += 9
        const end = source.indexOf(']]>', index)
        if (end < 0) throw new Error('XML 的 CDATA 没有闭合')
        children.push({ type: 'text', text: source.slice(index, end) })
        index = end + 3
        continue
      }
      if (starts('<!')) {
        skipDoctype()
        continue
      }
      if (starts('<')) {
        children.push(parseElement())
        continue
      }
      const start = index
      while (index < source.length && source[index] !== '<') index += 1
      children.push({ type: 'text', text: decodeXml(source.slice(start, index)) })
    }
    return { type: 'element', name, attrs, children }
  }

  const roots = []
  while (!eof()) {
    skipWs()
    if (eof()) break
    if (starts('<?')) {
      skipUntil('?>')
      continue
    }
    if (starts('<!--')) {
      skipUntil('-->')
      continue
    }
    if (starts('<!')) {
      skipDoctype()
      continue
    }
    if (starts('<')) {
      roots.push(parseElement())
      continue
    }
    throw new Error('XML 根节点之外有无法识别的内容')
  }
  return roots
}

function textOf(element) {
  let out = ''
  for (const child of element.children) {
    if (child.type === 'text') out += child.text
    else out += textOf(child)
  }
  return out
}

function ignoredTree(element) {
  const prefix = prefixOf(element.name)
  const local = localName(element.name)
  if (prefix === 'bpmndi' || prefix === 'dc' || prefix === 'di') return true
  return local === 'BPMNDiagram' || local === 'BPMNPlane' || local === 'BPMNShape' || local === 'BPMNEdge' || local === 'BPMNLabel'
}

function collect(element, acc) {
  if (ignoredTree(element)) return
  const local = localName(element.name)
  if (local === 'sequenceFlow') {
    let condition = null
    for (const child of element.children) {
      if (child.type === 'element' && localName(child.name) === 'conditionExpression') {
        condition = textOf(child).trim()
        break
      }
    }
    acc.flows.push({
      id: attribute(element, 'id'),
      name: attribute(element, 'name'),
      source: attribute(element, 'sourceRef'),
      target: attribute(element, 'targetRef'),
      condition,
    })
    return
  }
  if (KIND_BY_TAG[local]) {
    acc.nodes.push({
      kind: KIND_BY_TAG[local],
      id: attribute(element, 'id'),
      name: attribute(element, 'name'),
      defaultId: attribute(element, 'default'),
    })
    return
  }
  for (const child of element.children) {
    if (child.type === 'element') collect(child, acc)
  }
}

function nodeLine(node) {
  if (!node.name) return `${node.kind} ${node.id}`
  return `${node.kind} ${node.id} "${escapeBeta(node.name)}"`
}

function edgeLine(flow, byId) {
  const source = byId.get(flow.source)
  if (source && source.defaultId && flow.id && source.defaultId === flow.id) {
    return `${flow.source} --> ${flow.target}: "其余"`
  }
  if (flow.condition !== null) {
    const label = flow.name ? flow.name : flow.condition
    return `${flow.source} --> ${flow.target}: "${escapeBeta(label)}"`
  }
  return `${flow.source} --> ${flow.target}`
}

export function xmlToBeta(xml) {
  const acc = { nodes: [], flows: [] }
  for (const root of parseDocument(xml)) collect(root, acc)
  const byId = new Map()
  for (const node of acc.nodes) {
    if (node.id && !byId.has(node.id)) byId.set(node.id, node)
  }
  const lines = []
  for (const node of acc.nodes) lines.push(nodeLine(node))
  for (const flow of acc.flows) lines.push(edgeLine(flow, byId))
  return lines.join('\n')
}

function unescapeQuoted(rest) {
  const trimmed = rest.trim()
  if (!trimmed.startsWith('"')) throw new Error(`引号缺失：${rest}`)
  let out = ''
  for (let index = 1; index < trimmed.length; index++) {
    const char = trimmed[index]
    if (char === '\\') {
      const next = trimmed[index + 1]
      if (next === '\\' || next === '"') {
        out += next
        index += 1
        continue
      }
      out += char
      continue
    }
    if (char === '"') {
      if (trimmed.slice(index + 1).trim() !== '') throw new Error(`引号后面还有多余内容：${rest}`)
      return out
    }
    out += char
  }
  throw new Error(`引号没有闭合：${rest}`)
}

function parseBeta(beta) {
  const elements = []
  const flows = []
  const lines = String(beta ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.includes('-->')) {
      const plain = line.match(/^(\S+)\s+-->\s+(\S+)\s*$/)
      if (plain) {
        flows.push({ source: plain[1], target: plain[2], label: null })
        continue
      }
      const labeled = line.match(/^(\S+)\s+-->\s+([^\s:]+)\s*:\s*([\s\S]*)$/)
      if (!labeled) throw new Error(`无法识别的连线：${line}`)
      flows.push({ source: labeled[1], target: labeled[2], label: unescapeQuoted(labeled[3]) })
      continue
    }
    const bare = line.match(/^(xor|and|or|start|end|task)\s+(\S+)\s*$/)
    if (bare) {
      elements.push({ kind: bare[1], id: bare[2], name: '' })
      continue
    }
    const named = line.match(/^(xor|and|or|start|end|task)\s+(\S+)\s+([\s\S]*)$/)
    if (!named) throw new Error(`无法识别的行：${line}`)
    elements.push({ kind: named[1], id: named[2], name: unescapeQuoted(named[3]) })
  }
  return { elements, flows }
}

function attrList(pairs) {
  return pairs
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ')
}

export function betaToXml(beta) {
  const { elements, flows } = parseBeta(beta)
  const counts = new Map()
  const planned = flows.map((flow) => {
    const key = `${flow.source}\0${flow.target}`
    const sequence = (counts.get(key) || 0) + 1
    counts.set(key, sequence)
    return { ...flow, flowId: `Flow_${flow.source}_${flow.target}_${sequence}` }
  })
  const declared = new Set(elements.map((element) => element.id))
  const defaultBySource = new Map()
  for (const flow of planned) {
    if (flow.label !== '其余') continue
    if (!declared.has(flow.source)) throw new Error(`「其余」的源 ${flow.source} 没有声明`)
    if (defaultBySource.has(flow.source)) {
      throw new Error(`网关 ${flow.source} 有两条「其余」，一条网关最多一条`)
    }
    defaultBySource.set(flow.source, flow.flowId)
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1">',
    '  <bpmn:process id="Process_1" isExecutable="false">',
  ]
  for (const element of elements) {
    const tag = TAG_BY_KIND[element.kind]
    if (!tag) throw new Error(`无法写成 XML 的元素：${element.kind}`)
    const attrs = attrList([
      ['id', element.id],
      ['name', element.name],
      ['default', defaultBySource.get(element.id) || ''],
    ])
    lines.push(`    <bpmn:${tag} ${attrs} />`)
  }
  for (const flow of planned) {
    if (flow.label == null || flow.label === '其余') {
      const attrs = attrList([
        ['id', flow.flowId],
        ['sourceRef', flow.source],
        ['targetRef', flow.target],
      ])
      lines.push(`    <bpmn:sequenceFlow ${attrs} />`)
      continue
    }
    const attrs = attrList([
      ['id', flow.flowId],
      ['name', flow.label],
      ['sourceRef', flow.source],
      ['targetRef', flow.target],
    ])
    lines.push(`    <bpmn:sequenceFlow ${attrs}>`)
    lines.push(`      <bpmn:conditionExpression>${escapeXml(flow.label)}</bpmn:conditionExpression>`)
    lines.push('    </bpmn:sequenceFlow>')
  }
  lines.push('  </bpmn:process>')
  lines.push('</bpmn:definitions>')
  return lines.join('\n')
}

function reachable(seeds, nextOf) {
  const seen = new Set()
  const stack = [...seeds]
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of nextOf.get(id) || []) stack.push(next)
  }
  return seen
}

export function extraFlowRules(beta) {
  const { elements, flows } = parseBeta(beta)
  const errors = []
  const looped = new Set()
  for (const flow of flows) {
    if (flow.source !== flow.target || looped.has(flow.source)) continue
    looped.add(flow.source)
    errors.push({
      ruleId: 'snowflake.self-loop',
      message: `${flow.source} 连回了自己`,
      elementId: flow.source,
    })
  }

  const starts = elements.filter((element) => element.kind === 'start')
  if (starts.length === 0) return { errors }

  const declared = []
  const seen = new Set()
  for (const element of elements) {
    if (seen.has(element.id)) continue
    seen.add(element.id)
    declared.push(element)
  }

  const forward = new Map()
  const reverse = new Map()
  for (const element of declared) {
    forward.set(element.id, [])
    reverse.set(element.id, [])
  }
  for (const flow of flows) {
    if (!forward.has(flow.source)) forward.set(flow.source, [])
    if (!reverse.has(flow.target)) reverse.set(flow.target, [])
    forward.get(flow.source).push(flow.target)
    reverse.get(flow.target).push(flow.source)
  }

  const fromStart = reachable(starts.map((element) => element.id), forward)
  const ends = elements.filter((element) => element.kind === 'end').map((element) => element.id)
  const canReachEnd = reachable(ends, reverse)

  for (const element of declared) {
    if (fromStart.has(element.id) && canReachEnd.has(element.id)) continue
    errors.push({
      ruleId: 'snowflake.unreachable-end',
      message: `从起点走不到终点：${element.id}`,
      elementId: element.id,
    })
  }
  return { errors }
}
