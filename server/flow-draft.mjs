// 从活动书收集材料，让模型起草 bpmn-beta，最多三轮校验，投影成 XML。
// 只返回草稿。不写 snowflake.json，不调用 commitEnvelope，不写 gbrain。

import { request as httpRequest } from 'node:http'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { betaToXml, extraFlowRules } from './flow-project.mjs'
import { validateBpmnBeta } from './vendor/validate-bpmn-beta.mjs'

const DRAFT_TIMEOUT_MS = 60_000
const MAX_ROUNDS = 3
const SCENE_EXCERPT_CHARS = 400
const ALLOWED_EDGE = new Set(['grows-from', 'appears-in', 'chapter-in'])
const REF_KINDS = new Set(['card', 'edge', 'chapter', 'scene', 'entity'])

const SYSTEM_PROMPT = [
  '你只输出 bpmn-beta，不要输出 XML，不要解释。',
  '恰好一条主线。每个分叉写成 xor，每条出线都带引号条件，其中一条条件固定写「其余」。',
  '每个任务最终要能走到某个 end。写不出的步骤在名称里标 ASSUMED，不要编造材料里没有的卡片。',
  '来源写成单独的注释行，格式只能是 # card:<id>、# edge:<id>、# chapter:<id>、# scene:<id>、# entity:<id>。',
  'id 必须来自本次材料。节点写成 start、task、xor、end，例如 start s "开始"、end e "结束"、s --> e、g --> e: "其余"。',
].join('\n')

function gatewayError(message) {
  const error = new Error(message)
  error.statusCode = 502
  return error
}

function scopeError(message) {
  const error = new Error(message)
  error.statusCode = 400
  return error
}

function failureMessage(error) {
  if (error instanceof Error && error.message) return error.message
  const text = String(error ?? '')
  return text || '校验没有完成'
}

function normalizeScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) throw scopeError('范围没有给对')
  if (scope.kind === 'book') return { kind: 'book' }
  if (scope.kind === 'chapter') {
    if (typeof scope.chapterId !== 'string' || scope.chapterId.length === 0) throw scopeError('没有这一章')
    return { kind: 'chapter', chapterId: scope.chapterId }
  }
  if (scope.kind === 'scene') {
    if (typeof scope.chapterId !== 'string' || scope.chapterId.length === 0) throw scopeError('没有这一章')
    if (typeof scope.sceneId !== 'string' || scope.sceneId.length === 0) throw scopeError('没有这一场')
    return { kind: 'scene', chapterId: scope.chapterId, sceneId: scope.sceneId }
  }
  throw scopeError('范围没有给对')
}

// 只认 scope。客户端带来的 xml、beta、flows 一律不看。
export function readDraftScope(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw scopeError('范围没有给对')
  return normalizeScope(body.scope)
}

function cardMap(document) {
  const cards = document && document.snowflake && document.snowflake.cards
  if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return {}
  return cards
}

function entityMap(document) {
  const map = new Map()
  const list = document && Array.isArray(document.entities) ? document.entities : []
  for (const entity of list) {
    if (!entity || typeof entity !== 'object' || typeof entity.id !== 'string' || map.has(entity.id)) continue
    map.set(entity.id, entity)
  }
  return map
}

function chapterRows(document) {
  const list = document && Array.isArray(document.chapters) ? document.chapters : []
  return list.filter((chapter) => chapter && typeof chapter === 'object' && typeof chapter.id === 'string')
}

function sceneRows(chapter) {
  if (!chapter || !Array.isArray(chapter.scenes)) return []
  return chapter.scenes.filter((scene) => scene && typeof scene === 'object' && typeof scene.id === 'string')
}

function selectChapters(document, scope) {
  const chapters = chapterRows(document)
  if (scope.kind === 'book') {
    return chapters.map((chapter) => ({ chapter, scenes: sceneRows(chapter) }))
  }
  const chapter = chapters.find((item) => item.id === scope.chapterId)
  if (!chapter) throw scopeError('没有这一章')
  const scenes = sceneRows(chapter)
  if (scope.kind === 'chapter') return [{ chapter, scenes }]
  const scene = scenes.find((item) => item.id === scope.sceneId)
  if (!scene) throw scopeError('没有这一场')
  return [{ chapter, scenes: [scene] }]
}

