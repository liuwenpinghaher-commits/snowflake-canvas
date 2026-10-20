import { useEffect, useMemo, useState } from 'react'

interface Assertion {
  id: number
  book_ref: string
  layer: 'canon' | 'pov_belief'
  pov_entity_id: string | null
  subject_ref: string
  phrase: string
  literal_value: string | null
  valid_from_scene_seq: number
  valid_to_scene_seq: number | null
  quote: string | null
  active: boolean
}

interface NarrativePayload {
  book_ref: string
  scene_seq: number | null
  pov: string | null
  available_books: string[]
  available_povs: string[]
  scene_range: { min: number; max: number }
  active_canon: Assertion[]
  active_pov_beliefs: Assertion[]
  all_assertions: Assertion[]
}

interface ConflictItem {
  conflict_id: string
  old_ref: string
  new_ref: string
  reason: string
  status: 'open' | 'resolved' | 'withdrawn'
  resolution: 'supersede' | 'coexist' | 'reject' | null
  scope_key?: string | null
  scope?: { demo_key?: string; rationale?: string; scope_key?: string } | null
}

interface LedgerItem {
  ledger_seq: number
  resolution: string
  rationale: string
  decided_by: string
  decided_at: string
  prev_hash: string | null
  row_hash: string
}

interface ConflictPayload {
  conflicts: ConflictItem[]
  ledger: LedgerItem[]
  ledger_verification: { ok: boolean; status: string; count: number }
}

const BOOK_LABEL: Record<string, string> = {
  'got-s1': '权力的游戏',
  'zztj-zhou': '资治通鉴·周纪',
  'accept-plan1-live': '方案1验收样本',
}

const POV_LABEL: Record<string, string> = {
  'eddard-stark': '奈德·史塔克',
  'jon-snow': '琼恩·雪诺',
  'catelyn-stark': '凯特琳·史塔克',
  'arya-stark': '艾莉亚·史塔克',
  'cersei-lannister': '瑟曦·兰尼斯特',
  'jaime-lannister': '詹姆·兰尼斯特',
  'daenerys-targaryen': '丹妮莉丝·坦格利安',
  '司马光': '司马光',
}

const SUBJECT_LABEL: Record<string, string> = {
  ...POV_LABEL,
  'joffrey-baratheon': '乔佛里',
  'bran-stark': '布兰·史塔克',
  '三家分晋': '三家分晋',
  '周威烈王': '周威烈王',
}

const ANCHORS = [
  { seq: 1, label: 'S1 凛冬将至' },
  { seq: 5, label: 'S5 守夜宣誓' },
  { seq: 12, label: 'S12 君临调查' },
  { seq: 24, label: 'S24 血统真相' },
  { seq: 36, label: 'S36 孪河城' },
  { seq: 45, label: 'S45 贝勒大圣堂' },
  { seq: 50, label: 'S50 龙焰降生' },
]

const RESOLUTION_LABEL: Record<string, string> = {
  supersede: '新替旧',
  coexist: '分域共存',
  reject: '驳回',
}

