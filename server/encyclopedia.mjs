import { stripTimeline } from './discuss-context.mjs'

const MARKER = '<!-- timeline -->'
const wrote = new Set()
const inflight = new Map()

const LABEL = {
  sentence: '一句',
  background: '背景',
  disaster1: '灾难一',
  disaster2: '灾难二',
  disaster3: '灾难三',
  ending: '结局',
  fourPages: '四页大纲',
  name: '名字',
  role: '角色',
  motivation: '动机',
  goal: '目标',
  conflict: '冲突',
  epiphany: '顿悟',
  paragraph: '一段',
  grade: '类别',
  who: '哪个人',
  length: '篇幅',
  story: '从他眼里看的故事',
  bodyName: '名字',
  age: '年龄',
  birthday: '生日',
  height: '身高',
  weight: '体重',
  ethnicity: '族裔',
  hairEyes: '发色瞳色',
  looks: '外貌',
  clothes: '穿着',
  humor: '幽默感',
  personality: '人格类型',
  religion: '宗教',
  politics: '党派',
  hobbies: '爱好',
  taste: '喜欢的音乐书电影',
  favColor: '喜欢的颜色',
  bag: '钱包或包里有什么',
  home: '家',
  education: '教育',
  job: '工作',
  family: '家人',
  bestFriend: '最好的朋友',
  maleFriends: '男性朋友',
  femaleFriends: '女性朋友',
  enemies: '敌人',
  bestMemory: '最好的童年记忆',
  worstMemory: '最坏的童年记忆',
  traitLine: '一句性格概括',
  strongest: '最强特质',
  weakest: '最弱特质',
  paradox: '这个人的悖论',
  hope: '最大的希望',
  fear: '最大的恐惧',
  philosophy: '人生哲学',
  selfView: '他怎么看自己',
  othersView: '别人怎么看他',
  endingChange: '结局时他怎么变',
  pov: '视角',
  adopted: '采纳',
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function clearPromoteMemory() {
  wrote.clear()
  inflight.clear()
}

export function fieldLineLabel(key) {
  return LABEL[key] || key
}

function blocksToMarkdown(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const value = typeof block.text === 'string' ? block.text : ''
      if (block.type === 'heading') return `# ${value}`
      if (block.type === 'quote') return value.split('\n').map((line) => `> ${line}`).join('\n')
      if (block.type === 'todo') return `- [${block.checked === true ? 'x' : ' '}] ${value}`
      if (block.type === 'divider') return '---'
      if (block.type === 'image') {
        const alt = typeof block.alt === 'string' ? block.alt : value
        const relativePath = typeof block.relativePath === 'string' ? block.relativePath : ''
        return `![${alt}](${relativePath})`
      }
      if (block.type === 'file') {
        const name = typeof block.name === 'string' ? block.name : value
        const relativePath = typeof block.relativePath === 'string' ? block.relativePath : ''
        const size = typeof block.size === 'number' && Number.isFinite(block.size) ? block.size : 0
        return `[${name}](${relativePath} "${size}")`
      }
      return value
    })
    .filter((line) => line.length > 0)
    .join('\n\n')
}

function blocksForField(document, entity, key) {
  const cards = document && document.snowflake && document.snowflake.cards
  if (!cards || typeof cards !== 'object') return null
  const views = entity.views && typeof entity.views === 'object' ? entity.views : {}
  const ids = [views.renwubiao, views.renwugushi, views.renwudangan]
  for (const id of ids) {
    if (typeof id !== 'string' || !cards[id]) continue
    const list = cards[id].blocks && cards[id].blocks[key]
    if (Array.isArray(list) && list.length > 0) return list
  }
  return null
}

export function composeEntityPage(entity, document) {
  if (!entity || typeof entity !== 'object') return ''
  const lines = []
  const name = text(entity.name)
  if (name) lines.push(name)
  const fields = entity.fields && typeof entity.fields === 'object' ? entity.fields : {}
  for (const [key, field] of Object.entries(fields)) {
    if (key === 'cover') continue
    if (!field || typeof field.value !== 'string') continue
    const value = field.value.trim()
    if (!value && !blocksForField(document, entity, key)) continue
    if (key === 'name' && value === name) continue
    const rich = blocksForField(document, entity, key)
    if (rich) {
      const markdown = blocksToMarkdown(rich)
      if (markdown) lines.push(markdown)
      continue
    }
    if (!value) continue
    lines.push(`${fieldLineLabel(key)}：${value}`)
  }
  return lines.join('\n\n')
}

