import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import DataTable, { type DataColumn } from './DataTable.tsx'
import MentionBacklinks, { MentionCountBadge } from './MentionBacklinks.tsx'
import type { MentionHit } from './mentions.ts'
import { parseBindFilter, parseGradeFilter, personRowVisible, type BindFilter, type GradeFilter } from './table-view.ts'
import { bindLabel } from './encyclopedia.ts'
import {
  ARC_KEYS,
  RENWUGUSHI_KEYS,
  createCard,
  type AppState,
  type Entity,
} from './document.ts'
import {
  NARRATIVE_FIELD_KEYS,
  NARRATIVE_HINTS,
  actionLabel,
  commitPersonField,
  archiveGroupTitles,
  eventsForEntity,
  fieldEvents,
  discussPrompt,
  fieldLabel,
  gradeVisibility,
  PERSON_GRADE_COLUMNS,
  groupEventsByIdea,
  ideaOptions,
  ideaTitle,
  mergePendingEntity,
  projectingIdeas,
  readPersonField,
  setPersonGrade,
  traceEvents,
  traceField,
  type GradeVisibility,
} from './person-form.ts'
import { browserViewStore, openRowRecord, readChoice, readIdList, writeChoice, writeIdList } from './view-memory.ts'

type OpenIdea = (cardId: string, sessionId?: string, adoptionKey?: string, draft?: string) => void

export type CastFocus = { entityId: string; fieldKey: string } | null

const REFRESH_NOTE = '展开的行记在这台浏览器里，只跟这一本走。刷新后仍展开。'

