import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { betaToXml, xmlToBeta } from '../server/flow-project.mjs'
import { validateBpmnBeta } from '../server/vendor/validate-bpmn-beta.mjs'
import { validateDocumentFlows } from '../server/flow-validate.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverEntry = join(repoRoot, 'server', 'http.mjs')

type FlowIssue = { ruleId?: string; message: string; elementId?: string; element?: string }
type FlowValidation = { ranAt: string; valid: boolean; errors: FlowIssue[]; warnings: FlowIssue[] }
type SavedFlow = {
  id: string
  title: string
  scope: { kind: string; chapterId?: string; sceneId?: string }
  xml: string
  beta: string
  origin: string
  sourceRefs: Array<{ kind: string; id: string }>
  validation: FlowValidation
}

function blankValidation(valid = true): FlowValidation {
  return { ranAt: '2026-10-14T00:00:00.000Z', valid, errors: [], warnings: [] }
}

function flowOf(partial: Partial<SavedFlow> & Pick<SavedFlow, 'id' | 'xml'>): SavedFlow {
  return {
    title: '主线',
    scope: { kind: 'book' },
    beta: 'old-beta',
    origin: 'human',
    sourceRefs: [{ kind: 'card', id: 'card-1' }],
    validation: blankValidation(),
    ...partial,
  }
}

function canvasOf(flows: SavedFlow[]) {
  return {
    canvas: { nodes: [], edges: [] },
    snowflake: { fileId: 'book-flow-validate', cards: {} },
    flows,
  }
}

interface Running {
  base: string
  stop: () => Promise<void>
}

const running: Running[] = []

afterEach(async () => {
  while (running.length) await running.pop()?.stop()
})

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
  const dataDir = await mkdtemp(join(tmpdir(), 'snowflake-flow-validate-data-'))
  const home = await mkdtemp(join(tmpdir(), 'snowflake-flow-validate-home-'))
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    SNOWFLAKE_DATA_DIR: dataDir,
    SNOWFLAKE_LISTEN_HOST: '127.0.0.1',
    SNOWFLAKE_PORT: String(port),
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
    stop: async () => {
      await stopChild(child)
      await rm(dataDir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
      const index = running.indexOf(handle)
      if (index >= 0) running.splice(index, 1)
    },
  }
  running.push(handle)
  return handle
}

async function getCanvas(server: Running) {
  const response = await fetch(`${server.base}/api/canvas`)
  const text = await response.text()
  return {
    response,
    text,
    body: JSON.parse(text) as { version: number; document: { flows?: SavedFlow[] } },
  }
}

