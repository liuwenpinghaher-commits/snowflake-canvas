import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { createBookStore } from '../server/db/engine.mjs'
import { psqlFile, quoteLiteral, readDsn } from '../server/db/pg-mirror.mjs'
import { defaultComplete } from '../server/flow-draft.mjs'

const BASE = process.env.GOT_S3_BASE || 'http://127.0.0.1:18093'
const TITLE = '权力的游戏·第三季验收'
const TITLES = ['北上', '黑城堡', '孪河城', '熊与少女', '火吻', '攀爬', '熊坑', '次子', '卡斯特梅的雨季', '弥莎']
const REQUIRED = ['罗柏', '凯特琳', '詹姆', '布蕾妮', '琼恩', '丹妮莉丝', '提利昂', '珊莎']
const FORBIDDEN = ['3b7c83ea', 'f63f5409']
const NOVEL = process.env.GOT_S3_NOVEL_PATH || join(userInfo().homedir, 'notes/snowflake-e2e-got-s3-novel.md')
const STATUS = '/tmp/snowflake-e2e-got-s3-status.json'
const SQL = '/tmp/snowflake-e2e-got-s3-seed.sql'
const SYNOPSIS = new URL('../got-s3/synopsis.md', import.meta.url)
const SUFFIX = '\n验收修订：北上的口令在出发前又核对了一遍。'
const SESSION_ID = 'got-s3-discuss-1'
const REQUEST_ID = 'got-s3-req-rob'
const HANDWRITTEN = {
  凯特琳: '凯特琳反对连夜北上，把干粮分成伤兵和传令两袋。',
  詹姆: '詹姆在孪河城被押着过桥，仍要布蕾妮看清箭窗。',
  布蕾妮: '布蕾妮把木盾交给詹姆，自己先跳进熊坑把熊引开。',
  琼恩: '琼恩在黑城堡把号角口令重复到每个哨位。',
  丹妮莉丝: '丹妮莉丝让进城的长矛不指向百姓，先去找还能用的井。',
  提利昂: '提利昂请珊莎把听见的名字记在蜡板上，今晚不必微笑。',
  珊莎: '珊莎把名字写到一半停住，有一个名字不肯念出声。',
}

function scrub(error) {
  let text = error instanceof Error ? `${error.message}` : String(error)
  try {
    const url = readDsn()
    const rest = url.split('://')[1] || ''
    const creds = rest.split('@')[0] || ''
    const pass = decodeURIComponent(creds.split(':').slice(1).join(':'))
    if (pass) text = text.split(pass).join('[redacted]')
  } catch {
    // 连接串读不到时只靠正则。
  }
  const key = process.env.CPA_API_KEY || ''
  if (key) text = text.split(key).join('[redacted]')
  return text.replace(/PGPASSWORD=\S+/g, 'PGPASSWORD=[redacted]').replace(/Bearer\s+\S+/g, 'Bearer [redacted]').slice(0, 800)
}

function hanCount(text) {
  return (text.match(/[\u4e00-\u9fff]/g) || []).length
}

function importBody(markdown) {
  const start = markdown.indexOf('## ')
  if (start < 0) throw Object.assign(new Error('梗概里没有章标题'), { failure: '梗概格式不对' })
  return markdown.slice(start).trim() + '\n'
}

function assertSynopsis(markdown) {
  const lines = markdown.split(/\r?\n/)
  if (!lines[0].includes('自写夹具，非原著摘录') || !lines[1].includes('自写夹具，非原著摘录') || !lines[2].includes('自写夹具，非原著摘录')) {
    throw Object.assign(new Error('梗概文首三行没有写明自写夹具'), { failure: '梗概格式不对' })
  }
  const body = importBody(markdown)
  const chunks = []
  let current = null
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      current = { title: line.slice(3).trim(), lines: [] }
      chunks.push(current)
    } else if (current) current.lines.push(line)
  }
  if (chunks.length !== 10) throw Object.assign(new Error(`梗概章数 ${chunks.length}`), { failure: '梗概格式不对' })
  chunks.forEach((chunk, index) => {
    if (chunk.title !== TITLES[index]) throw Object.assign(new Error(`梗概标题不符 ${chunk.title}`), { failure: '梗概格式不对' })
    const count = hanCount(chunk.lines.join('\n'))
    if (count < 180 || count > 320) throw Object.assign(new Error(`${chunk.title} 汉字 ${count}`), { failure: '梗概格式不对' })
  })
  const joined = chunks.map((chunk) => chunk.lines.join('\n')).join('\n')
  for (const name of REQUIRED) {
    const hits = chunks.filter((chunk) => chunk.lines.join('\n').includes(name)).length
    if (hits < 2) throw Object.assign(new Error(`${name} 只出现在 ${hits} 集`), { failure: '梗概格式不对' })
  }
  for (const id of FORBIDDEN) {
    if (joined.includes(id) || markdown.includes(id)) throw Object.assign(new Error('梗概含有其他季书 id'), { failure: '梗概格式不对' })
  }
  return body
}

