import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { searchBook, type SearchRow } from '../src/book-search.ts'
import { buildBlankChapters, chapterPageCanCreate } from '../src/chapter-edit.ts'
import { assembleContext } from '../src/context-pack.ts'
import {
  acknowledgeCardReview,
  cardNeedsReview,
  changeToAnyLayer,
  commitCardText,
  createCard,
  createDocument,
  earlierLayers,
  linkCards,
  normalizeStoredDocument,
  type AppState,
} from '../src/document.ts'
import {
  acceptSuggestionToScene,
  addChapter,
  rollbackSceneRevision,
  saveSceneRevision,
  updateSceneFailure,
  updateSceneProse,
  updateSceneStep,
} from '../src/chapter-edit.ts'
import { documentToBytes, parseCompleteDocument } from '../src/persist.ts'
import { exportIssues, locateExportIssue } from '../src/export-precheck.ts'
import { MSG_STASHED_LOCAL, createStash, replayStash, stashText } from '../src/local-stash.ts'
import { openDraftCard, proseEditorWritable, sceneEditor } from '../src/scene-prose.ts'
import { gapReport } from '../src/structure-gaps.ts'
import { applyObjectOps, diffDocuments } from '../server/db/object-ops.mjs'
import {
  DB_NAME,
  EMBED_URL,
  FRAME_STEPS,
  MIGRATED_MARK,
  createBookStore,
  createGbrainClient,
} from '../server/db/engine.mjs'
import { applySchema, chapterKeyCountSql, mirrorDocument, psql, readMirroredDocument } from '../server/db/pg-mirror.mjs'
import { stripSpace } from '../server/db/formats.mjs'

const booksDir = process.env.SNOWFLAKE_BOOKS_DIR || join(userInfo().homedir, '.local/share/snowflake-canvas/books')

describe('R1 书稿库与增量写入', () => {
  it('迁移后再导出，规范化后与原文件逐字段一致', () => {
    const ids = readdirSync(booksDir)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const raw = JSON.parse(readFileSync(join(booksDir, id, 'snowflake.json'), 'utf8')) as { document: unknown }
      const norm = normalizeStoredDocument(raw.document)
      const store = createBookStore()
      store.migrateDocument(id, norm)
      const exported = store.exportDocument(id)
      expect(normalizeStoredDocument(exported)).toEqual(norm)
    }
  })

  it('两个场各写 100 字，行版本对得上时零个 412', () => {
    const store = createBookStore()
    store.createChapters('book', 1, 2)
    const scenes = store.chapters('book')[0].scenes
    const left = '甲'.repeat(100)
    const right = '乙'.repeat(100)
    const outcome = store.patchScenes('book', [
      { sceneId: scenes[0].id, baseRev: 1, text: left },
      { sceneId: scenes[1].id, baseRev: 1, text: right },
    ])
    expect(outcome.conflicts).toBe(0)
    expect(store.sceneBody('book', scenes[0].id)).toBe(left)
    expect(store.sceneBody('book', scenes[1].id)).toBe(right)
  })

  it('单次按键的差异不随书的长度变大', () => {
    const body = '字'.repeat(20000)
    const before = {
      canvas: { nodes: [], edges: [] },
      snowflake: { fileId: 'big', cards: { c1: { layer: 'situation', body, fields: {} } } },
    }
    const after = structuredClone(before)
    after.snowflake.cards.c1.body = `${body}甲`
    const ops = diffDocuments(before, after)
    const packet = JSON.stringify({ ops })
    expect(packet.length).toBeLessThan(4096)
    expect(packet.includes(body)).toBe(false)
    const applied = applyObjectOps(before, ops) as typeof before
    expect(applied.snowflake.cards.c1.body).toBe(`${body}甲`)
  })

  it('库写不进去时先记在本机，恢复后字数还在', () => {
    const log = createStash()
    const text = '暂存的三百字'.repeat(30)
    expect(stashText(log, text)).toBe(MSG_STASHED_LOCAL)
    expect([...replayStash(log)].length).toBe([...text].length)
  })
})

