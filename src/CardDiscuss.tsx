import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MarkdownText } from './markdown-lite.tsx'

function api(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${path}`
}

const BUSY = '讨论的人有点多，正在排队，稍后自动重试。'

type DiscussSession = {
  sessionId: string
  title: string
  createdAt: string
  cardId: string
}

type ChatMessage = {
  role: 'user' | 'assistant' | 'error'
  content: string
  at?: string
  adopted?: boolean
  retryText?: string
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

function sessionLabel(item: DiscussSession): string {
  const date = new Date(item.createdAt)
  if (Number.isNaN(date.getTime())) return '念头讨论'
  const when = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
  return `念头讨论 ${when}`
}

function mergeBody(base: string, addition: string): string {
  const cleaned = addition.trim()
  if (!cleaned) return base
  const trimmed = base.replace(/\s+$/u, '')
  if (!trimmed) return cleaned
  if (trimmed === cleaned || trimmed.endsWith(`\n${cleaned}`)) return trimmed
  return `${trimmed}\n${cleaned}`
}

function applySse(
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

export default function CardDiscuss({
  cardId,
  cardBody,
  onClose,
  onCommitBody,
}: {
  cardId: string
  cardBody: string
  onClose: () => void
  onCommitBody: (cardId: string, body: string) => Promise<void>
}) {
  const [sessions, setSessions] = useState<DiscussSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [copiedAt, setCopiedAt] = useState<number | null>(null)
  const [pendingNew, setPendingNew] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const genRef = useRef(0)
  const busyRef = useRef(false)
  const loadGen = useRef(0)
  const onCloseRef = useRef(onClose)
  const onCommitRef = useRef(onCommitBody)
  onCloseRef.current = onClose
  onCommitRef.current = onCommitBody

  function halt() {
    genRef.current += 1
    loadGen.current += 1
    abortRef.current?.abort()
    abortRef.current = null
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
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-discuss-popover]')) return
      const host = target.closest('.react-flow__node')
      if (host?.getAttribute('data-id') === cardId) return
      onCloseRef.current()
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
      halt()
    }
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
  }

  function jumpLatest() {
    const el = chatRef.current
    stickRef.current = true
    setPendingNew(false)
    if (el) el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight
      setPendingNew(false)
      return
    }
    setPendingNew(true)
  }, [messages])

  async function loadMessages(nextSessionId: string) {
    const ticket = loadGen.current + 1
    loadGen.current = ticket
    const response = await fetch(
      api(`/api/discuss/messages?cardId=${encodeURIComponent(cardId)}&sessionId=${encodeURIComponent(nextSessionId)}`),
      { cache: 'no-store' },
    )
    const payload = (await response.json().catch(() => ({}))) as {
      messages?: Array<{ role?: string; content?: string; at?: string }>
      error?: string
    }
    if (ticket !== loadGen.current) return
    if (!response.ok) {
      setNotice(payload.error || '讨论记录没有取到。再打开一次这张卡片。')
      setMessages([])
      return
    }
    const list = Array.isArray(payload.messages) ? payload.messages : []
    stickRef.current = true
    setPendingNew(false)
    setMessages(
      list
        .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
        .map((item) => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: item.content ?? '',
          at: typeof item.at === 'string' ? item.at : undefined,
        })),
    )
  }

  async function remember(nextSessionId: string, list: DiscussSession[]) {
    sessionStorage.setItem(storageKey(cardId), nextSessionId)
    setSessionId(nextSessionId)
    setSessions(list)
    if (nextSessionId) await loadMessages(nextSessionId)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setNotice('')
      setMessages([])
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
      const remembered = sessionStorage.getItem(storageKey(cardId)) || ''
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
        return
      }
      await remember(picked, list)
    })().catch(() => {
      if (!cancelled) setNotice('画布会话没有连上。检查本机服务后再试。')
    })
    return () => {
      cancelled = true
    }
  }, [cardId])

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
      return [...next, { role: 'assistant', content: recipe(''), at: new Date().toISOString() }]
    })
  }

  function attachError(gen: number, note: string, text: string) {
    if (genRef.current !== gen) return
    setNotice(note)
    setMessages((current) => {
      const next = current.slice()
      const last = next[next.length - 1]
      if (last && last.role === 'assistant' && !last.content.trim()) next.pop()
      next.push({ role: 'error', content: note, retryText: text, at: new Date().toISOString() })
      return next
    })
  }

  async function stream(text: string) {
    const gen = genRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setNotice('')
    let waitMs = 2000
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (controller.signal.aborted || genRef.current !== gen) return
        const response = await fetch(api('/api/discuss/stream'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ cardId, sessionId, message: text }),
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
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() || ''
          for (const block of blocks) applySse(block, append, replace, () => {})
        }
        if (buffer.trim()) applySse(buffer, append, replace, () => {})
        sessionStorage.setItem(storageKey(cardId), sessionId)
        return
      }
      attachError(gen, BUSY, text)
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return
      attachError(gen, '讨论连接断了', text)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      if (genRef.current === gen) {
        busyRef.current = false
        setBusy(false)
        draftRef.current?.focus()
      }
    }
  }

  async function sendText(text: string) {
    const message = text.trim()
    if (!message || busyRef.current || !sessionId) return
    busyRef.current = true
    setBusy(true)
    stickRef.current = true
    const at = new Date().toISOString()
    setDraft('')
    setMessages((current) => [
      ...current.filter((item) => item.role !== 'error'),
      { role: 'user', content: message, at },
      { role: 'assistant', content: '', at },
    ])
    await stream(message)
  }

  async function retry(text: string) {
    const message = text.trim()
    if (!message || busyRef.current || !sessionId) return
    busyRef.current = true
    setBusy(true)
    stickRef.current = true
    setMessages((current) => [
      ...current.filter((item) => item.role !== 'error'),
      { role: 'assistant', content: '', at: new Date().toISOString() },
    ])
    await stream(message)
  }

  function stop() {
    abortRef.current?.abort()
  }

  function onDraftKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing) return
    event.preventDefault()
    void sendText(draft)
  }

  async function copyText(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAt(index)
    } catch {
      setNotice('没有复制上。再点一次「复制」。')
    }
  }

  async function adopt(index: number, text: string) {
    const cleaned = text.trim()
    if (!cleaned) return
    const next = mergeBody(cardBody, cleaned)
    setNotice('')
    try {
      await onCommitRef.current(cardId, next)
      setMessages((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, adopted: true } : item)))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setNotice(message || '正文没有写上。再点一次「采纳进本念头」。')
    }
  }

  const selected = sessions.some((item) => item.sessionId === sessionId) ? sessionId : ''

  return (
    <section className="discuss-popover" data-discuss-popover="" role="dialog" aria-label="念头讨论">
      <div className="discuss-history">
        <label>
          历史讨论
          <select
            aria-label="历史讨论"
            value={selected}
            disabled={busy || sessions.length === 0}
            onChange={(event) => void openSession(event.target.value)}
          >
            {sessions.map((item) => (
              <option key={item.sessionId} value={item.sessionId}>
                {sessionLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void createSession()}>
          新建讨论
        </button>
        <button type="button" onClick={() => requestClose()}>
          关闭
        </button>
      </div>
      <div className="discuss-chat" aria-label="讨论记录" ref={chatRef} onScroll={onChatScroll}>
        {messages.map((item, index) => {
          const time = clock(item.at)
          if (item.role === 'error') {
            return (
              <div key={`error-${index}`} className="bubble-row error" data-role="error">
                <span className="avatar">!</span>
                <div className="bubble">
                  <p className="plain">{item.content}</p>
                  {item.retryText ? (
                    <div className="bubble-actions shown">
                      <button type="button" onClick={() => void retry(item.retryText || '')}>
                        重试
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          }
          const mine = item.role === 'user'
          return (
            <div key={`${item.role}-${index}`} className={`bubble-row ${item.role}`} data-role={item.role}>
              <span className="avatar">{mine ? '我' : 'AI'}</span>
              <div className="bubble">
                <div className="bubble-meta">
                  <span className="who">{mine ? '我' : 'AI'}</span>
                  {time ? (
                    <time className="stamp" dateTime={item.at} title={time.full}>
                      <span className="stamp-short">{time.short}</span>
                      <span className="stamp-full">{time.full}</span>
                    </time>
                  ) : null}
                </div>
                {mine ? (
                  <p className="plain">{item.content}</p>
                ) : item.content ? (
                  <MarkdownText text={item.content} />
                ) : busy ? (
                  <p className="pending">正在回复</p>
                ) : (
                  <p className="plain" />
                )}
                {item.role === 'assistant' && item.adopted ? <p className="adopted-mark">已采纳</p> : null}
                {item.role === 'assistant' && item.content.trim() ? (
                  <div className="bubble-actions">
                    <button type="button" onClick={() => void adopt(index, item.content)}>
                      采纳进本念头
                    </button>
                    <button type="button" onClick={() => void copyText(item.content, index)}>
                      {copiedAt === index ? '已复制' : '复制'}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
        {pendingNew ? (
          <button type="button" className="jump-latest" onClick={jumpLatest}>
            有新消息
          </button>
        ) : null}
      </div>
      <div className="discuss-compose">
        <p className="compose-hint">Enter 发送，Shift+Enter 换行</p>
        <textarea
          ref={draftRef}
          aria-label="讨论内容"
          value={draft}
          readOnly={busy}
          rows={3}
          placeholder="接着这张念头写一句"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onDraftKey}
        />
        <div className="discuss-compose-bar">
          {busy ? (
            <button type="button" onClick={stop}>
              停止
            </button>
          ) : (
            <button type="button" disabled={draft.trim().length === 0 || !sessionId} onClick={() => void sendText(draft)}>
              发送
            </button>
          )}
          {busy ? <span className="spinner" role="status" aria-label="发送中" /> : null}
        </div>
      </div>
      {notice ? (
        <p className="status-line" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  )
}