async function putCanvas(server: Running, document: unknown, etag: string) {
  const response = await fetch(`${server.base}/api/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify(document),
  })
  const text = await response.text()
  return { response, text, body: text ? (JSON.parse(text) as { document?: { flows?: SavedFlow[] } }) : null }
}

function diagram(lines: string[]) {
  return ['bpmn-beta', ...lines].join('\n')
}

function checked(lines: string[]) {
  return validateBpmnBeta(diagram(lines)) as {
    valid: boolean
    errors: Array<{ ruleId: string; message: string; element?: string }>
    warnings: Array<{ message: string; element?: string }>
  }
}

function ruleIds(lines: string[]) {
  return checked(lines).errors.map((error) => error.ruleId)
}

const legalLines = ['start s "开始"', 'end e "结束"', 's --> e']

describe('保存流程时写入 validation', () => {
  it('最小流程校验通过；空 xml 跳过，不另造 xml', async () => {
    const source = legalLines.join('\n')
    const xml = betaToXml(source)
    const kept = flowOf({
      id: 'flow-empty',
      title: '空的',
      xml: '',
      beta: 'keep-beta',
      validation: blankValidation(),
    })
    const server = await startServer()
    const opened = await getCanvas(server)
    expect(opened.response.status).toBeLessThan(400)
    const saved = await putCanvas(
      server,
      canvasOf([
        flowOf({ id: 'flow-ok', xml, beta: 'old-beta' }),
        kept,
      ]),
      opened.response.headers.get('etag') ?? '',
    )
    expect(saved.response.status, saved.text).toBe(200)

    const read = await getCanvas(server)
    expect(read.response.status).toBeLessThan(400)
    const ok = read.body.document.flows?.find((item) => item.id === 'flow-ok')
    const empty = read.body.document.flows?.find((item) => item.id === 'flow-empty')
    expect(ok).toBeTruthy()
    expect(ok?.xml).toBe(xml)
    expect(ok?.beta).toBe(source)
    expect(ok?.beta).toBe(xmlToBeta(ok?.xml ?? ''))
    expect(ok?.beta.startsWith('bpmn-beta')).toBe(false)
    expect(ok?.title).toBe('主线')
    expect(ok?.scope).toEqual({ kind: 'book' })
    expect(ok?.origin).toBe('human')
    expect(ok?.sourceRefs).toEqual([{ kind: 'card', id: 'card-1' }])
    expect(ok?.validation.valid).toBe(true)
    expect(ok?.validation.errors).toEqual([])
    expect(Array.isArray(ok?.validation.warnings)).toBe(true)
    expect(Number.isNaN(Date.parse(ok?.validation.ranAt ?? ''))).toBe(false)
    expect(Object.keys(ok ?? {}).sort()).toEqual(['beta', 'id', 'origin', 'scope', 'sourceRefs', 'title', 'validation', 'xml'])
    expect(Object.keys(ok?.validation ?? {}).sort()).toEqual(['errors', 'ranAt', 'valid', 'warnings'])

    expect(empty?.xml).toBe('')
    expect(empty?.beta).toBe('keep-beta')
    expect(empty?.validation).toEqual(blankValidation())
  }, 30_000)

  it('线指向未声明的节点时仍然保存，elementId 是那个端点', async () => {
    const source = ['start s "开始"', 'end e "结束"', 's --> ghost'].join('\n')
    const xml = betaToXml(source)
    const server = await startServer()
    const opened = await getCanvas(server)
    const saved = await putCanvas(
      server,
      canvasOf([flowOf({ id: 'flow-dangling', xml })]),
      opened.response.headers.get('etag') ?? '',
    )
    expect(saved.response.status, saved.text).toBe(200)

    const read = await getCanvas(server)
    const flow = read.body.document.flows?.find((item) => item.id === 'flow-dangling')
    expect(flow?.xml).toBe(xml)
    expect(flow?.beta).toBe(xmlToBeta(xml))
    expect(flow?.validation.valid).toBe(false)
    const hit = flow?.validation.errors.find((error) => error.elementId === 'ghost')
    expect(hit?.ruleId).toBe('VR-004')
    expect(hit).not.toHaveProperty('element')
    expect(flow?.id).toBe('flow-dangling')
    expect(flow?.origin).toBe('human')
    expect(flow?.sourceRefs).toEqual([{ kind: 'card', id: 'card-1' }])
  }, 30_000)

  it('xml 无法投影时仍然保存，并记下失败原因', async () => {
    const server = await startServer()
    const opened = await getCanvas(server)
    const saved = await putCanvas(
      server,
      canvasOf([flowOf({ id: 'flow-bad', xml: '<broken', beta: 'keep-beta' })]),
      opened.response.headers.get('etag') ?? '',
    )
    expect(saved.response.status, saved.text).toBe(200)
    const read = await getCanvas(server)
    const flow = read.body.document.flows?.find((item) => item.id === 'flow-bad')
    expect(flow?.xml).toBe('<broken')
    expect(flow?.beta).toBe('keep-beta')
    expect(flow?.title).toBe('主线')
    expect(flow?.scope).toEqual({ kind: 'book' })
    expect(flow?.origin).toBe('human')
    expect(flow?.sourceRefs).toEqual([{ kind: 'card', id: 'card-1' }])
    expect(flow?.validation.valid).toBe(false)
    expect(flow?.validation.errors).toEqual([
      { ruleId: 'snowflake.validate-failed', message: expect.stringMatching(/\S/) },
    ])
    expect(flow?.validation.warnings).toEqual([])
  }, 30_000)
})

describe('保存路径把上游字段改名后写入 validation', () => {
  it('没有 xml 时不改 beta，也不改已有校验', async () => {
    const empty = flowOf({ id: 'flow-empty', xml: '', beta: 'keep-beta' })
    const missing = { ...flowOf({ id: 'flow-missing', xml: 'unused', beta: 'keep-two' }) }
    delete (missing as { xml?: string }).xml
    await validateDocumentFlows({ flows: [empty, missing] })
    expect(empty.beta).toBe('keep-beta')
    expect(empty.validation).toEqual(blankValidation())
    expect(missing.beta).toBe('keep-two')
    expect(missing.validation).toEqual(blankValidation())
  })

  it('自环并进同一份错误；并行网关的警告把 element 写成 elementId', async () => {
    const loopBeta = ['start s "开始"', 'end e "结束"', 's --> s', 's --> e'].join('\n')
    const loop = flowOf({ id: 'flow-loop', xml: betaToXml(loopBeta) })
    const splitBeta = [
      'start s "开始"',
      'and split "并行"',
      'task t "做事"',
      'end e1 "甲"',
      'end e2 "乙"',
      's --> split',
      'split --> t',
      'split --> e1',
      't --> e2',
    ].join('\n')
    const split = flowOf({ id: 'flow-split', xml: betaToXml(splitBeta) })
    await validateDocumentFlows({ flows: [loop, split] })

    expect(loop.validation.valid).toBe(false)
    expect(loop.validation.errors).toContainEqual({
      ruleId: 'snowflake.self-loop',
      message: 's 连回了自己',
      elementId: 's',
    })
    expect(loop.beta).toBe(xmlToBeta(loop.xml))

    expect(split.validation.valid).toBe(true)
    const warning = split.validation.warnings.find((item) => item.elementId === 'split')
    expect(warning?.message).toContain('AND')
    expect(warning).not.toHaveProperty('element')
    expect(split.validation.errors).toEqual([])
  })
})

describe('bpmn-beta 规则 VR-001 到 VR-012', () => {
  it('VR-001 没有起点就报，有起点不报', () => {
    expect(ruleIds(['end e "结束"', 'task t "做事"', 't --> e'])).toContain('VR-001')
    expect(ruleIds(legalLines)).not.toContain('VR-001')
  })

  it('VR-002 没有终点就报，有终点不报', () => {
    expect(ruleIds(['start s "开始"', 'task t "做事"', 's --> t'])).toContain('VR-002')
    expect(ruleIds(legalLines)).not.toContain('VR-002')
  })

  it('VR-003 线的起点没声明就报，声明了不报', () => {
    const hit = checked(['start s "开始"', 'end e "结束"', 'ghost --> e', 's --> e'])
    expect(hit.errors).toContainEqual({
      ruleId: 'VR-003',
      message: "Flow source 'ghost' is not a declared element.",
      element: 'ghost',
    })
    expect(ruleIds(legalLines)).not.toContain('VR-003')
  })

  it('VR-004 线的终点没声明就报，声明了不报', () => {
    const hit = checked(['start s "开始"', 'end e "结束"', 's --> ghost'])
    expect(hit.errors).toContainEqual({
      ruleId: 'VR-004',
      message: "Flow target 'ghost' is not a declared element.",
      element: 'ghost',
    })
    expect(ruleIds(legalLines)).not.toContain('VR-004')
  })

  it('VR-005 互斥网关出边少于两条就报，两条就不报', () => {
    expect(ruleIds(['start s "开始"', 'xor g "判断"', 'end e "结束"', 's --> g', 'g --> e: "是"'])).toContain('VR-005')
    expect(
      ruleIds(['start s "开始"', 'xor g "判断"', 'end e1 "甲"', 'end e2 "乙"', 's --> g', 'g --> e1: "是"', 'g --> e2: "其余"']),
    ).not.toContain('VR-005')
  })

  it('VR-006 互斥网关有未标条件的出边就报，标了「其余」不报', () => {
    expect(
      ruleIds(['start s "开始"', 'xor g "判断"', 'end e1 "甲"', 'end e2 "乙"', 's --> g', 'g --> e1: "是"', 'g --> e2']),
    ).toContain('VR-006')
    expect(
      ruleIds(['start s "开始"', 'xor g "判断"', 'end e1 "甲"', 'end e2 "乙"', 's --> g', 'g --> e1: "是"', 'g ==> e2']),
    ).toContain('VR-006')
    expect(
      ruleIds(['start s "开始"', 'xor g "判断"', 'end e1 "甲"', 'end e2 "乙"', 's --> g', 'g --> e1: "是"', 'g --> e2: "其余"']),
    ).not.toContain('VR-006')
  })

  it('VR-007 没有连线的节点就报，进了连线不报', () => {
    const hit = checked(['start s "开始"', 'end e "结束"', 'task alone "孤立"', 's --> e'])
    expect(hit.errors).toContainEqual({
      ruleId: 'VR-007',
      message: "Element 'alone' (task) is an orphan — it does not appear in any flow.",
      element: 'alone',
    })
    expect(ruleIds(legalLines)).not.toContain('VR-007')
  })

  it('VR-008 顺序流跨池就报，跨池消息流和顶层连线不报', () => {
    const hit = checked([
      'pool pa "甲" {',
      'start sa "甲始"',
      'sa --> ta',
      '}',
      'pool pb "乙" {',
      'task ta "做事"',
      'end eb "乙完"',
      'ta --> eb',
      '}',
    ])
    expect(hit.errors).toContainEqual({
      ruleId: 'VR-008',
      message:
        "Sequence flow from 'sa' (pool: pa) to 'ta' (pool: pb) crosses a pool boundary. Use '~~>' message flow at top level.",
      element: 'sa --> ta',
    })
    const message = checked([
      'pool pa "甲" {',
      'start sa "甲始"',
      'end ea "甲完"',
      'sa --> ea',
      '}',
      'pool pb "乙" {',
      'start sb "乙始"',
      'end eb "乙完"',
      'sb --> eb',
      '}',
      'sa ~~> sb',
    ])
    expect(message.errors.map((error) => error.ruleId)).not.toContain('VR-008')
    expect(message.valid).toBe(true)
    expect(ruleIds(legalLines)).not.toContain('VR-008')
  })

  it('VR-009 与 VR-010：这份脚本不发出这两条；顶层和池里的 start 到 end 都不报 VR-010', () => {
    const lane = checked([
      'pool dept "部门" {',
      'lane desk "席位" {',
      'start s "开始"',
      'end e "结束"',
      's --> e',
      '}',
      '}',
    ])
    const samples = [
      legalLines,
      ['end e "结束"', 'task t "做事"', 't --> e'],
      ['start s "开始"', 'xor g "判断"', 'end e1 "甲"', 'end e2 "乙"', 's --> g', 'g --> e1: "是"', 'g --> e2'],
      ['pool pa "甲" {', 'start sa "甲始"', 'sa --> ta', '}', 'pool pb "乙" {', 'task ta "做事"', 'end eb "乙完"', 'ta --> eb', '}'],
    ]
    for (const sample of samples) {
      expect(ruleIds(sample)).not.toContain('VR-009')
      expect(ruleIds(sample)).not.toContain('VR-010')
    }
    expect(lane.valid).toBe(true)
    expect(lane.errors.map((error) => error.ruleId)).not.toContain('VR-010')
    expect(lane.errors.map((error) => error.ruleId)).not.toContain('VR-009')
    expect(checked(legalLines).valid).toBe(true)
    expect(ruleIds(legalLines)).not.toContain('VR-010')
  })

  it('VR-011 用保留字当 id 就报，普通 id 不报', () => {
    const hit = checked(['start start "开始"', 'end e "结束"', 'start --> e'])
    expect(hit.errors).toContainEqual({
      ruleId: 'VR-011',
      message: "Element ID 'start' is a reserved keyword. Rename it to a non-reserved identifier.",
      element: 'start',
    })
    expect(ruleIds(legalLines)).not.toContain('VR-011')
  })

  it('VR-012 并行分开后没有汇合、也没有都接到终点，就给警告；都接到终点不给', () => {
    const hit = checked([
      'start s "开始"',
      'and split "并行"',
      'task t "做事"',
      'end e1 "甲"',
      'end e2 "乙"',
      's --> split',
      'split --> t',
      'split --> e1',
      't --> e2',
    ])
    expect(hit.valid).toBe(true)
    expect(hit.warnings.map((warning) => warning.element)).toContain('split')
    const miss = checked([
      'start s "开始"',
      'and split "并行"',
      'end e1 "甲"',
      'end e2 "乙"',
      's --> split',
      'split --> e1',
      'split --> e2',
    ])
    expect(miss.valid).toBe(true)
    expect(miss.warnings).toEqual([])
  })
})
