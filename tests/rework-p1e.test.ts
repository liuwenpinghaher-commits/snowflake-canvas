import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import ChapterPage from '../src/ChapterPage.tsx'
import { DiscussContextPreview } from '../src/CardDiscuss.tsx'
import {
  createCard,
  createDocument,
  emptyArc,
  resolveProseFork,
  serializeDocument,
  type AppState,
  type SedimentEvent,
} from '../src/document.ts'
import { parseCompleteDocument } from '../src/persist.ts'
import { SUGGEST_KIND, SUGGEST_NOTE, SUGGEST_SOURCE, foldIntoScene } from '../src/suggest.ts'
import { collectDiscussContext, postGatewaySession } from '../server/discuss-context.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const ORIGINAL = [
  '你是雪花画布的讨论助手。',
  'gbrain-first：先读脑再说话。',
  '回答用户之前，先用 gbrain 读取与问题相关的页面，默认页是 projects/snowflake-canvas，再根据读到的内容说话。',
  '讨论结论不要自动写回 gbrain。只有用户在页面上另点「写入脑」才写。',
  '不要关闭记忆，不要关闭技能，不要假装看不见日常网关里已有的记忆和技能。',
].join('')

const temps: string[] = []

afterEach(async () => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

function instructionsFrom(source: string): string {
  const start = source.indexOf('const DISCUSS_INSTRUCTIONS = [')
  const end = source.indexOf("].join('')", start)
  if (start < 0 || end < 0) return ''
  return [...source.slice(start, end).matchAll(/'([^']*)'/g)].map((match) => match[1] ?? '').join('')
}

function person(id: string, name: string, slug = '', fieldValue = '') {
  const entity: Record<string, unknown> = {
    id,
    entityType: 'person',
    name,
    fields: fieldValue ? { motivation: { value: fieldValue, events: [] } } : {},
  }
  if (slug) entity.slug = slug
  return entity
}

function book(input: {
  body?: string
  parent?: string | false
  entities?: Array<Record<string, unknown>>
  projections?: string[]
} = {}) {
  const edges: Array<Record<string, string>> = []
  const cards: Record<string, { layer: string; body: string; fields: Record<string, string> }> = {
    idea: { layer: 'situation', body: input.body ?? '奈德为什么不肯用小指头的办法', fields: {} },
  }
  if (input.parent !== false) {
    edges.push({ id: 'grow', kind: 'grows-from', fromNode: 'parent', toNode: 'idea' })
    cards.parent = { layer: 'situation', body: input.parent ?? '父卡写了临冬城的雪。', fields: {} }
  }
  for (const id of input.projections ?? []) {
    edges.push({ id: `p-${id}`, kind: 'projects-onto', fromNode: 'idea', toNode: id })
  }
  return {
    canvas: { nodes: [], edges },
    snowflake: { fileId: 'book', cards },
    entities: input.entities ?? [],
  }
}

function fakeScript(argsFile: string): string {
  return `#!/bin/sh
echo "$@" >> '${argsFile}'
slug=$2
if [ "$1" != "get" ]; then
  exit 0
fi
if [ "$slug" = "world/ned" ]; then
  printf '%s\\n' '奈德定稿在分隔线以上。' '<!-- timeline -->' '时间线不该出现在预览'
  exit 0
fi
if [ "$slug" = "world/fail" ]; then
  echo 'get failed' >&2
  exit 3
fi
printf '%s\\n' "页 $slug" '<!-- timeline -->' "时间线 $slug"
`
}

async function fakeGbrain() {
  const home = await mkdtemp(join(tmpdir(), 'snowflake-p1e-home-'))
  temps.push(home)
  await mkdir(join(home, '.gbrain'), { recursive: true })
  await writeFile(join(home, '.gbrain', 'env'), '')
  const argsFile = join(home, 'gbrain-args')
  const fake = join(home, 'gbrain-fake')
  await writeFile(fake, fakeScript(argsFile))
  await chmod(fake, 0o755)
  const getPage = (slug: string) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(
        'bash',
        [
          '-lc',
          'set -a; source "$HOME/.gbrain/env"; set +a; export PATH="$HOME/.bun/bin:$PATH"; exec "${SNOWFLAKE_GBRAIN_BIN:-$HOME/.bun/bin/gbrain}" "$@"',
          'bash',
          'get',
          slug,
        ],
        { env: { ...process.env, HOME: home, SNOWFLAKE_GBRAIN_BIN: fake }, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(Buffer.concat(stderr).toString('utf8') || `exit ${code}`))
          return
        }
        resolve(Buffer.concat(stdout).toString('utf8'))
      })
    })
  return { argsFile, getPage }
}

