import { useEffect, useState } from 'react'

function api(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${path}`
}

const SESSION_KEY = 'snowflake-discuss-session'
const BUSY = '讨论忙，网关同时最多 10 路，正在等空位再试。'

function applySse(block: string, append: (text: string) => void, onRun: (runId: string) => void) {
  for (const line of block.split('\n')) {
    if (!line.startsWith('data:')) continue
    const raw = line.slice(5).trim()
    if (!raw) continue
    try {
      const payload = JSON.parse(raw) as { delta?: string; run_id?: string }
      if (typeof payload.run_id === 'string' && payload.run_id) onRun(payload.run_id)
      if (typeof payload.delta === 'string' && payload.delta) append(payload.delta)
    } catch {
      // 不是 JSON 的 data 行仍留给下一行，不把整段连接掐掉。
    }
  }
}

export default function DiscussPanel() {
  const [sessionId, setSessionId] = useState('')
  const [draft, setDraft] = useState('')
  const [transcript, setTranscript] = useState('')
  const [notice, setNotice] = useState('')
  const [runId, setRunId] = useState('')
  const [statusText, setStatusText] = useState('')
  const [compiled, setCompiled] = useState('')
  const [timeline, setTimeline] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_KEY) || ''
    if (stored) setSessionId(stored)
    void fetch(api('/api/discuss/session'), { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { sessionId?: string; error?: string }
        if (!response.ok || !payload.sessionId) {
          setNotice(payload.error || '画布会话没有取到')
          return
        }
        sessionStorage.setItem(SESSION_KEY, payload.sessionId)
        setSessionId(payload.sessionId)
      })
      .catch(() => setNotice('画布会话没有连上'))
    void fetch(api('/api/brain/page'), { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as { compiled?: string; error?: string }
        if (!response.ok) {
          setNotice(payload.error || '脑页没有取到')
          return
        }
        if (typeof payload.compiled === 'string') setCompiled(payload.compiled)
      })
      .catch(() => setNotice('脑页没有连上'))
  }, [])

  async function send() {
    const message = draft.trim()
    if (!message || busy) return
    setBusy(true)
    setNotice('')
    setTranscript('')
    setRunId('')
    let waitMs = 2000
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch(api('/api/discuss/stream'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ message }),
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
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() || ''
          for (const block of blocks) {
            applySse(
              block,
              (text) => setTranscript((current) => current + text),
              (id) => setRunId(id),
            )
          }
        }
        setDraft('')
        return
      }
      setNotice(BUSY)
    } catch {
      setNotice('讨论连接断了')
    } finally {
      setBusy(false)
    }
  }

  async function queryStatus() {
    if (!runId) return
    const response = await fetch(api(`/api/discuss/runs/${encodeURIComponent(runId)}`), { cache: 'no-store' })
    const payload = (await response.json().catch(() => ({}))) as { status?: string; error?: string }
    setStatusText(payload.status || payload.error || `状态 ${response.status}`)
  }

  async function stopRun() {
    if (!runId) return
    const response = await fetch(api(`/api/discuss/runs/${encodeURIComponent(runId)}/stop`), { method: 'POST' })
    const payload = (await response.json().catch(() => ({}))) as { status?: string; error?: string }
    setStatusText(payload.status || payload.error || `停止 ${response.status}`)
  }

  async function writeBrain() {
    setNotice('')
    const response = await fetch(api('/api/brain/write'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ compiled, timeline: timeline.trim() }),
    })
    const payload = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean }
    if (!response.ok || !payload.ok) {
      setNotice(payload.error || '写入脑失败')
      return
    }
    setNotice('已写入脑')
    setTimeline('')
  }

  return (
    <section className="discuss-panel" aria-label="画布讨论">
      <h2>画布讨论</h2>
      <p className="status-line">会话号 {sessionId || '还没有'}</p>
      <textarea
        aria-label="讨论内容"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={3}
      />
      <div className="discuss-actions">
        <button type="button" disabled={busy || draft.trim().length === 0} onClick={() => void send()}>
          发送讨论
        </button>
        <button type="button" disabled={!runId} onClick={() => void queryStatus()}>
          查询状态
        </button>
        <button type="button" disabled={!runId} onClick={() => void stopRun()}>
          停止这一轮
        </button>
      </div>
      {statusText ? <p className="status-line">{statusText}</p> : null}
      <pre className="discuss-log">{transcript}</pre>
      <label className="fold-field">
        定稿
        <textarea
          aria-label="定稿"
          value={compiled}
          onChange={(event) => setCompiled(event.target.value)}
          rows={6}
        />
      </label>
      <label className="fold-field">
        时间线摘要
        <input
          aria-label="时间线摘要"
          value={timeline}
          onChange={(event) => setTimeline(event.target.value)}
        />
      </label>
      <button type="button" onClick={() => void writeBrain()}>
        写入脑
      </button>
      {notice ? (
        <p className="status-line" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  )
}
