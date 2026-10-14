import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { betaToXml } from '../server/flow-project.mjs'
import { draftFlow } from '../server/flow-draft.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverEntry = join(repoRoot, 'server', 'http.mjs')

const MISSING_END = 'No end event found. Add an \'end [id] "[Label]"\' declaration.'
const MISSING_START = 'No start event found. Add a \'start [id] "[Label]"\' declaration.'

const keptBeta = ['start s "开始"', 'end e "结束"', 's --> e'].join('\n')

const roundOneBeta = ['start s "第一轮标记"', 'task t "做事"', 's --> t'].join('\n')
const roundTwoBeta = ['end e "结束"', 'task t "第二轮标记"', 'e --> t'].join('\n')

const COMPLETE_SOURCE = [
  "import { readFileSync, writeFileSync } from 'node:fs'",
  'export async function complete(messages) {',
  '  const logPath = process.env.SNOWFLAKE_FLOW_DRAFT_LOG',
  '  const scriptPath = process.env.SNOWFLAKE_FLOW_DRAFT_SCRIPT',
  '  const script = JSON.parse(readFileSync(scriptPath, "utf8"))',
  '  let calls = []',
  '  try { calls = JSON.parse(readFileSync(logPath, "utf8")) } catch { calls = [] }',
  '  if (!Array.isArray(calls)) calls = []',
  '  calls.push(messages)',
  '  writeFileSync(logPath, JSON.stringify(calls))',
  '  const next = script[calls.length - 1]',
  '  if (typeof next !== "string") {',
  '    const error = new Error("连不上起草服务")',
  '    error.statusCode = 502',
  '    throw error',
  '  }',
  '  return next',
  '}',
  '',
].join('\n')

type DraftIssue = { ruleId?: string; message: string; elementId?: string }
type DraftBody = {
  xml: string
  beta: string
  validation: { ranAt: string; valid: boolean; errors: DraftIssue[]; warnings: DraftIssue[] }
  sourceRefs: Array<{ kind: string; id: string }>
  origin: string
  rounds: number
  document?: unknown
}

interface Running {
  base: string
  dataDir: string
  scriptPath: string
  logPath: string
  stop: () => Promise<void>
}

const running: Running[] = []

afterEach(async () => {
  while (running.length) await running.pop()?.stop()
})

function sampleDocument() {
  return {
    canvas: {
      nodes: [],
      edges: [
        { id: 'edgeGrow', fromNode: 'cardIdea', toNode: 'cardScene', kind: 'grows-from' },
        { id: 'edgeAppear', fromNode: 'cardScene', toNode: 'entPerson', kind: 'appears-in' },
        { id: 'edgeChapter', fromNode: 'ch1', toNode: 'sc1', kind: 'chapter-in' },
        { id: 'edgeSceneCard', fromNode: 'sc1', toNode: 'cardLinked', kind: 'chapter-in' },
        { id: 'edgeRelate', fromNode: 'cardIdea', toNode: 'cardScene', kind: 'relates' },
        { id: 'edgeOther', fromNode: 'ch2', toNode: 'sc2', kind: 'chapter-in' },
      ],
    },
    snowflake: {
      fileId: 'book-flow-draft',
      cards: {
        cardIdea: { layer: 'situation', body: '主角决定进城。', fields: { title: '决定' } },
        cardScene: {
          layer: 'changci',
          body: '城门口。',
          fields: {},
          originAnchor: { chapterId: 'ch1', sceneId: 'sc1' },
        },
        cardBeat: { layer: 'changci', body: '节拍上的卡。', fields: {} },
        cardLinked: { layer: 'changci', body: '场次连到的卡。', fields: {} },
        cardOther: {
          layer: 'situation',
          body: '另一章的事。',
          fields: {},
          originAnchor: { chapterId: 'ch2', sceneId: 'sc2' },
        },
        cardPic: { layer: 'situation', body: '看见图 data:image/png;base64,aaaa 图完', fields: {} },
      },
    },
    chapters: [
      {
        id: 'ch1',
        title: '第一章',
        scenes: [
          {
            id: 'sc1',
            title: '进城',
            prose: '开头可见。\n\n后段不送的句子',
            placeEntityId: 'entPlace',
            beatIds: ['cardBeat'],
          },
        ],
      },
      {
        id: 'ch2',
        title: '第二章',
        scenes: [{ id: 'sc2', title: '离开了城外', prose: '甲'.repeat(450) }],
      },
    ],
    entities: [
      { id: 'entPerson', name: '阿禾' },
      { id: 'entPlace', name: '城门' },
      { id: 'entUnused', name: '路人未引用' },
    ],
  }
}

