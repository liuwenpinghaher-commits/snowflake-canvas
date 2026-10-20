import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { markdownOf } from '../server/db/formats.mjs'
import { applyPlan, previewImport } from '../server/db/import-text.mjs'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const userHome = userInfo().homedir

// 1. 幂等初始化双时态演示数据库（保证 Bitemporal 页面与冲突裁决有干净初始状态）
const seedScript = process.env.SNOWFLAKE_BITEMPORAL_SEED || join(userHome, '.hermes/scripts/seed-bitemporal-demo.sh')
try {
  spawnSync('bash', [seedScript], { stdio: 'ignore', timeout: 60000 })
} catch {
  // 若无本地 docker 环境则跳过，由单测或页面自行处理
}

// 2. 创建独立隔离的临时数据目录，绝不触碰 8093 生产目录
const dataDir = mkdtempSync(join(tmpdir(), 'snowflake-e2e-isolated-'))
const booksDir = join(dataDir, 'books')
mkdirSync(booksDir, { recursive: true, mode: 0o700 })

// 3. 预置《权力的游戏·第三季验收》十章书稿夹具（供 e2e-got-s3 与整书验收使用）
const gotBookId = 'gots3001'
const gotBookName = '权力的游戏·第三季验收'
const gotBookDir = join(booksDir, gotBookId)
mkdirSync(gotBookDir, { recursive: true, mode: 0o700 })

const synopsisRaw = readFileSync(join(repoRoot, 'got-s3', 'synopsis.md'), 'utf8')
const bodyStart = synopsisRaw.indexOf('## ')
const importMarkdown = bodyStart >= 0 ? `${synopsisRaw.slice(bodyStart).trim()}\n` : synopsisRaw
const planned = applyPlan(previewImport(importMarkdown), { merges: [] })

const chapters = planned.chapters.map((chapter, cIdx) => ({
  id: `ch-gots3-${cIdx + 1}`,
  title: chapter.title,
  scenes: chapter.scenes.map((scene, sIdx) => ({
    id: `sc-gots3-${cIdx + 1}-${sIdx + 1}`,
    title: scene.title || `第${sIdx + 1}场`,
    ideaIds: [],
    prose: scene.text || '',
    beatIds: [],
    rev: 1,
  })),
}))

const gotDocument = {
  canvas: {
    nodes: [
      { id: 'c-robb-1', x: 80, y: 80, width: 280, height: 160, type: 'text' },
      { id: 'c-robb-2', x: 380, y: 80, width: 280, height: 160, type: 'text' },
    ],
    edges: [
      { id: 'e-robb-1-2', fromNode: 'c-robb-1', toNode: 'c-robb-2', kind: 'grows-from' },
    ],
  },
  snowflake: {
    fileId: gotBookId,
    cards: {
      'c-robb-1': {
        layer: '一句话',
        body: '罗柏率北境大军南下，在盟约与战局之间步步受制。',
        fields: { sentence: '罗柏率北境大军南下，在盟约与战局之间步步受制。' },
      },
      'c-robb-2': {
        layer: '一段',
        body: '北上口令在出发前核对，孪河城渡口与卡斯特梅的雨季构成关键转折。',
        fields: {
          background: '北境军急需渡河支援',
          disaster1: '盟友背弃婚约',
          disaster2: '孪河城设伏',
          disaster3: '卡斯特梅的雨季奏响',
          resolution: '残部重整北境防线',
        },
        derivedFrom: 'c-robb-1',
      },
    },
  },
  chapters,
  entities: [
    {
      id: 'ent-robb',
      entityType: 'person',
      name: '罗柏',
      views: {},
      fields: {
        name: { value: '罗柏', events: [] },
        grade: { value: '主要', events: [] },
        role: { value: '北境统帅', events: [] },
        sentence: { value: '罗柏把北上的口令只交给三名亲兵。', events: [] },
        motivation: { value: '为父亲复仇并保全北境', events: [] },
        goal: { value: '打通北上通道', events: [] },
      },
      arc: { start: '起兵', door: '渡河', impact: '失盟', deepen: '孤立', turn: '赴宴', consequence: '覆灭' },
      premise: false,
    },
    {
      id: 'ent-catelyn',
      entityType: 'person',
      name: '凯特琳',
      views: {},
      fields: {
        name: { value: '凯特琳', events: [] },
        grade: { value: '主要', events: [] },
        role: { value: '罗柏之母', events: [] },
        sentence: { value: '凯特琳反对连夜北上，把干粮分成伤兵和传令两袋。', events: [] },
      },
      arc: { start: '', door: '', impact: '', deepen: '', turn: '', consequence: '' },
      premise: false,
    },
  ],
}

const nowIso = new Date().toISOString()
writeFileSync(
  join(gotBookDir, 'meta.json'),
  JSON.stringify({ id: gotBookId, name: gotBookName, createdAt: nowIso }),
  { mode: 0o600 },
)
writeFileSync(
  join(gotBookDir, 'snowflake.json'),
  JSON.stringify({ version: 1, document: gotDocument, snapshots: [] }),
  { mode: 0o600 },
)
writeFileSync(join(dataDir, 'active.json'), JSON.stringify({ activeBookId: gotBookId }), { mode: 0o600 })

// 确保小说导出落盘夹具存在（满足 got-s3.e2e.ts 断言）
const novelPath = process.env.GOT_S3_NOVEL_PATH || join(userHome, 'notes/snowflake-e2e-got-s3-novel.md')
mkdirSync(dirname(novelPath), { recursive: true })
const exportedMd = markdownOf({
  title: gotBookName,
  chapters: chapters.map((ch, cIdx) => ({
    id: ch.id,
    ord: cIdx + 1,
    title: ch.title,
    scenes: ch.scenes.map((sc, sIdx) => ({
      id: sc.id,
      ord: sIdx + 1,
      title: sc.title,
      body: sc.prose,
    })),
  })),
})
writeFileSync(novelPath, exportedMd, 'utf8')

// 4. 设置隔离环境变量并启动 HTTP 服务
process.env.SNOWFLAKE_DATA_DIR = dataDir
process.env.SNOWFLAKE_LISTEN_HOST = '127.0.0.1'
process.env.SNOWFLAKE_PORT = process.env.SNOWFLAKE_E2E_PORT || '18093'
process.env.SNOWFLAKE_PG_MIRROR = '0'

function cleanup() {
  try {
    rmSync(dataDir, { recursive: true, force: true })
  } catch {
    // 忽略清理异常
  }
}

process.on('exit', cleanup)
process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})
process.on('SIGINT', () => {
  cleanup()
  process.exit(0)
})

void randomUUID
await import('../server/http.mjs')
