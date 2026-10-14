import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { addEdge, createDocument, emptyArc, type Entity, type EntityType } from '../src/document.ts'
import RelationPage, {
  BRAIN_EDGE_CLASS,
  BRAIN_EDGE_COLOR,
  DEGREE_HIDE_MAX,
  activeDegreeThreshold,
  brainBacklinkElements,
  clampDegreeThreshold,
  entitySlugsForBacklinks,
  fetchRelationBacklinks,
  hideLowDegree,
  nodeSizeForDegree,
  relationArrowByClass,
  relationDisplayElements,
  relationStylesheet,
  type BrainBacklink,
} from '../src/RelationPage.tsx'
import { buildRelationGraph, defaultRelationFilter, type RelationGraph } from '../src/relations.ts'
import { relationTableRows } from '../src/relation-table.ts'

function entity(id: string, entityType: EntityType, name: string, slug?: string): Entity {
  const item: Entity = { id, entityType, name, views: {}, fields: {}, arc: emptyArc(), premise: false }
  if (slug) item.slug = slug
  return item
}

function node(id: string) {
  return { id, layer: 'entity' as const, label: id, shape: 'square' as const, color: '#111' }
}

function arrowOf(showAllArrows: boolean, selector: string): string {
  const block = relationStylesheet(showAllArrows).find((item) => item.selector === selector)
  if (!block || !('style' in block) || !block.style || typeof block.style !== 'object') return ''
  const value = (block.style as { 'target-arrow-shape'?: unknown })['target-arrow-shape']
  return typeof value === 'string' ? value : ''
}

describe('方向箭头总开关', () => {
  it('默认只有引用边是三角，打开后各类边都指向 target', () => {
    const off = relationArrowByClass(false)
    expect(off['rel-citation']).toBe('triangle')
    expect(off[BRAIN_EDGE_CLASS]).toBe('none')
    for (const [cls, shape] of Object.entries(off)) {
      if (cls === 'rel-citation') continue
      expect(shape).toBe('none')
      expect(arrowOf(false, `edge.${cls}`)).toBe('none')
    }
    expect(arrowOf(false, 'edge.rel-citation')).toBe('triangle')

    const on = relationArrowByClass(true)
    for (const [cls, shape] of Object.entries(on)) {
      expect(shape).toBe('triangle')
      expect(arrowOf(true, `edge.${cls}`)).toBe('triangle')
    }

    const brain = relationStylesheet(false).find((item) => item.selector === `edge.${BRAIN_EDGE_CLASS}`)
    expect(brain && 'style' in brain ? brain.style : null).toMatchObject({
      width: 1.5,
      'line-color': BRAIN_EDGE_COLOR,
      'line-style': 'dashed',
      'target-arrow-shape': 'none',
    })
    expect(BRAIN_EDGE_COLOR).toBe('#7a5ea7')
  })
})

describe('按相连边数隐藏', () => {
  it('阈值 0 不改节点；升高或勾孤点后，不够的点和悬空边不进元素，原图和故事边不动', () => {
    expect(DEGREE_HIDE_MAX).toBe(8)
    expect(clampDegreeThreshold(9)).toBe(8)
    expect(clampDegreeThreshold(-3)).toBe(0)
    expect(activeDegreeThreshold(0, false)).toBe(0)
    expect(activeDegreeThreshold(0, true)).toBe(1)
    expect(activeDegreeThreshold(4, true)).toBe(4)

    let state = createDocument('degree-hide')
    state = {
      ...state,
      entities: [
        entity('a', 'person', '甲'),
        entity('b', 'person', '乙'),
        entity('c', 'place', '丙'),
        entity('solo', 'concept', '孤'),
      ],
    }
    state = addEdge(state, 'a', 'b', 'relates-entity')
    state = addEdge(state, 'a', 'c', 'relates-entity')
    const canvasEdges = state.canvas.edges
    const graph = buildRelationGraph(state)
    const nodes = graph.nodes
    const edges = graph.edges
    const before = JSON.stringify(graph)

    expect(hideLowDegree(graph, 0, false)).toBe(graph)
    const untouched = relationDisplayElements(graph, null, { minDegree: 0, hideIsolates: false })
    expect(untouched.filter((item) => !item.data.source)).toHaveLength(graph.nodes.length)

    const withoutSolo = relationDisplayElements(graph, null, { minDegree: 0, hideIsolates: true })
    expect(withoutSolo.filter((item) => !item.data.source).map((item) => item.data.id)).toEqual(['a', 'b', 'c'])
    expect(withoutSolo.filter((item) => item.data.source)).toHaveLength(2)

    const onlyHub = relationDisplayElements(graph, null, { minDegree: 2, hideIsolates: true })
    expect(onlyHub.filter((item) => !item.data.source).map((item) => item.data.id)).toEqual(['a'])
    expect(onlyHub.filter((item) => item.data.source)).toEqual([])
    expect(onlyHub.find((item) => item.data.id === 'a')?.data.size).toBe(nodeSizeForDegree(0))
    expect(nodeSizeForDegree(2)).toBeGreaterThan(nodeSizeForDegree(0))

    const rows = relationTableRows(state, defaultRelationFilter())
    expect(rows).toHaveLength(2)
    expect(state.canvas.edges).toBe(canvasEdges)
    expect(graph.nodes).toBe(nodes)
    expect(graph.edges).toBe(edges)
    expect(JSON.stringify(graph)).toBe(before)
    expect(canvasEdges).toHaveLength(2)
  })
})