export default function CastPage({
  state,
  canEdit,
  onApply,
  onOpenIdea,
  focus = null,
  onPlaceOnCanvas,
  onOpenMention,
  bookId = null,
  initialView,
}: {
  state: AppState
  canEdit: boolean
  onApply: (recipe: (state: AppState) => AppState) => void
  onOpenIdea: OpenIdea
  focus?: CastFocus
  onPlaceOnCanvas?: (entityId: string) => void
  onOpenMention?: (hit: MentionHit) => void
  bookId?: string | null
  initialView?: 'table' | 'board'
}) {
  const storageId = bookId ?? 'none'
  const [view, setView] = useState<'table' | 'board'>(
    () => initialView ?? readChoice(browserViewStore(), storageId, 'cast', ['table', 'board'] as const, 'table'),
  )
  const [openRows, setOpenRows] = useState<Record<string, true>>(() =>
    openRowRecord(readIdList(browserViewStore(), storageId, 'cast-open'), focus?.entityId),
  )
  const [mergeNote, setMergeNote] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(focus?.entityId ?? null)
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>('')
  const [bindFilter, setBindFilter] = useState<BindFilter>('')
  useEffect(() => {
    if (focus?.entityId) setSelectedId(focus.entityId)
  }, [focus?.entityId])
  useEffect(() => {
    if (initialView) return
    const store = browserViewStore()
    setView(readChoice(store, storageId, 'cast', ['table', 'board'] as const, 'table'))
    const record = openRowRecord(readIdList(store, storageId, 'cast-open'), focus?.entityId)
    setOpenRows(record)
    if (focus?.entityId && !readIdList(store, storageId, 'cast-open').includes(focus.entityId)) {
      writeIdList(store, storageId, 'cast-open', Object.keys(record))
    }
  }, [storageId, focus?.entityId, initialView])
  useEffect(() => {
    setGradeFilter('')
    setBindFilter('')
  }, [storageId])
  const people = (state.entities ?? []).filter((entity) => entity.entityType === 'person')
  const pending = state.pendingEntities ?? []
  const castColumns: DataColumn<Entity>[] = [
    {
      id: 'name',
      label: '名字',
      sortable: true,
      search: true,
      defaultWidth: 180,
      text: (entity) => readPersonField(state, entity, 'name') || entity.name || '未命名',
      render: (entity) => {
        const name = readPersonField(state, entity, 'name') || entity.name || '未命名'
        return (
          <>
            <div>
              {name}
              <MentionCountBadge state={state} kind="entity" id={entity.id} />
            </div>
            {onOpenMention ? <MentionBacklinks state={state} kind="entity" id={entity.id} onOpen={onOpenMention} /> : null}
          </>
        )
      },
    },
    {
      id: 'grade',
      label: '类别',
      sortable: false,
      search: true,
      defaultWidth: 96,
      text: (entity) => gradeVisibility(readPersonField(state, entity, 'grade')).level,
      render: (entity) => gradeVisibility(readPersonField(state, entity, 'grade')).level,
    },
    {
      id: 'sentence',
      label: '一句',
      sortable: true,
      search: true,
      defaultWidth: 240,
      text: (entity) => readPersonField(state, entity, 'sentence'),
      render: (entity) => readPersonField(state, entity, 'sentence'),
    },
    {
      id: 'bind',
      label: '百科',
      sortable: false,
      search: false,
      defaultWidth: 160,
      text: (entity) => bindLabel(entity.slug),
      render: (entity) => bindLabel(entity.slug),
    },
  ]
  const tablePeople = people.filter((entity) =>
    personRowVisible(
      gradeVisibility(readPersonField(state, entity, 'grade')).level,
      Boolean(entity.slug?.trim()),
      gradeFilter,
      bindFilter,
    ),
  )


  const chooseView = (next: 'table' | 'board') => {
    setView(next)
    writeChoice(browserViewStore(), storageId, 'cast', next)
  }

  const selectRow = (entityId: string, summaryOnly: boolean) => {
    setSelectedId(entityId)
    if (summaryOnly) return
    setOpenRows((current) => {
      if (current[entityId]) return current
      const next: Record<string, true> = { ...current, [entityId]: true }
      writeIdList(browserViewStore(), storageId, 'cast-open', Object.keys(next))
      return next
    })
  }

  const toggleRow = (entityId: string) => {
    setOpenRows((current) => {
      const next = { ...current }
      if (next[entityId]) delete next[entityId]
      else next[entityId] = true
      writeIdList(browserViewStore(), storageId, 'cast-open', Object.keys(next))
      return next
    })
  }

  return (
    <section className="cast-page" aria-label="人物">
      <header className="cast-head">
        <h2>人物</h2>
        <div className="view-switch" role="tablist" aria-label="人物视图">
          <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : undefined} onClick={() => chooseView('table')}>
            表
          </button>
          <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : undefined} onClick={() => chooseView('board')}>
            看板
          </button>
        </div>
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
      {view === 'board' ? (
        <div className="cast-board" aria-label="人物看板">
          {PERSON_GRADE_COLUMNS.map((column) => (
            <section
              key={column}
              className="board-col"
              aria-label={column}
              onDragOver={(event) => {
                if (!canEdit) return
                event.preventDefault()
              }}
              onDrop={(event) => {
                if (!canEdit) return
                const raw = event.dataTransfer.getData('text/plain')
                if (!raw.startsWith('person:')) return
                event.preventDefault()
                const entityId = raw.slice('person:'.length)
                onApply((current) => setPersonGrade(current, entityId, column))
              }}
            >
              <h3>{column}</h3>
              {people
                .filter((entity) => gradeVisibility(readPersonField(state, entity, 'grade')).level === column)
                .map((entity) => {
                  const name = readPersonField(state, entity, 'name') || entity.name || '未命名'
                  const sentence = readPersonField(state, entity, 'sentence')
                  return (
                    <article
                      key={entity.id}
                      className="board-card"
                      draggable={canEdit}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/plain', `person:${entity.id}`)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                    >
                      <strong>{name}</strong>
                      <MentionCountBadge state={state} kind="entity" id={entity.id} />
                      {onOpenMention ? (
                        <MentionBacklinks state={state} kind="entity" id={entity.id} onOpen={onOpenMention} />
                      ) : null}
                      <p>{sentence}</p>
                    </article>
                  )
                })}
            </section>
          ))}
        </div>
      ) : people.length === 0 ? (
        <p className="hint">这本书还没有人物实体。人物表上写下名字之后，会在这里出现一行。</p>
      ) : (
        <DataTable
          bookId={storageId}
          slot="cast-columns"
          tableClass="cast-table data-table"
          columns={castColumns}
          rows={tablePeople}
          rowKey={(entity) => entity.id}
          emptyText="没有符合的人物"
          trailingWidth={180}
          filters={
            <>
              <label>
                类别
                <select aria-label="按类别筛选" value={gradeFilter} onChange={(event) => setGradeFilter(parseGradeFilter(event.currentTarget.value))}>
                  <option value="">全部</option>
                  {PERSON_GRADE_COLUMNS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                百科
                <select aria-label="按百科绑定筛选" value={bindFilter} onChange={(event) => setBindFilter(parseBindFilter(event.currentTarget.value))}>
                  <option value="">全部</option>
                  <option value="bound">已绑定</option>
                  <option value="unbound">未绑定</option>
                </select>
              </label>
            </>
          }
          renderRow={(entity, visible, colSpan) => (
            <PersonRow
              state={state}
              entity={entity}
              columns={visible}
              colSpan={colSpan}
              visibility={gradeVisibility(readPersonField(state, entity, 'grade'))}
              open={openRows[entity.id] === true && !gradeVisibility(readPersonField(state, entity, 'grade')).summaryOnly}
              selected={selectedId === entity.id}
              canEdit={canEdit}
              onSelect={() => selectRow(entity.id, gradeVisibility(readPersonField(state, entity, 'grade')).summaryOnly)}
              onToggle={() => {
                if (gradeVisibility(readPersonField(state, entity, 'grade')).summaryOnly) return
                toggleRow(entity.id)
              }}
              onApply={onApply}
              onOpenIdea={onOpenIdea}
              focusFieldKey={focus?.entityId === entity.id ? focus.fieldKey : null}
              onPlaceOnCanvas={onPlaceOnCanvas}
            />
          )}
        />
      )}
    </section>
  )
}