describe('R2 章与场', () => {
  it('空白书可以建出 3 章 2 场', () => {
    const state = buildBlankChapters(createDocument('blank'))
    expect(chapterPageCanCreate(createDocument('blank'))).toBe(true)
    expect(state.chapters).toHaveLength(3)
    expect(state.chapters?.every((chapter) => chapter.scenes.length === 2)).toBe(true)
    const again = JSON.parse(JSON.stringify(state)) as AppState
    expect(again.chapters).toHaveLength(3)
  })

  it('场次卡拖到章上写的是关联，卡片字段里没有 chapter', () => {
    const store = createBookStore()
    store.linkCard('book', 'card-1', '第2章')
    expect(store.linksOf('book', '第2章')).toEqual(['card-1'])
    expect(store.chapterKeyCount()).toBe(0)
  })
})

describe('R3 场正文与修订', () => {
  it('写 500 字改 3 次能对比增删，回退后新稿还在', () => {
    const store = createBookStore()
    store.createChapters('book', 1, 1)
    const sceneId = store.chapters('book')[0].scenes[0].id
    const first = '甲'.repeat(500)
    const second = `${'甲'.repeat(499)}乙`
    const third = `${'甲'.repeat(498)}乙丙`
    store.putSceneText('book', sceneId, first, { force: true })
    store.putSceneText('book', sceneId, second, { force: true })
    store.putSceneText('book', sceneId, third, { force: true })
    expect(store.revisions('book', sceneId).length).toBeGreaterThanOrEqual(3)
    const parts = store.diffRevisions('book', sceneId, 0, 2)
    expect(parts.some((part: { kind: string }) => part.kind === 'del' || part.kind === 'add')).toBe(true)
    const kept = store.rollbackRevision('book', sceneId, 1)
    expect(kept).toBeGreaterThanOrEqual(3)
    expect(store.sceneBody('book', sceneId)).toBe(second)
    expect(store.revisions('book', sceneId)[2].body).toBe(third)
  })

  it('正文草稿打开的是所属场，不读 derivedFrom', () => {
    const state: AppState = {
      ...createDocument('draft'),
      chapters: [{ id: 'ch', title: '一', scenes: [{ id: 'sc', title: '场', ideaIds: [], prose: '场上的正文', beatIds: [] }] }],
    }
    state.snowflake.cards.draft = {
      layer: '正文草稿',
      body: '卡上的旧字',
      fields: {},
      originAnchor: { chapterId: 'ch', sceneId: 'sc' },
    }
    const editor = openDraftCard(state, 'draft')
    expect(proseEditorWritable(editor)).toBe(true)
    expect(editor?.text).toBe('场上的正文')
    expect(editor?.usesDerivedFrom).toBe(false)
    expect(sceneEditor(state, 'sc')?.readOnly).toBe(false)
  })

  it('迁移后没有没挂上场的正文草稿', () => {
    const store = createBookStore()
    store.migrateDocument('book', {
      canvas: { nodes: [], edges: [] },
      snowflake: { fileId: 'f', cards: { d1: { layer: '正文草稿', body: '无主', fields: {} } } },
    })
    expect(store.orphanProseCount()).toBe(0)
    expect(store.chapters('book').some((chapter: { title: string }) => chapter.title === '未归场')).toBe(true)
  })
})

describe('R4 来源', () => {
  it('来源写入前失败时正文也回到原样', () => {
    const store = createBookStore()
    store.createChapters('book', 1, 1)
    const sceneId = store.chapters('book')[0].scenes[0].id
    store.putSceneText('book', sceneId, '原来的', { force: true })
    store.setAdoptFailure('before-provenance')
    const outcome = store.adopt({ bookId: 'book', sceneId, text: '采纳来的', kind: '采纳', sessionId: 's1', quote: '采纳来的' })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('没采纳上')
    expect(store.sceneBody('book', sceneId)).toBe('原来的')
  })

  it('采纳和扩写都带会话或请求，引文只留前 500 字', () => {
    const store = createBookStore()
    store.createChapters('book', 1, 1)
    const sceneId = store.chapters('book')[0].scenes[0].id
    const long = '引'.repeat(800)
    const adopted = store.adopt({ bookId: 'book', sceneId, text: long, kind: '采纳', sessionId: 'sess', quote: long })
    expect(adopted.ok).toBe(true)
    store.setAdoptFailure(null)
    const expanded = store.adopt({ bookId: 'book', sceneId, text: '扩', kind: '扩写', requestId: 'req-1', quote: '扩' })
    expect(expanded.ok).toBe(true)
    const report = store.provenanceReport()
    expect(report.badKind).toBe(0)
    expect(report.missing).toBe(0)
    expect(report.linked).toBe(2)
    const quotes = store.revisions('book', sceneId).map((row: { quote: string }) => row.quote)
    expect(quotes.some((quote: string) => [...quote].length === 500)).toBe(true)
  })
})

