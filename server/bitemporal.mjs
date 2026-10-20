import { spawn } from 'node:child_process'
import { userInfo } from 'node:os'
import { join } from 'node:path'

const USER_HOME = userInfo().homedir
const CTL = process.env.SNOWFLAKE_BITEMPORAL_CTL || join(USER_HOME, '.hermes/scripts/gbrain-bitemporal-ctl.sh')
const SEED = process.env.SNOWFLAKE_BITEMPORAL_SEED || join(USER_HOME, '.hermes/scripts/seed-bitemporal-demo.sh')

function hexJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('hex')
}

function psql(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'exec', '-i', 'gbrain-postgres',
      'psql', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1',
      '-U', 'postgres', '-d', 'postgres',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        const error = new Error((err || out || `psql exited ${code}`).trim())
        error.stderr = err
        error.stdout = out
        reject(error)
        return
      }
      resolve(out.trim())
    })
    child.stdin.end(sql)
  })
}

function lastJson(text) {
  const lines = String(text).split(/\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) throw new Error('数据库没有返回 JSON')
  return JSON.parse(lines[lines.length - 1])
}

function runCmd(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${cmd} 超时`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { out += chunk })
    child.stderr.on('data', (chunk) => { err += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, out, err })
    })
  })
}

function narrativeSql(hex) {
  return `
WITH input AS (
  SELECT convert_from(decode('${hex}', 'hex'), 'UTF8')::jsonb AS j
),
params AS (
  SELECT
    coalesce(nullif(j->>'book_ref', ''), 'got-s1') AS book_ref,
    CASE
      WHEN j->>'scene_seq' IS NULL OR j->>'scene_seq' = '' OR j->>'scene_seq' = 'null' THEN NULL
      ELSE (j->>'scene_seq')::integer
    END AS scene_seq,
    nullif(j->>'pov', '') AS pov
  FROM input
),
books AS (
  SELECT coalesce(json_agg(book_ref ORDER BY book_ref), '[]'::json) AS items
  FROM (SELECT DISTINCT book_ref FROM plan1.narrative_assertions) s
),
rows AS (
  SELECT
    n.id,
    n.book_ref,
    n.layer,
    n.pov_entity_ref,
    n.subject_ref,
    n.phrase,
    n.object_ref,
    n.literal_value,
    n.valid_from_scene_seq,
    n.valid_to_scene_seq,
    n.chapter_ord,
    n.scene_ord,
    n.quote,
    (
      p.scene_seq IS NOT NULL
      AND n.valid_from_scene_seq <= p.scene_seq
      AND (n.valid_to_scene_seq IS NULL OR n.valid_to_scene_seq > p.scene_seq)
    ) AS active
  FROM plan1.narrative_assertions n
  CROSS JOIN params p
  WHERE n.book_ref = p.book_ref
)
SELECT json_build_object(
  'book_ref', (SELECT book_ref FROM params),
  'scene_seq', (SELECT scene_seq FROM params),
  'pov', (SELECT pov FROM params),
  'available_books', (SELECT items FROM books),
  'available_povs', coalesce((
    SELECT json_agg(pov ORDER BY pov)
    FROM (SELECT DISTINCT pov_entity_ref AS pov FROM rows WHERE pov_entity_ref IS NOT NULL) s
  ), '[]'::json),
  'scene_range', (
    SELECT json_build_object(
      'min', coalesce(min(valid_from_scene_seq), 1),
      'max', greatest(coalesce(max(valid_from_scene_seq), 1), coalesce(max(valid_to_scene_seq), 0))
    )
    FROM rows
  ),
  'active_canon', coalesce((
    SELECT json_agg(json_build_object(
      'id', id,
      'book_ref', book_ref,
      'layer', layer,
      'pov_entity_id', pov_entity_ref,
      'subject_ref', subject_ref,
      'phrase', phrase,
      'object_ref', object_ref,
      'literal_value', literal_value,
      'valid_from_scene_seq', valid_from_scene_seq,
      'valid_to_scene_seq', valid_to_scene_seq,
      'chapter_ord', chapter_ord,
      'scene_ord', scene_ord,
      'quote', quote,
      'active', active
    ) ORDER BY valid_from_scene_seq, id)
    FROM rows
    WHERE active AND layer = 'canon'
  ), '[]'::json),
  'active_pov_beliefs', coalesce((
    SELECT json_agg(json_build_object(
      'id', id,
      'book_ref', book_ref,
      'layer', layer,
      'pov_entity_id', pov_entity_ref,
      'subject_ref', subject_ref,
      'phrase', phrase,
      'object_ref', object_ref,
      'literal_value', literal_value,
      'valid_from_scene_seq', valid_from_scene_seq,
      'valid_to_scene_seq', valid_to_scene_seq,
      'chapter_ord', chapter_ord,
      'scene_ord', scene_ord,
      'quote', quote,
      'active', active
    ) ORDER BY pov_entity_ref, valid_from_scene_seq, id)
    FROM rows
    WHERE active AND layer = 'pov_belief'
      AND ((SELECT pov FROM params) IS NULL OR pov_entity_ref = (SELECT pov FROM params))
  ), '[]'::json),
  'all_assertions', coalesce((
    SELECT json_agg(json_build_object(
      'id', id,
      'book_ref', book_ref,
      'layer', layer,
      'pov_entity_id', pov_entity_ref,
      'subject_ref', subject_ref,
      'phrase', phrase,
      'object_ref', object_ref,
      'literal_value', literal_value,
      'valid_from_scene_seq', valid_from_scene_seq,
      'valid_to_scene_seq', valid_to_scene_seq,
      'chapter_ord', chapter_ord,
      'scene_ord', scene_ord,
      'quote', quote,
      'active', active
    ) ORDER BY layer, subject_ref, phrase, valid_from_scene_seq, id)
    FROM rows
  ), '[]'::json)
)::text;
`
}

function conflictsSql() {
  return `
WITH ordered AS (
  SELECT id, source_id, action, coalesce(target_id, '') AS target_id, detail, prev_hash, row_hash, created_at,
         lag(row_hash) OVER (ORDER BY id) AS expect_prev
  FROM plan1.decision_ledger
),
chk AS (
  SELECT count(*) AS n,
         coalesce(bool_and(
           prev_hash IS NOT DISTINCT FROM expect_prev
           AND row_hash = encode(sha256(convert_to(
             coalesce(prev_hash, '') || action || target_id || detail::text,
             'UTF8')), 'hex')
         ), false) AS ok
  FROM ordered
)
SELECT json_build_object(
  'conflicts', coalesce((
    SELECT json_agg(json_build_object(
      'conflict_id', c.id::text,
      'old_ref', c.old_ref,
      'new_ref', c.new_ref,
      'reason', c.reason,
      'status', c.status,
      'resolution', c.resolution,
      'scope', c.scope,
      'scope_key', c.scope->>'scope_key',
      'created_at', c.created_at,
      'resolved_at', c.resolved_at
    ) ORDER BY CASE WHEN c.status = 'open' THEN 0 ELSE 1 END, c.id)
    FROM plan1.assertion_conflicts c
  ), '[]'::json),
  'ledger', coalesce((
    SELECT json_agg(json_build_object(
      'ledger_seq', id,
      'resolution', action,
      'action', action,
      'rationale', coalesce(
        detail->>'rationale',
        detail->>'reason',
        detail->>'claim',
        detail#>>'{value,rationale}',
        detail#>>'{value,claim}',
        left(detail::text, 180)
      ),
      'decided_by', coalesce(detail->>'decided_by', detail#>>'{value,decided_by}', source_id),
      'decided_at', created_at,
      'prev_hash', prev_hash,
      'row_hash', row_hash,
      'target_id', target_id,
      'detail', detail
    ) ORDER BY id)
    FROM plan1.decision_ledger
  ), '[]'::json),
  'ledger_verification', (
    SELECT json_build_object(
      'ok', ok AND n > 0,
      'status', CASE WHEN ok AND n > 0 THEN 'LEDGER_OK' ELSE 'LEDGER_BROKEN' END,
      'count', n
    )
    FROM chk
  )
)::text;
`
}

function dbFailure(error) {
  const text = `${error.stderr || ''}\n${error.stdout || ''}\n${error.message || ''}`
  if (text.includes('narrative_scene_no_overlap') || text.includes('exclusion constraint') || text.includes('23P01')) {
    return {
      status: 409,
      body: {
        ok: false,
        error: '排他约束冲突：同一作品、同一层、同一视角、同一主体、同一句话的场次区间不能重叠',
        constraint: 'narrative_scene_no_overlap',
      },
    }
  }
  if (text.includes('narrative_assertions_check')) {
    return {
      status: 400,
      body: { ok: false, error: '区间或视角不合法：客观正史不能带角色，主观认知必须带角色，结束场次必须晚于开始场次' },
    }
  }
  return { status: 500, body: { ok: false, error: text.trim().slice(0, 800) || '数据库失败' } }
}

function asInt(value, name) {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value)
  throw Object.assign(new Error(`${name} 必须是整数`), { statusCode: 400 })
}

function optionalInt(value, name) {
  if (value == null || value === '') return null
  return asInt(value, name)
}

function cleanText(value, name, required) {
  const text = value == null ? '' : String(value).trim()
  if (required && !text) throw Object.assign(new Error(`${name} 不能为空`), { statusCode: 400 })
  if (text.length > 500) throw Object.assign(new Error(`${name} 太长`), { statusCode: 400 })
  return text
}

export function registerBitemporalRoutes(app, prefix) {
  app.get(`${prefix}/api/bitemporal/narrative`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const query = request.query || {}
    let sceneSeq = null
    if (query.scene_seq != null && query.scene_seq !== '') {
      if (!/^-?\d+$/.test(String(query.scene_seq))) {
        reply.code(400)
        return reply.send({ ok: false, error: 'scene_seq 必须是整数' })
      }
      sceneSeq = Number(query.scene_seq)
    }
    const bookRef = query.book_ref == null ? '' : String(query.book_ref).trim()
    const pov = query.pov == null ? '' : String(query.pov).trim()
    if (bookRef.length > 200 || pov.length > 200) {
      reply.code(400)
      return reply.send({ ok: false, error: 'book_ref 或 pov 太长' })
    }
    try {
      const text = await psql(narrativeSql(hexJson({ book_ref: bookRef, scene_seq: sceneSeq, pov })))
      return reply.send(lastJson(text))
    } catch (error) {
      const mapped = dbFailure(error)
      reply.code(mapped.status)
      return reply.send(mapped.body)
    }
  })

  app.get(`${prefix}/api/bitemporal/conflicts`, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      const text = await psql(conflictsSql())
      return reply.send(lastJson(text))
    } catch (error) {
      const mapped = dbFailure(error)
      reply.code(mapped.status)
      return reply.send(mapped.body)
    }
  })

  app.post(`${prefix}/api/bitemporal/narrative`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    try {
      const bookRef = cleanText(body.book_ref, 'book_ref', true)
      const layer = cleanText(body.layer, 'layer', true)
      const pov = cleanText(body.pov_entity_id ?? body.pov_entity_ref ?? '', 'pov_entity_id', false)
      const subject = cleanText(body.subject_ref, 'subject_ref', true)
      const phrase = cleanText(body.phrase, 'phrase', true)
      const literal = cleanText(body.literal_value ?? '', 'literal_value', false)
      const objectRef = cleanText(body.object_ref ?? '', 'object_ref', false)
      const quote = cleanText(body.quote ?? '', 'quote', false)
      const fromSeq = asInt(body.valid_from_scene_seq, 'valid_from_scene_seq')
      const toSeq = optionalInt(body.valid_to_scene_seq, 'valid_to_scene_seq')
      const chapterOrd = body.chapter_ord == null || body.chapter_ord === '' ? 0 : asInt(body.chapter_ord, 'chapter_ord')
      const sceneOrd = body.scene_ord == null || body.scene_ord === '' ? fromSeq : asInt(body.scene_ord, 'scene_ord')
      if (layer !== 'canon' && layer !== 'pov_belief') {
        reply.code(400)
        return reply.send({ ok: false, error: 'layer 只能是 canon 或 pov_belief' })
      }
      if (layer === 'canon' && pov) {
        reply.code(400)
        return reply.send({ ok: false, error: '客观正史不能填写角色视角' })
      }
      if (layer === 'pov_belief' && !pov) {
        reply.code(400)
        return reply.send({ ok: false, error: '角色主观认知必须填写视角' })
      }
      if (toSeq != null && toSeq <= fromSeq) {
        reply.code(400)
        return reply.send({ ok: false, error: '结束场次必须晚于开始场次' })
      }
      const hex = hexJson({
        book_ref: bookRef,
        layer,
        pov_entity_id: pov,
        subject_ref: subject,
        phrase,
        literal_value: literal,
        object_ref: objectRef,
        quote,
        valid_from_scene_seq: fromSeq,
        valid_to_scene_seq: toSeq,
        chapter_ord: chapterOrd,
        scene_ord: sceneOrd,
      })
      const text = await psql(`
WITH input AS (
  SELECT convert_from(decode('${hex}', 'hex'), 'UTF8')::jsonb AS j
),
norm AS (
  SELECT
    j->>'book_ref' AS book_ref,
    j->>'layer' AS layer,
    nullif(j->>'pov_entity_id', '') AS pov_entity_ref,
    j->>'subject_ref' AS subject_ref,
    j->>'phrase' AS phrase,
    nullif(j->>'object_ref', '') AS object_ref,
    nullif(j->>'literal_value', '') AS literal_value,
    (j->>'valid_from_scene_seq')::integer AS valid_from_scene_seq,
    CASE
      WHEN j->>'valid_to_scene_seq' IS NULL OR j->>'valid_to_scene_seq' = '' OR j->>'valid_to_scene_seq' = 'null' THEN NULL
      ELSE (j->>'valid_to_scene_seq')::integer
    END AS valid_to_scene_seq,
    COALESCE((j->>'chapter_ord')::integer, 0) AS chapter_ord,
    COALESCE((j->>'scene_ord')::integer, (j->>'valid_from_scene_seq')::integer) AS scene_ord,
    nullif(j->>'quote', '') AS quote
  FROM input
),
existing AS (
  SELECT n.id
  FROM plan1.narrative_assertions n
  JOIN norm x
    ON n.book_ref = x.book_ref
   AND n.layer = x.layer
   AND n.pov_entity_ref IS NOT DISTINCT FROM x.pov_entity_ref
   AND n.subject_ref = x.subject_ref
   AND n.phrase = x.phrase
   AND n.literal_value IS NOT DISTINCT FROM x.literal_value
   AND n.valid_from_scene_seq = x.valid_from_scene_seq
),
overlap AS (
  SELECT n.id
  FROM plan1.narrative_assertions n
  JOIN norm x
    ON n.book_ref = x.book_ref
   AND n.layer = x.layer
   AND coalesce(n.pov_entity_ref, '') = coalesce(x.pov_entity_ref, '')
   AND n.subject_ref = x.subject_ref
   AND n.phrase = x.phrase
   AND int4range(n.valid_from_scene_seq, coalesce(n.valid_to_scene_seq, 2147483647), '[)')
       && int4range(x.valid_from_scene_seq, coalesce(x.valid_to_scene_seq, 2147483647), '[)')
  WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE e.id = n.id)
),
ins AS (
  INSERT INTO plan1.narrative_assertions (
    book_ref, layer, pov_entity_ref, subject_ref, phrase, object_ref, literal_value,
    valid_from_scene_seq, valid_to_scene_seq, chapter_ord, scene_ord, quote
  )
  SELECT
    book_ref, layer, pov_entity_ref, subject_ref, phrase, object_ref, literal_value,
    valid_from_scene_seq, valid_to_scene_seq, chapter_ord, scene_ord, quote
  FROM norm
  WHERE NOT EXISTS (SELECT 1 FROM existing)
    AND NOT EXISTS (SELECT 1 FROM overlap)
  RETURNING id
)
SELECT json_build_object(
  'status', CASE
    WHEN EXISTS (SELECT 1 FROM overlap) THEN 'exclusion_violation'
    WHEN EXISTS (SELECT 1 FROM ins) THEN 'inserted'
    ELSE 'idempotent'
  END,
  'id', COALESCE((SELECT id FROM ins), (SELECT min(id) FROM existing)),
  'conflict_ids', COALESCE((SELECT json_agg(id ORDER BY id) FROM overlap), '[]'::json)
)::text;
`)
      const parsed = lastJson(text)
      if (parsed.status === 'exclusion_violation') {
        reply.code(409)
        return reply.send({
          ok: false,
          error: '排他约束冲突：同一作品、同一层、同一视角、同一主体、同一句话的场次区间不能重叠',
          constraint: 'narrative_scene_no_overlap',
          conflict_ids: parsed.conflict_ids,
        })
      }
      return reply.send({ ok: true, status: parsed.status, id: parsed.id })
    } catch (error) {
      if (error.statusCode === 400) {
        reply.code(400)
        return reply.send({ ok: false, error: error.message })
      }
      const mapped = dbFailure(error)
      reply.code(mapped.status)
      return reply.send(mapped.body)
    }
  })

  app.post(`${prefix}/api/bitemporal/resolve`, async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const resolution = String(body.resolution || '').trim()
    if (!['supersede', 'coexist', 'reject'].includes(resolution)) {
      reply.code(400)
      return reply.send({ ok: false, error: 'resolution 只能是 supersede、coexist 或 reject' })
    }
    if (!/^\d+$/.test(String(body.conflict_id ?? ''))) {
      reply.code(400)
      return reply.send({ ok: false, error: 'conflict_id 必须是数字' })
    }
    const conflictId = String(body.conflict_id)
    const scopeKey = String(body.scope_key ?? '').trim().slice(0, 200)
    const decidedBy = String(body.decided_by ?? '').trim().slice(0, 200) || '画布'
    let rationale = String(body.rationale ?? '').trim().slice(0, 500)
    if (resolution === 'reject' && !rationale) rationale = '界面驳回，不采纳这条新说法'
    if (!rationale) rationale = '界面裁决'
    try {
      const foundText = await psql(`
SELECT coalesce((
  SELECT json_build_object(
    'conflict_id', id::text,
    'status', status,
    'old_ref', old_ref,
    'new_ref', new_ref
  )::text
  FROM plan1.assertion_conflicts
  WHERE id = ${conflictId}
), '')
`)
      const foundLine = foundText.split(/\n/).map((line) => line.trim()).filter(Boolean).pop() || ''
      if (!foundLine) {
        reply.code(404)
        return reply.send({ ok: false, error: '没有这条冲突' })
      }
      const found = JSON.parse(foundLine)
      if (found.status !== 'open') {
        reply.code(409)
        return reply.send({ ok: false, error: '这条冲突已经裁决过' })
      }
      const stamp = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
      const key = `ui-${conflictId}-${resolution}-${stamp}`
      const lines = []
      let closesBeliefId = null
      if (resolution === 'supersede') {
        const created = await runCmd(CTL, [
          'coexist',
          '--new-json',
          JSON.stringify({
            idempotency_key: `${key}-old`,
            claim: found.old_ref,
            conflict_id: conflictId,
            decided_by: decidedBy,
            rationale,
          }),
        ], 30000)
        if (created.code !== 0) {
          reply.code(created.code === 2 ? 400 : 500)
          return reply.send({ ok: false, error: (created.err || created.out || '旧说法没写进信念表').trim().slice(0, 800) })
        }
        const oldLine = created.out.split(/\n/).filter((line) => /^(ok|idempotent)\|/.test(line)).pop()
        if (!oldLine) {
          reply.code(500)
          return reply.send({ ok: false, error: '旧说法没有返回信念编号' })
        }
        closesBeliefId = Number(oldLine.split('|')[1])
        const closed = await runCmd(CTL, [
          'supersede',
          '--old-id', String(closesBeliefId),
          '--valid-until', new Date().toISOString(),
          '--new-json',
          JSON.stringify({
            idempotency_key: key,
            claim: found.new_ref,
            conflict_id: conflictId,
            decided_by: decidedBy,
            rationale,
            scope_key: scopeKey,
          }),
        ], 30000)
        if (closed.code !== 0) {
          reply.code(closed.code === 2 ? 400 : 500)
          return reply.send({ ok: false, error: (closed.err || closed.out || '新替旧失败').trim().slice(0, 800) })
        }
        lines.push(oldLine, ...(closed.out.split(/\n/).filter((line) => /^(ok|idempotent)\|/.test(line))))
      } else if (resolution === 'coexist') {
        const created = await runCmd(CTL, [
          'coexist',
          '--new-json',
          JSON.stringify({
            idempotency_key: key,
            claim: `${found.old_ref} 与 ${found.new_ref} 分域共存`,
            conflict_id: conflictId,
            decided_by: decidedBy,
            rationale,
            scope_key: scopeKey,
          }),
        ], 30000)
        if (created.code !== 0) {
          reply.code(created.code === 2 ? 400 : 500)
          return reply.send({ ok: false, error: (created.err || created.out || '分域共存失败').trim().slice(0, 800) })
        }
        lines.push(...created.out.split(/\n/).filter((line) => /^(ok|idempotent)\|/.test(line)))
      } else {
        const created = await runCmd(CTL, [
          'reject',
          '--reason', rationale,
          '--new-json',
          JSON.stringify({
            idempotency_key: key,
            claim: found.new_ref,
            conflict_id: conflictId,
            decided_by: decidedBy,
            rationale,
          }),
        ], 30000)
        if (created.code !== 0) {
          reply.code(created.code === 2 ? 400 : 500)
          return reply.send({ ok: false, error: (created.err || created.out || '驳回失败').trim().slice(0, 800) })
        }
        lines.push(...created.out.split(/\n/).filter((line) => /^(ok|idempotent)\|/.test(line)))
      }
      const patch = hexJson({
        conflict_id: conflictId,
        resolution,
        scope_key: scopeKey,
        rationale,
        decided_by: decidedBy,
        closes_belief_id: closesBeliefId,
      })
      await psql(`
UPDATE plan1.assertion_conflicts AS c
SET status = 'resolved',
    resolution = payload.resolution,
    resolved_at = now(),
    scope = c.scope || jsonb_strip_nulls(jsonb_build_object(
      'scope_key', nullif(payload.scope_key, ''),
      'rationale', payload.rationale,
      'decided_by', payload.decided_by,
      'closes_belief_id', payload.closes_belief_id
    ))
FROM (
  SELECT
    (convert_from(decode('${patch}', 'hex'), 'UTF8')::jsonb->>'conflict_id')::bigint AS conflict_id,
    convert_from(decode('${patch}', 'hex'), 'UTF8')::jsonb->>'resolution' AS resolution,
    convert_from(decode('${patch}', 'hex'), 'UTF8')::jsonb->>'scope_key' AS scope_key,
    convert_from(decode('${patch}', 'hex'), 'UTF8')::jsonb->>'rationale' AS rationale,
    convert_from(decode('${patch}', 'hex'), 'UTF8')::jsonb->>'decided_by' AS decided_by,
    convert_from(decode('${patch}', 'hex'), 'UTF8')::jsonb->>'closes_belief_id' AS closes_belief_id
) AS payload
WHERE c.id = payload.conflict_id
  AND c.status = 'open';
`)
      const latest = lastJson(await psql(conflictsSql()))
      return reply.send({ ok: true, conflict_id: conflictId, resolution, ctl: lines, ...latest })
    } catch (error) {
      const mapped = dbFailure(error)
      reply.code(mapped.status)
      return reply.send(mapped.body)
    }
  })

  app.post(`${prefix}/api/bitemporal/seed`, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store')
    try {
      const result = await runCmd('bash', [SEED], 120000)
      if (result.code !== 0) {
        reply.code(500)
        return reply.send({ ok: false, error: (result.err || result.out || '灌库失败').trim().slice(0, 1200) })
      }
      const summary = result.out.split(/\n/).filter((line) => line.startsWith('SEED_OK')).pop() || result.out.trim()
      const latest = lastJson(await psql(conflictsSql()))
      return reply.send({ ok: true, summary, ledger_verification: latest.ledger_verification })
    } catch (error) {
      const mapped = dbFailure(error)
      reply.code(mapped.status)
      return reply.send(mapped.body)
    }
  })
}
