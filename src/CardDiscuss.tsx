import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MarkdownText, stripMarkdown } from './markdown-lite.tsx'
import { bookScopedPath } from './books.ts'
import { ARCHIVE_GROUPS, ARC_KEYS, PERSON_ZONES, RENWUGUSHI_KEYS, cardFace, type CanvasEdge, type Card, type Entity, type SedimentAction, type SedimentEvent } from './document.ts'
import { MANY_PERSONS_HINT, defaultSedimentTarget, fieldLabel } from './person-form.ts'

function api(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${bookScopedPath(path)}`
}

const BUSY = '讨论的人有点多，正在排队，稍后自动重试。'
const STOP_FAILED = '屏幕上的回复停了，但网关任务可能还在跑。'
const PAGE_SIZE = 40

export type DiscussSession = {
  sessionId: string
  title: string
  createdAt: string
  cardId: string
  firstAsk?: string
}

export type ChatMessage = {
  key: string
  role: 'user' | 'assistant' | 'error'
  content: string
  at?: string
  id?: string
  serverKey?: string
  adopted?: boolean
  brainSlug?: string
  retryText?: string
}

type ServerMessage = { role?: string; content?: string; at?: string; id?: string; key?: string; adopted?: boolean }

let localSerial = 0
function localKey(): string {
  localSerial += 1
  return `local-${localSerial}`
}

function fromServer(list: ServerMessage[]): ChatMessage[] {
  return list
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map((item) => ({
      key: item.key ? `srv-${item.key}` : localKey(),
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: item.content ?? '',
      at: typeof item.at === 'string' ? item.at : undefined,
      id: typeof item.id === 'string' ? item.id : undefined,
      serverKey: item.key,
      adopted: item.adopted === true,
    }))
}

// 往前翻时网关的 offset 会因为新消息往后挪，可能和已显示的重叠；按服务器给的消息键去重，不覆盖已显示的消息。
export function prependOlder(current: ChatMessage[], older: ChatMessage[]): ChatMessage[] {
  const known = new Set(current.map((item) => item.serverKey).filter(Boolean))
  return [...older.filter((item) => !item.serverKey || !known.has(item.serverKey)), ...current]
}

type ClosestTarget = { closest: (selector: string) => { getAttribute: (name: string) => string | null } | null }

// 点浮窗自己、右侧编辑器、本卡节点不关；点画布空白、别的卡、顶栏都关。
export function pointerCloses(target: unknown, cardId: string): boolean {
  if (!target || typeof (target as ClosestTarget).closest !== 'function') return false
  const el = target as ClosestTarget
  if (el.closest('[data-discuss-popover]')) return false
  if (el.closest('.control-pane') || el.closest('.session-pane')) return false
  if (el.closest('.drawer-resizer')) return false
  const host = el.closest('.react-flow__node')
  if (host?.getAttribute('data-id') === cardId) return false
  return true
}

export type ReplyRun = {
  cardId: string
  sessionId: string
  runId: string
  controller: AbortController
  done: Promise<void>
}

// 浮窗关掉后回复继续在后台收；同一张卡再开时接上这条，收完再从服务器拉全文。
const liveRuns = new Map<string, ReplyRun>()

export function liveRunFor(cardId: string): ReplyRun | undefined {
  return liveRuns.get(cardId)
}

export function startRun(cardId: string, sessionId: string, work: (run: ReplyRun) => Promise<void>): ReplyRun {
  const run: ReplyRun = { cardId, sessionId, runId: '', controller: new AbortController(), done: Promise.resolve() }
  liveRuns.set(cardId, run)
  run.done = work(run).finally(() => {
    if (liveRuns.get(cardId) === run) liveRuns.delete(cardId)
  })
  return run
}

// 换卡只断旧卡的浏览器连接，不停网关任务；停网关只给「停止」按钮。
export function leaveCard(run: ReplyRun | null, nextCardId: string): boolean {
  if (!run || run.cardId === nextCardId) return false
  run.controller.abort()
  if (liveRuns.get(run.cardId) === run) liveRuns.delete(run.cardId)
  return true
}

export type StopOutcome = 'local' | 'stopped' | 'failed'

export async function stopRun(run: ReplyRun, fetchImpl: typeof fetch = fetch): Promise<StopOutcome> {
  run.controller.abort()
  if (!run.runId) return 'local'
  const query = `cardId=${encodeURIComponent(run.cardId)}&sessionId=${encodeURIComponent(run.sessionId)}`
  try {
    const response = await fetchImpl(api(`/api/discuss/runs/${encodeURIComponent(run.runId)}/stop?${query}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    return response.ok ? 'stopped' : 'failed'
  } catch {
    return 'failed'
  }
}

function storageKey(cardId: string): string {
  return `snowflake-discuss-last:${cardId}`
}

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'AbortError'
}

function clock(iso: string | undefined): { short: string; full: string } | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const short = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(date)
  const full = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
  return { short, full }
}