describe('R5 导出', () => {
  it('三章两场的纯文本字数等于各场正文相加，顺序与章节一致', () => {
    const store = createBookStore()
    store.setConstraints('book', { title: '测试书' })
    store.createChapters('book', 3, 2)
    const chapters = store.chapters('book')
    let expected = ''
    for (const chapter of chapters) {
      for (const scene of chapter.scenes) {
        const text = `${chapter.title}${scene.title}正文`
        store.putSceneText('book', scene.id, text, { force: true })
        expected += text
      }
    }
    const plain = store.exportPlain('book')
    expect(stripSpace(plain)).toBe(stripSpace(expected))
    const markdown = store.exportMarkdown('book')
    const first = markdown.indexOf('第1章')
    const second = markdown.indexOf('第2章')
    const third = markdown.indexOf('第3章')
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(second)
    expect(second).toBeLessThan(third)
    expect(store.exportDocx('book').subarray(0, 2).toString()).toBe('PK')
  })

  it('空场清单能指回那场', () => {
    const state: AppState = {
      ...createDocument('empty'),
      chapters: [
        {
          id: 'c1',
          title: '甲',
          scenes: [
            { id: 's1', title: '满', ideaIds: [], prose: '有字', beatIds: [] },
            { id: 's2', title: '空', ideaIds: [], prose: '', beatIds: [] },
          ],
        },
        { id: 'c2', title: '乙', scenes: [{ id: 's3', title: '空', ideaIds: [], prose: '  ', beatIds: [] }] },
      ],
    }
    const issues = exportIssues(state)
    expect(issues.some((issue) => issue.message === '第 1 章第 2 场是空的')).toBe(true)
    expect(locateExportIssue(issues, '第 1 章第 2 场是空的')).toBe('s2')
  })

  it('epub 交给 epubcheck，有错误就不能过', () => {
    const store = createBookStore()
    store.setConstraints('book', { title: '校验书' })
    store.createChapters('book', 1, 1)
    const sceneId = store.chapters('book')[0].scenes[0].id
    store.putSceneText('book', sceneId, '一段可以装订的正文', { force: true })
    const bytes = store.exportEpub('book')
    const file = join(tmpdir(), `snowflake-r1r12-${process.pid}.epub`)
    writeFileSync(file, bytes)
    let help = ''
    try {
      help = execFileSync('epubcheck', ['-h'], { encoding: 'utf8' })
    } catch (error) {
      const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout ?? '') : ''
      const stderr = error instanceof Error ? error.message : String(error)
      const combined = `${stdout}\n${stderr}`
      if (!/EPUBCheck/u.test(combined)) throw new Error(`缺少 epubcheck，不能把 epub 判成通过。${stderr}`)
      help = combined
    }
    expect(help.length >= 0).toBe(true)
    const output = execFileSync('epubcheck', [file], { encoding: 'utf8' })
    expect(output).not.toMatch(/ERROR/u)
  }, 60000)
})

describe('R6 导入', () => {
  it('十万字去掉空白后与导出的纯文本一致', () => {
    const store = createBookStore()
    const text = `第一章 开端\n${'文'.repeat(100000)}`
    const outcome = store.importText('book', text)
    expect(outcome.ok).toBe(true)
    expect(outcome.queued).toBeGreaterThan(0)
    expect(store.embeddingCount('book')).toBe(0)
    expect(stripSpace(store.exportPlain('book'))).toBe(stripSpace(text.replace(/^第一章 开端\n/u, '')))
    const revision = store.revisions('book', store.chapters('book')[0].scenes[0].id)[0]
    expect(revision.kind).toBe('导入')
    expect(revision.body.includes('文'.repeat(1000))).toBe(true)
  })

  it('空文本不建章', () => {
    const store = createBookStore()
    store.createChapters('book', 1, 1)
    const before = store.chapters('book').length
    const outcome = store.importText('book', '   \n')
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('导入文本是空的，没有建章')
    expect(outcome.unchanged).toBe(true)
    expect(store.chapters('book')).toHaveLength(before)
  })

  it('预览里合并两场后正文连在一起', () => {
    const store = createBookStore()
    const outcome = store.importText('book', '上半\n---\n下半', { merges: [[0, 0, 1]] })
    expect(outcome.ok).toBe(true)
    expect(store.chapters('book')[0].scenes).toHaveLength(1)
    expect(store.chapters('book')[0].scenes[0].body).toContain('上半')
    expect(store.chapters('book')[0].scenes[0].body).toContain('下半')
  })
})