function usableEdge(edge) {
  return Boolean(
    edge &&
      typeof edge === 'object' &&
      typeof edge.id === 'string' &&
      edge.id.length > 0 &&
      typeof edge.kind === 'string' &&
      ALLOWED_EDGE.has(edge.kind) &&
      typeof edge.fromNode === 'string' &&
      typeof edge.toNode === 'string',
  )
}

function allEdges(document) {
  const edges = document && document.canvas && Array.isArray(document.canvas.edges) ? document.canvas.edges : []
  return edges.filter(usableEdge)
}

// 一场对应的卡片：节拍表上的卡、chapter-in 连到这场的卡、originAnchor 落在这场或这章的卡。
function correspondingCardIds(cards, selected, edges, scope) {
  if (scope.kind === 'book') return new Set(Object.keys(cards))
  const sceneIds = new Set()
  const ids = new Set()
  for (const { scenes } of selected) {
    for (const scene of scenes) {
      sceneIds.add(scene.id)
      if (cards[scene.id]) ids.add(scene.id)
      if (!Array.isArray(scene.beatIds)) continue
      for (const beatId of scene.beatIds) {
        if (typeof beatId === 'string' && cards[beatId]) ids.add(beatId)
      }
    }
  }
  for (const edge of edges) {
    if (!edge || edge.kind !== 'chapter-in') continue
    if (sceneIds.has(edge.fromNode) && typeof edge.toNode === 'string' && cards[edge.toNode]) ids.add(edge.toNode)
    if (sceneIds.has(edge.toNode) && typeof edge.fromNode === 'string' && cards[edge.fromNode]) ids.add(edge.fromNode)
  }
  for (const [id, card] of Object.entries(cards)) {
    if (!card || typeof card !== 'object') continue
    const anchor = card.originAnchor
    if (!anchor || typeof anchor !== 'object' || anchor.chapterId !== scope.chapterId) continue
    if (scope.kind === 'scene' && anchor.sceneId !== scope.sceneId) continue
    ids.add(id)
  }
  return ids
}

function edgeInScope(edge, scope, anchors, entityIds) {
  if (scope.kind === 'book') return true
  const fromAnchor = anchors.has(edge.fromNode)
  const toAnchor = anchors.has(edge.toNode)
  if (edge.kind === 'appears-in') {
    const fromOk = fromAnchor || entityIds.has(edge.fromNode)
    const toOk = toAnchor || entityIds.has(edge.toNode)
    return fromOk && toOk && (fromAnchor || toAnchor)
  }
  return fromAnchor && toAnchor
}

export function sceneExcerpt(prose) {
  const text = typeof prose === 'string' ? prose.replace(/\r\n/g, '\n') : ''
  const blank = text.search(/\n[ \t]*\n/)
  const first = blank === -1 ? text : text.slice(0, blank)
  const chars = Array.from(first)
  if (chars.length <= SCENE_EXCERPT_CHARS) return first
  return chars.slice(0, SCENE_EXCERPT_CHARS).join('')
}

function visibleBody(body) {
  if (typeof body !== 'string') return ''
  return body.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+/g, '[图片]')
}

