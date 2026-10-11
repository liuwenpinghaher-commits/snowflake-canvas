import { useState } from 'react'
import {
  ARC_KEYS,
  RENWUGUSHI_KEYS,
  choiceFields,
  createCard,
  type AppState,
  type Entity,
} from './document.ts'
import {
  NARRATIVE_FIELD_KEYS,
  NARRATIVE_HINTS,
  actionLabel,
  applyManualField,
  archiveGroupTitles,
  eventsForEntity,
  fieldEvents,
  fieldLabel,
  gradeVisibility,
  groupEventsByIdea,
  ideaOptions,
  ideaTitle,
  mergePendingEntity,
  projectingIdeas,
  readPersonField,
  traceEvents,
  traceField,
  type GradeVisibility,
} from './person-form.ts'

const REFRESH_NOTE = '各行的展开只留在这一页的内存里。刷新后全部收起。'

export default function CastPage({
  state,
  canEdit,
  onApply,
  onOpenIdea,
}: {
  state: AppState
  canEdit: boolean
  onApply: (recipe: (state: AppState) => AppState) => void
  onOpenIdea: (cardId: string, sessionId?: string) => void
}) {
  const [openRows, setOpenRows] = useState<Record<string, true>>({})
  const [mergeNote, setMergeNote] = useState('')
  const people = (state.entities ?? []).filter((entity) => entity.entityType === 'person')
  const pending = state.pendingEntities ?? []

  return (
    <section className="cast-page" aria-label="人物">
      <header className="cast-head">
        <h2>人物</h2>
        <p className="hint">{REFRESH_NOTE}</p>
      </header>
      {pending.length > 0 ? (
        <div className="cast-pending">
          <p>待确认的人物</p>
          {pending.map((item) => (
            <div key={item.name} className="cast-pending-row">
              <span>
                {item.name} · {item.cardIds.length} 张卡
              </span>
              {item.cardIds.length >= 2 ? (
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => {
                    const result = mergePendingEntity(state, item.name)
                    if (!result.attached) {
                      setMergeNote('合并还没接上')
                      return
                    }
                    setMergeNote('')
                    onApply((current) => {
                      const again = mergePendingEntity(current, item.name)
                      return again.attached ? again.state : current
                    })
                  }}
                >
                  合并为一个实体？
                </button>
              ) : null}
            </div>
          ))}
          {mergeNote ? (
            <p className="cast-warn" role="status">
              {mergeNote}
            </p>
          ) : null}
        </div>
      ) : null}
      {people.length === 0 ? (
        <p className="hint">这本书还没有人物实体。人物表上写下名字之后，会在这里出现一行。</p>
      ) : (
        <table className="cast-table">
          <thead>
            <tr>
              <th>名字</th>
              <th>类别</th>
              <th>一句</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {people.map((entity) => {
              const visibility = gradeVisibility(readPersonField(state, entity, 'grade'))
              const open = openRows[entity.id] === true
              return (
                <PersonRow
                  key={entity.id}
                  state={state}
                  entity={entity}
                  visibility={visibility}
                  open={open && !visibility.summaryOnly}
                  canEdit={canEdit}
                  onToggle={() => {
                    if (visibility.summaryOnly) return
                    setOpenRows((current) => {
                      if (current[entity.id]) {
                        const next = { ...current }
                        delete next[entity.id]
                        return next
                      }
                      return { ...current, [entity.id]: true }
                    })
                  }}
                  onApply={onApply}
                  onOpenIdea={onOpenIdea}
                />
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

function PersonRow({
  state,
  entity,
  visibility,
  open,
  canEdit,
  onToggle,
  onApply,
  onOpenIdea,
}: {
  state: AppState
  entity: Entity
  visibility: GradeVisibility
  open: boolean
  canEdit: boolean
  onToggle: () => void
  onApply: (recipe: (state: AppState) => AppState) => void
  onOpenIdea: (cardId: string, sessionId?: string) => void
}) {
  const name = readPersonField(state, entity, 'name') || entity.name
  const sentence = readPersonField(state, entity, 'sentence')
  return (
    <>
      <tr className="cast-summary">
        <td>{name || '未命名'}</td>
        <td>{visibility.level}</td>
        <td>{sentence}</td>
        <td>
          {visibility.summaryOnly ? null : (
            <button type="button" aria-expanded={open} onClick={onToggle}>
              {open ? '收起' : '展开'}
            </button>
          )}
        </td>
      </tr>
      {open ? (
        <tr className="cast-detail">
          <td colSpan={4}>
            <PersonZones
              state={state}
              entity={entity}
              cardId={entity.views.renwubiao ?? entity.views.renwugushi ?? entity.views.renwudangan ?? null}
              canEdit={canEdit}
              onApply={onApply}
              onOpenIdea={onOpenIdea}
            />
          </td>
        </tr>
      ) : null}
    </>
  )
}

export function PersonZones({
  state,
  entity,
  cardId,
  canEdit,
  onApply,
  onOpenIdea,
}: {
  state: AppState
  entity: Entity
  cardId: string | null
  canEdit: boolean
  onApply: (recipe: (state: AppState) => AppState) => void
  onOpenIdea: (cardId: string, sessionId?: string) => void
}) {
  const [gradeDraft, setGradeDraft] = useState<string | null>(null)
  const [ideaId, setIdeaId] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const grade = gradeDraft ?? readPersonField(state, entity, 'grade')
  const visibility = gradeVisibility(grade)
  const ideas = ideaOptions(state)
  const projections = projectingIdeas(state, entity.id)
  const ledger = groupEventsByIdea(eventsForEntity(state, entity.id))

  const save = (fieldKey: string, text: string) => {
    if (!ideaId) {
      setNotice('不选念头不能保存')
      return
    }
    const requestId = crypto.randomUUID()
    const at = new Date().toISOString()
    const next = applyManualField(state, {
      cardId,
      entityId: entity.id,
      fieldKey,
      text,
      ideaId,
      requestId,
      at,
    })
    if (next === state) {
      setNotice('没有保存。先写上名字，并选一条已有念头。')
      return
    }
    setNotice('')
    onApply((current) =>
      applyManualField(current, {
        cardId,
        entityId: entity.id,
        fieldKey,
        text,
        ideaId,
        requestId,
        at,
      }),
    )
  }

  const createIdea = () => {
    if (!canEdit) return
    const id = `n-${crypto.randomUUID()}`
    const shift = state.canvas.nodes.length * 28
    const next = createCard(state, { id, layer: 'situation', x: 80 + shift, y: 80 + shift, body: '' })
    if (next === state) {
      setNotice('新念头没有建成')
      return
    }
    setIdeaId(id)
    setNotice('')
    onApply((current) => createCard(current, { id, layer: 'situation', x: 80 + shift, y: 80 + shift, body: '' }))
  }

  const narrativeKeys = NARRATIVE_FIELD_KEYS.filter((key) => {
    if (visibility.narrative) return true
    return visibility.more && moreOpen && !visibility.shown.includes(key)
  })

  return (
    <div className="person-zones">
      <label className="person-idea">
        挂到念头
        <select aria-label="挂到念头" value={ideaId} onChange={(event) => setIdeaId(event.target.value)}>
          <option value="">先选一条念头</option>
          {ideas.map((idea) => (
            <option key={idea.id} value={idea.id}>
              {idea.title}
            </option>
          ))}
        </select>
        <button type="button" disabled={!canEdit} onClick={createIdea}>
          新建一条念头
        </button>
      </label>
      {!ideaId ? <p className="hint">不选念头不能保存。</p> : null}
      {notice ? (
        <p className="cast-warn" role="status">
          {notice}
        </p>
      ) : null}

      <section className="person-zone" aria-label="身份">
        <h3>身份</h3>
        <FieldLine state={state} entity={entity} fieldKey="name" canEdit={canEdit && Boolean(ideaId)} onSave={save} onOpenIdea={onOpenIdea} projections={projections} />
        {visibility.summaryOnly ? null : (
          <FieldLine state={state} entity={entity} fieldKey="role" canEdit={canEdit && Boolean(ideaId)} onSave={save} onOpenIdea={onOpenIdea} projections={projections} />
        )}
        <label className="person-field">
          <span>类别</span>
          <select
            aria-label="类别"
            value={grade}
            disabled={!canEdit}
            onChange={(event) => {
              setGradeDraft(event.target.value)
            }}
          >
            {choiceFields('renwubiao')[0]?.options.map((option) => (
              <option key={option.value || 'empty'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={!canEdit || !ideaId} onClick={() => save('grade', grade)}>
            保存类别
          </button>
        </label>
        <p className="hint">类别决定这一行露出多少：主要露出叙事功能和弧线，次要露出叙事功能，NPC 只露名字、角色和一句，路人只有这一行摘要。</p>
      </section>

      {!visibility.narrative ? (
        <FieldLine state={state} entity={entity} fieldKey="sentence" hint={NARRATIVE_HINTS.sentence} canEdit={canEdit && Boolean(ideaId)} onSave={save} onOpenIdea={onOpenIdea} projections={projections} />
      ) : null}

      {narrativeKeys.length > 0 || visibility.arc || (visibility.more && moreOpen) ? (
        <section className="person-zone" aria-label="叙事功能">
          <h3>叙事功能</h3>
          {narrativeKeys.map((key) => (
            <FieldLine
              key={key}
              state={state}
              entity={entity}
              fieldKey={key}
              hint={NARRATIVE_HINTS[key]}
              canEdit={canEdit && Boolean(ideaId)}
              onSave={save}
              onOpenIdea={onOpenIdea}
              projections={projections}
            />
          ))}
          {visibility.arc || (visibility.more && moreOpen) ? (
            <div className="person-arc">
              <h4 title={NARRATIVE_HINTS.arc}>弧线</h4>
              <p className="hint">{NARRATIVE_HINTS.arc}</p>
              {ARC_KEYS.map((key) => (
                <FieldLine
                  key={key}
                  state={state}
                  entity={entity}
                  fieldKey={`arc.${key}`}
                  canEdit={canEdit && Boolean(ideaId)}
                  onSave={save}
                  onOpenIdea={onOpenIdea}
                  projections={projections}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {visibility.more ? (
        <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
          {moreOpen ? '收起更多' : '更多'}
        </button>
      ) : null}

      {visibility.archive || (visibility.more && moreOpen) ? (
        <section className="person-zone" aria-label="档案">
          <button type="button" aria-expanded={archiveOpen} onClick={() => setArchiveOpen((value) => !value)}>
            {archiveOpen ? '收起档案' : '档案'}
          </button>
          <p className="hint">档案默认折叠。不要编撰事无巨细的生平传记。（6W 第7章）</p>
          {archiveOpen ? (
            <div>
              {archiveGroupTitles().map((group) => (
                <div key={group.title} className="person-archive-group">
                  <h4>
                    {group.title}
                    {group.egri ? <span className="hint"> {group.egri}</span> : null}
                  </h4>
                  {group.keys.map((key) =>
                    key === 'philosophy' ? (
                      <p key={key} className="person-field">
                        <span>人生哲学</span>
                        <span>{readPersonField(state, entity, 'motivation') || '跟着动机，不单独存'}</span>
                      </p>
                    ) : (
                      <FieldLine
                        key={key}
                        state={state}
                        entity={entity}
                        fieldKey={key}
                        canEdit={canEdit && Boolean(ideaId)}
                        onSave={save}
                        onOpenIdea={onOpenIdea}
                        projections={projections}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {visibility.sample || (visibility.more && moreOpen) ? (
        <section className="person-zone" aria-label="视角样章">
          <h3>视角样章</h3>
          {RENWUGUSHI_KEYS.map((key) => (
            <FieldLine
              key={key}
              state={state}
              entity={entity}
              fieldKey={key}
              canEdit={canEdit && Boolean(ideaId)}
              onSave={save}
              onOpenIdea={onOpenIdea}
              projections={projections}
            />
          ))}
        </section>
      ) : null}

      <section className="person-zone" aria-label="沉淀账本">
        <h3>沉淀账本</h3>
        {ledger.length === 0 ? (
          <p className="hint">这条人物还没有沉淀记录。</p>
        ) : (
          ledger.map((group) => (
            <div key={group.ideaId} className="cast-ledger">
              <button type="button" onClick={() => onOpenIdea(group.ideaId)}>
                {ideaTitle(state, group.ideaId)}
              </button>
              <ul>
                {group.events.map((event) => (
                  <li key={event.id}>
                    <time dateTime={event.at}>{event.at}</time> {actionLabel(event.action)}{' '}
                    {event.status === 'failed' ? '百科没写上' : event.quote}{' '}
                    {event.sessionId ? `会话 ${event.sessionId}` : '手填'}
                    {event.sessionId && event.adoptionKey ? (
                      <button type="button" onClick={() => onOpenIdea(event.ideaId, event.sessionId)}>
                        ↗
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

function FieldLine({
  state,
  entity,
  fieldKey,
  hint,
  canEdit,
  onSave,
  onOpenIdea,
  projections,
}: {
  state: AppState
  entity: Entity
  fieldKey: string
  hint?: string
  canEdit: boolean
  onSave: (fieldKey: string, text: string) => void
  onOpenIdea: (cardId: string, sessionId?: string) => void
  projections: { id: string; title: string }[]
}) {
  const value = readPersonField(state, entity, fieldKey)
  const [draft, setDraft] = useState<string | null>(null)
  const [openTrace, setOpenTrace] = useState(false)
  const text = draft ?? value
  const hits = traceField(state, entity.id, fieldKey)
  const count = traceEvents(fieldEvents(state, entity.id, fieldKey)).length
  const showDiscuss = fieldKey !== 'philosophy' && !value.trim() && projections.length > 0
  return (
    <label className="person-field">
      <span>
        {fieldLabel(fieldKey)}
        {count > 0 ? (
          <button
            type="button"
            className="trace-badge"
            aria-label={`${fieldLabel(fieldKey)} 溯源 ${count}`}
            onClick={(event) => {
              event.preventDefault()
              setOpenTrace((current) => !current)
            }}
          >
            ⌁{count}
          </button>
        ) : null}
      </span>
      {hint ? <small className="hint">{hint}</small> : null}
      <textarea
        aria-label={fieldLabel(fieldKey)}
        value={text}
        rows={fieldKey === 'story' || fieldKey === 'paragraph' ? 4 : 2}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" disabled={!canEdit || text.trim() === value.trim()} onClick={() => onSave(fieldKey, text)}>
        保存
      </button>
      {showDiscuss ? (
        <button
          type="button"
          onClick={() => {
            const idea = projections[0]
            if (idea) onOpenIdea(idea.id)
          }}
        >
          去讨论
        </button>
      ) : null}
      {openTrace ? (
        <ul className="trace-list">
          {hits.map((hit) => (
            <li key={hit.eventId}>
              <time dateTime={hit.at}>{hit.at}</time> {actionLabel(hit.action)} {hit.label} {hit.ideaTitle}
              {hit.sessionId ? ` 会话 ${hit.sessionId}` : ''}
              {hit.sessionId && hit.adoptionKey ? (
                <button type="button" onClick={() => onOpenIdea(hit.ideaId, hit.sessionId)}>
                  ↗
                </button>
              ) : (
                <button type="button" onClick={() => onOpenIdea(hit.ideaId)}>
                  打开念头
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  )
}