async function api(path, options = {}) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    })
  } catch (error) {
    throw Object.assign(new Error(scrub(error)), { failure: '临时端口起不来' })
  }
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 400) }
  }
  if (!response.ok) {
    const failure = response.status === 502 || response.status === 504 ? '讨论模型失败' : `接口没有完成 HTTP ${response.status}`
    throw Object.assign(new Error(`HTTP ${response.status} ${path} ${JSON.stringify(body).slice(0, 400)}`), { failure })
  }
  return { body, etag: response.headers.get('etag') }
}

async function discussRobb() {
  let text = ''
  try {
    text = await defaultComplete([
      {
        role: 'user',
        content: '用四十到八十个汉字写一句验收夹具旁白，句子里必须出现「罗柏」，讲他把北上的口令只交给三名亲兵。不要用引号，不要复述已出版小说的句子。',
      },
    ])
  } catch (error) {
    throw Object.assign(new Error(scrub(error)), { failure: '讨论模型失败' })
  }
  const cleaned = String(text || '').trim()
  if (!cleaned.includes('罗柏') || hanCount(cleaned) < 8) {
    throw Object.assign(new Error('讨论模型没有给出可用的人物字段'), { failure: '讨论模型失败' })
  }
  for (const id of FORBIDDEN) {
    if (cleaned.includes(id)) throw Object.assign(new Error('讨论结果含有其他季书 id'), { failure: '讨论模型失败' })
  }
  return cleaned
}

function peopleOf(robText) {
  return [
    { name: '罗柏', text: robText, kind: '采纳', sessionId: SESSION_ID, requestId: REQUEST_ID },
    ...Object.entries(HANDWRITTEN).map(([name, text], index) => ({
      name,
      text,
      kind: '手写',
      sessionId: '',
      requestId: `got-s3-req-hand-${index + 1}`,
    })),
  ]
}