describe('R7 书稿与运营记忆', () => {
  it('沉淀十次不写 gbrain 页，也不写时间线', async () => {
    const gbrain = createGbrainClient()
    const store = createBookStore({ gbrain })
    for (let index = 0; index < 10; index += 1) {
      store.sediment('book', { name: `人${index}`, text: `设定${index}`, sessionId: `s${index}` })
    }
    expect(store.gbrainStats()).toEqual({ puts: 0, timeline: 0, pages: 0 })
    expect(store.entityCount('book')).toBe(10)
    const pagesBefore = gbrain.pages.size
    store.deleteBook('book')
    expect(store.entityCount('book')).toBe(0)
    expect(gbrain.pages.size).toBe(pagesBefore)
  })

  it('只有写作方法心得能写入脑，开头写明书和讨论', async () => {
    const gbrain = createGbrainClient()
    const store = createBookStore({ gbrain })
    store.setConstraints('book', { title: '冰与火' })
    await expect(store.writeMethod('book', { kind: '人物', text: '不要写', sessionId: 's' })).rejects.toThrow('只有写作方法心得可以写入脑')
    expect(store.gbrainStats().puts).toBe(0)
    await store.writeMethod('book', { kind: '写作方法心得', text: '先写灾难', sessionId: 'talk-9' })
    const page = gbrain.pages.get('method/writing-notes') ?? ''
    expect(page.startsWith('来自《冰与火》讨论 talk-9')).toBe(true)
  })

  it('迁回的设定页只加标记，不删页', async () => {
    const gbrain = createGbrainClient()
    await gbrain.put('world/ned', '原设定')
    const store = createBookStore({ gbrain })
    await store.pullPages('book', [{ slug: 'world/ned', name: '奈德', content: '原设定' }])
    expect(gbrain.pages.has('world/ned')).toBe(true)
    expect(gbrain.pages.get('world/ned')).toContain(MIGRATED_MARK)
    await store.ensureBibliography('/xuehua/')
    expect(gbrain.pages.has('projects/snowflake-canvas-books')).toBe(true)
  })
})

describe('R8 回边', () => {
  it('接受建议后带来源场次', () => {
    const store = createBookStore()
    const suggestion = store.suggest('book', { sceneId: 'sc', text: '他其实是弟弟', chapterIndex: 1, sceneIndex: 2, entityName: '弟弟' })
    expect(store.suggestions('book')).toHaveLength(1)
    const entity = store.acceptSuggestion('book', suggestion.id)
    expect(entity.source).toBe('来自 第 1 章第 2 场')
    expect(store.suggestions('book')).toHaveLength(0)
  })

  it('改一句话后，派生的一段变成待复核，确认后消失', () => {
    const store = createBookStore()
    store.editCard('book', 'sentence', '门口站着人')
    store.editCard('book', 'paragraph', '一段灾难')
    store.markDerived('book', 'sentence', 'paragraph')
    expect(store.needsReview('book', 'paragraph')).toBe(false)
    store.editSentence('book', 'sentence', '门口站着的是弟弟')
    expect(store.needsReview('book', 'paragraph')).toBe(true)
    store.acknowledge('book', 'paragraph')
    expect(store.needsReview('book', 'paragraph')).toBe(false)
  })
})

