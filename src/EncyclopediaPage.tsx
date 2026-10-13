import { useEffect, useRef, useState, type FormEvent } from 'react'
import MentionBacklinks from './MentionBacklinks.tsx'
import type { MentionHit } from './mentions.ts'
import { bookScopedPath } from './books.ts'
import { addEdge, createCard, type AppState, type Entity } from './document.ts'
import {
  ENTITY_TYPE_LABEL,
  bindEntitySlug,
  bindLabel,
  pullFinalized,
} from './encyclopedia.ts'
import { ideaTitle, projectingIdeas } from './person-form.ts'

function api(path: string, bookId: string | null): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${bookScopedPath(path, bookId)}`
}

type LoadedPage = { failed: true } | { failed: false; finalized: string; timeline: string }

async function loadPage(slug: string, bookId: string | null): Promise<LoadedPage> {
  const response = await fetch(api(`/api/encyclopedia/page?slug=${encodeURIComponent(slug)}`, bookId), {
    cache: 'no-store',
  })
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    finalized?: unknown
    timeline?: unknown
  }
  if (!response.ok || payload.ok !== true) return { failed: true }
  return {
    failed: false,
    finalized: typeof payload.finalized === 'string' ? payload.finalized : '',
    timeline: typeof payload.timeline === 'string' ? payload.timeline : '',
  }
}

function ideaOptionTitle(state: AppState, id: string): string {
  if (!state.snowflake.cards[id]) return '新卡片'
  return ideaTitle(state, id)
}

function EntityDetail({
  state,
  entity,
  canEdit,
  bookId,
  onApply,
}: {
  state: AppState
  entity: Entity
  canEdit: boolean
  bookId: string | null
  onApply: (recipe: (state: AppState) => AppState) => void | Promise<void>
}) {
  const slug = entity.slug?.trim() ?? ''
  const [readySlug, setReadySlug] = useState(slug)
  const [draft, setDraft] = useState('')
  const [bindError, setBindError] = useState('')
  const [pageText, setPageText] = useState<LoadedPage | null>(null)
  const [promoteError, setPromoteError] = useState('')
  const [pullError, setPullError] = useState('')
  const [ideaId, setIdeaId] = useState('')
  const [pending, setPending] = useState(false)
  const requestRef = useRef<string | null>(null)
  const alive = useRef(true)
  const binding = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (binding.current) return
    setReadySlug(slug)
  }, [slug])

  useEffect(() => {
    if (!readySlug) {
      setPageText(null)
      return
    }
    let cancelled = false
    setPageText(null)
    void loadPage(readySlug, bookId).then((loaded) => {
      if (!cancelled) setPageText(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [readySlug, bookId])

  async function confirmBind(event: FormEvent) {
    event.preventDefault()
    if (!canEdit) return
    const next = draft.trim()
    if (!next) {
      setBindError('页名是空的，没有绑定')
      return
    }
    setBindError('')
    binding.current = true
    try {
      await onApply((current) => bindEntitySlug(current, entity.id, next))
      if (alive.current) setReadySlug(next)
    } finally {
      binding.current = false
    }
  }

  async function promote() {
    if (!canEdit || pending) return
    const requestId = requestRef.current ?? crypto.randomUUID()
    requestRef.current = requestId
    setPending(true)
    setPromoteError('')
    try {
      const response = await fetch(api('/api/encyclopedia/promote', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ entityId: entity.id, requestId }),
      })
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: unknown }
      if (!alive.current) return
      if (!response.ok || payload.ok !== true) {
        const message = typeof payload.error === 'string' && payload.error ? payload.error : '升格没有写上'
        setPromoteError(message)
        return
      }
      requestRef.current = null
      const loaded = await loadPage(readySlug, bookId)
      if (alive.current) setPageText(loaded)
    } catch (error) {
      if (!alive.current) return
      setPromoteError(error instanceof Error && error.message ? error.message : '升格没有写上')
    } finally {
      if (alive.current) setPending(false)
    }
  }

  function createIdea() {
    if (!canEdit) return
    const id = crypto.randomUUID()
    setIdeaId(id)
    setPullError('')
    void onApply((current) => {
      if (current.snowflake.cards[id]) return current
      const withCard = createCard(current, {
        id,
        layer: 'situation',
        x: 40,
        y: 40,
        body: entity.name.trim() || '卡片',
      })
      if (withCard === current) return current
      return addEdge(withCard, id, entity.id, 'projects-onto')
    })
  }

  function pull() {
    if (!canEdit) return
    if (!ideaId.trim()) {
      setPullError('没有卡片不能保存')
      return
    }
    if (!pageText || pageText.failed) {
      setPullError('还没有定稿')
      return
    }
    const text = pageText.finalized.trim()
    if (!text) {
      setPullError('定稿是空的，没有写回卡片')
      return
    }
    const requestId = crypto.randomUUID()
    const at = new Date().toISOString()
    const preview = pullFinalized(state, { entityId: entity.id, ideaId, text, requestId, at })
    if (!preview.saved) {
      setPullError('没有写回卡片')
      return
    }
    setPullError('')
    void onApply((current) => {
      const again = pullFinalized(current, { entityId: entity.id, ideaId, text, requestId, at })
      return again.saved ? again.state : current
    })
  }

  if (!readySlug) {
    return (
      <form className="encyclopedia-detail" onSubmit={(event) => void confirmBind(event)}>
        <label>
          页名
          <input
            aria-label="页名"
            value={draft}
            placeholder="world/ned-stark"
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button type="submit" disabled={!canEdit}>
          确认
        </button>
        {bindError ? (
          <p className="status-line is-error" role="alert">
            {bindError}
          </p>
        ) : null}
      </form>
    )
  }

  const ideas = projectingIdeas(state, entity.id)
  const options =
    ideaId && !ideas.some((item) => item.id === ideaId)
      ? [...ideas, { id: ideaId, title: ideaOptionTitle(state, ideaId) }]
      : ideas
  const finalized = !pageText ? '' : pageText.failed ? '还没有定稿' : pageText.finalized
  const timeline = pageText && !pageText.failed ? pageText.timeline : ''

  return (
    <div className="encyclopedia-detail">
      <h3>定稿</h3>
      <p className="encyclopedia-text">{finalized}</p>
      {promoteError ? (
        <p className="status-line is-error" role="alert">
          {promoteError}
        </p>
      ) : null}
      <div className="encyclopedia-actions">
        <button type="button" disabled={!canEdit || pending} onClick={() => void promote()}>
          把卡片写入定稿
        </button>
        <label>
          卡片
          <select aria-label="卡片" value={ideaId} onChange={(event) => setIdeaId(event.target.value)}>
            <option value="">选一条已有卡片</option>
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!canEdit} onClick={createIdea}>
          新建一条卡片
        </button>
        <button type="button" disabled={!canEdit} onClick={pull}>
          用定稿覆盖卡片正文
        </button>
      </div>
      {pullError ? (
        <p className="status-line is-error" role="alert">
          {pullError}
        </p>
      ) : null}
      <h3>时间线</h3>
      <p className="encyclopedia-text">{timeline}</p>
    </div>
  )
}

export default function EncyclopediaPage({
  state,
  canEdit,
  bookId,
  focusId = null,
  onApply,
  onOpenMention,
}: {
  state: AppState
  canEdit: boolean
  bookId: string | null
  focusId?: string | null
  onApply: (recipe: (state: AppState) => AppState) => void | Promise<void>
  onOpenMention?: (hit: MentionHit) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(focusId)
  const entities = (state.entities ?? []).filter((entity) => entity.entityType in ENTITY_TYPE_LABEL)

  useEffect(() => {
    if (focusId) setSelectedId(focusId)
  }, [focusId])

  useEffect(() => {
    if (!focusId) return
    const node = document.getElementById(`encyclopedia-entity-${focusId}`)
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
  }, [focusId])

  return (
    <section className="encyclopedia-page" aria-label="百科">
      <h2>百科</h2>
      {entities.length === 0 ? (
        <p className="hint">这本书还没有实体。</p>
      ) : (
        <>
          <div className="encyclopedia-head">
            <span>名字</span>
            <span>类型</span>
            <span>绑定</span>
          </div>
          <ul className="encyclopedia-list">
            {entities.map((entity) => {
              const selected = selectedId === entity.id
              return (
                <li key={entity.id} id={`encyclopedia-entity-${entity.id}`} className="encyclopedia-item">
                  <button
                    type="button"
                    className="encyclopedia-row page-table-row"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => setSelectedId(entity.id)}
                  >
                    <span>{entity.name.trim() || '未命名'}</span>
                    <span>{ENTITY_TYPE_LABEL[entity.entityType]}</span>
                    <span>{bindLabel(entity.slug)}</span>
                  </button>
                  {onOpenMention ? (
                    <MentionBacklinks state={state} kind="entity" id={entity.id} onOpen={onOpenMention} />
                  ) : null}
                  {selected ? (
                    <EntityDetail
                      state={state}
                      entity={entity}
                      canEdit={canEdit}
                      bookId={bookId}
                      onApply={onApply}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