function cardTitle(card) {
  const fields = card && card.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return ''
  for (const key of ['title', 'name']) {
    const value = fields[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function shortText(text) {
  const line = String(text ?? '').split('\n')[0].trim()
  const chars = Array.from(line)
  if (chars.length <= 40) return line
  return chars.slice(0, 40).join('')
}

function endpointLabel(id, cards, chapterTitles, sceneTitles, entities) {
  if (cards[id]) {
    const title = cardTitle(cards[id])
    if (title) return title
    const body = shortText(visibleBody(cards[id].body))
    if (body) return body
  }
  if (sceneTitles.has(id)) return sceneTitles.get(id)
  if (chapterTitles.has(id)) return chapterTitles.get(id)
  if (entities.has(id)) {
    const name = entities.get(id).name
    if (typeof name === 'string' && name.trim()) return name.trim()
  }
  return ''
}

function collectMaterials(document, scope) {
  const normalized = normalizeScope(scope)
  const cards = cardMap(document)
  const entities = entityMap(document)
  const selected = selectChapters(document, normalized)
  const edges = allEdges(document)
  const cardIds = correspondingCardIds(cards, selected, edges, normalized)
  const anchors = new Set(cardIds)
  const chapterTitles = new Map()
  const sceneTitles = new Map()
  for (const { chapter, scenes } of selected) {
    anchors.add(chapter.id)
    chapterTitles.set(chapter.id, typeof chapter.title === 'string' ? chapter.title.trim() : '')
    for (const scene of scenes) {
      anchors.add(scene.id)
      sceneTitles.set(scene.id, typeof scene.title === 'string' ? scene.title.trim() : '')
    }
  }
  const includedEdges = edges.filter((edge) => edgeInScope(edge, normalized, anchors, new Set(entities.keys())))

  const cardRows = []
  for (const [id, card] of Object.entries(cards)) {
    if (!cardIds.has(id) || !card || typeof card !== 'object') continue
    cardRows.push({
      id,
      layer: typeof card.layer === 'string' ? card.layer : '',
      title: cardTitle(card),
      body: visibleBody(card.body),
    })
  }

  const edgeRows = includedEdges.map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    fromNode: edge.fromNode,
    toNode: edge.toNode,
    fromLabel: endpointLabel(edge.fromNode, cards, chapterTitles, sceneTitles, entities),
    toLabel: endpointLabel(edge.toNode, cards, chapterTitles, sceneTitles, entities),
  }))

  const chapterOut = selected.map(({ chapter, scenes }) => ({
    id: chapter.id,
    title: typeof chapter.title === 'string' ? chapter.title.trim() : '',
    scenes: scenes.map((scene) => ({
      id: scene.id,
      title: typeof scene.title === 'string' ? scene.title.trim() : '',
      prose: sceneExcerpt(scene.prose),
      placeEntityId: typeof scene.placeEntityId === 'string' ? scene.placeEntityId : '',
    })),
  }))

  const seenEntities = new Set()
  const entityRows = []
  const takeEntity = (id) => {
    if (!entities.has(id) || seenEntities.has(id)) return
    seenEntities.add(id)
    const entity = entities.get(id)
    const name = entity && typeof entity.name === 'string' ? entity.name.trim() : ''
    entityRows.push({ id, name })
  }
  for (const edge of includedEdges) {
    takeEntity(edge.fromNode)
    takeEntity(edge.toNode)
  }
  for (const chapter of chapterOut) {
    for (const scene of chapter.scenes) takeEntity(scene.placeEntityId)
  }

  return {
    cards: cardRows,
    edges: edgeRows,
    chapters: chapterOut,
    entities: entityRows,
    index: {
      card: new Set(cardRows.map((card) => card.id)),
      edge: new Set(edgeRows.map((edge) => edge.id)),
      chapter: new Set(chapterOut.map((chapter) => chapter.id)),
      scene: new Set(chapterOut.flatMap((chapter) => chapter.scenes.map((scene) => scene.id))),
      entity: new Set(entityRows.map((entity) => entity.id)),
    },
  }
}

function formatMaterials(materials) {
  const lines = []
  for (const card of materials.cards) {
    const title = card.title ? ` 标题 ${card.title}` : ''
    lines.push(`卡片 ${card.id} 层 ${card.layer}${title}`)
    if (card.body) lines.push(card.body)
    lines.push('')
  }
  for (const edge of materials.edges) {
    const from = edge.fromLabel ? `${edge.fromNode}（${edge.fromLabel}）` : edge.fromNode
    const to = edge.toLabel ? `${edge.toNode}（${edge.toLabel}）` : edge.toNode
    lines.push(`边 ${edge.id} ${edge.kind} ${from} -> ${to}`)
  }
  if (materials.edges.length) lines.push('')
  for (const chapter of materials.chapters) {
    lines.push(`章节 ${chapter.id} ${chapter.title}`)
    for (const scene of chapter.scenes) {
      lines.push(`场次 ${scene.id} ${scene.title}`)
      if (scene.prose) lines.push(scene.prose)
      if (scene.placeEntityId) lines.push(`地点 ${scene.placeEntityId}`)
    }
    lines.push('')
  }
  for (const entity of materials.entities) {
    lines.push(entity.name ? `实体 ${entity.id} ${entity.name}` : `实体 ${entity.id}`)
  }
  return lines.join('\n').trim()
}

function openingMessages(materialText) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `根据下面的材料起草流程。\n\n材料：\n${materialText}` },
  ]
}