describe('R9 结构尺', () => {
  it('故事八步只缺结局；经过段失败不足可以标成有意这样写', () => {
    const store = createBookStore()
    store.createChapters('eight', 1, 7)
    store.setFrame('eight', '故事八步', '八步要点：最后必须落到结局', 'method/eight')
    const steps = FRAME_STEPS['故事八步']
    const scenes = store.chapters('eight')[0].scenes
    for (let index = 0; index < 7; index += 1) store.hangStep('eight', scenes[index].id, steps[index])
    const onlyEnding = gapReport(store.frameView('eight')).map((item) => item.message)
    expect(onlyEnding).toEqual(['结局'])

    store.createChapters('journey', 1, 2)
    store.setFrame('journey', '启程转合', '经过要失败三次', 'method/journey')
    const journeyScenes = store.chapters('journey')[0].scenes
    store.hangStep('journey', journeyScenes[0].id, '经过', true)
    store.hangStep('journey', journeyScenes[1].id, '经过', true)
    const before = gapReport(store.frameView('journey')).map((item) => item.message)
    expect(before).toContain('经过段只有 2 次失败')
    store.dismissGap('journey', 'journey:failures')
    const after = gapReport(store.frameView('journey')).map((item) => item.message)
    expect(after).not.toContain('经过段只有 2 次失败')
    expect(store.frameView('journey').points).toBe('经过要失败三次')
  })

  it('只埋不收的伏笔，和大纲里没出场的人，都会列出来', () => {
    const store = createBookStore()
    store.setFrame('book', '故事八步', '要点还在', 'method/eight')
    store.createChapters('book', 1, 1)
    const sceneId = store.chapters('book')[0].scenes[0].id
    store.addForeshadow('book', '门口的信', sceneId, null)
    store.setOutline('book', ['林晚'], {})
    const messages = gapReport(store.frameView('book')).map((item) => item.message)
    expect(messages.some((message) => message.includes('门口的信') && message.includes('只埋没回收'))).toBe(true)
    expect(messages.some((message) => message.includes('林晚'))).toBe(true)
  })
})

describe('R10 检索与上下文', () => {
  it('只出现在第 5 章第 2 场的句子，命中列表第一条就是这场', () => {
    const rows: SearchRow[] = []
    for (let chapter = 0; chapter < 6; chapter += 1) {
      for (let scene = 0; scene < 2; scene += 1) {
        const text = chapter === 4 && scene === 1 ? '雪夜里只有这句不会出现在别处' : `第${chapter}章第${scene}场普通正文`
        rows.push({ kind: 'scene', id: `s-${chapter}-${scene}`, label: `第${chapter + 1}章第${scene + 1}场`, text, chapterIndex: chapter, sceneIndex: scene })
      }
    }
    rows.push({ kind: 'card', id: 'c', label: '卡片', text: '无关' })
    const hits = searchBook(rows, '雪夜里只有这句不会出现在别处')
    expect(hits[0]?.chapterIndex).toBe(4)
    expect(hits[0]?.sceneIndex).toBe(1)
  })

  it('去掉上一场后，请求正文里没有上一场的句子', () => {
    const secret = '上一场结尾的独有句子甲乙丙'
    const full = assembleContext({
      本场场景表: '本场场景',
      出场人物: '林晚',
      上一场: secret,
      相关设定: '世界很冷',
      骨架段: '结局',
      风格约束: '短句',
      禁写清单: '不写现代网络用语',
    })
    expect(full.requestText).toContain('不写现代网络用语')
    expect(full.requestText).toContain(secret)
    expect(full.materials.find((item) => item.key === '上一场')?.text.length).toBeLessThanOrEqual(800)
    const omitted = assembleContext(
      { 本场场景表: '本场场景', 上一场: secret, 禁写清单: '不写现代网络用语' },
      ['上一场'],
    )
    expect(omitted.requestText).not.toContain(secret)
    expect(omitted.requestText).toContain('不写现代网络用语')
  })

  it('嵌入只打本机 18100，失败时字面检索还在，目标库名是 snowflake', async () => {
    const calls: string[] = []
    const gbrain = createGbrainClient()
    const store = createBookStore({
      gbrain,
      gbrainEmbedRows: 4,
      embedFetch: async (url: string) => {
        calls.push(url)
        if (url !== EMBED_URL) throw new Error('语义检索失败')
      },
    })
    store.importText('book', '独特句子只在这一场')
    expect(store.embeddingDbName()).toBe(DB_NAME)
    expect(store.gbrainEmbedCount()).toBe(4)
    await store.flushEmbed('book')
    expect(calls).toEqual([EMBED_URL])
    expect(store.gbrainEmbedCount()).toBe(4)
    expect(store.literalSearch('book', '独特句子')[0]?.text).toContain('独特句子')
    const down = createBookStore({
      embedFetch: async () => {
        throw new Error('连不上')
      },
    })
    down.importText('book', '字面还能找')
    await expect(down.semanticSearch('book', '字面')).rejects.toThrow('语义检索失败')
    expect(down.literalSearch('book', '字面')[0]?.text).toContain('字面还能找')
    const foreign = createBookStore({
      embedFetch: async (url: string) => {
        calls.push(url)
      },
    })
    const foreignHits = await foreign.semanticSearch('book', 'x')
    expect(foreignHits).toEqual([])
    expect(calls.every((url) => url === EMBED_URL)).toBe(true)
    expect(calls.some((url) => url.includes('10.') || url.includes('example'))).toBe(false)
  })
})

