import { diffTextParts } from './diff-text.mjs'
import { docxOf, epubOf, markdownOf, plainOf, stripSpace } from './formats.mjs'
import { applyPlan, previewImport } from './import-text.mjs'

export const PROVENANCE_KINDS = ['手写', '采纳', '扩写', '导入']
export const EMBED_URL = 'http://127.0.0.1:18100/v1/embeddings'
export const DB_NAME = 'snowflake'
export const METHOD_PAGE = 'method/writing-notes'
export const BIBLIOGRAPHY_PAGE = 'projects/snowflake-canvas-books'
export const MIGRATED_MARK = '已迁回雪花画布'
export const PAUSE_MS = 1500
export const REVISION_KEEP = 200
export const TRASH_MS = 30 * 24 * 60 * 60 * 1000

export const FRAME_STEPS = {
  雪花十层: ['situation', '一句话', '一段', 'renwubiao', 'yiyedagang', 'renwugushi', 'renwudangan', '场景表', 'changci', '正文草稿'],
  启程转合: ['开端', '经过', '转折', '结果'],
  故事八步: ['开端', '激励', '进展', '挫折', '高潮前', '高潮', '下降', '结局'],
}

let seq = 0
function nid(prefix) {
  seq += 1
  return `${prefix}-${seq}`
}

export function createGbrainClient() {
  const calls = []
  const pages = new Map()
  const timeline = []
  return {
    calls,
    pages,
    timeline,
    async put(slug, content) {
      calls.push({ op: 'put', slug })
      pages.set(slug, content)
      return { slug }
    },
    async timelineAdd(page, line) {
      calls.push({ op: 'timeline', page, line })
      timeline.push({ page, line })
    },
    async get(slug) {
      return pages.has(slug) ? pages.get(slug) : null
    },
    async appendMarker(slug, marker) {
      const current = pages.get(slug) ?? ''
      pages.set(slug, `${current}\n${marker}`.trim())
      calls.push({ op: 'append', slug, marker })
    },
  }
}