export function timelineBelow(markdown) {
  const raw = typeof markdown === 'string' ? markdown : ''
  const at = raw.indexOf(MARKER)
  if (at < 0) return ''
  return raw.slice(at + MARKER.length).trim()
}

export function finalizedText(markdown) {
  return stripTimeline(markdown)
}

// 页已存在时，分隔线以上换成卡面，分隔线以下原样留着。
export function replaceAboveTimeline(existing, body) {
  const raw = typeof existing === 'string' ? existing : ''
  const at = raw.indexOf(MARKER)
  const head = at < 0 ? raw : raw.slice(0, at)
  const tail = at < 0 ? '' : raw.slice(at).replace(/^\s*/, '')
  const frontMatch = head.match(/^---\r?\n[\s\S]*?\r?\n---/)
  const parts = []
  if (frontMatch) parts.push(frontMatch[0])
  const compiled = text(body)
  if (compiled) parts.push(compiled)
  if (tail) parts.push(tail)
  if (parts.length === 0) return ''
  const joined = parts.join('\n\n')
  return joined.endsWith('\n') ? joined : `${joined}\n`
}

export function parsePageSnapshot(stdout) {
  const raw = typeof stdout === 'string' ? stdout : ''
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return null
  let value
  try {
    value = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const revision = text(value.revision)
  if (!revision) return null
  return { revision, content: typeof value.content === 'string' ? value.content : '' }
}

export function pageMissingMessage(message) {
  const raw = typeof message === 'string' ? message : ''
  return raw.includes('page_not_found') || raw.includes('Page not found')
}

async function promoteOnce(input, deps) {
  const requestId = text(input.requestId)
  const slug = text(input.slug)
  const body = text(input.body)
  if (!requestId) return { ok: false, statusCode: 400, error: '缺少 requestId' }
  if (!slug) return { ok: false, statusCode: 400, error: '还没绑定' }
  if (!body) return { ok: false, statusCode: 400, error: '卡面是空的，没有写入' }
  let current = null
  try {
    current = await deps.readPage(slug)
  } catch (error) {
    return { ok: false, statusCode: 502, error: error instanceof Error ? error.message : 'gbrain 读取失败' }
  }
  const content = replaceAboveTimeline(current && current.content, body)
  const put = { slug, content, requestId }
  if (current) {
    const revision = text(current.revision)
    if (!revision) return { ok: false, statusCode: 502, error: '没有读到页的版本，没有写入' }
    put.expectedRevision = revision
  }
  try {
    await deps.putPage(put)
  } catch (error) {
    return { ok: false, statusCode: 502, error: error instanceof Error ? error.message : '升格没有写上' }
  }
  return { ok: true, statusCode: 200, slug }
}

// 同一个 requestId 成功之后再试，不再 put 第二次。失败不记成已写，还可以再试。
export function promoteEncyclopedia(input, deps) {
  const requestId = text(input.requestId)
  const bookId = text(input.bookId)
  const key = `${bookId}\0${requestId}`
  if (!requestId) return Promise.resolve({ ok: false, statusCode: 400, error: '缺少 requestId' })
  if (wrote.has(key)) return Promise.resolve({ ok: true, statusCode: 200, slug: text(input.slug), skipped: true })
  const pending = inflight.get(key)
  if (pending) return pending
  const run = (async () => {
    const result = await promoteOnce(input, deps)
    if (result.ok) wrote.add(key)
    return result
  })().finally(() => {
    if (inflight.get(key) === run) inflight.delete(key)
  })
  inflight.set(key, run)
  return run
}

export async function promoteEntityPage(document, entityId, requestId, deps) {
  const entities = document && Array.isArray(document.entities) ? document.entities : []
  const entity = entities.find((item) => item && item.id === entityId)
  if (!entity) return { ok: false, statusCode: 404, error: '没有这个实体' }
  const slug = text(entity.slug)
  if (!slug) return { ok: false, statusCode: 400, error: '还没绑定' }
  const body = composeEntityPage(entity, document)
  return promoteEncyclopedia({ slug, body, requestId, bookId: deps.bookId || '' }, deps)
}