describe('R11 约束与系列', () => {
  it('约束记在书上，系列改动能选只改本书或改到系列', () => {
    const store = createBookStore()
    store.setConstraints('a', { title: '第一本', targetWords: 120000, endingType: '悲剧', forbidden: '不写穿越', styleSample: '短句。' })
    store.setConstraints('b', { title: '第二本' })
    const seriesId = store.createSeries('冰与火')
    store.attachSeries('a', seriesId)
    store.attachSeries('b', seriesId)
    store.upsertEntity('a', { name: '师父', text: '系列里的师父', mode: 'series' })
    expect(store.visibleEntities('b').find((entity: { name: string }) => entity.name === '师父')?.text).toBe('系列里的师父')
    store.upsertEntity('a', { name: '师父', text: '只在第一本', mode: 'book' })
    expect(store.visibleEntities('a').find((entity: { name: string }) => entity.name === '师父')?.text).toBe('只在第一本')
    expect(store.visibleEntities('b').find((entity: { name: string }) => entity.name === '师父')?.text).toBe('系列里的师父')
    expect(store.constraints('a').forbidden).toBe('不写穿越')
    expect(store.contextInput('a', 'missing')['禁写清单']).toBe('不写穿越')
  })
})

describe('R12 撤销与回收站', () => {
  it('改 30 次后能连续撤销 30 次', () => {
    const store = createBookStore()
    for (let index = 1; index <= 30; index += 1) store.editCard('book', 'c1', `第${index}次`)
    expect(store.cardBody('book', 'c1')).toBe('第30次')
    for (let index = 0; index < 30; index += 1) expect(store.undo('book')).toBe(true)
    expect(store.cardBody('book', 'c1')).toBe('')
  })

  it('删掉有讨论的卡，恢复后卡、连线和讨论都回来', () => {
    const store = createBookStore()
    store.editCard('book', 'c1', '有讨论的卡')
    store.addEdge('book', 'c1', 'c2')
    store.addDiscussion('book', 'c1', 'session-1')
    store.softDeleteCard('book', 'c1')
    expect(store.cardBundle('book', 'c1').card).toBeNull()
    expect(store.cardBundle('book', 'c1').edges).toHaveLength(0)
    expect(store.cardBundle('book', 'c1').discussions).toHaveLength(0)
    store.restoreCard('book', 'c1')
    const back = store.cardBundle('book', 'c1')
    expect(back.card?.body).toBe('有讨论的卡')
    expect(back.edges).toHaveLength(1)
    expect(back.discussions[0]?.sessionId).toBe('session-1')
  })

  it('删书后能恢复，导出与删前一致；过了 30 天才会清掉', () => {
    const store = createBookStore({ now: () => new Date('2026-01-01T00:00:00Z') })
    store.setConstraints('book', { title: '可恢复' })
    store.createChapters('book', 1, 1)
    const sceneId = store.chapters('book')[0].scenes[0].id
    store.putSceneText('book', sceneId, '删前正文', { force: true })
    const before = store.exportMarkdown('book')
    store.deleteBook('book')
    store.restoreBook('book')
    expect(store.exportMarkdown('book')).toBe(before)
    store.deleteBook('kept')
    expect(store.purgeExpired(new Date('2026-01-20T00:00:00Z'))).toBe(0)
    expect(store.purgeExpired(new Date('2026-02-15T00:00:00Z'))).toBeGreaterThan(0)
  })
})