function repairMessages(materialText, beta, validation) {
  const errors = Array.isArray(validation && validation.errors) ? validation.errors : []
  const lines = [
    '上一轮 bpmn-beta 没有通过校验。请只改 beta，仍然只输出 bpmn-beta。',
    '',
    '上一轮 beta：',
    beta,
    '',
    '错误原文：',
  ]
  for (const error of errors) {
    if (error && typeof error.message === 'string' && error.message) lines.push(error.message)
  }
  lines.push('', '材料：', materialText)
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ]
}

function extractBetaSource(content) {
  const text = String(content ?? '').replace(/^\uFEFF/, '')
  const fenced = text.match(/```[^\n`]*\n([\s\S]*?)```/)
  if (fenced) return fenced[1]
  return text
}

function cleanBeta(source) {
  const refs = []
  const kept = []
  for (const raw of String(source ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('#')) {
      const matched = line.match(/^#\s*(card|edge|chapter|scene|entity):\s*(\S+)\s*$/)
      if (matched && REF_KINDS.has(matched[1])) refs.push({ kind: matched[1], id: matched[2] })
      continue
    }
    if (line === 'bpmn-beta' || line.startsWith('%%')) continue
    kept.push(line)
  }
  while (kept.length && kept[0] === '') kept.shift()
  while (kept.length && kept[kept.length - 1] === '') kept.pop()
  return { beta: kept.join('\n'), refs }
}

function keepRefs(refs, index) {
  const seen = new Set()
  const out = []
  for (const ref of refs) {
    const bucket = index && index[ref.kind]
    if (!bucket || !bucket.has(ref.id)) continue
    const key = `${ref.kind}\0${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: ref.kind, id: ref.id })
  }
  return out
}

function extractDraft(content, index) {
  const cleaned = cleanBeta(extractBetaSource(content))
  return { beta: cleaned.beta, refs: keepRefs(cleaned.refs, index) }
}

// 与保存路径相同：vendor 看到补上的 bpmn-beta 首行，extraFlowRules 吃不带这个文件头的正文。
function withBpmnBetaHeader(beta) {
  const text = String(beta).replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('%%')) continue
    if (line === 'bpmn-beta') return text
    return `bpmn-beta\n${text}`
  }
  return 'bpmn-beta'
}

function vendorError(issue) {
  const out = {
    ruleId: typeof issue?.ruleId === 'string' ? issue.ruleId : 'snowflake.validate-failed',
    message: typeof issue?.message === 'string' ? issue.message : String(issue?.message ?? ''),
  }
  if (typeof issue?.element === 'string') out.elementId = issue.element
  return out
}

function extraError(issue) {
  const out = {
    ruleId: typeof issue?.ruleId === 'string' ? issue.ruleId : 'snowflake.validate-failed',
    message: typeof issue?.message === 'string' ? issue.message : String(issue?.message ?? ''),
  }
  if (typeof issue?.elementId === 'string') out.elementId = issue.elementId
  return out
}

function vendorWarning(issue) {
  const out = {
    message: typeof issue?.message === 'string' ? issue.message : String(issue?.message ?? ''),
  }
  if (typeof issue?.ruleId === 'string') out.ruleId = issue.ruleId
  if (typeof issue?.element === 'string') out.elementId = issue.element
  return out
}

