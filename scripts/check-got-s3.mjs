import { readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { psql, readDsn } from '../server/db/pg-mirror.mjs'

const TITLE = '权力的游戏·第三季验收'
const TITLES = ['北上', '黑城堡', '孪河城', '熊与少女', '火吻', '攀爬', '熊坑', '次子', '卡斯特梅的雨季', '弥莎']
const PEOPLE = ['罗柏', '凯特琳', '詹姆', '布蕾妮']
const NOVEL = process.env.GOT_S3_NOVEL_PATH || join(userInfo().homedir, 'notes/snowflake-e2e-got-s3-novel.md')
const FORBIDDEN = ['3b7c83ea', 'f63f5409']

function scrub(error) {
  let text = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error)
  try {
    const url = readDsn()
    const rest = url.split('://')[1] || ''
    const creds = rest.split('@')[0] || ''
    const pass = decodeURIComponent(creds.split(':').slice(1).join(':'))
    if (pass) text = text.split(pass).join('[redacted]')
  } catch {
    // 连接串读不到时只靠下面的替换。
  }
  return text.replace(/PGPASSWORD=\S+/g, 'PGPASSWORD=[redacted]').replace(/Bearer\s+\S+/g, 'Bearer [redacted]')
}

function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function fieldTexts(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return []
  const texts = []
  for (const value of Object.values(fields)) {
    if (typeof value === 'string' && value.trim()) texts.push(value.trim())
    else if (value && typeof value === 'object' && typeof value.value === 'string' && value.value.trim()) texts.push(value.value.trim())
  }
  return texts
}

function hasSource(row) {
  const kind = typeof row.kind === 'string' ? row.kind.trim() : ''
  const sessionId = typeof row.session_id === 'string' ? row.session_id.trim() : ''
  const requestId = typeof row.request_id === 'string' ? row.request_id.trim() : ''
  return Boolean(kind || sessionId || requestId)
}

function matches(row, text) {
  if (!hasSource(row)) return false
  const blob = `${row.quote || ''}\n${row.body || ''}`
  return blob.includes(text)
}