describe('四条阻断', () => {
  it('章节页能直接建，场正文可写，起草已接上，常规保存不是整份 PUT', () => {
    const root = join(import.meta.dirname, '..')
    const chapter = readFileSync(join(root, 'src/ChapterPage.tsx'), 'utf8')
    const flow = readFileSync(join(root, 'src/FlowPage.tsx'), 'utf8')
    const remote = readFileSync(join(root, 'src/remote-canvas.ts'), 'utf8')
    expect(chapter).toContain('新建章')
    expect(chapter).toContain('readOnly={false}')
    expect(chapter).toContain("resolveProseFork(current, scene.id, 'scene')")
    expect(flow).toContain('/api/flows/draft')
    expect(flow).not.toContain('起草还没接上')
    expect(remote).toContain("method: 'PATCH'")
    expect(remote).not.toContain("method: 'PUT'")
  })

  it('场景表退回一段时，原来的非空字段都还在', () => {
    let state = createDocument('layer')
    state = createCard(state, {
      id: 's',
      layer: '场景表',
      x: 0,
      y: 0,
      fields: { pov: '林晚', what: '她在门口停了三秒', conflict: '弟弟不肯进门' },
    })
    const before = Object.values(state.snowflake.cards.s?.fields ?? {}).filter((value) => value.trim())
    const next = changeToAnyLayer(state, 's', '一段')
    const packed = JSON.stringify(next.snowflake.cards.s)
    const found = before.filter((value) => packed.includes(value))
    expect(next.snowflake.cards.s?.layer).toBe('一段')
    expect(found).toHaveLength(before.length)
  })
})

describe('postgres 书稿库', () => {
  it('表建在 snowflake 库，正本能写回，chapter 键计数按表来', () => {
    applySchema()
    const document = { canvas: { nodes: [], edges: [] }, snowflake: { fileId: 'pg-1', cards: {} }, title: 'pg' }
    mirrorDocument('pg-roundtrip', document)
    expect(readMirroredDocument('pg-roundtrip')).toEqual(document)
    expect(chapterKeyCountSql()).toBe(0)
    const trigram = psql('snowflake', "SELECT count(*) FROM show_trgm('雪花')")
    expect(Number(trigram)).toBeGreaterThan(0)
    expect(() => psql('postgres', 'SELECT 1')).toThrow(/CONNECT/u)
  })

  it('上游改字或退回更早层后下游标记 needsReview，场次步骤/失败/历史稿与建议箱完整落盘往返', () => {
    let state = createDocument('persist-v3-closure')
    state = createCard(state, { id: 'up', layer: '一句话', x: 0, y: 0, fields: { sentence: '初版一句话' } })
    state = createCard(state, { id: 'down', layer: '一段', x: 0, y: 120, fields: { background: '初版一段' } })
    state = linkCards(state, 'up', 'down')
    expect(cardNeedsReview(state.snowflake.cards.down)).toBe(false)

    state = commitCardText(state, 'up', '改后的一句话', 'sentence', false)
    expect(cardNeedsReview(state.snowflake.cards.down)).toBe(true)
    expect(earlierLayers('一段')).toContain('一句话')

    state = addChapter(state, '第一章', 'ch-1')
    const sceneId = state.chapters![0]!.scenes[0]!.id
    state = updateSceneStep(state, sceneId, '经过')
    state = updateSceneFailure(state, sceneId, true)
    state = updateSceneProse(state, sceneId, '第一稿正文')
    state = saveSceneRevision(state, sceneId, '10:00:00')
    state = updateSceneProse(state, sceneId, '第二稿正文')
    state = {
      ...state,
      suggestions: [
        {
          id: 'sug-1',
          cardId: 'down',
          action: 'existing-scene',
          beatId: sceneId,
          text: '折入的补充段落',
          where: '本场任务',
          createdAt: '2026-10-18T14:00:00Z',
        },
      ],
    }

    const roundTrip = parseCompleteDocument(documentToBytes(state))
    expect(roundTrip).not.toBeNull()
    let loaded = roundTrip!.state
    expect(cardNeedsReview(loaded.snowflake.cards.down)).toBe(true)
    expect(loaded.chapters![0]!.scenes[0]!.step).toBe('经过')
    expect(loaded.chapters![0]!.scenes[0]!.failure).toBe(true)
    expect(loaded.chapters![0]!.scenes[0]!.revisions).toHaveLength(1)
    expect(loaded.suggestions).toHaveLength(1)

    loaded = acknowledgeCardReview(loaded, 'down')
    expect(cardNeedsReview(loaded.snowflake.cards.down)).toBe(false)

    loaded = acceptSuggestionToScene(loaded, 'sug-1', sceneId, '10:05:00')
    expect(loaded.suggestions ?? []).toHaveLength(0)
    expect(loaded.chapters![0]!.scenes[0]!.prose).toContain('折入的补充段落')

    loaded = rollbackSceneRevision(loaded, sceneId, 0, '10:06:00')
    expect(loaded.chapters![0]!.scenes[0]!.prose).toBe('第一稿正文')
  })

})