function PersonRow({
  state,
  entity,
  columns,
  colSpan,
  visibility,
  open,
  selected,
  canEdit,
  onSelect,
  onToggle,
  onApply,
  onOpenIdea,
  focusFieldKey = null,
  onPlaceOnCanvas,
}: {
  state: AppState
  entity: Entity
  columns: readonly DataColumn<Entity>[]
  colSpan: number
  visibility: GradeVisibility
  open: boolean
  selected: boolean
  canEdit: boolean
  onSelect: () => void
  onToggle: () => void
  onApply: (recipe: (state: AppState) => AppState) => void
  onOpenIdea: OpenIdea
  focusFieldKey?: string | null
  onPlaceOnCanvas?: (entityId: string) => void
}) {
  return (
    <>
      <tr
        className={selected ? 'cast-summary page-table-row is-selected' : 'cast-summary page-table-row'}
        onClick={() => onSelect()}
      >
        {columns.map((column) => (
          <td key={column.id}>{column.render(entity)}</td>
        ))}
        <td>
          <div className="row-actions">
            <button
              type="button"
              className="row-handle"
              draggable={canEdit}
              aria-label="拖动这一行"
              disabled={!canEdit}
              onClick={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.stopPropagation()
                event.dataTransfer.setData('text/plain', `place-entity:${entity.id}`)
                event.dataTransfer.effectAllowed = 'copy'
              }}
            >
              ⋮⋮
            </button>
            <button
              type="button"
              disabled={!canEdit}
              onClick={(event) => {
                event.stopPropagation()
                onPlaceOnCanvas?.(entity.id)
              }}
            >
              放到画布
            </button>
            {visibility.summaryOnly ? null : (
              <button
                type="button"
                aria-expanded={open}
                onClick={(event) => {
                  event.stopPropagation()
                  if (open) onToggle()
                  else onSelect()
                }}
              >
                {open ? '收起' : '展开'}
              </button>
            )}
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="cast-detail">
          <td colSpan={colSpan}>
            <PersonZones
              state={state}
              entity={entity}
              cardId={entity.views.renwubiao ?? entity.views.renwugushi ?? entity.views.renwudangan ?? null}
              canEdit={canEdit}
              onApply={onApply}
              onOpenIdea={onOpenIdea}
              focusFieldKey={focusFieldKey}
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
  focusFieldKey = null,
}: {
  state: AppState
  entity: Entity
  cardId: string | null
  canEdit: boolean
  onApply: (recipe: (state: AppState) => AppState) => void
  onOpenIdea: OpenIdea
  focusFieldKey?: string | null
}) {
  const [ideaId, setIdeaId] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const grade = readPersonField(state, entity, 'grade')
  const visibility = gradeVisibility(grade)
  const ideas = ideaOptions(state)
  const projections = projectingIdeas(state, entity.id)
  const ledger = groupEventsByIdea(eventsForEntity(state, entity.id))

  const save = (fieldKey: string, text: string): boolean => {
    if (!canEdit) {
      setNotice('现在不能改。')
      return false
    }
    const requestId = crypto.randomUUID()
    const at = new Date().toISOString()
    const input = {
      cardId,
      entityId: entity.id,
      fieldKey,
      text,
      ideaId,
      requestId,
      at,
    }
    const next = commitPersonField(state, input)
    if (next === state) {
      setNotice(fieldKey === 'name' && !text.trim() ? '没有保存。先写上名字。' : '没有保存。')
      return false
    }
    setNotice('')
    onApply((current) => commitPersonField(current, input))
    return true
  }

  const createIdea = () => {
    if (!canEdit) return
    const id = `n-${crypto.randomUUID()}`
    const shift = state.canvas.nodes.length * 28
    const next = createCard(state, { id, layer: 'situation', x: 80 + shift, y: 80 + shift, body: '' })
    if (next === state) {
      setNotice('新卡片没有建成')
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
        归入卡片/视图（可选）
        <select aria-label="归入卡片/视图（可选）" value={ideaId} onChange={(event) => setIdeaId(event.target.value)}>
          <option value="">不归入</option>
          {ideas.map((idea) => (
            <option key={idea.id} value={idea.id}>
              {idea.title}
            </option>
          ))}
        </select>
        <button type="button" disabled={!canEdit} onClick={createIdea}>
          新建一条卡片
        </button>
      </label>
      {notice ? (
        <p className="cast-warn" role="status">
          {notice}
        </p>
      ) : null}

      <section className="person-zone" aria-label="身份">
        <h3>身份</h3>
        <FieldLine state={state} entity={entity} fieldKey="name" canEdit={canEdit} onSave={save} onOpenIdea={onOpenIdea} focusFieldKey={focusFieldKey} projections={projections} />
        {visibility.summaryOnly ? null : (
          <FieldLine state={state} entity={entity} fieldKey="role" canEdit={canEdit} onSave={save} onOpenIdea={onOpenIdea} focusFieldKey={focusFieldKey} projections={projections} />
        )}
        <div className="person-field">
          <span>类别</span>
          <GradeGhost value={grade} canEdit={canEdit} onCommit={(text) => save('grade', text)} />
        </div>
        <p className="hint">类别决定这一行露出多少：主要露出叙事功能和弧线，次要露出叙事功能，NPC 只露名字、角色和一句，路人只有这一行摘要。</p>
      </section>

      {!visibility.narrative ? (
        <FieldLine state={state} entity={entity} fieldKey="sentence" hint={NARRATIVE_HINTS.sentence} canEdit={canEdit} onSave={save} onOpenIdea={onOpenIdea} focusFieldKey={focusFieldKey} projections={projections} />
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
              canEdit={canEdit}
              onSave={save}
              onOpenIdea={onOpenIdea}
              focusFieldKey={focusFieldKey}
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
                  canEdit={canEdit}
                  onSave={save}
                  onOpenIdea={onOpenIdea}
                  focusFieldKey={focusFieldKey}
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
                        canEdit={canEdit}
                        onSave={save}
                        onOpenIdea={onOpenIdea}
                        focusFieldKey={focusFieldKey}
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
              canEdit={canEdit}
              onSave={save}
              onOpenIdea={onOpenIdea}
              focusFieldKey={focusFieldKey}
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
                      <button type="button" onClick={() => onOpenIdea(event.ideaId, event.sessionId, event.adoptionKey)}>
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

export function finishGhostEdit(baseline: string, text: string, commit: (text: string) => boolean): string {
  if (text.trim() === baseline.trim()) return baseline
  return commit(text) ? text : baseline
}

function readGhostText(node: HTMLElement | null, multiline: boolean): string {
  if (!node) return ''
  const raw = node.innerText.replace(/\u00a0/g, ' ')
  if (!multiline) return raw.replace(/\r?\n/g, '')
  return raw.replace(/\n$/, '')
}

function GhostField({
  label,
  value,
  multiline,
  canEdit,
  onCommit,
}: {
  label: string
  value: string
  multiline: boolean
  canEdit: boolean
  onCommit: (text: string) => boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const editing = useRef(false)
  const baseline = useRef(value)
  const pending = useRef<string | null>(null)
  const [live, setLive] = useState(false)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node || editing.current) return
    if (pending.current !== null) {
      if (value === pending.current) pending.current = null
      else return
    }
    if ((node.textContent ?? '') !== value) node.textContent = value
  }, [value])

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label={label}
      aria-multiline={multiline || undefined}
      aria-readonly={canEdit ? undefined : true}
      className={live ? 'person-ghost is-editing' : 'person-ghost'}
      contentEditable={canEdit}
      spellCheck={false}
      data-placeholder="未填写"
      suppressContentEditableWarning
      onFocus={() => {
        baseline.current = value
        editing.current = true
        setLive(true)
      }}
      onBlur={() => {
        if (!editing.current) return
        const node = ref.current
        const text = readGhostText(node, multiline)
        editing.current = false
        setLive(false)
        const next = finishGhostEdit(baseline.current, text, onCommit)
        if (next !== baseline.current) pending.current = next
        if (node) node.textContent = next
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.key === 'Process') return
        if (event.key === 'Escape') {
          event.preventDefault()
          const node = ref.current
          editing.current = false
          setLive(false)
          pending.current = null
          if (node) node.textContent = baseline.current
          node?.blur()
          return
        }
        if (event.key !== 'Enter') return
        if (multiline && !(event.metaKey || event.ctrlKey)) return
        event.preventDefault()
        ref.current?.blur()
      }}
    />
  )
}

function GradeGhost({
  value,
  canEdit,
  onCommit,
}: {
  value: string
  canEdit: boolean
  onCommit: (text: string) => boolean
}) {
  const [open, setOpen] = useState(false)
  const level = gradeVisibility(value).level
  if (!open) {
    return (
      <button type="button" className="person-ghost" aria-label="类别" disabled={!canEdit} onClick={() => setOpen(true)}>
        {level}
      </button>
    )
  }
  return (
    <select
      className="person-grade"
      aria-label="类别"
      autoFocus
      value={level}
      onChange={(event) => {
        const next = event.target.value
        if (next !== level) onCommit(next)
        setOpen(false)
      }}
      onBlur={() => {
        window.setTimeout(() => setOpen(false), 150)
      }}
    >
      {PERSON_GRADE_COLUMNS.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
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
  focusFieldKey = null,
  projections,
}: {
  state: AppState
  entity: Entity
  fieldKey: string
  hint?: string
  canEdit: boolean
  onSave: (fieldKey: string, text: string) => boolean
  onOpenIdea: OpenIdea
  focusFieldKey?: string | null
  projections: { id: string; title: string }[]
}) {
  const value = readPersonField(state, entity, fieldKey)
  const [openTrace, setOpenTrace] = useState(false)
  const hits = traceField(state, entity.id, fieldKey)
  const count = traceEvents(fieldEvents(state, entity.id, fieldKey)).length
  const showDiscuss = fieldKey !== 'philosophy' && !value.trim() && projections.length > 0
  const focused = focusFieldKey === fieldKey
  const multiline = fieldKey === 'story' || fieldKey === 'paragraph'
  return (
    <div className={focused ? 'person-field field-focus' : 'person-field'} data-field-key={fieldKey} data-field-focus={focused ? 'true' : undefined}>
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
      <GhostField
        label={fieldLabel(fieldKey)}
        value={value}
        multiline={multiline}
        canEdit={canEdit}
        onCommit={(text) => onSave(fieldKey, text)}
      />
      {showDiscuss ? (
        <button
          type="button"
          onClick={() => {
            const idea = projections[0]
            if (idea) onOpenIdea(idea.id, undefined, undefined, discussPrompt(fieldKey))
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
                <button type="button" onClick={() => onOpenIdea(hit.ideaId, hit.sessionId, hit.adoptionKey)}>
                  ↗
                </button>
              ) : (
                <button type="button" onClick={() => onOpenIdea(hit.ideaId)}>
                  打开卡片
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