async function posted(contextText: string) {
  let body: { title?: string; system_prompt?: string } = {}
  const created = await postGatewaySession({
    cardId: 'idea',
    store: { cards: {} },
    contextText,
    instructions: ORIGINAL,
    apiKey: 'test-key',
    fetchImpl: async (path: string, options: { body?: string }) => {
      expect(path).toBe('/api/sessions')
      body = JSON.parse(String(options.body)) as { title?: string; system_prompt?: string }
      return { status: 201, json: async () => ({ session: { id: 'sess-1' } }) }
    },
  })
  return { created, body }
}

function openFork(): AppState {
  const parsed = parseCompleteDocument(
    new TextEncoder().encode(
      JSON.stringify({
        canvas: { nodes: [], edges: [] },
        snowflake: {
          fileId: 'fork-book',
          cards: {
            draft: { layer: '正文草稿', body: '卡上的另一份', fields: {}, derivedFrom: 'scene-1' },
          },
        },
        chapters: [
          {
            id: 'ch-1',
            title: '第一章',
            scenes: [{ id: 'scene-1', title: '门口', ideaIds: [], prose: '场上的正文', beatIds: [] }],
          },
        ],
      }),
    ),
  )
  expect(parsed).not.toBeNull()
  if (!parsed) throw new Error('文档没有打开')
  return parsed.state
}

function sedimentEvent(partial: Partial<SedimentEvent> & Pick<SedimentEvent, 'id' | 'at' | 'sessionId' | 'adoptionKey'>): SedimentEvent {
  return {
    requestId: partial.id,
    kind: 'discuss',
    ideaId: 'idea',
    target: { entityType: 'person', entityId: 'ned', fieldKey: 'motivation' },
    action: 'append',
    quote: '不肯借兵',
    status: 'written',
    ...partial,
  }
}