export function sessionLabel(item: DiscussSession): string {
  const ask = typeof item.firstAsk === 'string' ? item.firstAsk.trim() : ''
  const date = new Date(item.createdAt)
  if (Number.isNaN(date.getTime())) return ask ? `念头讨论 ${ask}` : '念头讨论'
  const when = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
  return ask ? `${when} ${ask}` : `念头讨论 ${when}`
}

export function adoptionText(content: string): string {
  return stripMarkdown(content)
}

export function messageIndexForAdoption(
  messages: readonly { content: string; serverKey?: string; adopted?: boolean }[],
  hit: { found?: boolean; index?: number; text?: string; adoptionKey?: string },
): number {
  if (!hit || hit.found !== true) return -1
  if (hit.adoptionKey) {
    const byKey = messages.findIndex((item) => item.serverKey === hit.adoptionKey)
    if (byKey >= 0) return byKey
  }
  const text = typeof hit.text === 'string' ? hit.text.trim() : ''
  if (text) {
    const byText = messages.findIndex((item) => {
      const plain = adoptionText(item.content)
      return item.content === text || plain === text || item.content.includes(text) || plain.includes(text)
    })
    if (byText >= 0) return byText
  }
  if (typeof hit.index === 'number' && hit.index >= 0) {
    const adoptedIndexes = messages.map((item, index) => (item.adopted ? index : -1)).filter((index) => index >= 0)
    if (hit.index < adoptedIndexes.length) return adoptedIndexes[hit.index] ?? -1
    if (hit.index < messages.length) return hit.index
  }
  return -1
}

export type BrainOutcome = { ok: true; slug: string } | { ok: false; error: string }

export function brainFailure(error: string): string {
  return `没写入脑：${error}`
}

// 只把这一条回复交给服务器追加进 gbrain；来源行和 slug 都由服务器和 gbrain 定，浏览器不拼页面。
export async function captureToBrain(
  cardId: string,
  sessionId: string,
  item: ChatMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<BrainOutcome> {
  const content = adoptionText(item.content)
  if (!content) return { ok: false, error: '这条结论是空的，没有写入' }
  try {
    const response = await fetchImpl(api('/api/brain/capture'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId, sessionId, messageId: item.id, role: item.role, at: item.at, content }),
    })
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; slug?: string; error?: string }
    if (!response.ok || payload.ok !== true || typeof payload.slug !== 'string' || !payload.slug) {
      return { ok: false, error: payload.error || 'gbrain 不可用' }
    }
    return { ok: true, slug: payload.slug }
  } catch {
    return { ok: false, error: '连不上画布服务' }
  }
}

export function AssistantActions({
  item,
  copied,
  writing,
  finished,
  onAdopt,
  onCopy,
  onWriteBrain,
  onSediment,
}: {
  item: ChatMessage
  copied: boolean
  writing: boolean
  finished: boolean
  onAdopt: () => void
  onCopy: () => void
  onWriteBrain: () => void
  onSediment?: () => void
}) {
  if (item.role !== 'assistant' || !item.content.trim()) return null
  return (
    <>
      {item.brainSlug ? <p className="brain-mark">已写入脑：{item.brainSlug}</p> : null}
      <div className="log-actions">
        <button type="button" onClick={onAdopt}>
          采纳进本念头
        </button>
        <button type="button" onClick={() => onSediment?.()}>
          沉淀到…
        </button>
        <button type="button" onClick={onCopy}>
          {copied ? '已复制' : '复制'}
        </button>
        {finished ? (
          <button type="button" disabled={writing} aria-busy={writing} onClick={onWriteBrain}>
            写入脑
          </button>
        ) : null}
      </div>
    </>
  )
}

function mergeBody(base: string, addition: string): string {
  const cleaned = addition.trim()
  if (!cleaned) return base
  const trimmed = base.replace(/\s+$/u, '')
  if (!trimmed) return cleaned
  if (trimmed === cleaned || trimmed.endsWith(`\n${cleaned}`)) return trimmed
  return `${trimmed}\n${cleaned}`
}

export function applySse(
  block: string,
  append: (text: string) => void,
  replace: (text: string) => void,
  onRun: (runId: string) => void,
) {
  let eventName = ''
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      continue
    }
    if (!line.startsWith('data:')) continue
    const raw = line.slice(5).trim()
    if (!raw) continue
    try {
      const payload = JSON.parse(raw) as { delta?: string; run_id?: string; content?: string }
      if (typeof payload.run_id === 'string' && payload.run_id) onRun(payload.run_id)
      if (eventName === 'assistant.delta' && typeof payload.delta === 'string' && payload.delta) append(payload.delta)
      if (eventName === 'assistant.completed' && typeof payload.content === 'string') replace(payload.content)
    } catch {
      // 不是 JSON 的 data 行仍留给下一行，不把整段连接掐掉。
    }
  }
}