describe('脑反链只画两边都在的点', () => {
  it('对不上的页名不造节点，同一页名只收集一次', () => {
    const graph: RelationGraph = {
      nodes: [node('ned'), node('cat')],
      edges: [],
    }
    const entities = [
      { id: 'ned', slug: 'world/ned' },
      { id: 'cat', slug: 'world/cat' },
      { id: 'ghost', slug: 'world/ghost' },
      { id: 'again', slug: 'world/ned' },
    ]
    expect(entitySlugsForBacklinks(entities, ['ned', 'cat', 'ghost'])).toEqual(['world/ned', 'world/cat', 'world/ghost'])
    expect(entitySlugsForBacklinks(entities, ['ned'])).toEqual(['world/ned'])
    const links: BrainBacklink[] = [
      { fromSlug: 'world/ned', toSlug: 'world/cat', label: 'knows' },
      { fromSlug: 'world/ghost', toSlug: 'world/ned', label: '脑反链' },
      { fromSlug: 'world/nope', toSlug: 'world/missing', label: 'x' },
    ]
    const elements = brainBacklinkElements(graph, entities, links)
    expect(elements).toHaveLength(1)
    expect(elements[0]).toMatchObject({
      data: { source: 'ned', target: 'cat' },
      classes: BRAIN_EDGE_CLASS,
    })
    expect(elements.every((item) => typeof item.data.source === 'string' && !item.data.label)).toBe(true)
    expect(graph.nodes).toHaveLength(2)
  })

  it('请求失败、非 JSON、ok 为 false 时这一页是空的', async () => {
    const original = globalThis.fetch
    try {
      globalThis.fetch = async () =>
        ({
          ok: true,
          json: async () => ({ ok: false, edges: [{ fromSlug: 'a', toSlug: 'b', label: 'x' }] }),
        }) as Response
      expect(await fetchRelationBacklinks('world/ned')).toEqual([])

      globalThis.fetch = async () => {
        throw new Error('超时')
      }
      expect(await fetchRelationBacklinks('world/ned')).toEqual([])

      globalThis.fetch = async () =>
        ({
          ok: true,
          json: async () => {
            throw new Error('不是 JSON')
          },
        }) as Response
      expect(await fetchRelationBacklinks('world/ned')).toEqual([])

      let called = ''
      globalThis.fetch = async (input) => {
        called = String(input)
        return {
          ok: true,
          json: async () => ({ ok: true, edges: [{ fromSlug: 'world/ned', toSlug: 'world/cat', label: 'kin' }] }),
        } as Response
      }
      expect(await fetchRelationBacklinks('world/ned')).toEqual([{ fromSlug: 'world/ned', toSlug: 'world/cat', label: 'kin' }])
      expect(called).toContain('/api/relation/backlinks?slug=world%2Fned')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('关系图工具条', () => {
  it('图上有方向箭头、最低相连边数、隐藏孤点和脑反链图例，默认关，表不跟着藏', () => {
    const state = {
      ...createDocument('toolbar'),
      entities: [entity('ned', 'person', '奈德', 'world/ned')],
    }
    const html = renderToStaticMarkup(createElement(RelationPage, { state }))
    expect(html).toContain('方向箭头')
    expect(html).toContain('最低相连边数')
    expect(html).toContain('隐藏孤点')
    expect(html).toContain('脑反链')
    expect(html).toContain('min="0"')
    expect(html).toContain(`max="${DEGREE_HIDE_MAX}"`)
    const arrow = html.match(/<input[^>]*aria-label="方向箭头"[^>]*>/)?.[0] ?? ''
    const isolate = html.match(/<input[^>]*aria-label="隐藏孤点"[^>]*>/)?.[0] ?? ''
    expect(arrow).not.toContain('checked')
    expect(isolate).not.toContain('checked')
    const table = renderToStaticMarkup(createElement(RelationPage, { state, initialView: 'table' }))
    expect(table).toContain('关系表')
    expect(table).not.toContain('脑反链')
    const source = readFileSync(join(process.cwd(), 'src/RelationPage.tsx'), 'utf8')
    expect(source.match(/writeChoice\(/g)).toHaveLength(1)
    expect(source).not.toContain('timeline-add')
    expect(source).not.toContain('/api/brain/write')
  })
})

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const serverEntry = join(repoRoot, 'server', 'http.mjs')

interface Running {
  base: string
  dataDir: string
  argsFile: string
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

async function startServer(buildScript: (argsFile: string) => string): Promise<Running> {
  const dataDir = await mkdtemp(join(tmpdir(), 'snowflake-p1-data-'))
  const home = await mkdtemp(join(tmpdir(), 'snowflake-p1-home-'))
  await mkdir(join(home, '.gbrain'), { recursive: true })
  await writeFile(join(home, '.gbrain', 'env'), '')
  const argsFile = join(home, 'gbrain-args')
  const fake = join(home, 'gbrain-fake')
  await writeFile(fake, buildScript(argsFile))
  await chmod(fake, 0o755)
  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    SNOWFLAKE_DATA_DIR: dataDir,
    SNOWFLAKE_LISTEN_HOST: '127.0.0.1',
    SNOWFLAKE_PORT: String(port),
    SNOWFLAKE_GBRAIN_BIN: fake,
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
  const deadline = Date.now() + 15_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`服务器没起来：${output}`)
    try {
      if ((await fetch(`${base}/api/health`)).ok) break
    } catch {
      // 还没开始监听。
    }
    if (Date.now() > deadline) throw new Error(`服务器起不来：${output}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const handle: Running = {
    base,
    dataDir,
    argsFile,
    stop: async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve))
        child.kill('SIGTERM')
        await exited
      }
      await rm(dataDir, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    },
  }
  running.push(handle)
  return handle
}

function successScript(argsFile: string): string {
  const dest = JSON.stringify(argsFile)
  return `#!${process.execPath}
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
appendFileSync(${dest}, args.join(' ') + '\\n')
const cmd = args[0]
const slug = args[1]
if (cmd === 'backlinks') {
  const incoming = []
  for (let i = 0; i < 30; i += 1) {
    incoming.push({
      from_slug: 'world/in-' + i,
      to_slug: slug,
      link_type: i === 0 ? '' : 't' + i,
      context: 'LEAKPAGEBODY',
    })
  }
  incoming.push(incoming[0])
  incoming.push({ from_slug: 'world/a', to_slug: 'world/b', link_type: 'aside', context: 'LEAKPAGEBODY' })
  console.log('UPGRADE_AVAILABLE gbrain 9')
  console.log(JSON.stringify(incoming))
  process.exit(0)
}
if (cmd === 'graph') {
  const links = []
  for (let i = 0; i < 20; i += 1) {
    links.push({ to_slug: 'world/out-' + i, link_type: 'out' + i })
  }
  const nodes = [
    { slug, depth: 0, title: 'LEAKPAGEBODY', links },
    { slug: 'world/other', depth: 1, title: 'LEAKPAGEBODY', links: [{ to_slug: 'world/nope', link_type: 'skip' }] },
    { slug: 'world/deep', depth: 2, title: 'LEAKPAGEBODY', links: [{ to_slug: slug, link_type: 'too-deep' }] },
  ]
  console.log('UPGRADE_AVAILABLE gbrain 9')
  console.log(JSON.stringify(nodes))
  process.exit(0)
}
console.log('[]')
process.exit(0)
`
}

describe('反链端点', () => {
  it('成功时返回去重后最多 40 条，不带正文，depth 固定为 1', async () => {
    const server = await startServer(successScript)
    const slug = 'world/ned'
    const load = async (path: string) => {
      const response = await fetch(`${server.base}${path}?slug=${encodeURIComponent(slug)}&depth=9`)
      expect(response.status).toBe(200)
      return (await response.json()) as { ok: boolean; edges: Array<{ fromSlug: string; toSlug: string; label: string }> }
    }
    const body = await load('/api/relation/backlinks')
    const again = await load('/xuehua/api/relation/backlinks')
    for (const item of [body, again]) {
      expect(item.ok).toBe(true)
      expect(item.edges).toHaveLength(40)
      expect(JSON.stringify(item)).not.toContain('LEAKPAGEBODY')
      expect(item.edges.some((edge) => edge.fromSlug === 'world/in-0' && edge.toSlug === slug && edge.label === '脑反链')).toBe(true)
      expect(item.edges.some((edge) => edge.fromSlug === slug && edge.toSlug === 'world/out-0' && edge.label === 'out0')).toBe(true)
      expect(item.edges.some((edge) => edge.label === 'out19' || edge.label === 'too-deep' || edge.label === 'aside' || edge.label === 'skip')).toBe(false)
      expect(item.edges.some((edge) => edge.toSlug === 'world/nope')).toBe(false)
      expect(Object.keys(item.edges[0] ?? {}).sort()).toEqual(['fromSlug', 'label', 'toSlug'])
    }
    const text = await readFile(server.argsFile, 'utf8')
    const lines = text.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      expect(['backlinks', 'graph']).toContain(line.split(' ')[0])
      expect(line).not.toMatch(/(^| )(put|timeline-add|capture|link|delete)( |$)/)
    }
    expect(lines.filter((line) => line.startsWith('graph ')).every((line) => line.includes('--depth 1'))).toBe(true)
    expect(text).not.toContain('--depth 9')
  }, 30_000)

  it('页名不合法是 400，不调用 gbrain', async () => {
    const server = await startServer((argsFile) => `#!/bin/sh\necho "$@" >> '${argsFile}'\nexit 0\n`)
    const samples = ['', ' ', 'a b', 'foo/../bar', 'a\nb', 'a\u0001b', 'x'.repeat(201)]
    for (const slug of samples) {
      const response = await fetch(`${server.base}/api/relation/backlinks?slug=${encodeURIComponent(slug)}`)
      expect(response.status).toBe(400)
    }
    const missing = await fetch(`${server.base}/api/relation/backlinks`)
    expect(missing.status).toBe(400)
    await expect(stat(server.argsFile)).rejects.toThrow()
    expect((await fetch(`${server.base}/api/health`)).ok).toBe(true)
  }, 30_000)

  it('gbrain-force-fail 时 200 且不调用假脚本', async () => {
    const server = await startServer((argsFile) => `#!/bin/sh\necho "$@" >> '${argsFile}'\nexit 0\n`)
    await writeFile(join(server.dataDir, 'gbrain-force-fail'), '')
    for (const path of ['/api/relation/backlinks', '/xuehua/api/relation/backlinks']) {
      const response = await fetch(`${server.base}${path}?slug=world/ned`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: false, edges: [] })
    }
    await expect(stat(server.argsFile)).rejects.toThrow()
  }, 30_000)

  it('假脚本退出码非 0 时 200 且 ok 为 false，进程还在', async () => {
    const server = await startServer(
      (argsFile) =>
        `#!${process.execPath}\nimport { appendFileSync } from 'node:fs'\nappendFileSync(${JSON.stringify(argsFile)}, process.argv.slice(2).join(' ') + '\\n')\nprocess.exit(2)\n`,
    )
    const response = await fetch(`${server.base}/api/relation/backlinks?slug=world/ned`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: false, edges: [] })
    const text = await readFile(server.argsFile, 'utf8')
    expect(text).not.toMatch(/(^|\n)(put|timeline-add|capture|link|delete)( |\n)/)
    expect((await fetch(`${server.base}/api/health`)).ok).toBe(true)
  }, 30_000)

  it('假脚本不是 JSON 时 200 且 ok 为 false', async () => {
    const server = await startServer(() => `#!${process.execPath}\nconsole.log('NOT_JSON')\n`)
    const response = await fetch(`${server.base}/api/relation/backlinks?slug=world/ned`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: false, edges: [] })
    expect((await fetch(`${server.base}/api/health`)).ok).toBe(true)
  }, 30_000)

  it('超过 8 秒杀掉子进程，仍然 200 且 ok 为 false', async () => {
    const server = await startServer((argsFile) => `#!/bin/sh\necho "$@" >> '${argsFile}'\nsleep 60\n`)
    const started = Date.now()
    const response = await fetch(`${server.base}/api/relation/backlinks?slug=world/ned`)
    const elapsed = Date.now() - started
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: false, edges: [] })
    expect(elapsed).toBeGreaterThan(5_000)
    expect(elapsed).toBeLessThan(16_000)
    expect((await fetch(`${server.base}/api/health`)).ok).toBe(true)
    const text = await readFile(server.argsFile, 'utf8')
    expect(text).toContain('backlinks ')
    expect(text).toContain('--depth 1')
    expect(text).not.toMatch(/(^|\n)(put|timeline-add|capture|link|delete)( |\n)/)
  }, 30_000)
})