export function createBookStore(options = {}) {
  const now = options.now || (() => new Date('2026-10-16T03:00:00Z'))
  const gbrain = options.gbrain || createGbrainClient()
  const embedFetch = options.embedFetch || null
  const books = new Map()
  const series = new Map()
  let adoptFail = null
  const gbrainEmbedRows = { count: options.gbrainEmbedRows ?? 0 }

  function clock() {
    const value = now()
    return value instanceof Date ? value : new Date(value)
  }

  function ensure(id) {
    if (!books.has(id)) {
      books.set(id, {
        id,
        title: '',
        deletedAt: null,
        document: null,
        snapshot: null,
        report: [],
        meta: { targetWords: 0, endingType: '', forbidden: '', styleSample: '', title: '' },
        seriesId: null,
        chapters: [],
        cards: {},
        links: [],
        edges: [],
        discussions: [],
        revisions: {},
        provenance: [],
        entities: [],
        relations: [],
        suggestions: [],
        frame: { kind: '雪花十层', points: '', slug: '', dismissed: [] },
        opLog: [],
        outlineNames: [],
        appearing: {},
        embedQueue: [],
        embeddings: [],
        proseMarks: {},
        edited: false,
      })
    }
    return books.get(id)
  }

  function liveScenes(book) {
    const rows = []
    for (const chapter of book.chapters) {
      if (chapter.deletedAt) continue
      for (const scene of chapter.scenes) {
        if (!scene.deletedAt) rows.push({ chapter, scene })
      }
    }
    return rows
  }

  function findScene(book, sceneId) {
    for (const row of liveScenes(book)) {
      if (row.scene.id === sceneId) return row
    }
    return null
  }

  function pushOp(book, before, after) {
    book.opLog.push({ id: nid('op'), before, after, undone: false, at: clock().toISOString() })
  }

  function snapshotBook(book) {
    return structuredClone({
      title: book.title,
      chapters: book.chapters,
      cards: book.cards,
      edges: book.edges,
      discussions: book.discussions,
      entities: book.entities,
      meta: book.meta,
    })
  }

  function restoreBookShape(book, shape) {
    book.title = shape.title
    book.chapters = shape.chapters
    book.cards = shape.cards
    book.edges = shape.edges
    book.discussions = shape.discussions
    book.entities = shape.entities
    book.meta = shape.meta
  }

  function mutate(book, recipe) {
    const before = snapshotBook(book)
    recipe()
    const after = snapshotBook(book)
    pushOp(book, before, after)
    book.edited = true
  }

  function placeOrphan(book, cardId, body) {
    let chapter = book.chapters.find((item) => item.title === '未归场' && !item.deletedAt)
    if (!chapter) {
      chapter = { id: nid('ch'), title: '未归场', ord: book.chapters.length, deletedAt: null, scenes: [] }
      book.chapters.push(chapter)
    }
    const scene = {
      id: nid('sc'),
      title: '未归场草稿',
      ord: chapter.scenes.length,
      body: body || '',
      deletedAt: null,
      step: '',
      failure: false,
      rev: 1,
      draftCardId: cardId,
    }
    chapter.scenes.push(scene)
    book.revisions[scene.id] = [{ body: scene.body, kind: '手写', at: clock().toISOString(), sessionId: '', requestId: '', quote: '', offset: null }]
    return scene.id
  }

  function project(book, document) {
    book.document = structuredClone(document)
    book.snapshot = structuredClone(document)
    book.title = typeof document.title === 'string' ? document.title : book.title
    const incoming = Array.isArray(document.chapters) ? document.chapters : []
    const knownTitles = new Set(incoming.map((chapter) => (typeof chapter.title === 'string' ? chapter.title : '')))
    book.chapters = incoming.map((chapter, index) => ({
      id: typeof chapter.id === 'string' ? chapter.id : nid('ch'),
      title: typeof chapter.title === 'string' ? chapter.title : '',
      ord: index,
      deletedAt: null,
      scenes: Array.isArray(chapter.scenes)
        ? chapter.scenes.map((scene, sceneIndex) => ({
            id: typeof scene.id === 'string' ? scene.id : nid('sc'),
            title: typeof scene.title === 'string' ? scene.title : '',
            ord: sceneIndex,
            body: typeof scene.prose === 'string' ? scene.prose : '',
            deletedAt: null,
            step: typeof scene.step === 'string' ? scene.step : '',
            failure: scene.failure === true,
            rev: 1,
            proseFork: scene.proseFork === true,
          }))
        : [],
    }))
    const titleMap = new Map(book.chapters.map((chapter) => [chapter.title, chapter]))
    const cards = document.snowflake && document.snowflake.cards && typeof document.snowflake.cards === 'object' ? document.snowflake.cards : {}
    book.cards = {}
    book.links = []
    book.report = []
    for (const [cardId, card] of Object.entries(cards)) {
      const fields = card && card.fields && typeof card.fields === 'object' ? { ...card.fields } : {}
      const chapterName = typeof fields.chapter === 'string' ? fields.chapter : ''
      delete fields.chapter
      let sceneId = card && card.originAnchor && typeof card.originAnchor.sceneId === 'string' ? card.originAnchor.sceneId : null
      if (card && card.layer === '正文草稿' && !sceneId) sceneId = placeOrphan(book, cardId, typeof card.body === 'string' ? card.body : '')
      book.cards[cardId] = {
        id: cardId,
        layer: card && typeof card.layer === 'string' ? card.layer : 'situation',
        fields,
        body: card && typeof card.body === 'string' ? card.body : '',
        sceneId,
        deletedAt: null,
        needsReview: false,
        rev: 1,
      }
      if (chapterName.trim()) {
        let chapter = titleMap.get(chapterName)
        const merged = knownTitles.has(chapterName) && chapter
        if (!chapter) {
          chapter = { id: nid('ch'), title: chapterName, ord: book.chapters.length, deletedAt: null, scenes: [] }
          book.chapters.push(chapter)
          titleMap.set(chapterName, chapter)
        }
        book.links.push({ cardId, chapterId: chapter.id })
        book.report.push({ cardId, chapter: chapterName, merged: Boolean(merged) })
      }
    }
    book.revisions = {}
    for (const chapter of book.chapters) {
      for (const scene of chapter.scenes) {
        const revs = []
        if (scene.proseFork) {
          revs.push({ body: scene.body, kind: '手写', at: clock().toISOString(), sessionId: '', requestId: '', quote: '', offset: null })
          const draft = Object.values(book.cards).find((card) => card.sceneId === scene.id || card.id === scene.draftCardId)
          revs.push({ body: draft ? draft.body : '', kind: '手写', at: clock().toISOString(), sessionId: '', requestId: '', quote: '', offset: null })
        } else {
          revs.push({ body: scene.body, kind: '手写', at: clock().toISOString(), sessionId: '', requestId: '', quote: '', offset: null })
        }
        book.revisions[scene.id] = revs
      }
    }
    book.edited = false
  }

  function addRevision(book, scene, body, meta) {
    const list = book.revisions[scene.id] || []
    const last = list[list.length - 1]
    const at = clock()
    const force = meta.force === true
    if (last && !force && at.getTime() - new Date(last.at).getTime() < PAUSE_MS && last.kind === (meta.kind || '手写')) {
      last.body = body
      last.at = at.toISOString()
    } else {
      list.push({
        body,
        kind: meta.kind || '手写',
        at: at.toISOString(),
        sessionId: meta.sessionId || '',
        requestId: meta.requestId || '',
        quote: (meta.quote || body).slice(0, 500),
        offset: Number.isInteger(meta.offset) ? meta.offset : null,
      })
    }
    book.revisions[scene.id] = pruneRevisions(list)
    scene.body = body
    scene.rev += 1
  }

  function recordProvenance(book, meta, revision) {
    const kind = meta.kind || '手写'
    if (!PROVENANCE_KINDS.includes(kind)) throw new Error(`来源种类不对：${kind}`)
    if ((kind === '采纳' || kind === '扩写') && !meta.sessionId && !meta.requestId) throw new Error('扩写和采纳必须带会话或请求')
    book.provenance.push({
      id: nid('pv'),
      kind,
      sessionId: meta.sessionId || '',
      requestId: meta.requestId || '',
      quote: (meta.quote || revision.body || '').slice(0, 500),
      offset: Number.isInteger(meta.offset) ? meta.offset : null,
    })
  }

  return {
    migrateDocument(id, document) {
      const book = ensure(id)
      project(book, document)
      return book.report
    },
    exportDocument(id) {
      const book = ensure(id)
      if (!book.edited && book.snapshot) return structuredClone(book.snapshot)
      return structuredClone(book.document ?? book.snapshot ?? {})
    },
    chapterKeyCount() {
      let count = 0
      for (const book of books.values()) {
        for (const card of Object.values(book.cards)) {
          if (card.fields && Object.prototype.hasOwnProperty.call(card.fields, 'chapter')) count += 1
        }
      }
      return count
    },
    orphanProseCount() {
      let count = 0
      for (const book of books.values()) {
        for (const card of Object.values(book.cards)) {
          if (card.deletedAt) continue
          if (card.layer === '正文草稿' && !card.sceneId) count += 1
        }
      }
      return count
    },
    migrationReport(id) {
      return ensure(id).report.filter((item) => !item.merged)
    },
    createChapters(id, chapterCount, sceneCount) {
      const book = ensure(id)
      mutate(book, () => {
        for (let index = 0; index < chapterCount; index += 1) {
          const chapter = { id: nid('ch'), title: `第${book.chapters.length + 1}章`, ord: book.chapters.length, deletedAt: null, scenes: [] }
          for (let sceneIndex = 0; sceneIndex < sceneCount; sceneIndex += 1) {
            const scene = {
              id: nid('sc'),
              title: `第${sceneIndex + 1}场`,
              ord: sceneIndex,
              body: '',
              deletedAt: null,
              step: '',
              failure: false,
              rev: 1,
            }
            chapter.scenes.push(scene)
            book.revisions[scene.id] = []
          }
          book.chapters.push(chapter)
        }
      })
      return this.chapters(id)
    },
    chapters(id) {
      return ensure(id).chapters.filter((chapter) => !chapter.deletedAt).map((chapter) => ({
        ...chapter,
        scenes: chapter.scenes.filter((scene) => !scene.deletedAt),
      }))
    },
    renameChapter(id, chapterId, title) {
      const book = ensure(id)
      mutate(book, () => {
        const chapter = book.chapters.find((item) => item.id === chapterId)
        if (chapter) chapter.title = title
      })
    },
    linkCard(id, cardId, chapterTitle) {
      const book = ensure(id)
      mutate(book, () => {
        let chapter = book.chapters.find((item) => item.title === chapterTitle && !item.deletedAt)
        if (!chapter) {
          chapter = { id: nid('ch'), title: chapterTitle, ord: book.chapters.length, deletedAt: null, scenes: [] }
          book.chapters.push(chapter)
        }
        book.links = book.links.filter((link) => link.cardId !== cardId)
        book.links.push({ cardId, chapterId: chapter.id })
        if (!book.cards[cardId]) {
          book.cards[cardId] = { id: cardId, layer: 'changci', fields: {}, body: '', sceneId: null, deletedAt: null, needsReview: false, rev: 1 }
        }
        const card = book.cards[cardId]
        delete card.fields.chapter
      })
    },
    linksOf(id, chapterTitle) {
      const book = ensure(id)
      const chapter = book.chapters.find((item) => item.title === chapterTitle)
      if (!chapter) return []
      return book.links.filter((link) => link.chapterId === chapter.id).map((link) => link.cardId)
    },
    putSceneText(id, sceneId, text, meta = {}) {
      const book = ensure(id)
      const found = findScene(book, sceneId)
      if (!found) throw new Error('没有这场')
      addRevision(book, found.scene, text, meta)
      recordProvenance(book, meta, { body: text })
      if (meta.mark === 'ai') book.proseMarks[sceneId] = { on: true, faded: false }
      if (meta.authorEdit && book.proseMarks[sceneId]?.on) book.proseMarks[sceneId].faded = true
      return book.revisions[sceneId]
    },
    revisions(id, sceneId) {
      return [...(ensure(id).revisions[sceneId] || [])]
    },
    diffRevisions(id, sceneId, left, right) {
      const list = ensure(id).revisions[sceneId] || []
      return diffTextParts(list[left]?.body || '', list[right]?.body || '')
    },
    rollbackRevision(id, sceneId, index) {
      const book = ensure(id)
      const list = book.revisions[sceneId] || []
      const chosen = list[index]
      if (!chosen) throw new Error('没有这稿')
      const found = findScene(book, sceneId)
      if (!found) throw new Error('没有这场')
      found.scene.body = chosen.body
      return list.length
    },
    setAdoptFailure(stage) {
      adoptFail = stage
    },
    adopt(input) {
      const book = ensure(input.bookId)
      const before = snapshotBook(book)
      const provenanceBefore = structuredClone(book.provenance)
      const revisionsBefore = structuredClone(book.revisions)
      try {
        const found = findScene(book, input.sceneId)
        if (!found) throw new Error('没有这场')
        addRevision(book, found.scene, input.text, { ...input, force: true, kind: input.kind || '采纳' })
        if (adoptFail === 'before-provenance') throw new Error('写入来源前失败')
        recordProvenance(book, { ...input, kind: input.kind || '采纳', quote: input.quote || input.text }, { body: input.text })
        pushOp(book, before, snapshotBook(book))
        return { ok: true }
      } catch {
        restoreBookShape(book, before)
        book.provenance = provenanceBefore
        book.revisions = revisionsBefore
        const error = new Error('没采纳上')
        return { ok: false, error: error.message }
      }
    },
    provenanceReport() {
      const rows = []
      for (const book of books.values()) rows.push(...book.provenance)
      const badKind = rows.filter((row) => !PROVENANCE_KINDS.includes(row.kind))
      const linked = rows.filter((row) => row.kind === '采纳' || row.kind === '扩写')
      const missing = linked.filter((row) => !row.sessionId && !row.requestId)
      return {
        kinds: [...new Set(rows.map((row) => row.kind))],
        linked: linked.length,
        missing: missing.length,
        badKind: badKind.length,
      }
    },
    exportMarkdown: (id) => markdownOf(viewBook(ensure(id))),
    exportPlain: (id) => plainOf(viewBook(ensure(id))),
    exportDocx: (id) => docxOf(viewBook(ensure(id))),
    exportEpub: (id) => epubOf(viewBook(ensure(id))),
    precheck(id) {
      const book = ensure(id)
      const issues = []
      for (const [chapterIndex, chapter] of book.chapters.filter((item) => !item.deletedAt).entries()) {
        if (chapter.title === '未归场') {
          for (const scene of chapter.scenes.filter((item) => !item.deletedAt)) {
            issues.push({ sceneId: scene.id, message: '未归场还有草稿', chapterIndex, sceneIndex: scene.ord })
          }
        }
        for (const [sceneIndex, scene] of chapter.scenes.filter((item) => !item.deletedAt).entries()) {
          if (!(scene.body || '').trim()) issues.push({ sceneId: scene.id, message: `第 ${chapterIndex + 1} 章第 ${sceneIndex + 1} 场是空的` })
          const mark = book.proseMarks[scene.id]
          if (mark?.on && !mark.faded) issues.push({ sceneId: scene.id, message: `第 ${chapterIndex + 1} 章第 ${sceneIndex + 1} 场还有未决的 AI 标记` })
        }
      }
      return issues
    },
    previewImport,
    importText(id, text, plan) {
      const book = ensure(id)
      const before = snapshotBook(book)
      const preview = previewImport(text)
      if (!preview.ok) return { ok: false, error: preview.error, unchanged: JSON.stringify(before) === JSON.stringify(snapshotBook(book)) }
      const planned = applyPlan(preview, plan)
      const chapterCountBefore = book.chapters.length
      book.chapters = planned.chapters.map((chapter, index) => ({
        id: nid('ch'),
        title: chapter.title,
        ord: index,
        deletedAt: null,
        scenes: chapter.scenes.map((scene, sceneIndex) => {
          const sceneId = nid('sc')
          const row = {
            id: sceneId,
            title: scene.title,
            ord: sceneIndex,
            body: scene.text,
            deletedAt: null,
            step: '',
            failure: false,
            rev: 1,
          }
          book.revisions[sceneId] = [{
            body: scene.text,
            kind: '导入',
            at: clock().toISOString(),
            sessionId: '',
            requestId: '',
            quote: scene.text.slice(0, 500),
            offset: scene.start ?? 0,
          }]
          book.provenance.push({ id: nid('pv'), kind: '导入', sessionId: '', requestId: '', quote: scene.text.slice(0, 500), offset: scene.start ?? 0 })
          const summary = [...scene.text].slice(0, 40).join('')
          const cardId = nid('idea')
          book.cards[cardId] = {
            id: cardId,
            layer: 'situation',
            fields: {},
            body: summary,
            sceneId,
            deletedAt: null,
            needsReview: false,
            rev: 1,
          }
          book.embedQueue.push({ id: sceneId, text: scene.text })
          return row
        }),
      }))
      void chapterCountBefore
      return { ok: true, chapters: this.chapters(id), queued: book.embedQueue.length }
    },
    embedPending(id) {
      return ensure(id).embedQueue.length
    },
    embeddingCount(id) {
      return ensure(id).embeddings.length
    },
    embeddingDbName() {
      return DB_NAME
    },
    gbrainEmbedCount() {
      return gbrainEmbedRows.count
    },
    async flushEmbed(id) {
      const book = ensure(id)
      const jobs = book.embedQueue.splice(0)
      for (const job of jobs) {
        assertEmbedTarget(EMBED_URL)
        if (embedFetch) await embedFetch(EMBED_URL, job.text)
        book.embeddings.push({ id: nid('emb'), targetId: job.id, chunk: job.text, db: DB_NAME })
      }
      return book.embeddings.length
    },
    async semanticSearch(id, query) {
      assertEmbedTarget(EMBED_URL)
      if (!embedFetch) throw new Error('语义检索失败')
      try {
        await embedFetch(EMBED_URL, query)
      } catch {
        throw new Error('语义检索失败')
      }
      return this.literalSearch(id, query)
    },
    literalSearch(id, query) {
      const book = ensure(id)
      const hits = []
      for (const [chapterIndex, chapter] of book.chapters.filter((item) => !item.deletedAt).entries()) {
        for (const [sceneIndex, scene] of chapter.scenes.filter((item) => !item.deletedAt).entries()) {
          if ((scene.body || '').includes(query)) hits.push({ kind: 'scene', chapterIndex, sceneIndex, sceneId: scene.id, text: scene.body })
        }
      }
      return hits
    },
    sediment(id, item) {
      const book = ensure(id)
      const entity = {
        id: nid('en'),
        bookId: id,
        seriesId: null,
        scope: 'book',
        name: item.name || '未命名',
        fields: { body: item.text || '' },
        deletedAt: null,
        source: item.sessionId ? `讨论 ${item.sessionId}` : '',
      }
      book.entities.push(entity)
      book.entityRevisions = book.entityRevisions || []
      book.entityRevisions.push({ entityId: entity.id, body: item.text || '', kind: '采纳', sessionId: item.sessionId || '', source: entity.source })
      return entity.id
    },
    async writeMethod(id, item) {
      if (item.kind !== '写作方法心得') throw new Error('只有写作方法心得可以写入脑')
      const book = ensure(id)
      const header = `来自《${book.meta.title || book.title || id}》讨论 ${item.sessionId || ''}`
      await gbrain.put(METHOD_PAGE, `${header}\n${item.text || ''}`)
      return METHOD_PAGE
    },
    gbrainStats() {
      return { puts: gbrain.calls.filter((call) => call.op === 'put').length, timeline: gbrain.timeline.length, pages: gbrain.pages.size }
    },
    async pullPages(id, pages) {
      const book = ensure(id)
      for (const page of pages) {
        const content = (await gbrain.get(page.slug)) ?? page.content ?? ''
        const entityId = this.sediment(id, { name: page.name || page.slug, text: content, sessionId: '' })
        book.entities.find((entity) => entity.id === entityId).source = page.slug
        await gbrain.appendMarker(page.slug, MIGRATED_MARK)
      }
    },
    async ensureBibliography(canvasPath) {
      const body = `书目索引\n画布：${canvasPath || '/xuehua/'}`
      if (!gbrain.pages.has(BIBLIOGRAPHY_PAGE)) await gbrain.put(BIBLIOGRAPHY_PAGE, body)
      return BIBLIOGRAPHY_PAGE
    },
    deleteBook(id) {
      const book = ensure(id)
      book.deletedAt = clock().toISOString()
      for (const entity of book.entities) entity.deletedAt = book.deletedAt
    },
    restoreBook(id) {
      const book = ensure(id)
      book.deletedAt = null
      for (const entity of book.entities) entity.deletedAt = null
    },
    entityCount(id) {
      const book = books.get(id)
      if (!book || book.deletedAt) return 0
      return book.entities.filter((entity) => !entity.deletedAt).length
    },
    purgeExpired(at) {
      const moment = at instanceof Date ? at : new Date(at)
      let removed = 0
      for (const book of books.values()) {
        if (book.deletedAt && moment.getTime() - new Date(book.deletedAt).getTime() >= TRASH_MS) {
          books.delete(book.id)
          removed += 1
          continue
        }
        for (const chapter of book.chapters) {
          chapter.scenes = chapter.scenes.filter((scene) => {
            if (!scene.deletedAt) return true
            if (moment.getTime() - new Date(scene.deletedAt).getTime() >= TRASH_MS) {
              removed += 1
              return false
            }
            return true
          })
        }
      }
      return removed
    },
    suggest(id, item) {
      const book = ensure(id)
      const suggestion = {
        id: nid('sg'),
        sceneId: item.sceneId,
        body: item.text,
        status: 'open',
        source: `来自 第 ${item.chapterIndex} 章第 ${item.sceneIndex} 场`,
        entityName: item.entityName || '',
      }
      book.suggestions.push(suggestion)
      return suggestion
    },
    suggestions(id) {
      return ensure(id).suggestions.filter((item) => item.status === 'open')
    },
    acceptSuggestion(id, suggestionId) {
      const book = ensure(id)
      const suggestion = book.suggestions.find((item) => item.id === suggestionId)
      if (!suggestion) throw new Error('没有这条建议')
      suggestion.status = 'accepted'
      const entity = {
        id: nid('en'),
        bookId: id,
        seriesId: book.seriesId,
        scope: 'book',
        name: suggestion.entityName || '设定',
        fields: { body: suggestion.body },
        deletedAt: null,
        source: suggestion.source,
      }
      book.entities.push(entity)
      return entity
    },
    setFrame(id, kind, points, slug) {
      const book = ensure(id)
      if (!FRAME_STEPS[kind]) throw new Error('没有这套骨架')
      book.frame = { kind, points: points || '', slug: slug || '', dismissed: [] }
    },
    frameView(id) {
      const book = ensure(id)
      const steps = FRAME_STEPS[book.frame.kind] || []
      return {
        kind: book.frame.kind,
        steps,
        points: book.frame.points,
        slug: book.frame.slug,
        dismissed: [...book.frame.dismissed],
        scenes: liveScenes(book).map((row) => ({ id: row.scene.id, step: row.scene.step, failure: row.scene.failure === true })),
        foreshadows: book.relations.map((relation) => ({ id: relation.id, name: relation.name, plant: relation.plantSceneId, payoff: relation.payoffSceneId })),
        outlineNames: [...book.outlineNames],
        appearingNames: Object.keys(book.appearing),
      }
    },
    hangStep(id, sceneId, step, failure = false) {
      const found = findScene(ensure(id), sceneId)
      if (!found) throw new Error('没有这场')
      found.scene.step = step
      found.scene.failure = failure
    },
    addForeshadow(id, name, plantSceneId, payoffSceneId = null) {
      ensure(id).relations.push({ id: nid('rel'), name, plantSceneId, payoffSceneId })
    },
    setOutline(id, names, appearing) {
      const book = ensure(id)
      book.outlineNames = [...names]
      book.appearing = { ...appearing }
    },
    dismissGap(id, gapId) {
      const book = ensure(id)
      if (!book.frame.dismissed.includes(gapId)) book.frame.dismissed.push(gapId)
    },
    setConstraints(id, meta) {
      const book = ensure(id)
      book.meta = {
        ...book.meta,
        ...meta,
        title: meta.title ?? book.meta.title,
      }
      if (meta.title) book.title = meta.title
    },
    constraints(id) {
      return { ...ensure(id).meta }
    },
    contextInput(id, sceneId) {
      const book = ensure(id)
      const rows = liveScenes(book)
      const index = rows.findIndex((row) => row.scene.id === sceneId)
      const current = rows[index]
      const previous = index > 0 ? rows[index - 1].scene.body : ''
      return {
        本场场景表: current ? current.scene.body : '',
        出场人物: book.entities.filter((entity) => !entity.deletedAt).map((entity) => `${entity.name} ${entity.fields.body || ''}`).join('\n'),
        上一场: previous,
        相关设定: book.entities.filter((entity) => !entity.deletedAt).map((entity) => entity.fields.body || '').join('\n'),
        骨架段: book.frame.points || (FRAME_STEPS[book.frame.kind] || []).join('、'),
        风格约束: book.meta.styleSample || '',
        禁写清单: book.meta.forbidden || '',
      }
    },
    createSeries(name) {
      const id = nid('series')
      series.set(id, { id, name, entities: [] })
      return id
    },
    attachSeries(bookId, seriesId) {
      if (!series.has(seriesId)) throw new Error('没有这个系列')
      ensure(bookId).seriesId = seriesId
    },
    upsertEntity(bookId, input) {
      const book = ensure(bookId)
      if (input.mode === 'series') {
        if (!book.seriesId) throw new Error('这本书没有系列')
        const bucket = series.get(book.seriesId)
        const existing = bucket.entities.find((entity) => entity.name === input.name)
        if (existing) existing.fields = { body: input.text }
        else bucket.entities.push({ id: nid('en'), name: input.name, fields: { body: input.text }, scope: 'series' })
        return
      }
      const override = book.entities.find((entity) => entity.name === input.name && entity.scope === 'book' && entity.override)
      if (override) override.fields = { body: input.text }
      else {
        book.entities.push({
          id: nid('en'),
          bookId,
          seriesId: book.seriesId,
          scope: 'book',
          name: input.name,
          fields: { body: input.text },
          deletedAt: null,
          source: '',
          override: true,
        })
      }
    },
    visibleEntities(bookId) {
      const book = ensure(bookId)
      const shared = book.seriesId ? series.get(book.seriesId).entities : []
      const overrides = book.entities.filter((entity) => entity.override && !entity.deletedAt)
      const names = new Set(overrides.map((entity) => entity.name))
      return [
        ...shared.filter((entity) => !names.has(entity.name)).map((entity) => ({ name: entity.name, text: entity.fields.body, scope: 'series' })),
        ...overrides.map((entity) => ({ name: entity.name, text: entity.fields.body, scope: 'book' })),
      ]
    },
    editCard(id, cardId, body) {
      const book = ensure(id)
      mutate(book, () => {
        if (!book.cards[cardId]) {
          book.cards[cardId] = { id: cardId, layer: 'situation', fields: {}, body: '', sceneId: null, deletedAt: null, needsReview: false, rev: 1 }
        }
        book.cards[cardId].body = body
        book.cards[cardId].rev += 1
      })
    },
    cardBody(id, cardId) {
      return ensure(id).cards[cardId]?.body ?? ''
    },
    undo(id) {
      const book = ensure(id)
      for (let index = book.opLog.length - 1; index >= 0; index -= 1) {
        const entry = book.opLog[index]
        if (entry.undone) continue
        entry.undone = true
        restoreBookShape(book, entry.before)
        return true
      }
      return false
    },
    softDeleteCard(id, cardId) {
      const book = ensure(id)
      const stamp = clock().toISOString()
      mutate(book, () => {
        if (book.cards[cardId]) book.cards[cardId].deletedAt = stamp
        for (const edge of book.edges) {
          if (edge.from === cardId || edge.to === cardId) edge.deletedAt = stamp
        }
        for (const discussion of book.discussions) {
          if (discussion.cardId === cardId) discussion.deletedAt = stamp
        }
      })
    },
    restoreCard(id, cardId) {
      const book = ensure(id)
      mutate(book, () => {
        if (book.cards[cardId]) book.cards[cardId].deletedAt = null
        for (const edge of book.edges) {
          if (edge.from === cardId || edge.to === cardId) edge.deletedAt = null
        }
        for (const discussion of book.discussions) {
          if (discussion.cardId === cardId) discussion.deletedAt = null
        }
      })
    },
    addEdge(id, from, to) {
      ensure(id).edges.push({ id: nid('edge'), from, to, kind: '派生', deletedAt: null })
    },
    addDiscussion(id, cardId, sessionId) {
      ensure(id).discussions.push({ id: nid('ds'), cardId, sessionId, deletedAt: null })
    },
    cardBundle(id, cardId) {
      const book = ensure(id)
      const card = book.cards[cardId]
      return {
        card: card && !card.deletedAt ? card : null,
        edges: book.edges.filter((edge) => !edge.deletedAt && (edge.from === cardId || edge.to === cardId)),
        discussions: book.discussions.filter((item) => !item.deletedAt && item.cardId === cardId),
      }
    },
    patchScenes(id, patches) {
      const book = ensure(id)
      let conflicts = 0
      for (const patch of patches) {
        const found = findScene(book, patch.sceneId)
        if (!found) {
          conflicts += 1
          continue
        }
        if (found.scene.rev !== patch.baseRev) {
          conflicts += 1
          continue
        }
        addRevision(book, found.scene, patch.text, { force: true, kind: '手写' })
      }
      return { conflicts }
    },
    sceneRev(id, sceneId) {
      return findScene(ensure(id), sceneId)?.scene.rev ?? null
    },
    sceneBody(id, sceneId) {
      return findScene(ensure(id), sceneId)?.scene.body ?? ''
    },
    markDerived(id, fromId, toId) {
      const book = ensure(id)
      this.addEdge(id, fromId, toId)
      if (book.cards[fromId] && book.cards[toId]) book.cards[toId].needsReview = false
    },
    editSentence(id, cardId, text) {
      const book = ensure(id)
      this.editCard(id, cardId, text)
      for (const edge of book.edges) {
        if (edge.deletedAt || edge.kind !== '派生' || edge.from !== cardId) continue
        if (book.cards[edge.to]) book.cards[edge.to].needsReview = true
      }
    },
    acknowledge(id, cardId) {
      const card = ensure(id).cards[cardId]
      if (card) card.needsReview = false
    },
    needsReview(id, cardId) {
      return ensure(id).cards[cardId]?.needsReview === true
    },
  }
}

function viewBook(book) {
  return { id: book.id, title: book.meta.title || book.title, chapters: book.chapters }
}

function pruneRevisions(list) {
  if (list.length <= REVISION_KEEP) return list
  const recent = list.slice(-REVISION_KEEP)
  const older = list.slice(0, -REVISION_KEEP)
  const daily = []
  const seen = new Set()
  for (const revision of older) {
    const day = (revision.at || '').slice(0, 10)
    if (seen.has(day)) continue
    seen.add(day)
    daily.push(revision)
  }
  return [...daily, ...recent]
}

export function assertEmbedTarget(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('语义检索失败')
  }
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '18100') throw new Error('语义检索失败')
}

export { diffTextParts, stripSpace }