function sqlOf(bookId, chapters, revisionsByScene, people) {
  const lines = ['BEGIN;']
  lines.push(`DELETE FROM book WHERE title = ${quoteLiteral(TITLE)} AND id NOT IN ('3b7c83ea', 'f63f5409');`)
  lines.push(`INSERT INTO book (id, title, document_text) VALUES (${quoteLiteral(bookId)}, ${quoteLiteral(TITLE)}, '');`)
  chapters.forEach((chapter, index) => {
    const chapterId = `${bookId}-ch-${index + 1}`
    lines.push(
      `INSERT INTO chapter (id, book_id, title, ord) VALUES (${quoteLiteral(chapterId)}, ${quoteLiteral(bookId)}, ${quoteLiteral(chapter.title)}, ${index});`,
    )
    chapter.scenes.forEach((scene, sceneIndex) => {
      const sceneId = `${bookId}-sc-${index + 1}-${sceneIndex + 1}`
      const revisions = revisionsByScene.get(scene.id) || []
      lines.push(
        `INSERT INTO scene (id, book_id, chapter_id, title, ord, body, rev) VALUES (${quoteLiteral(sceneId)}, ${quoteLiteral(bookId)}, ${quoteLiteral(chapterId)}, ${quoteLiteral(scene.title || '第1场')}, ${sceneIndex}, ${quoteLiteral(scene.body || '')}, ${revisions.length || 1});`,
      )
      revisions.forEach((revision, revIndex) => {
        const revId = `${bookId}-sr-${index + 1}-${sceneIndex + 1}-${revIndex + 1}`
        lines.push(
          `INSERT INTO scene_revision (id, scene_id, rev, body, kind, session_id, request_id, quote) VALUES (${quoteLiteral(revId)}, ${quoteLiteral(sceneId)}, ${revIndex + 1}, ${quoteLiteral(revision.body || '')}, ${quoteLiteral(revision.kind || '手写')}, ${quoteLiteral(revision.sessionId || '')}, ${quoteLiteral(revision.requestId || '')}, ${quoteLiteral(revision.quote || '')});`,
        )
        lines.push(
          `INSERT INTO provenance (id, book_id, kind, scene_revision_id, session_id, request_id, quote) VALUES (${quoteLiteral(`${bookId}-pv-sc-${index + 1}-${sceneIndex + 1}-${revIndex + 1}`)}, ${quoteLiteral(bookId)}, ${quoteLiteral(revision.kind || '手写')}, ${quoteLiteral(revId)}, ${quoteLiteral(revision.sessionId || '')}, ${quoteLiteral(revision.requestId || '')}, ${quoteLiteral(revision.quote || revision.body || '')});`,
        )
      })
    })
  })
  people.forEach((person, index) => {
    const entityId = `${bookId}-en-${index + 1}`
    const revId = `${bookId}-er-${index + 1}`
    const fields = JSON.stringify({ 摘要: person.text })
    lines.push(
      `INSERT INTO entity (id, book_id, scope, name, fields) VALUES (${quoteLiteral(entityId)}, ${quoteLiteral(bookId)}, 'book', ${quoteLiteral(person.name)}, ${quoteLiteral(fields)}::jsonb);`,
    )
    lines.push(
      `INSERT INTO entity_revision (id, entity_id, rev, body, kind, source, session_id) VALUES (${quoteLiteral(revId)}, ${quoteLiteral(entityId)}, 1, ${quoteLiteral(person.text)}, ${quoteLiteral(person.kind)}, ${quoteLiteral(person.kind === '采纳' ? '讨论采纳' : '手写')}, ${quoteLiteral(person.sessionId || '')});`,
    )
    lines.push(
      `INSERT INTO provenance (id, book_id, kind, entity_revision_id, session_id, request_id, quote) VALUES (${quoteLiteral(`${bookId}-pv-en-${index + 1}`)}, ${quoteLiteral(bookId)}, ${quoteLiteral(person.kind)}, ${quoteLiteral(revId)}, ${quoteLiteral(person.sessionId || '')}, ${quoteLiteral(person.requestId || '')}, ${quoteLiteral(person.text)});`,
    )
  })
  lines.push(
    `INSERT INTO discussion (id, book_id, entity_id, session_id) VALUES (${quoteLiteral(`${bookId}-ds-1`)}, ${quoteLiteral(bookId)}, ${quoteLiteral(`${bookId}-en-1`)}, ${quoteLiteral(SESSION_ID)});`,
  )
  lines.push('COMMIT;')
  return lines.join('\n')
}

