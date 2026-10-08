import { useEffect, useRef, useState } from 'react'

function api(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${path}`
}

const BUSY = '讨论忙，网关同时最多 10 路，正在等空位再试。'

type DiscussSession = {
  sessionId: string
  title: string
  createdAt: string
  cardId: string
}

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

function storageKey(cardId: string): string {
  return `snowflake-discuss-last:${cardId}`
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
  anchor,
  onClose,
  onCommitBody,
}: {
  cardId: string
  cardBody: string
  anchor: { left: number; top: number; right: number }
  onClose: () => void
  onCommitBody: (cardId: string, body: string) => Promise<void>
}) {
  const [body, setBody] = useState(cardBody)
  const [sessions, setSessions] = useState<DiscussSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const latestBody = useRef(cardBody)
  const saveTimer = useRef<number | null>(null)
  const popRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const onCommitRef = useRef(onCommitBody)
  onCloseRef.current = onClose
  onCommitRef.current = onCommitBody
  latestBody.current = body

  const place = () => {
    const width = 380
    const height = Math.min(640, window.innerHeight - 16)
    let left = anchor.right + 8
    if (left + width > window.innerWidth - 8) left = Math.max(8, anchor.left - width - 8)
    let top = anchor.top
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8)
    return { left, top, width, maxHeight: height }
  }
  const box = place()

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('[data-discuss-popover]')) return
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', onPointer, true)
    return () => document.removeEventListener('pointerdown', onPointer, true)
  }, [])

  useEffect(() => {
    setBody(cardBody)
    latestBody.current = cardBody
  }, [cardId])

  useEffect(() => {
    if (bodyRef.current && document.activeElement === bodyRef.current) return
    setBody(cardBody)
    latestBody.current = cardBody
  }, [cardBody])

  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = null
        void onCommitRef.current(cardId, latestBody.current)
      }
    }
  }, [cardId])

  async function loadMessages(nextSessionId: string) {
    const response = await fetch(
      api(`/api/discuss/messages?cardId=${encodeURIComponent(cardId)}&sessionId=${encodeURIComponent(nextSessionId)}`),
      { cache: 'no-store' },
    )
    const payload = (await response.json().catch(() => ({}))) as { messages?: ChatMessage[]; error?: string }
    if (!response.ok) {
      setNotice(payload.error || '讨论记录没有取到')
      setMessages([])
      return
    }
    setMessages(Array.isArray(payload.messages) ? payload.messages : [])
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
        setNotice(payload.error || '画布会话没有取到')
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
          setNotice(selectedPayload.error || '没有切到上次的讨论')
          await remember(payload.sessionId, list)
          return
        }
        await remember(selectedPayload.sessionId, selectedPayload.sessions || list)
        return
      }
      await remember(picked, list)
    })().catch(() => {
      if (!cancelled) setNotice('画布会话没有连上')
    })
    return () => {
      cancelled = true
    }
  }, [cardId])

  function scheduleBody(text: string) {
    latestBody.current = text
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      void onCommitRef.current(cardId, text)
    }, 400)
  }

  function flushBody() {
    if (saveTimer.current === null) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = null
    void onCommitRef.current(cardId, latestBody.current)
  }

  async function openSession(nextSessionId: string) {
    setNotice('')
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
      setNotice(payload.error || '没有打开这条讨论')
      return
    }
    await remember(payload.sessionId, payload.sessions || sessions)
  }

  async function createSession() {
    setNotice('')
    setBusy(true)
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
        setNotice(payload.error || '新讨论没有建成')
        return
      }
      await remember(payload.sessionId, payload.sessions || [])
    } catch {
      setNotice('画布会话没有连上')
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    const message = draft.trim()
    if (!message || busy || !sessionId) return
    setBusy(true)
    setNotice('')
    setDraft('')
    setMessages((current) => [...current, { role: 'user', content: message }, { role: 'assistant', content: '' }])
    let waitMs = 2000
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(api('/api/discuss/stream'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ cardId, sessionId, message }),
        })
        if (response.status === 429) {
          setNotice(BUSY)
          await new Promise((resolve) => setTimeout(resolve, waitMs))
          waitMs *= 2
          continue
        }
        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string }
          setNotice(payload.error || '讨论没有发出去')
          return
        }
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        const append = (text: string) => {
          setMessages((current) => {
            const next = current.slice()
            const last = next[next.length - 1]
            if (!last || last.role !== 'assistant') return [...next, { role: 'assistant', content: text }]
            next[next.length - 1] = { role: 'assistant', content: last.content + text }
            return next
          })
        }
        const replace = (text: string) => {
          setMessages((current) => {
            const next = current.slice()
            const last = next[next.length - 1]
            if (!last || last.role !== 'assistant') return [...next, { role: 'assistant', content: text }]
            next[next.length - 1] = { role: 'assistant', content: text }
            return next
          })
        }
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
      setNotice(BUSY)
    } catch {
      setNotice('讨论连接断了')
    } finally {
      setBusy(false)
    }
  }

  async function adopt(text: string) {
    const cleaned = text.trim()
    if (!cleaned) return
    flushBody()
    const base = latestBody.current
    const next = base.trim() ? `${base.replace(/\s+$/u, '')}\n${cleaned}` : cleaned
    setBody(next)
    latestBody.current = next
    setNotice('')
    try {
      // 只改这张卡的正文。保存走正本 PUT，带上当前 If-Match；对不上时服务器回 412，正文不动。
      await onCommitBody(cardId, next)
      setNotice('已采纳进本念头正文')
    } catch {
      setNotice('正文没有写上')
    }
  }

  return (
    <section
      ref={popRef}
      className="discuss-popover"
      data-discuss-popover=""
      role="dialog"
      aria-label="念头讨论"
      style={{ left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
    >
      <label className="fold-field">
        念头正文
        <textarea
          ref={bodyRef}
          aria-label="念头正文"
          rows={5}
          value={body}
          onChange={(event) => {
            const text = event.target.value
            setBody(text)
            scheduleBody(text)
          }}
          onBlur={() => flushBody()}
        />
      </label>
      <div className="discuss-history" aria-label="历史讨论">
        <h3>历史讨论</h3>
        <ul>
          {sessions.map((item) => (
            <li key={item.sessionId}>
              <button
                type="button"
                aria-current={item.sessionId === sessionId ? 'true' : undefined}
                onClick={() => void openSession(item.sessionId)}
              >
                {item.title || '念头讨论'}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" disabled={busy} onClick={() => void createSession()}>
          新建讨论
        </button>
      </div>
      <div className="discuss-chat" aria-label="讨论记录">
        {messages.map((item, index) => (
          <div key={`${item.role}-${index}`} className="discuss-message">
            <p className="discuss-role">{item.role === 'assistant' ? '回复' : '我'}</p>
            <pre className="discuss-log">{item.content}</pre>
            {item.role === 'assistant' && item.content.trim() ? (
              <button type="button" onClick={() => void adopt(item.content)}>
                采纳进本念头正文
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <textarea
        aria-label="讨论内容"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
      />
      <div className="discuss-actions">
        <button type="button" disabled={busy || draft.trim().length === 0 || !sessionId} onClick={() => void send()}>
          发送讨论
        </button>
      </div>
      {notice ? (
        <p className="status-line" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  )
}