let raw
try {
  const forbidden = FORBIDDEN.map(q).join(', ')
  const count = Number(psql('snowflake', `SELECT count(*) FROM book WHERE title = ${q(TITLE)} AND id NOT IN (${forbidden}) AND deleted_at IS NULL`))
  if (count !== 1) fail(`CHECK_FAIL 书名「${TITLE}」有 ${count} 本，需要正好一本`)
  const bookId = psql('snowflake', `SELECT id FROM book WHERE title = ${q(TITLE)} AND id NOT IN (${forbidden}) AND deleted_at IS NULL`)
  if (FORBIDDEN.includes(bookId)) fail('CHECK_FAIL 书 id 落在禁止使用的书上')
  raw = psql(
    'snowflake',
    `SELECT json_build_object(
      'chapters', (
        SELECT coalesce(json_agg(json_build_object(
          'title', c.title,
          'ord', c.ord,
          'scenes', (
            SELECT coalesce(json_agg(json_build_object('body', s.body) ORDER BY s.ord), '[]'::json)
            FROM scene s WHERE s.chapter_id = c.id AND s.deleted_at IS NULL
          )
        ) ORDER BY c.ord), '[]'::json)
        FROM chapter c WHERE c.book_id = ${q(bookId)} AND c.deleted_at IS NULL
      ),
      'entities', (
        SELECT coalesce(json_agg(json_build_object('name', e.name, 'fields', e.fields)), '[]'::json)
        FROM entity e WHERE e.book_id = ${q(bookId)} AND e.deleted_at IS NULL
      ),
      'provenance', (
        SELECT coalesce(json_agg(json_build_object('kind', p.kind, 'session_id', p.session_id, 'request_id', p.request_id, 'quote', p.quote)), '[]'::json)
        FROM provenance p WHERE p.book_id = ${q(bookId)}
      ),
      'entityRevisions', (
        SELECT coalesce(json_agg(json_build_object('kind', r.kind, 'session_id', r.session_id, 'body', r.body)), '[]'::json)
        FROM entity_revision r WHERE r.entity_id IN (SELECT id FROM entity WHERE book_id = ${q(bookId)})
      ),
      'sceneRevisions', (
        SELECT coalesce(json_agg(json_build_object('kind', r.kind, 'session_id', r.session_id, 'request_id', r.request_id, 'quote', r.quote, 'body', r.body, 'scene_id', r.scene_id)), '[]'::json)
        FROM scene_revision r WHERE r.scene_id IN (SELECT id FROM scene WHERE book_id = ${q(bookId)})
      )
    )::text`,
  )
  const data = JSON.parse(raw)
  const chapters = data.chapters || []
  if (chapters.length !== 10) fail(`CHECK_FAIL 章数 ${chapters.length}`)
  for (let index = 0; index < TITLES.length; index += 1) {
    if (chapters[index].title !== TITLES[index]) fail(`CHECK_FAIL 第 ${index + 1} 章标题是 ${chapters[index].title}`)
  }
  for (const chapter of chapters) {
    const scenes = chapter.scenes || []
    if (scenes.length < 1) fail(`CHECK_FAIL ${chapter.title} 没有场`)
    for (const scene of scenes) {
      if (!String(scene.body || '').trim()) fail(`CHECK_FAIL ${chapter.title} 有空场`)
    }
  }
  const byScene = new Map()
  for (const revision of data.sceneRevisions || []) {
    byScene.set(revision.scene_id, (byScene.get(revision.scene_id) || 0) + 1)
  }
  if (![...byScene.values()].some((countOf) => countOf >= 2)) fail('CHECK_FAIL 没有任何一场的修订次数增加')
  const names = new Set((data.entities || []).map((entity) => entity.name))
  for (const name of PEOPLE) {
    if (!names.has(name)) fail(`CHECK_FAIL 缺少人物 ${name}`)
  }
  let fieldWrites = 0
  let adopted = 0
  for (const entity of data.entities || []) {
    const texts = fieldTexts(entity.fields)
    if (PEOPLE.includes(entity.name) && texts.length < 1) fail(`CHECK_FAIL ${entity.name} 没有人物字段`)
    for (const text of texts) {
      fieldWrites += 1
      const found = (data.provenance || []).some((row) => matches(row, text))
        || (data.entityRevisions || []).some((row) => matches(row, text))
        || (data.sceneRevisions || []).some((row) => matches(row, text))
      if (!found) fail(`CHECK_FAIL ${entity.name} 的人物字段找不到来源`)
      const adoption = (data.provenance || []).some((row) => matches(row, text) && row.kind === '采纳' && String(row.session_id || '').trim())
        || (data.entityRevisions || []).some((row) => matches(row, text) && row.kind === '采纳' && String(row.session_id || '').trim())
      if (adoption) adopted += 1
    }
  }
  if (adopted < 1) fail('CHECK_FAIL 没有一场讨论采纳写进人物字段')
  const novel = readFileSync(NOVEL, 'utf8')
  for (const title of TITLES) {
    if (!novel.includes(title)) fail(`CHECK_FAIL 导出缺少章名 ${title}`)
  }
  for (const id of FORBIDDEN) {
    if (novel.includes(id)) fail(`CHECK_FAIL 导出含有其他季的书 id ${id}`)
  }
  console.log(`book=${bookId}`)
  console.log(`chapters=10`)
  console.log(`fieldWrites=${fieldWrites}`)
  console.log(`provenance=${(data.provenance || []).length}`)
  console.log('CHECK_OK')
} catch (error) {
  if (error && error.code === 'ERR_ASSERTION') throw error
  const message = scrub(error)
  if (message.includes('CHECK_FAIL')) {
    console.error(message)
    process.exit(1)
  }
  console.error(`CHECK_FAIL 书稿库连不上或校验中断：${message.split('\n')[0]}`)
  process.exit(1)
}