async function main() {
  const robText = await discussRobb()
  const markdown = readFileSync(SYNOPSIS, 'utf8')
  const text = assertSynopsis(markdown)
  const created = await api('/api/books', { method: 'POST', body: JSON.stringify({ name: TITLE }) })
  const bookId = created.body && created.body.id
  if (!bookId || FORBIDDEN.includes(bookId)) throw Object.assign(new Error('新建书 id 不可用'), { failure: '临时端口起不来' })
  const opened = await api(`/api/books/${bookId}/canvas`)
  await api(`/api/books/${bookId}/import-text`, {
    method: 'POST',
    headers: { 'If-Match': opened.etag || '' },
    body: JSON.stringify({ text }),
  })
  const imported = await api(`/api/books/${bookId}/canvas`)
  const httpChapters = imported.body.document.chapters || []
  if (httpChapters.length !== 10 || httpChapters.some((chapter, index) => chapter.title !== TITLES[index])) {
    throw Object.assign(new Error('导入后的章标题与十集不一致'), { failure: '临时端口起不来' })
  }
  const scene = httpChapters[0].scenes && httpChapters[0].scenes[0]
  if (!scene || !String(scene.prose || '').trim()) throw Object.assign(new Error('导入后第一场是空的'), { failure: '临时端口起不来' })
  const revisedProse = String(scene.prose).includes('验收修订：') ? String(scene.prose) : `${String(scene.prose).replace(/\s+$/u, '')}${SUFFIX}`
  await api(`/api/books/${bookId}/scenes/${scene.id}`, {
    method: 'PATCH',
    headers: { 'If-Match': imported.etag || '' },
    body: JSON.stringify({ text: revisedProse, baseRev: Number.isInteger(scene.rev) ? scene.rev : 1 }),
  })

  const store = createBookStore()
  store.setConstraints(bookId, { title: TITLE })
  const loaded = store.importText(bookId, text)
  if (!loaded.ok) throw Object.assign(new Error(loaded.error || '书稿库导入失败'), { failure: '书稿库连不上' })
  const before = store.chapters(bookId)
  if (before.length !== 10 || before.some((chapter, index) => chapter.title !== TITLES[index])) {
    throw Object.assign(new Error('书稿库章标题与十集不一致'), { failure: '书稿库连不上' })
  }
  const first = before[0].scenes[0]
  const engineBody = String(first.body).includes('验收修订：') ? String(first.body) : `${String(first.body).replace(/\s+$/u, '')}${SUFFIX}`
  store.putSceneText(bookId, first.id, engineBody, { kind: '手写', requestId: 'got-s3-rev-1' })
  store.sediment(bookId, { name: '罗柏', text: robText, sessionId: SESSION_ID })
  for (const [name, value] of Object.entries(HANDWRITTEN)) store.upsertEntity(bookId, { name, text: value })
  const chapters = store.chapters(bookId)
  const revisionsByScene = new Map(chapters.flatMap((chapter) => chapter.scenes.map((sceneRow) => [sceneRow.id, store.revisions(bookId, sceneRow.id)])))
  const firstRevisions = revisionsByScene.get(chapters[0].scenes[0].id) || []
  if (firstRevisions.length < 2) throw Object.assign(new Error('修订没有写进场'), { failure: '书稿库连不上' })
  const people = peopleOf(robText)
  const novel = store.exportMarkdown(bookId)
  for (const title of TITLES) {
    if (!novel.includes(title)) throw Object.assign(new Error(`导出缺少 ${title}`), { failure: '书稿库连不上' })
  }
  for (const id of FORBIDDEN) {
    if (novel.includes(id)) throw Object.assign(new Error('导出含有其他季书 id'), { failure: '书稿库连不上' })
  }
  const sql = sqlOf(bookId, chapters, revisionsByScene, people)
  writeFileSync(SQL, sql)
  try {
    psqlFile('snowflake', SQL)
  } catch (error) {
    throw Object.assign(new Error(scrub(error)), { failure: '书稿库连不上' })
  } finally {
    try {
      unlinkSync(SQL)
    } catch {
      // 临时 SQL 删不掉不影响书稿。
    }
  }
  writeFileSync(NOVEL, novel)
  const sceneReport = chapters.map((chapter) => ({
    title: chapter.title,
    scenes: chapter.scenes.map((sceneRow) => ({ nonEmpty: Boolean(String(sceneRow.body || '').trim()), revisions: (revisionsByScene.get(sceneRow.id) || []).length })),
  }))
  const provenanceCount = [...revisionsByScene.values()].reduce((sum, list) => sum + list.length, 0) + people.length
  const status = {
    ok: true,
    bookId,
    port: Number(new URL(BASE).port),
    titles: chapters.map((chapter) => chapter.title),
    scenes: sceneReport,
    provenanceCount,
    novelPath: NOVEL,
    hanzi: hanCount(novel),
    cpa: { ok: true, chars: hanCount(robText) },
    entityNames: people.map((person) => person.name),
    discussion: 'CPA defaultComplete → sediment 罗柏摘要',
  }
  writeFileSync(STATUS, JSON.stringify(status, null, 2))
  console.log(`SEED_OK book=${bookId} hanzi=${status.hanzi} provenance=${provenanceCount}`)
}

try {
  await main()
} catch (error) {
  const failure = error && error.failure ? error.failure : '未分类失败'
  const status = { ok: false, failure, error: scrub(error) }
  writeFileSync(STATUS, JSON.stringify(status, null, 2))
  console.error(`${failure}：${status.error}`)
  process.exit(1)
}