describe('C1 讨论上下文', () => {
  it('建会话的 system_prompt 以讨论指令开头，预览只有分隔线以上', async () => {
    const http = readFileSync(join(repoRoot, 'server/http.mjs'), 'utf8')
    expect(instructionsFrom(http)).toBe(ORIGINAL)
    expect(http).toContain('collectDiscussContext')
    expect(http).toContain('postGatewaySession')
    expect(http).not.toMatch(/system_prompt:\s*DISCUSS_INSTRUCTIONS/)
    expect(http).toContain('instructions: DISCUSS_INSTRUCTIONS')

    const fake = await fakeGbrain()
    const context = await collectDiscussContext(
      book({
        entities: [
          person('ned', '奈德', 'world/ned', '书内折叠不该进讨论'),
        ],
        projections: ['ned'],
      }),
      'idea',
      { available: true, getPage: fake.getPage },
    )
    const { created, body } = await posted(context)
    expect(created.sessionId).toBe('sess-1')
    expect(Object.keys(body).sort()).toEqual(['system_prompt', 'title'])
    const prompt = body.system_prompt ?? ''
    expect(prompt.startsWith(ORIGINAL)).toBe(true)
    expect(prompt).not.toBe(ORIGINAL)
    for (const title of ['这张卡', '父卡摘要', '定稿摘要']) {
      expect(prompt).toContain(title)
      expect(context).toContain(title)
    }
    expect(prompt).toContain('奈德为什么不肯用小指头的办法')
    expect(prompt).toContain('父卡写了临冬城的雪。')
    expect(prompt).toContain('奈德定稿在分隔线以上。')
    expect(prompt).not.toContain('时间线不该出现在预览')
    expect(prompt).not.toContain('<!-- timeline -->')
    expect(prompt).not.toContain('书内折叠不该进讨论')
    expect(context).not.toContain('时间线不该出现在预览')
    expect(context).not.toContain('<!-- timeline -->')

    const html = renderToStaticMarkup(createElement(DiscussContextPreview, { context }))
    expect(html).toContain('上下文预览')
    expect(html).toContain('这张卡')
    expect(html).toContain('父卡摘要')
    expect(html).toContain('定稿摘要')
    expect(html).toContain('奈德定稿在分隔线以上。')
    expect(html).not.toContain('时间线不该出现在预览')
    expect(html).not.toContain('timeline')
    const ui = readFileSync(join(repoRoot, 'src/CardDiscuss.tsx'), 'utf8')
    expect(ui).toContain('<DiscussContextPreview context={contextPreview} />')
    expect(ui).toContain('message: text')
    expect(ui).not.toContain('system_prompt')
  })

  it('没有 slug 或 gbrain get 失败时这一条是还没有定稿', async () => {
    let calls = 0
    const missing = await collectDiscussContext(
      book({
        entities: [person('bare', '缺页', '', '书内折叠不该进讨论')],
        projections: ['bare'],
      }),
      'idea',
      {
        available: true,
        getPage: async () => {
          calls += 1
          return '不该读'
        },
      },
    )
    expect(calls).toBe(0)
    expect(missing).toContain('缺页\n还没有定稿')
    expect(missing).not.toContain('书内折叠不该进讨论')
    expect(missing).not.toContain('不该读')

    const fake = await fakeGbrain()
    const failed = await collectDiscussContext(
      book({
        entities: [person('bad', '坏页', 'world/fail'), person('ned', '奈德', 'world/ned')],
        projections: ['bad', 'ned'],
      }),
      'idea',
      { available: true, getPage: fake.getPage },
    )
    expect(failed).toContain('坏页\n还没有定稿')
    expect(failed).toContain('奈德定稿在分隔线以上。')
    expect(failed).not.toContain('时间线不该出现在预览')
  })

  it('超过 8 个实体只带 8 个，并写还有 N 个没带', async () => {
    const fake = await fakeGbrain()
    const entities = Array.from({ length: 9 }, (_, index) => person(`e${index + 1}`, `实体${index + 1}`, `world/e${index + 1}`))
    const context = await collectDiscussContext(
      book({ entities, projections: entities.map((entity) => String(entity.id)) }),
      'idea',
      { available: true, getPage: fake.getPage },
    )
    const args = (await readFile(fake.argsFile, 'utf8')).trim().split('\n')
    expect(args).toHaveLength(8)
    expect(args.some((line) => line.includes('world/e9'))).toBe(false)
    expect(context).toContain('页 world/e1')
    expect(context).toContain('页 world/e8')
    expect(context).not.toContain('页 world/e9')
    expect(context).not.toContain('时间线 world/e1')
    expect(context).toContain('还有 1 个没带')
  })

  it('gbrain 整体不可用时定稿摘要写定稿读不到，会话照样建成', async () => {
    let calls = 0
    const context = await collectDiscussContext(
      book({ entities: [person('ned', '奈德', 'world/ned')], projections: ['ned'] }),
      'idea',
      {
        available: false,
        getPage: async () => {
          calls += 1
          return '不该读到'
        },
      },
    )
    expect(calls).toBe(0)
    expect(context).toContain('定稿摘要\n定稿读不到')
    expect(context).not.toContain('还没有定稿')
    expect(context).not.toContain('不该读到')
    const { created, body } = await posted(context)
    expect(created.sessionId).toBe('sess-1')
    expect(body.system_prompt?.startsWith(ORIGINAL)).toBe(true)
    expect(body.system_prompt).toContain('定稿读不到')
  })

  it('没有父卡、空卡，以及父卡正文截到 200 字', async () => {
    const io = {
      available: true,
      getPage: async () => {
        throw new Error('不该读')
      },
    }
    const none = await collectDiscussContext(book({ parent: false, body: '   ' }), 'idea', io)
    expect(none).toContain('这张卡\n这张卡还没有正文')
    expect(none).toContain('父卡摘要\n没有父卡')
    const clipped = await collectDiscussContext(book({ parent: '父'.repeat(230), body: '短念头' }), 'idea', io)
    expect(clipped.split('\n\n')[1]).toBe(`父卡摘要\n${'父'.repeat(200)}`)
  })
})

describe('D3 正文分叉', () => {
  it('加载两边不同的旧数据后出现两个按钮，点选后另一份丢弃', () => {
    const state = openFork()
    expect(state.chapters?.[0]?.scenes[0]?.proseFork).toBe(true)
    expect(state.chapters?.[0]?.scenes[0]?.prose).toBe('场上的正文')
    expect(state.snowflake.cards.draft?.body).toBe('卡上的另一份')
    const html = renderToStaticMarkup(
      createElement(ChapterPage, {
        state,
        canEdit: true,
        onApply: (recipe: (current: AppState) => AppState) => recipe(state),
      }),
    )
    expect(html).toContain('正文分叉')
    expect(html).toContain('留场上的')
    expect(html).toContain('留卡上的')
    expect(html.match(/<button[^>]*>留场上的<\/button>/g)).toHaveLength(1)
    expect(html.match(/<button[^>]*>留卡上的<\/button>/g)).toHaveLength(1)
    const chapter = readFileSync(join(repoRoot, 'src/ChapterPage.tsx'), 'utf8')
    expect(chapter).toContain("resolveProseFork(current, scene.id, 'scene')")
    expect(chapter).toContain("resolveProseFork(current, scene.id, 'card')")

    const keptScene = resolveProseFork(openFork(), 'scene-1', 'scene')
    expect(keptScene.snowflake.cards.draft?.body).toBe('')
    expect(keptScene.chapters?.[0]?.scenes[0]?.prose).toBe('场上的正文')
    expect(keptScene.chapters?.[0]?.scenes[0]?.proseFork).toBeUndefined()

    const keptCard = resolveProseFork(openFork(), 'scene-1', 'card')
    expect(keptCard.chapters?.[0]?.scenes[0]?.prose).toBe('卡上的另一份')
    expect(keptCard.snowflake.cards.draft?.body).toBe('')
    expect(keptCard.chapters?.[0]?.scenes[0]?.proseFork).toBeUndefined()

    const blocked = foldIntoScene(state, { cardId: 'draft', action: 'existing-scene' })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) return
    expect(blocked.reason).toContain('不能折进建议包')
    const opened = foldIntoScene(keptScene, { cardId: 'draft', action: 'existing-scene' })
    expect(opened.ok).toBe(true)
  })
})