function HistoryBar({
  busy,
  sessions,
  selected,
  onOpen,
  onCreate,
}: {
  busy: boolean
  sessions: DiscussSession[]
  selected: string
  onOpen: (sessionId: string) => void
  onCreate: () => void
}) {
  return (
    <div className="session-tabs">
      <label className="session-tab">
        <span>历史讨论</span>
        <select
          aria-label="历史讨论"
          value={selected}
          disabled={busy || sessions.length === 0}
          onChange={(event) => onOpen(event.target.value)}
        >
          {sessions.map((item) => (
            <option key={item.sessionId} value={item.sessionId}>
              {sessionLabel(item)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="session-tab" disabled={busy} onClick={onCreate}>
        新建讨论
      </button>
      {/* 关闭只留在卡头，讨论记录这一排不再放第二个关闭。 */}
    </div>
  )
}

const SEDIMENT_FIELDS = [
  ...PERSON_ZONES[0].keys,
  ...PERSON_ZONES[1].keys.filter((key) => key !== 'arc'),
  ...ARC_KEYS.map((key) => `arc.${key}`),
  ...ARCHIVE_GROUPS.flatMap((group) => group.keys).filter((key) => key !== 'philosophy'),
  ...RENWUGUSHI_KEYS,
]

export default function CardDiscuss({
  cardId,
  cardBody,
  onClose,
  onCommitBody,
  entities = [],
  edges = [],
  cards = {},
  focusSessionId,
  focusAdoptionKey,
  prefill,
  sediment = [],
  onCreatePerson,
  onSedimentDone,
}: {
  cardId: string
  cardBody: string
  onClose: () => void
  onCommitBody: (cardId: string, body: string) => Promise<void>
  entities?: Entity[]
  edges?: CanvasEdge[]
  cards?: Record<string, Card>
  focusSessionId?: string
  focusAdoptionKey?: string
  prefill?: string
  sediment?: SedimentEvent[]
  onCreatePerson?: (id: string, name: string) => Promise<boolean>
  onSedimentDone?: () => void
}) {
  const [sessions, setSessions] = useState<DiscussSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState(() => (prefill && prefill.trim() ? prefill : ''))
  const [adoptionHit, setAdoptionHit] = useState<{ found: boolean; index?: number; text?: string; adoptionKey?: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedAt, setCopiedAt] = useState<string | null>(null)
  const [pendingNew, setPendingNew] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [writingBrain, setWritingBrain] = useState<Record<string, true>>({})
  const [sedimentFor, setSedimentFor] = useState<ChatMessage | null>(null)
  const writingRef = useRef(new Set<string>())
  const chatRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)
  const runRef = useRef<ReplyRun | null>(null)
  const genRef = useRef(0)
  const busyRef = useRef(false)
  const loadGen = useRef(0)
  const offsetRef = useRef(0)
  const hasMoreRef = useRef(false)
  const olderRef = useRef(false)
  const adoptionPageRef = useRef(0)
  const anchorRef = useRef<{ height: number; top: number } | null>(null)
  const cardRef = useRef(cardId)
  const onCloseRef = useRef(onClose)
  const onCommitRef = useRef(onCommitBody)
  onCloseRef.current = onClose
  onCommitRef.current = onCommitBody

  function halt() {
    genRef.current += 1
    loadGen.current += 1
    runRef.current?.controller.abort()
    runRef.current = null
    busyRef.current = false
  }

  function focusCard() {
    const node = document.querySelector<HTMLElement>(`.react-flow__node-snowCard[data-id="${CSS.escape(cardId)}"]`)
    window.requestAnimationFrame(() => {
      node?.focus()
    })
  }

  function requestClose() {
    onCloseRef.current()
    focusCard()
  }

  useLayoutEffect(() => {
    draftRef.current?.focus()
  }, [])

  useEffect(() => {
    if (prefill && prefill.trim()) setDraft(prefill)
  }, [prefill])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (pointerCloses(event.target, cardId)) onCloseRef.current()
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
      loadGen.current += 1
    }
  }, [cardId])

  useEffect(() => {
    if (cardRef.current === cardId) return
    if (leaveCard(runRef.current, cardId)) {
      runRef.current = null
      genRef.current += 1
      busyRef.current = false
      setBusy(false)
    }
    cardRef.current = cardId
  }, [cardId])

  function nearBottom(el: HTMLElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  function onChatScroll() {
    const el = chatRef.current
    if (!el) return
    const bottom = nearBottom(el)
    stickRef.current = bottom
    if (bottom) setPendingNew(false)
    if (el.scrollTop < 24 && hasMoreRef.current) void loadOlder()
  }

  function jumpLatest() {
    const el = chatRef.current
    stickRef.current = true
    setPendingNew(false)
    if (el) el.scrollTop = el.scrollHeight
  }

  const adoptionIndex = adoptionHit ? messageIndexForAdoption(messages, adoptionHit) : -1
  const adoptionFocusKey = adoptionIndex >= 0 ? (messages[adoptionIndex]?.key ?? null) : null

  useEffect(() => {
    adoptionPageRef.current = 0
    if (!focusAdoptionKey || !focusSessionId || sessionId !== focusSessionId) {
      setAdoptionHit(null)
      return
    }
    let cancelled = false
    const query = new URLSearchParams({ cardId, sessionId, adoptionKey: focusAdoptionKey })
    void fetch(api(`/api/discuss/adoption?${query}`), { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          found?: boolean
          index?: number
          text?: string
          adoptionKey?: string
        } | null
        if (cancelled) return
        if (!response.ok || !payload || payload.found !== true) {
          setAdoptionHit({ found: false, adoptionKey: focusAdoptionKey })
          return
        }
        setAdoptionHit({
          found: true,
          index: typeof payload.index === 'number' ? payload.index : undefined,
          text: typeof payload.text === 'string' ? payload.text : undefined,
          adoptionKey: typeof payload.adoptionKey === 'string' ? payload.adoptionKey : focusAdoptionKey,
        })
      })
      .catch(() => {
        if (!cancelled) setAdoptionHit({ found: false, adoptionKey: focusAdoptionKey })
      })
    return () => {
      cancelled = true
    }
  }, [cardId, focusAdoptionKey, focusSessionId, sessionId])

  useEffect(() => {
    if (!adoptionHit || adoptionHit.found !== true) return
    if (messageIndexForAdoption(messages, adoptionHit) >= 0) return
    if (!hasMore || loadingOlder || adoptionPageRef.current >= 8) return
    adoptionPageRef.current += 1
    void loadOlder()
  }, [adoptionHit, messages, hasMore, loadingOlder])

  useLayoutEffect(() => {
    const el = chatRef.current
    if (!el) return
    const anchor = anchorRef.current
    if (anchor) {
      anchorRef.current = null
      el.scrollTop = el.scrollHeight - anchor.height + anchor.top
      return
    }
    const focused = el.querySelector('[data-adoption-focus="true"]')
    if (focused instanceof HTMLElement) {
      stickRef.current = false
      focused.scrollIntoView({ block: 'center' })
      return
    }
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight
      setPendingNew(false)
      return
    }
    setPendingNew(true)
  }, [messages, adoptionFocusKey])

  function setMore(more: boolean) {
    hasMoreRef.current = more
    setHasMore(more)
  }

  function pageUrl(nextSessionId: string, offset: number): string {
    const query = `cardId=${encodeURIComponent(cardId)}&sessionId=${encodeURIComponent(nextSessionId)}&limit=${PAGE_SIZE}`
    return api(`/api/discuss/messages?${query}${offset > 0 ? `&offset=${offset}` : ''}`)
  }

  async function loadMessages(nextSessionId: string) {
    const ticket = loadGen.current + 1
    loadGen.current = ticket
    const response = await fetch(pageUrl(nextSessionId, 0), { cache: 'no-store' })
    const payload = (await response.json().catch(() => ({}))) as {
      messages?: ServerMessage[]
      hasMore?: boolean
      nextOffset?: number
      error?: string
    }
    if (ticket !== loadGen.current) return
    if (!response.ok) {
      setNotice(payload.error || '讨论记录没有取到。再打开一次这张卡片。')
      setMessages([])
      setMore(false)
      return
    }
    offsetRef.current = typeof payload.nextOffset === 'number' ? payload.nextOffset : 0
    setMore(payload.hasMore === true)
    stickRef.current = true
    setPendingNew(false)
    setMessages(fromServer(Array.isArray(payload.messages) ? payload.messages : []))
  }

  async function loadOlder() {
    if (olderRef.current || !hasMoreRef.current || !sessionId) return
    olderRef.current = true
    setLoadingOlder(true)
    const ticket = loadGen.current
    const forSession = sessionId
    try {
      let offset = offsetRef.current
      let more = true
      let older: ChatMessage[] = []
      // 一页里可能全是工具消息，过滤后为空就再往前取几页。
      for (let round = 0; round < 5 && more && older.length === 0; round += 1) {
        const response = await fetch(pageUrl(forSession, offset), { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as {
          messages?: ServerMessage[]
          hasMore?: boolean
          nextOffset?: number
          error?: string
        }
        if (ticket !== loadGen.current) return
        if (!response.ok) {
          setNotice(payload.error || '更早的讨论没有取到。往上滚再试一次。')
          return
        }
        older = fromServer(Array.isArray(payload.messages) ? payload.messages : [])
        more = payload.hasMore === true
        offset = typeof payload.nextOffset === 'number' ? payload.nextOffset : offset
      }
      offsetRef.current = offset
      setMore(more)
      if (older.length > 0) {
        const el = chatRef.current
        anchorRef.current = el ? { height: el.scrollHeight, top: el.scrollTop } : null
        setMessages((current) => prependOlder(current, older))
      }
    } catch {
      if (ticket === loadGen.current) setNotice('更早的讨论没有取到。往上滚再试一次。')
    } finally {
      olderRef.current = false
      setLoadingOlder(false)
    }
  }

  async function remember(nextSessionId: string, list: DiscussSession[]) {
    sessionStorage.setItem(storageKey(cardId), nextSessionId)
    setSessionId(nextSessionId)
    setSessions(list)
    if (nextSessionId) await loadMessages(nextSessionId)
  }

  async function refreshSessions() {
    try {
      const response = await fetch(api(`/api/discuss/session?cardId=${encodeURIComponent(cardId)}`), { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as { sessions?: DiscussSession[] }
      if (response.ok && Array.isArray(payload.sessions)) setSessions(payload.sessions)
    } catch {
      // 下拉里的首问晚一点出现不影响讨论。
    }
  }

  async function followBackground(run: ReplyRun, isCancelled: () => boolean) {
    const waiting = '上一条回复还在后台接收，收完会自动显示。'
    runRef.current = run
    busyRef.current = true
    setBusy(true)
    setNotice(waiting)
    await run.done.catch(() => {})
    if (isCancelled()) return
    if (runRef.current === run) runRef.current = null
    busyRef.current = false
    setBusy(false)
    setNotice((current) => (current === waiting ? '' : current))
    await loadMessages(run.sessionId)
  }

  useEffect(() => {
    let cancelled = false
    const isCancelled = () => cancelled
    void (async () => {
      setNotice('')
      setMessages([])
      setMore(false)
      const response = await fetch(api(`/api/discuss/session?cardId=${encodeURIComponent(cardId)}`), { cache: 'no-store' })
      const payload = (await response.json().catch(() => ({}))) as {
        sessionId?: string
        sessions?: DiscussSession[]
        error?: string
      }
      if (cancelled) return
      if (!response.ok || !payload.sessionId) {
        setNotice(payload.error || '画布会话没有取到。再双击这张卡片。')
        return
      }
      const list = Array.isArray(payload.sessions) ? payload.sessions : []
      const running = liveRunFor(cardId)
      const remembered = focusSessionId || running?.sessionId || sessionStorage.getItem(storageKey(cardId)) || ''
      const picked = list.some((item) => item.sessionId === remembered) ? remembered : payload.sessionId
      if (picked !== payload.sessionId) {
        const selected = await fetch(api('/api/discuss/session'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId, sessionId: picked }),
        })
        const selectedPayload = (await selected.json().catch(() => ({}))) as {
          sessionId?: string
          sessions?: DiscussSession[]
          error?: string
        }
        if (cancelled) return
        if (!selected.ok || !selectedPayload.sessionId) {
          setNotice(selectedPayload.error || '没有切到上次的讨论。先看当前这条。')
          await remember(payload.sessionId, list)
          return
        }
        await remember(selectedPayload.sessionId, selectedPayload.sessions || list)
      } else {
        await remember(picked, list)
      }
      if (!cancelled && running && running.sessionId === picked) await followBackground(running, isCancelled)
    })().catch(() => {
      if (!cancelled) setNotice('画布会话没有连上。检查本机服务后再试。')
    })
    return () => {
      cancelled = true
    }
  }, [cardId, focusSessionId])

  async function openSession(nextSessionId: string) {
    if (!nextSessionId) return
    halt()
    busyRef.current = true
    setBusy(true)
    setNotice('')
    try {
      const response = await fetch(api('/api/discuss/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, sessionId: nextSessionId }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        sessionId?: string
        sessions?: DiscussSession[]
        error?: string
      }
      if (!response.ok || !payload.sessionId) {
        setNotice(payload.error || '没有打开这条讨论。从历史讨论里再选一次。')
        return
      }
      await remember(payload.sessionId, payload.sessions || sessions)
    } catch {
      setNotice('没有打开这条讨论。从历史讨论里再选一次。')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function createSession() {
    halt()
    busyRef.current = true
    setBusy(true)
    setNotice('')
    try {
      const response = await fetch(api('/api/discuss/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId }),
      })
      const payload = (await response.json().catch(() => ({}))) as {
        sessionId?: string
        sessions?: DiscussSession[]
        error?: string
      }
      if (!response.ok || !payload.sessionId) {
        setNotice(payload.error || '新讨论没有建成。再点一次「新建讨论」。')
        return
      }
      await remember(payload.sessionId, payload.sessions || [])
    } catch {
      setNotice('画布会话没有连上。检查本机服务后再试。')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function patchAssistant(gen: number, recipe: (text: string) => string) {
    if (genRef.current !== gen) return
    setMessages((current) => {
      const next = current.slice()
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const item = next[index]
        if (item && item.role === 'assistant') {
          next[index] = { ...item, content: recipe(item.content) }
          return next
        }
      }
      return [...next, { key: localKey(), role: 'assistant', content: recipe(''), at: new Date().toISOString() }]
    })
  }

  function attachError(gen: number, note: string, text: string) {
    if (genRef.current !== gen) return
    setNotice(note)
    setMessages((current) => {
      const next = current.slice()
      const last = next[next.length - 1]
      if (last && last.role === 'assistant' && !last.content.trim()) next.pop()
      next.push({ key: localKey(), role: 'error', content: note, retryText: text, at: new Date().toISOString() })
      return next
    })
  }

  async function pump(run: ReplyRun, gen: number, text: string) {
    const controller = run.controller
    setNotice('')
    let waitMs = 2000
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (controller.signal.aborted || genRef.current !== gen) return
        const response = await fetch(api('/api/discuss/stream'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ cardId: run.cardId, sessionId: run.sessionId, message: text }),
          signal: controller.signal,
        })
        if (response.status === 429) {
          setNotice(BUSY)
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(resolve, waitMs)
            const onAbort = () => {
              window.clearTimeout(timer)
              reject(new DOMException('Aborted', 'AbortError'))
            }
            if (controller.signal.aborted) {
              onAbort()
              return
            }
            controller.signal.addEventListener('abort', onAbort, { once: true })
          })
          waitMs *= 2
          continue
        }
        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          attachError(gen, payload.error || '讨论没有发出去', text)
          return
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        const append = (chunk: string) => patchAssistant(gen, (current) => current + chunk)
        const replace = (full: string) => patchAssistant(gen, () => full)
        const onRun = (runId: string) => {
          run.runId = runId
        }
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() || ''
          for (const block of blocks) applySse(block, append, replace, onRun)
        }
        if (buffer.trim()) applySse(buffer, append, replace, onRun)
        sessionStorage.setItem(storageKey(run.cardId), run.sessionId)
        return
      }
      attachError(gen, BUSY, text)
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return
      attachError(gen, '讨论连接断了', text)
    } finally {
      if (runRef.current === run) runRef.current = null
      if (genRef.current === gen) {
        busyRef.current = false
        setBusy(false)
        draftRef.current?.focus()
      }
    }
  }

  async function stream(text: string) {
    const gen = genRef.current
    const run = startRun(cardId, sessionId, (next) => pump(next, gen, text))
    runRef.current = run
    await run.done
  }

  async function sendText(text: string) {
    const message = text.trim()
    if (!message || busyRef.current || !sessionId) return
    busyRef.current = true
    setBusy(true)
    stickRef.current = true
    const at = new Date().toISOString()
    const askMissing = !sessions.some((item) => item.sessionId === sessionId && item.firstAsk)
    setDraft('')
    setMessages((current) => [
      ...current.filter((item) => item.role !== 'error'),
      { key: localKey(), role: 'user', content: message, at },
      { key: localKey(), role: 'assistant', content: '', at },
    ])
    await stream(message)
    if (askMissing) void refreshSessions()
  }

  async function retry(text: string) {
    const message = text.trim()
    if (!message || busyRef.current || !sessionId) return
    busyRef.current = true
    setBusy(true)
    stickRef.current = true
    setMessages((current) => [
      ...current.filter((item) => item.role !== 'error'),
      { key: localKey(), role: 'assistant', content: '', at: new Date().toISOString() },
    ])
    await stream(message)
  }

  async function stop() {
    const run = runRef.current
    if (!run) return
    const outcome = await stopRun(run)
    if (outcome === 'failed') setNotice(STOP_FAILED)
  }

  function onDraftKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void sendText(draft)
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAt(key)
    } catch {
      setNotice('没有复制上。再点一次「复制」。')
    }
  }

  async function adopt(item: ChatMessage) {
    const cleaned = adoptionText(item.content)
    if (!cleaned) return
    const next = mergeBody(cardBody, cleaned)
    setNotice('')
    try {
      await onCommitRef.current(cardId, next)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setNotice(message || '正文没有写上。再点一次「采纳进本念头」。')
      return
    }
    const unsaved = '正文已写进卡片，但「已采纳」记录没存上，重开浮窗后不会显示已采纳。'
    try {
      const response = await fetch(api('/api/discuss/adoptions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, sessionId, messageId: item.id, role: item.role, at: item.at, content: item.content }),
      })
      const payload = (await response.json().catch(() => ({}))) as { key?: string; error?: string }
      if (!response.ok || !payload.key) {
        setNotice(unsaved)
        return
      }
      setMessages((current) =>
        current.map((entry) =>
          entry.key === item.key ? { ...entry, adopted: true, serverKey: entry.serverKey ?? payload.key } : entry,
        ),
      )
    } catch {
      setNotice(unsaved)
    }
  }

  async function writeBrain(item: ChatMessage) {
    if (writingRef.current.has(item.key) || !sessionId) return
    writingRef.current.add(item.key)
    setWritingBrain((current) => ({ ...current, [item.key]: true }))
    try {
      const outcome = await captureToBrain(cardId, sessionId, item)
      if (!outcome.ok) {
        setNotice(brainFailure(outcome.error))
        return
      }
      setNotice((current) => (current.startsWith(brainFailure('')) ? '' : current))
      setMessages((current) => current.map((entry) => (entry.key === item.key ? { ...entry, brainSlug: outcome.slug } : entry)))
    } finally {
      writingRef.current.delete(item.key)
      setWritingBrain((current) => {
        const next = { ...current }
        delete next[item.key]
        return next
      })
    }
  }

  const selected = sessions.some((item) => item.sessionId === sessionId) ? sessionId : ''

  return (
    <section className="discuss-popover" data-discuss-popover="">
      <HistoryBar
        busy={busy}
        sessions={sessions}
        selected={selected}
        onOpen={(id) => void openSession(id)}
        onCreate={() => void createSession()}
      />
      <div className="discuss-chat" aria-label="讨论记录" ref={chatRef} onScroll={onChatScroll}>
        {hasMore ? (
          <button type="button" className="load-older" disabled={loadingOlder} onClick={() => void loadOlder()}>
            {loadingOlder ? '正在取更早的讨论' : '看更早的讨论'}
          </button>
        ) : null}
        {messages.map((item, index) => {
          const time = clock(item.at)
          if (item.role === 'error') {
            return (
              <div key={item.key} className="log-row" data-role="error" data-adoption-focus={item.key === adoptionFocusKey ? 'true' : undefined}>
                <div className="log-meta">
                  <span className="who">出错</span>
                </div>
                <p className="plain log-body">{item.content}</p>
                {item.retryText ? (
                  <div className="log-actions">
                    <button type="button" onClick={() => void retry(item.retryText || '')}>
                      重试
                    </button>
                  </div>
                ) : null}
              </div>
            )
          }
          const mine = item.role === 'user'
          return (
            <div key={item.key} className="log-row" data-role={item.role} data-adoption-focus={item.key === adoptionFocusKey ? 'true' : undefined}>
              <div className="log-meta">
                <span className="who">{mine ? '我' : 'AI'}</span>
                {time ? (
                  <time className="stamp" dateTime={item.at} title={time.full}>
                    <span className="stamp-short">{time.short}</span>
                    <span className="stamp-full">{time.full}</span>
                  </time>
                ) : null}
              </div>
              <div className="log-body">
                {mine ? (
                  <p className="plain">{item.content}</p>
                ) : item.content ? (
                  <MarkdownText text={item.content} />
                ) : busy ? (
                  <p className="pending">正在回复</p>
                ) : (
                  <p className="plain" />
                )}
              </div>
              {item.role === 'assistant' && item.adopted ? <p className="adopted-mark">已采纳</p> : null}
              <AssistantActions
                item={item}
                copied={copiedAt === item.key}
                writing={writingBrain[item.key] === true}
                finished={!(busy && index === messages.length - 1)}
                onAdopt={() => void adopt(item)}
                onSediment={() => setSedimentFor(item)}
                onCopy={() => void copyText(item.content, item.key)}
                onWriteBrain={() => void writeBrain(item)}
              />
            </div>
          )
        })}
        {pendingNew ? (
          <button type="button" className="jump-latest" onClick={jumpLatest}>
            有新消息
          </button>
        ) : null}
      </div>
      {sedimentFor ? (
        <SedimentPanel
          cardId={cardId}
          sessionId={sessionId}
          message={sedimentFor}
          entities={entities}
          edges={edges}
          cards={cards}
          sediment={sediment}
          onCreatePerson={onCreatePerson}
          onCancel={() => setSedimentFor(null)}
          onDone={() => {
            setSedimentFor(null)
            onSedimentDone?.()
          }}
          onKeep={() => {
            onSedimentDone?.()
          }}
        />
      ) : null}
      {notice ? (
        <p className="status-line discuss-notice" role="status">
          {notice}
        </p>
      ) : null}
      <div className="discuss-compose">
        <div className="discuss-input-shell">
          <textarea
            ref={draftRef}
            aria-label="讨论内容"
            value={draft}
            readOnly={busy}
            rows={2}
            placeholder="接着这张念头写一句，Enter 发送"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onDraftKey}
          />
          <div className="discuss-compose-bar">
            {busy ? (
              <button type="button" onClick={() => void stop()}>
                停止
              </button>
            ) : (
              <button type="button" className="discuss-send" disabled={draft.trim().length === 0 || !sessionId} onClick={() => void sendText(draft)}>
                发送
              </button>
            )}
            {busy ? <span className="spinner" role="status" aria-label="发送中" /> : null}
          </div>
        </div>
      </div>
    </section>
  )
}