function validateDraftBeta(beta) {
  const errors = []
  const warnings = []
  try {
    const vendor = validateBpmnBeta(withBpmnBetaHeader(beta))
    if (Array.isArray(vendor?.errors)) errors.push(...vendor.errors.map(vendorError))
    if (Array.isArray(vendor?.warnings)) warnings.push(...vendor.warnings.map(vendorWarning))
  } catch (error) {
    errors.push({ ruleId: 'snowflake.validate-failed', message: failureMessage(error) })
  }
  try {
    const extra = extraFlowRules(beta)
    if (Array.isArray(extra?.errors)) errors.push(...extra.errors.map(extraError))
  } catch (error) {
    errors.push({ ruleId: 'snowflake.validate-failed', message: failureMessage(error) })
  }
  return {
    ranAt: new Date().toISOString(),
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

function finishDraft(beta, validation, refs, rounds) {
  try {
    return {
      xml: betaToXml(beta),
      beta,
      validation,
      sourceRefs: refs,
      origin: 'llm',
      rounds,
    }
  } catch (error) {
    return {
      xml: '',
      beta,
      validation: {
        ...validation,
        valid: false,
        errors: [
          ...validation.errors,
          { ruleId: 'snowflake.project-failed', message: `投影成 XML 失败：${failureMessage(error)}` },
        ],
      },
      sourceRefs: refs,
      origin: 'llm',
      rounds,
    }
  }
}

async function askModel(complete, messages) {
  let content
  try {
    content = await complete(messages)
  } catch (error) {
    if (error && (error.statusCode === 400 || error.statusCode === 502)) throw error
    throw gatewayError('连不上起草服务')
  }
  if (typeof content !== 'string') throw gatewayError('起草服务没有给出可用回复')
  return content
}

export async function draftFlow(document, scope, options = {}) {
  const complete = options.complete
  if (typeof complete !== 'function') throw gatewayError('起草模型没有接上')
  const materials = collectMaterials(document, scope)
  const materialText = formatMaterials(materials)
  let beta = ''
  let validation = null
  let refs = []
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const messages = round === 1 ? openingMessages(materialText) : repairMessages(materialText, beta, validation)
    const content = await askModel(complete, messages)
    const extracted = extractDraft(content, materials.index)
    beta = extracted.beta
    refs = extracted.refs
    validation = validateDraftBeta(beta)
    if (validation.valid || round === MAX_ROUNDS) return finishDraft(beta, validation, refs, round)
  }
  throw gatewayError('起草没有完成')
}

function readUpstream(port, payload, headers) {
  return new Promise((resolveResponse, rejectResponse) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      rejectResponse(error)
    }
    const succeed = (value) => {
      if (settled) return
      settled = true
      resolveResponse(value)
    }
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers,
      },
      (res) => {
        const chunks = []
        let size = 0
        let tooBig = false
        res.on('data', (chunk) => {
          size += chunk.length
          if (size > 2_000_000) {
            tooBig = true
            res.destroy()
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          if (tooBig) {
            fail(gatewayError('起草服务没有给出可用回复'))
            return
          }
          succeed({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') })
        })
        res.on('error', () => {
          fail(gatewayError(tooBig ? '起草服务没有给出可用回复' : '连不上起草服务'))
        })
      },
    )
    req.setTimeout(DRAFT_TIMEOUT_MS, () => {
      req.destroy()
      fail(Object.assign(new Error('timeout'), { code: 'TIMEOUT' }))
    })
    req.on('error', (error) => fail(error))
    req.end(payload)
  })
}

export async function defaultComplete(messages) {
  const port = Number(process.env.SNOWFLAKE_EXPAND_PORT) || 18100
  const payload = JSON.stringify({
    model: 'deepseek-flash',
    messages,
  })
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    Host: `127.0.0.1:${port}`,
  }
  const key = typeof process.env.CPA_API_KEY === 'string' ? process.env.CPA_API_KEY.trim() : ''
  if (key) headers.Authorization = `Bearer ${key}`
  let raw
  try {
    raw = await readUpstream(port, payload, headers)
  } catch (error) {
    if (error && error.statusCode === 502) throw error
    if (error && error.code === 'TIMEOUT') throw gatewayError('起草服务 60 秒没有回复，超时')
    throw gatewayError('连不上起草服务')
  }
  if (raw.status < 200 || raw.status >= 300) throw gatewayError('起草服务没有给出可用回复')
  let parsed
  try {
    parsed = JSON.parse(raw.body)
  } catch {
    throw gatewayError('起草服务没有给出可用回复')
  }
  const content = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message
    ? parsed.choices[0].message.content
    : undefined
  if (typeof content !== 'string') throw gatewayError('起草服务没有给出可用回复')
  return content
}

let cachedComplete = null
let cachedSpec = ''

export async function resolveDraftComplete() {
  const spec = typeof process.env.SNOWFLAKE_FLOW_DRAFT_COMPLETE === 'string'
    ? process.env.SNOWFLAKE_FLOW_DRAFT_COMPLETE.trim()
    : ''
  if (!spec) return defaultComplete
  if (cachedComplete && cachedSpec === spec) return cachedComplete
  let mod
  try {
    const file = isAbsolute(spec) ? spec : resolve(spec)
    mod = await import(pathToFileURL(file).href)
  } catch {
    throw gatewayError('起草模型没有接上')
  }
  if (!mod || typeof mod.complete !== 'function') throw gatewayError('起草模型没有接上')
  cachedComplete = mod.complete
  cachedSpec = spec
  return cachedComplete
}