describe('D4 建议包溯源', () => {
  function scenePack(events?: SedimentEvent[]) {
    let state = createCard(createDocument('sed'), {
      id: 'scene-card',
      layer: '场景表',
      x: 0,
      y: 0,
      fields: { what: '她推开门', title: '门口' },
    })
    state = {
      ...state,
      entities: [
        {
          id: 'ned',
          entityType: 'person',
          name: '奈德',
          views: {},
          fields: {},
          arc: emptyArc(),
          premise: false,
          slug: 'world/ned',
        },
      ],
      canvas: {
        ...state.canvas,
        edges: [...state.canvas.edges, { id: 'proj', fromNode: 'scene-card', toNode: 'ned', kind: 'projects-onto' }],
      },
      ...(events ? { sediment: events } : {}),
    }
    const before = JSON.stringify(serializeDocument(state))
    const result = foldIntoScene(state, { cardId: 'scene-card', action: 'existing-scene', beatId: 'beat-1' })
    expect(JSON.stringify(serializeDocument(state))).toBe(before)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.reason)
    expect(result.json).not.toContain('设定图写入')
    expect(result.json).not.toContain('gbrain')
    const pack = JSON.parse(result.json) as {
      kind: string
      source: string
      note: string
      items: Array<Record<string, unknown>>
    }
    expect(pack.kind).toBe(SUGGEST_KIND)
    expect(pack.source).toBe(SUGGEST_SOURCE)
    expect(pack.note).toBe(SUGGEST_NOTE)
    return pack.items[0] ?? {}
  }

  it('最新一条未作废的沉淀写上 sessionId 和 adoptionKey，没有就省略', () => {
    const traced = scenePack([
      sedimentEvent({ id: 'old', at: '2026-10-10T00:00:00.000Z', sessionId: 'sess-old', adoptionKey: 'adopt-old' }),
      sedimentEvent({
        id: 'new',
        at: '2026-10-11T00:00:00.000Z',
        sessionId: 'sess-9',
        adoptionKey: 'adopt-3',
        superseded: true,
      }),
      sedimentEvent({ id: 'mid', at: '2026-10-10T12:00:00.000Z', sessionId: 'sess-mid', adoptionKey: 'adopt-mid' }),
    ])
    expect(traced.sessionId).toBe('sess-mid')
    expect(traced.adoptionKey).toBe('adopt-mid')

    const plain = scenePack()
    expect(plain).not.toHaveProperty('sessionId')
    expect(plain).not.toHaveProperty('adoptionKey')

    const blankKey = scenePack([
      sedimentEvent({ id: 'half', at: '2026-10-11T00:00:00.000Z', sessionId: '   ', adoptionKey: 'adopt-only' }),
    ])
    expect(blankKey).not.toHaveProperty('sessionId')
    expect(blankKey.adoptionKey).toBe('adopt-only')
  })
})

describe('百科占位文案', () => {
  it('不再写下一刀才做，并说明两个按钮要等百科页', () => {
    const app = readFileSync(join(repoRoot, 'src/App.tsx'), 'utf8')
    expect(app).not.toContain('这一页下一刀才做。')
    expect(app).toContain('百科页还没做。升格卡面到定稿、拉定稿回卡面这两个按钮要等百科页。')
    const block = app.slice(app.indexOf("page === 'encyclopedia'"), app.indexOf("page === 'chapter'"))
    expect(block).not.toContain('<button')
    expect(block).not.toContain('gbrain')
  })
})