function api(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${path}`
}

function bookLabel(id: string): string {
  return BOOK_LABEL[id] ? `${BOOK_LABEL[id]}（${id}）` : id
}

function personLabel(id: string | null): string {
  if (!id) return '客观正史'
  return POV_LABEL[id] ? `${POV_LABEL[id]}` : id
}

function subjectLabel(id: string): string {
  return SUBJECT_LABEL[id] ?? id
}

function rangeText(row: Assertion): string {
  const end = row.valid_to_scene_seq == null ? '之后仍有效' : `到第 ${row.valid_to_scene_seq} 场之前`
  return `第 ${row.valid_from_scene_seq} 场起，${end}`
}

function shortHash(value: string | null): string {
  if (!value) return '链首'
  return value.slice(0, 12)
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    return body.error || `请求失败（${response.status}）`
  } catch {
    return `请求失败（${response.status}）`
  }
}

export default function BitemporalPage() {
  const [bookRef, setBookRef] = useState('got-s1')
  const [sceneSeq, setSceneSeq] = useState(1)
  const [pov, setPov] = useState('')
  const [narrative, setNarrative] = useState<NarrativePayload | null>(null)
  const [conflicts, setConflicts] = useState<ConflictPayload | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [rationale, setRationale] = useState('')
  const [scopeKey, setScopeKey] = useState('duty-vs-blood')
  const [decidedBy, setDecidedBy] = useState('画布')
  const [draftLayer, setDraftLayer] = useState<'canon' | 'pov_belief'>('pov_belief')
  const [draftPov, setDraftPov] = useState('eddard-stark')
  const [draftSubject, setDraftSubject] = useState('jon-snow')
  const [draftPhrase, setDraftPhrase] = useState('补充设定')
  const [draftLiteral, setDraftLiteral] = useState('')
  const [draftFrom, setDraftFrom] = useState(1)
  const [draftTo, setDraftTo] = useState('')

  async function loadNarrative(nextBook: string, nextScene: number, nextPov: string) {
    const params = new URLSearchParams({ book_ref: nextBook, scene_seq: String(nextScene) })
    if (nextPov) params.set('pov', nextPov)
    const response = await fetch(api(`/api/bitemporal/narrative?${params.toString()}`), { cache: 'no-store' })
    if (!response.ok) throw new Error(await readError(response))
    setNarrative(await response.json() as NarrativePayload)
  }

  async function loadConflicts() {
    const response = await fetch(api('/api/bitemporal/conflicts'), { cache: 'no-store' })
    if (!response.ok) throw new Error(await readError(response))
    setConflicts(await response.json() as ConflictPayload)
  }

  async function reload(nextBook = bookRef, nextScene = sceneSeq, nextPov = pov) {
    setError('')
    await Promise.all([loadNarrative(nextBook, nextScene, nextPov), loadConflicts()])
  }

  useEffect(() => {
    let cancelled = false
    setError('')
    Promise.all([loadNarrative(bookRef, sceneSeq, pov), loadConflicts()]).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '读不到双时态数据')
    })
    return () => {
      cancelled = true
    }
    // loadNarrative / loadConflicts 每次渲染都是新函数，只跟着作品、场次、视角重读。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookRef, sceneSeq, pov])

  const sceneMax = Math.max(narrative?.scene_range.max ?? 1, sceneSeq, 1)
  const sceneMin = narrative?.scene_range.min ?? 1
  const activeCanon = narrative?.active_canon ?? []
  const activePov = narrative?.active_pov_beliefs ?? []

  const ironyIds = useMemo(() => {
    const ids = new Set<number>()
    for (const row of activePov) {
      const canon = activeCanon.find((item) => item.subject_ref === row.subject_ref && item.literal_value !== row.literal_value)
      if (canon) ids.add(row.id)
    }
    return ids
  }, [activeCanon, activePov])

  const tracks = useMemo(() => {
    const grouped = new Map<string, Assertion[]>()
    for (const row of narrative?.all_assertions ?? []) {
      const key = `${row.layer}|${row.pov_entity_id ?? ''}|${row.subject_ref}|${row.phrase}`
      const list = grouped.get(key) ?? []
      list.push(row)
      grouped.set(key, list)
    }
    return [...grouped.entries()].map(([key, segments]) => ({ key, segments }))
  }, [narrative])

  async function addAssertion() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(api('/api/bitemporal/narrative'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book_ref: bookRef,
          layer: draftLayer,
          pov_entity_id: draftLayer === 'canon' ? '' : draftPov,
          subject_ref: draftSubject.trim(),
          phrase: draftPhrase.trim(),
          literal_value: draftLiteral.trim(),
          valid_from_scene_seq: draftFrom,
          valid_to_scene_seq: draftTo.trim() === '' ? null : Number(draftTo),
          chapter_ord: 0,
          scene_ord: draftFrom,
          quote: '',
        }),
      })
      if (!response.ok) throw new Error(await readError(response))
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '新增断言失败')
    } finally {
      setBusy(false)
    }
  }

  async function resolve(conflictId: string, resolution: 'supersede' | 'coexist' | 'reject') {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(api('/api/bitemporal/resolve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conflict_id: conflictId,
          resolution,
          scope_key: resolution === 'coexist' ? scopeKey : '',
          rationale,
          decided_by: decidedBy,
        }),
      })
      if (!response.ok) throw new Error(await readError(response))
      const payload = await response.json() as ConflictPayload
      setConflicts(payload)
      await loadNarrative(bookRef, sceneSeq, pov)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '裁决失败')
    } finally {
      setBusy(false)
    }
  }

  async function restoreDemo() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(api('/api/bitemporal/seed'), { method: 'POST' })
      if (!response.ok) throw new Error(await readError(response))
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复演示数据失败')
    } finally {
      setBusy(false)
    }
  }

  const ledgerOk = conflicts?.ledger_verification.status === 'LEDGER_OK'
  const openCount = conflicts?.conflicts.filter((item) => item.status === 'open').length ?? 0

  return (
    <section className="bitemporal-page" data-testid="bitemporal-page">
      <header className="bt-head">
        <div>
          <h1>时序 / 设定演进</h1>
          <p>拖动场次，看同一条设定在哪一段生效；左边是客观正史，右边是这个角色当时以为的事。</p>
        </div>
        <button type="button" onClick={() => void restoreDemo()} disabled={busy}>恢复演示数据</button>
      </header>
      {error ? <p className="bt-error" role="alert">{error}</p> : null}
      <div className="bt-toolbar">
        <label>
          作品
          <select
            value={bookRef}
            onChange={(event) => {
              setBookRef(event.target.value)
              setSceneSeq(1)
            }}
          >
            {(narrative?.available_books.length ? narrative.available_books : [bookRef]).map((id) => (
              <option key={id} value={id}>{bookLabel(id)}</option>
            ))}
          </select>
        </label>
        <label>
          视角
          <select value={pov} onChange={(event) => setPov(event.target.value)}>
            <option value="">全部角色</option>
            {(narrative?.available_povs ?? []).map((id) => (
              <option key={id} value={id}>{personLabel(id)}</option>
            ))}
          </select>
        </label>
        <label className="bt-slider">
          第 {sceneSeq} 场
          <input
            data-testid="scene-slider"
            type="range"
            min={sceneMin}
            max={sceneMax}
            step={1}
            value={Math.min(Math.max(sceneSeq, sceneMin), sceneMax)}
            onChange={(event) => setSceneSeq(Number(event.target.value))}
          />
        </label>
      </div>
      {bookRef === 'got-s1' ? (
        <div className="bt-anchors">
          {ANCHORS.map((anchor) => (
            <button
              key={anchor.seq}
              type="button"
              className={sceneSeq === anchor.seq ? 'on' : ''}
              onClick={() => setSceneSeq(anchor.seq)}
            >
              {anchor.label}
            </button>
          ))}
        </div>
      ) : null}
      <p className="bt-summary">
        当前第 {sceneSeq} 场，客观正史 {activeCanon.length} 条，角色认知 {activePov.length} 条，其中 {ironyIds.size} 条和正史不一致。
      </p>
      <div className="bt-split">
        <div>
          <h2>客观正史 (Canon Truth)</h2>
          {activeCanon.length === 0 ? <p className="bt-empty">这一场没有生效的客观正史。</p> : null}
          {activeCanon.map((row) => (
            <article key={row.id} className="bt-card is-active">
              <strong>{subjectLabel(row.subject_ref)} · {row.phrase}</strong>
              <p>{row.literal_value}</p>
              <small>{rangeText(row)}{row.quote ? `。${row.quote}` : ''}</small>
            </article>
          ))}
        </div>
        <div>
          <h2>角色主观认知 (POV Belief)</h2>
          {activePov.length === 0 ? <p className="bt-empty">这一场没有生效的角色认知。</p> : null}
          {activePov.map((row) => (
            <article key={row.id} className={ironyIds.has(row.id) ? 'bt-card is-active is-irony' : 'bt-card is-active'}>
              <strong>{personLabel(row.pov_entity_id)}以为：{subjectLabel(row.subject_ref)} · {row.phrase}</strong>
              <p>{row.literal_value}</p>
              {ironyIds.has(row.id) ? <em>戏剧反差</em> : null}
              <small>{rangeText(row)}{row.quote ? `。${row.quote}` : ''}</small>
            </article>
          ))}
        </div>
      </div>
      <h2>场次演进</h2>
      <div className="bt-tracks">
        {tracks.map((track) => {
          const sample = track.segments[0]
          const span = Math.max(1, sceneMax - sceneMin + 1)
          return (
            <div key={track.key} className="bt-track">
              <div className="bt-track-label">
                {sample.layer === 'canon' ? '正史' : personLabel(sample.pov_entity_id)}
                {' · '}
                {subjectLabel(sample.subject_ref)}
                {' · '}
                {sample.phrase}
              </div>
              <div className="bt-bar">
                <span
                  className="bt-now"
                  style={{ left: `${((sceneSeq - sceneMin) / span) * 100}%` }}
                />
                {track.segments.map((segment) => {
                  const end = segment.valid_to_scene_seq ?? sceneMax + 1
                  const left = ((segment.valid_from_scene_seq - sceneMin) / span) * 100
                  const width = ((Math.min(end, sceneMax + 1) - segment.valid_from_scene_seq) / span) * 100
                  return (
                    <i
                      key={segment.id}
                      className={segment.active ? 'is-on' : ''}
                      style={{ left: `${left}%`, width: `${Math.max(width, 1.2)}%` }}
                      title={`${rangeText(segment)} ${segment.literal_value ?? ''}`}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <form
        className="bt-form"
        onSubmit={(event) => {
          event.preventDefault()
          void addAssertion()
        }}
      >
        <h2>新增一条场次断言</h2>
        <label>
          层
          <select value={draftLayer} onChange={(event) => setDraftLayer(event.target.value as 'canon' | 'pov_belief')}>
            <option value="canon">客观正史</option>
            <option value="pov_belief">角色主观认知</option>
          </select>
        </label>
        {draftLayer === 'pov_belief' ? (
          <label>
            视角
            <input value={draftPov} onChange={(event) => setDraftPov(event.target.value)} />
          </label>
        ) : null}
        <label>
          主体
          <input value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} />
        </label>
        <label>
          说法
          <input value={draftPhrase} onChange={(event) => setDraftPhrase(event.target.value)} />
        </label>
        <label>
          内容
          <input value={draftLiteral} onChange={(event) => setDraftLiteral(event.target.value)} />
        </label>
        <label>
          从第几场
          <input type="number" value={draftFrom} onChange={(event) => setDraftFrom(Number(event.target.value))} />
        </label>
        <label>
          到第几场之前（可空）
          <input value={draftTo} onChange={(event) => setDraftTo(event.target.value)} />
        </label>
        <button type="submit" disabled={busy}>写入这条断言</button>
      </form>
      <h2>冲突裁决</h2>
      <p>待裁决 {openCount} 条。分域共存会带上范围键；驳回和新替旧会带上理由。</p>
      <div className="bt-resolve-fields">
        <label>
          理由
          <input value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="为什么这样裁决" />
        </label>
        <label>
          范围键
          <input value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} />
        </label>
        <label>
          裁决人
          <input value={decidedBy} onChange={(event) => setDecidedBy(event.target.value)} />
        </label>
      </div>
      {(conflicts?.conflicts ?? []).map((item) => (
        <article key={item.conflict_id} className={item.status === 'open' ? 'bt-card is-open' : 'bt-card'}>
          <strong>{item.status === 'open' ? 'OPEN 待裁决' : 'RESOLVED 已裁决'}</strong>
          <p>旧：{item.old_ref}</p>
          <p>新：{item.new_ref}</p>
          {item.resolution ? <small>裁决：{RESOLUTION_LABEL[item.resolution] ?? item.resolution}</small> : null}
          {item.status === 'open' ? (
            <div className="bt-actions">
              <button type="button" disabled={busy} onClick={() => void resolve(item.conflict_id, 'supersede')}>新替旧 (Supersede)</button>
              <button type="button" disabled={busy} onClick={() => void resolve(item.conflict_id, 'coexist')}>分域共存 (Coexist)</button>
              <button type="button" disabled={busy} onClick={() => void resolve(item.conflict_id, 'reject')}>驳回 (Reject)</button>
            </div>
          ) : null}
        </article>
      ))}
      <h2>防篡改决策台账 (SHA-256 Decision Ledger)</h2>
      <p
        className={ledgerOk ? 'bt-badge is-ok' : 'bt-badge'}
        data-testid="ledger-badge"
      >
        {conflicts?.ledger_verification.status ?? '还没验'} · {conflicts?.ledger_verification.count ?? 0} 笔
      </p>
      <div className="bt-ledger">
        {(conflicts?.ledger ?? []).map((row) => (
          <div key={row.ledger_seq} className="bt-ledger-row">
            <b>#{row.ledger_seq}</b>
            <span>{RESOLUTION_LABEL[row.resolution] ?? row.resolution}</span>
            <code title={`${row.prev_hash ?? ''} -> ${row.row_hash}`}>
              {shortHash(row.prev_hash)} → {shortHash(row.row_hash)}
            </code>
            <small>{row.decided_by} · {row.rationale}</small>
          </div>
        ))}
      </div>
    </section>
  )
}