function SedimentPanel({
  cardId,
  sessionId,
  message,
  entities,
  edges,
  cards,
  sediment,
  onCreatePerson,
  onCancel,
  onDone,
  onKeep,
}: {
  cardId: string
  sessionId: string
  message: ChatMessage
  entities: Entity[]
  edges: CanvasEdge[]
  cards: Record<string, Card>
  sediment: SedimentEvent[]
  onCreatePerson?: (id: string, name: string) => Promise<boolean>
  onCancel: () => void
  onDone: () => void
  onKeep: () => void
}) {
  const choice = defaultSedimentTarget({ sessionId, ideaId: cardId, sediment, entities, edges })
  const preset = choice.step === 1 || choice.step === 2 || choice.step === 4 ? choice.entityId : ''
  const [pickedId, setPickedId] = useState(preset)
  const [personName, setPersonName] = useState('')
  const creating = choice.step === 5
  const blocked = choice.step === 0 || (choice.step === 3 && !pickedId)
  const chosen = entities.find((entity) => entity.id === pickedId)
  const people =
    choice.step === 3
      ? choice.personIds.flatMap((id) => {
          const person = entities.find((entity) => entity.id === id)
          return person ? [person] : []
        })
      : []
  const [fieldKey, setFieldKey] = useState('')
  const [action, setAction] = useState<SedimentAction>('append')
  const [quote, setQuote] = useState(() => adoptionText(message.content))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const requestRef = useRef<string | null>(null)
  const idea = cards[cardId]
  const ideaName = idea ? cardFace(idea).title.trim() || '未命名念头' : '当前念头'

  async function submit() {
    if (blocked || !fieldKey || fieldKey === 'philosophy' || !quote.trim() || !sessionId) return
    let entityId = pickedId
    if (creating) {
      const id = `person-${crypto.randomUUID()}`
      const created = onCreatePerson ? await onCreatePerson(id, personName) : false
      if (!created) {
        setError('人物没有建成')
        return
      }
      entityId = id
    }
    if (!entityId) return
    const requestId = requestRef.current ?? crypto.randomUUID()
    requestRef.current = requestId
    setBusy(true)
    try {
      const response = await fetch(api('/api/sediment'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cardId,
          sessionId,
          entityId,
          fieldKey,
          action,
          quote,
          requestId,
          ...(message.serverKey ? { adoptionKey: message.serverKey } : {}),
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; status?: string }
      if (payload.error === '百科没写上' || payload.status === 'failed') {
        setError('百科没写上')
        onKeep()
        return
      }
      if (!response.ok || payload.ok !== true) {
        requestRef.current = null
        setError(typeof payload.error === 'string' && payload.error ? payload.error : '沉淀没有写上')
        return
      }
      requestRef.current = null
      setError('')
      onDone()
    } catch {
      setError('沉淀没有写上')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="sediment-panel"
      aria-label="沉淀到"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p>把这句话沉淀到</p>
      {choice.step === 3 && !pickedId ? (
        <p className="cast-warn" role="status">
          {MANY_PERSONS_HINT}
        </p>
      ) : null}
      {people.length > 1 ? (
        <div className="sediment-people">
          {people.map((person) => (
            <button
              key={person.id}
              type="button"
              className={pickedId === person.id ? 'on' : ''}
              onClick={() => setPickedId(person.id)}
            >
              {person.name || '未命名'}
            </button>
          ))}
        </div>
      ) : null}
      {creating ? (
        <label>
          新建人物
          <input
            aria-label="新人物名字"
            value={personName}
            placeholder="名字空着，等你填"
            onChange={(event) => setPersonName(event.target.value)}
          />
        </label>
      ) : (
        <label>
          目标实体
          <input aria-label="目标实体" value={chosen?.name ?? ''} disabled readOnly />
        </label>
      )}
      <label>
        目标字段
        <select aria-label="目标字段" value={fieldKey} disabled={blocked} onChange={(event) => setFieldKey(event.target.value)}>
          <option value="">选一个字段</option>
          {SEDIMENT_FIELDS.map((key) => (
            <option key={key} value={key}>
              {fieldLabel(key)}
            </option>
          ))}
        </select>
      </label>
      <fieldset disabled={blocked}>
        <legend>方式</legend>
        <label>
          <input type="radio" name="sediment-action" checked={action === 'append'} onChange={() => setAction('append')} />
          追加
        </label>
        <label>
          <input type="radio" name="sediment-action" checked={action === 'replace'} onChange={() => setAction('replace')} />
          替换
        </label>
        <label>
          <input type="radio" name="sediment-action" checked={action === 'negate'} onChange={() => setAction('negate')} />
          否定
        </label>
      </fieldset>
      <label>
        挂到念头
        <input aria-label="挂到念头" value={ideaName} disabled readOnly />
      </label>
      <label>
        摘录
        <textarea aria-label="摘录" value={quote} disabled={blocked} rows={3} onChange={(event) => setQuote(event.target.value)} />
      </label>
      {error ? (
        <p className="cast-warn" role="status">
          {error}
        </p>
      ) : null}
      <div className="sediment-actions">
        <button type="submit" disabled={blocked || busy || !fieldKey || !quote.trim() || !sessionId}>
          {error === '百科没写上' ? '重试' : '沉淀'}
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  )
}