function fenced(beta: string) {
  return `先说一句。\n\`\`\`bpmn-beta\n${beta}\n\`\`\`\n`
}

function bookCitedBeta() {
  return [
    'bpmn-beta',
    '# card:cardIdea',
    '# card:no-such',
    '# edge:edgeGrow',
    '# edge:edgeRelate',
    '# chapter:ch1',
    '# scene:sc1',
    '# entity:entPerson',
    '# entity:entUnused',
    '# scene:sc2',
    '# entity:entPlace',
    'start s "开始"',
    'end e "结束"',
    's --> e',
  ].join('\n')
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await exited
}

async function startServer(): Promise<Running> {
  const dataDir = await mkdtemp(join(tmpdir(), 'snowflake-flow-draft-data-'))
  const home = await mkdtemp(join(tmpdir(), 'snowflake-flow-draft-home-'))
  const scratch = await mkdtemp(join(tmpdir(), 'snowflake-flow-draft-scratch-'))
  const scriptPath = join(scratch, 'script.json')
  const logPath = join(scratch, 'calls.json')
  const completePath = join(scratch, 'complete.mjs')
  await writeFile(completePath, COMPLETE_SOURCE)
  await writeFile(scriptPath, '[]')
  await writeFile(logPath, '[]')
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    SNOWFLAKE_DATA_DIR: dataDir,
    SNOWFLAKE_LISTEN_HOST: '127.0.0.1',
    SNOWFLAKE_PORT: String(port),
    SNOWFLAKE_EXPAND_PORT: '9',
    SNOWFLAKE_FLOW_DRAFT_COMPLETE: completePath,
    SNOWFLAKE_FLOW_DRAFT_SCRIPT: scriptPath,
    SNOWFLAKE_FLOW_DRAFT_LOG: logPath,
    API_SERVER_KEY: '',
  }
  const child: ChildProcess = spawn(process.execPath, [serverEntry], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.on('data', (chunk) => {
    output += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    output += String(chunk)
  })
  const base = `http://127.0.0.1:${port}`
  const fail = async (message: string) => {
    await stopChild(child)
    await rm(dataDir, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
    await rm(scratch, { recursive: true, force: true })
    throw new Error(`${message}：${output}`)
  }
  const deadline = Date.now() + 15_000
  for (;;) {
    if (child.exitCode !== null) await fail('服务器没起来')
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) break
    } catch {
      // 还没开始监听。
    }
    if (Date.now() > deadline) await fail('服务器起不来')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const handle: Running = {
    base,
    dataDir,
    scriptPath,
    logPath,
    stop: async () => {
      await stopChild(child)
      await rm(dataDir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
      await rm(scratch, { recursive: true, force: true })
      const index = running.indexOf(handle)
      if (index >= 0) running.splice(index, 1)
    },
  }
  running.push(handle)
  return handle
}

async function setScript(server: Running, responses: Array<string | null>) {
  await writeFile(server.scriptPath, JSON.stringify(responses))
  await writeFile(server.logPath, '[]')
}

async function readCalls(server: Running) {
  const text = await readFile(server.logPath, 'utf8')
  return JSON.parse(text) as Array<Array<{ role: string; content: string }>>
}

function joined(calls: Array<Array<{ role: string; content: string }>>, index: number) {
  return (calls[index] ?? []).map((message) => message.content).join('\n')
}

async function bookFile(dataDir: string) {
  const books = await readdir(join(dataDir, 'books'))
  expect(books).toHaveLength(1)
  return readFile(join(dataDir, 'books', books[0], 'snowflake.json'), 'utf8')
}

async function getCanvas(server: Running) {
  const response = await fetch(`${server.base}/api/canvas`)
  const text = await response.text()
  return {
    response,
    text,
    body: JSON.parse(text) as { version: number; document: { flows?: Array<{ id: string; origin: string }> } },
  }
}

async function putCanvas(server: Running, document: unknown, etag: string) {
  const response = await fetch(`${server.base}/api/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify(document),
  })
  const text = await response.text()
  return {
    response,
    text,
    body: text ? (JSON.parse(text) as { version: number; document: { flows?: unknown[] } }) : null,
  }
}

async function postDraft(server: Running, body: unknown, path = '/api/flows/draft') {
  const response = await fetch(`${server.base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { response, text, body: text ? (JSON.parse(text) as DraftBody & { error?: string }) : null }
}

describe('流程起草', () => {
  it('假函数一次就交出合法 beta，来源只留下材料里有的', async () => {
    const seen: string[] = []
    const draft = await draftFlow(sampleDocument(), { kind: 'book' }, {
      complete: async (messages) => {
        seen.push(messages.map((message) => message.content).join('\n'))
        if (seen.length > 1) throw new Error('多问了')
        return fenced(bookCitedBeta())
      },
    })
    expect(draft.rounds).toBe(1)
    expect(draft.origin).toBe('llm')
    expect(draft.validation.valid).toBe(true)
    expect(draft.beta).toBe(keptBeta)
    expect(draft.beta.startsWith('bpmn-beta')).toBe(false)
    expect(draft.xml).toContain('<bpmn:startEvent')
    expect(draft.sourceRefs).toEqual([
      { kind: 'card', id: 'cardIdea' },
      { kind: 'edge', id: 'edgeGrow' },
      { kind: 'chapter', id: 'ch1' },
      { kind: 'scene', id: 'sc1' },
      { kind: 'entity', id: 'entPerson' },
      { kind: 'scene', id: 'sc2' },
      { kind: 'entity', id: 'entPlace' },
    ])
    expect(seen[0]).toContain('其余')
    expect(seen[0]).toContain('主角决定进城。')
    expect(seen[0]).toContain('开头可见。')
    expect(seen[0]).not.toContain('后段不送')
    expect(seen[0]).toContain('甲'.repeat(400))
    expect(seen[0]).not.toContain('甲'.repeat(401))
    expect(seen[0]).not.toContain('edgeRelate')
    expect(seen[0]).not.toContain('路人未引用')
    expect(seen[0]).toContain('看见图')
    expect(seen[0]).toContain('[图片]')
    expect(seen[0]).not.toContain('base64')
  })

  it('一次合法就返回草稿，活动书里的流程保持打开时的样子', async () => {
    const server = await startServer()
    const opened = await getCanvas(server)
    expect(opened.response.status).toBeLessThan(400)
    expect(opened.body.document.flows).toBeUndefined()
    const saved = await putCanvas(server, sampleDocument(), opened.response.headers.get('etag') ?? '')
    expect(saved.response.status, saved.text).toBe(200)
    const before = await bookFile(server.dataDir)
    const version = saved.body?.version
    await setScript(server, [fenced(bookCitedBeta())])

    const drafted = await postDraft(server, {
      scope: { kind: 'book' },
      xml: '<injected/>',
      beta: 'task hacked "不要写入"',
      flows: [{ id: 'from-client' }],
    })
    expect(drafted.response.status, drafted.text).toBe(200)
    const body = drafted.body
    expect(body?.xml).toContain('<bpmn:startEvent')
    expect(body?.xml).toContain('id="e"')
    expect(body?.beta).toBe(keptBeta)
    expect(body?.beta.startsWith('bpmn-beta')).toBe(false)
    expect(body?.beta).not.toContain('#')
    expect(body?.validation.valid).toBe(true)
    expect(body?.validation.errors).toEqual([])
    expect(Array.isArray(body?.validation.warnings)).toBe(true)
    expect(Number.isNaN(Date.parse(body?.validation.ranAt ?? ''))).toBe(false)
    expect(Object.keys(body?.validation ?? {}).sort()).toEqual(['errors', 'ranAt', 'valid', 'warnings'])
    expect(body?.sourceRefs).toEqual([
      { kind: 'card', id: 'cardIdea' },
      { kind: 'edge', id: 'edgeGrow' },
      { kind: 'chapter', id: 'ch1' },
      { kind: 'scene', id: 'sc1' },
      { kind: 'entity', id: 'entPerson' },
      { kind: 'scene', id: 'sc2' },
      { kind: 'entity', id: 'entPlace' },
    ])
    expect(body?.origin).toBe('llm')
    expect(body?.rounds).toBe(1)
    expect(body?.document).toBeUndefined()
    expect((await readCalls(server))).toHaveLength(1)

    expect(await bookFile(server.dataDir)).toBe(before)
    const again = await getCanvas(server)
    expect(again.body.version).toBe(version)
    expect(again.body.document.flows).toBeUndefined()

    const books = (await (await fetch(`${server.base}/api/books`)).json()) as { activeBookId: string }
    await setScript(server, [fenced(bookCitedBeta())])
    const scoped = await postDraft(server, { scope: { kind: 'book' } }, `/api/books/${books.activeBookId}/flows/draft`)
    expect(scoped.response.status, scoped.text).toBe(200)
    expect(scoped.body?.rounds).toBe(1)
    expect(scoped.body?.origin).toBe('llm')
    expect(await bookFile(server.dataDir)).toBe(before)
  }, 40_000)

  it('前两轮非法，第三轮合法，模型第三次能看见上一轮错误原文', async () => {
    const server = await startServer()
    const opened = await getCanvas(server)
    await setScript(server, [roundOneBeta, roundTwoBeta, keptBeta])
    const before = await bookFile(server.dataDir)
    const drafted = await postDraft(server, { scope: { kind: 'book' } })
    expect(drafted.response.status, drafted.text).toBe(200)
    expect(drafted.body?.rounds).toBe(3)
    expect(drafted.body?.validation.valid).toBe(true)
    expect(drafted.body?.origin).toBe('llm')
    expect(drafted.body?.beta).toBe(keptBeta)
    const calls = await readCalls(server)
    expect(calls).toHaveLength(3)
    const third = joined(calls, 2)
    expect(third).toContain(MISSING_START)
    expect(third).toContain('第二轮标记')
    expect(third).not.toContain('第一轮标记')
    expect(third).not.toContain(MISSING_END)
    expect(joined(calls, 0)).not.toContain(MISSING_END)
    expect(joined(calls, 1)).toContain(MISSING_END)
    expect(joined(calls, 1)).toContain('第一轮标记')
    expect(await bookFile(server.dataDir)).toBe(before)
    expect((await getCanvas(server)).body.version).toBe(opened.body.version)
    expect((await getCanvas(server)).body.document.flows).toBeUndefined()
  }, 40_000)

  it('三轮都非法仍返回草稿，没有第四次调用', async () => {
    const server = await startServer()
    await getCanvas(server)
    await setScript(server, [roundOneBeta, roundOneBeta, roundOneBeta, keptBeta])
    const before = await bookFile(server.dataDir)
    const drafted = await postDraft(server, { scope: { kind: 'book' } })
    expect(drafted.response.status, drafted.text).toBe(200)
    expect(drafted.body?.validation.valid).toBe(false)
    expect(drafted.body?.validation.errors.length).toBeGreaterThan(0)
    expect(drafted.body?.validation.errors.some((error) => error.message === MISSING_END)).toBe(true)
    expect(drafted.body?.rounds).toBe(3)
    expect(drafted.body?.origin).toBe('llm')
    expect(drafted.body?.beta).toBe(roundOneBeta)
    expect(drafted.body?.xml).toContain('<bpmn:startEvent')
    expect(await readCalls(server)).toHaveLength(3)
    expect(await bookFile(server.dataDir)).toBe(before)
    expect((await getCanvas(server)).body.document.flows).toBeUndefined()
  }, 40_000)

  it('三轮都无法投影时仍返回草稿，xml 为空', async () => {
    const server = await startServer()
    await getCanvas(server)
    const junk = '这不是流程'
    await setScript(server, [junk, junk, junk])
    const drafted = await postDraft(server, { scope: { kind: 'book' } })
    expect(drafted.response.status, drafted.text).toBe(200)
    expect(drafted.body?.xml).toBe('')
    expect(drafted.body?.beta).toBe(junk)
    expect(drafted.body?.validation.valid).toBe(false)
    expect(drafted.body?.validation.errors.some((error) => error.message.startsWith('投影成 XML 失败：'))).toBe(true)
    expect(drafted.body?.rounds).toBe(3)
    expect(drafted.body?.origin).toBe('llm')
    expect(await readCalls(server)).toHaveLength(3)
  }, 40_000)

  it('范围对不上时不调用模型，也不改正本', async () => {
    const server = await startServer()
    const opened = await getCanvas(server)
    const saved = await putCanvas(server, sampleDocument(), opened.response.headers.get('etag') ?? '')
    expect(saved.response.status, saved.text).toBe(200)
    const before = await bookFile(server.dataDir)
    await setScript(server, [keptBeta])

    const missingChapter = await postDraft(server, { scope: { kind: 'chapter', chapterId: 'missing' } })
    expect(missingChapter.response.status).toBe(400)
    expect(missingChapter.body?.error).toBe('没有这一章')
    expect(await readCalls(server)).toHaveLength(0)

    const missingScene = await postDraft(server, { scope: { kind: 'scene', chapterId: 'ch1', sceneId: 'sc2' } })
    expect(missingScene.response.status).toBe(400)
    expect(missingScene.body?.error).toBe('没有这一场')
    expect(await readCalls(server)).toHaveLength(0)

    const badKind = await postDraft(server, { scope: { kind: 'nope' }, xml: '<a/>', beta: 'x', flows: [] })
    expect(badKind.response.status).toBe(400)
    expect(await readCalls(server)).toHaveLength(0)

    const books = (await (await fetch(`${server.base}/api/books`)).json()) as { activeBookId: string }
    const missingBook = await postDraft(server, { scope: { kind: 'book' } }, '/api/books/missingbook/flows/draft')
    expect(missingBook.response.status).toBe(404)
    expect(missingBook.body?.error).toBe('没有这本书')
    expect(await readCalls(server)).toHaveLength(0)
    expect(books.activeBookId).not.toBe('missingbook')
    expect(await bookFile(server.dataDir)).toBe(before)
  }, 40_000)

  it('章和场只带范围内的卡片、场次和边', async () => {
    const server = await startServer()
    const opened = await getCanvas(server)
    const saved = await putCanvas(server, sampleDocument(), opened.response.headers.get('etag') ?? '')
    expect(saved.response.status, saved.text).toBe(200)
    const before = await bookFile(server.dataDir)
    const chapterReply = [
      '# card:cardScene',
      '# card:cardOther',
      '# card:cardIdea',
      '# edge:edgeAppear',
      '# edge:edgeGrow',
      'start s "开始"',
      'end e "结束"',
      's --> e',
    ].join('\n')
    await setScript(server, [chapterReply])
    const chapter = await postDraft(server, { scope: { kind: 'chapter', chapterId: 'ch1' } })
    expect(chapter.response.status, chapter.text).toBe(200)
    expect(chapter.body?.validation.valid).toBe(true)
    expect(chapter.body?.sourceRefs).toEqual([
      { kind: 'card', id: 'cardScene' },
      { kind: 'edge', id: 'edgeAppear' },
    ])
    const chapterPrompt = joined(await readCalls(server), 0)
    expect(chapterPrompt).toContain('城门口。')
    expect(chapterPrompt).toContain('节拍上的卡。')
    expect(chapterPrompt).toContain('场次连到的卡。')
    expect(chapterPrompt).toContain('开头可见。')
    expect(chapterPrompt).toContain('edgeAppear')
    expect(chapterPrompt).toContain('edgeSceneCard')
    expect(chapterPrompt).toContain('阿禾')
    expect(chapterPrompt).toContain('城门')
    expect(chapterPrompt).not.toContain('主角决定进城。')
    expect(chapterPrompt).not.toContain('另一章的事。')
    expect(chapterPrompt).not.toContain('后段不送')
    expect(chapterPrompt).not.toContain('甲')
    expect(chapterPrompt).not.toContain('edgeGrow')
    expect(chapterPrompt).not.toContain('edgeOther')
    expect(chapterPrompt).not.toContain('edgeRelate')
    expect(chapterPrompt).not.toContain('路人未引用')
    expect(chapterPrompt).not.toContain('离开了城外')
    expect(chapterPrompt).not.toContain('看见图')

    await setScript(server, [keptBeta])
    const scene = await postDraft(server, { scope: { kind: 'scene', chapterId: 'ch2', sceneId: 'sc2' } })
    expect(scene.response.status, scene.text).toBe(200)
    const scenePrompt = joined(await readCalls(server), 0)
    expect(scenePrompt).toContain('另一章的事。')
    expect(scenePrompt).toContain('甲'.repeat(400))
    expect(scenePrompt).not.toContain('甲'.repeat(401))
    expect(scenePrompt).not.toContain('开头可见。')
    expect(scenePrompt).not.toContain('城门口。')
    expect(scenePrompt).not.toContain('节拍上的卡。')
    expect(scenePrompt).not.toContain('主角决定进城。')
    expect(await bookFile(server.dataDir)).toBe(before)
  }, 40_000)

  it('已有流程不被起草改写；连不上时也不写正本', async () => {
    const server = await startServer()
    const opened = await getCanvas(server)
    const xml = betaToXml(keptBeta)
    const document = {
      ...sampleDocument(),
      flows: [
        {
          id: 'flow-kept',
          title: '已有',
          scope: { kind: 'book' },
          xml,
          beta: 'old-beta',
          origin: 'human',
          sourceRefs: [{ kind: 'card', id: 'cardIdea' }],
          validation: {
            ranAt: '2026-10-14T00:00:00.000Z',
            valid: true,
            errors: [],
            warnings: [],
          },
        },
      ],
    }
    const saved = await putCanvas(server, document, opened.response.headers.get('etag') ?? '')
    expect(saved.response.status, saved.text).toBe(200)
    const stored = await getCanvas(server)
    expect(stored.body.document.flows).toHaveLength(1)
    expect(stored.body.document.flows?.[0].id).toBe('flow-kept')
    expect(stored.body.document.flows?.[0].origin).toBe('human')
    const before = await bookFile(server.dataDir)

    await setScript(server, [fenced(bookCitedBeta())])
    const drafted = await postDraft(server, { scope: { kind: 'book' }, flows: [{ id: 'from-client' }] })
    expect(drafted.response.status, drafted.text).toBe(200)
    expect(drafted.body?.origin).toBe('llm')
    expect(await bookFile(server.dataDir)).toBe(before)
    const after = await getCanvas(server)
    expect(after.body.version).toBe(stored.body.version)
    expect(after.body.document.flows).toEqual(stored.body.document.flows)

    await setScript(server, [null])
    const failed = await postDraft(server, { scope: { kind: 'book' } })
    expect(failed.response.status).toBe(502)
    expect(failed.body?.error).toBe('连不上起草服务')
    expect(failed.text).not.toContain('ECONNREFUSED')
    expect(failed.text).not.toContain('choices')
    expect(await readCalls(server)).toHaveLength(1)
    expect(await bookFile(server.dataDir)).toBe(before)
    expect((await getCanvas(server)).body.document.flows).toEqual(stored.body.document.flows)
  }, 40_000)
})
