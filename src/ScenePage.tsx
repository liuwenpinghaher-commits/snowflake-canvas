import { useEffect, useState, type DragEvent } from 'react'
import DataTable, { type DataColumn } from './DataTable.tsx'
import type { AppState } from './document.ts'
import {
  applySceneBoardDrop,
  chapterColumnDroppable,
  chapterColumnLabel,
  chapterColumns,
  listScenes,
  STRUCTURE_COLUMNS,
  syncCardToNamedChapter,
  structureColumnId,
  type SceneGroup,
  type SceneRow,
} from './scene-board.ts'
import { parseChapterPresence, parseStructureFilter, sceneRowVisible, type ChapterPresenceFilter, type StructureFilter } from './table-view.ts'
import { browserViewStore, readChoice, writeChoice } from './view-memory.ts'

type SceneView = 'table' | 'board'

function structureText(row: SceneRow): string {
  if (structureColumnId(row.structureKind) === 'empty') return '未填'
  return row.structureLabel
}

export default function ScenePage({
  state,
  canEdit,
  onApply,
  onOpenCard,
  bookId = null,
  initialView,
  initialGroup,
}: {
  state: AppState
  canEdit: boolean
  onApply: (recipe: (state: AppState) => AppState) => void
  onOpenCard: (cardId: string) => void
  bookId?: string | null
  initialView?: SceneView
  initialGroup?: SceneGroup
}) {
  const storageId = bookId ?? 'none'
  const [view, setView] = useState<SceneView>(() => initialView ?? readChoice(browserViewStore(), storageId, 'scene', ['table', 'board'] as const, 'table'))
  const [group, setGroup] = useState<SceneGroup>(
    () => initialGroup ?? readChoice(browserViewStore(), storageId, 'scene-group', ['chapter', 'structure'] as const, 'chapter'),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [structureFilter, setStructureFilter] = useState<StructureFilter>('')
  const [chapterFilter, setChapterFilter] = useState<ChapterPresenceFilter>('')
  useEffect(() => {
    const store = browserViewStore()
    if (!initialView) setView(readChoice(store, storageId, 'scene', ['table', 'board'] as const, 'table'))
    if (!initialGroup) setGroup(readChoice(store, storageId, 'scene-group', ['chapter', 'structure'] as const, 'chapter'))
    setStructureFilter('')
    setChapterFilter('')
  }, [storageId, initialView, initialGroup])

  const rows = listScenes(state)
  const tableRows = rows.filter((row) =>
    sceneRowVisible(structureColumnId(row.structureKind), row.chapter, structureFilter, chapterFilter),
  )
  const columns: DataColumn<SceneRow>[] = [
    {
      id: 'title',
      label: '标题',
      sortable: true,
      search: true,
      defaultWidth: 220,
      text: (row) => row.title,
      render: (row) => row.title,
    },
    {
      id: 'chapter',
      label: '章',
      sortable: false,
      search: true,
      defaultWidth: 120,
      text: (row) => row.chapter,
      render: (row) => row.chapter,
    },
    {
      id: 'structure',
      label: '冲突结构',
      sortable: false,
      search: true,
      defaultWidth: 120,
      text: (row) => structureText(row),
      render: (row) => structureText(row),
    },
    {
      id: 'task',
      label: '本场任务',
      sortable: true,
      search: true,
      defaultWidth: 280,
      text: (row) => row.task,
      render: (row) => row.task,
    },
  ]

  const chooseView = (next: SceneView) => {
    setView(next)
    writeChoice(browserViewStore(), storageId, 'scene', next)
  }

  const chooseGroup = (next: SceneGroup) => {
    setGroup(next)
    writeChoice(browserViewStore(), storageId, 'scene-group', next)
  }

  return (
    <section className="scene-page" aria-label="场次">
      <header className="scene-head">
        <h2>场次</h2>
        <div className="view-switch" role="tablist" aria-label="场次视图">
          <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'on' : undefined} onClick={() => chooseView('table')}>
            表
          </button>
          <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : undefined} onClick={() => chooseView('board')}>
            看板
          </button>
        </div>
        {view === 'board' ? (
          <div className="view-switch" role="tablist" aria-label="场次分组">
            <button type="button" role="tab" aria-selected={group === 'chapter'} className={group === 'chapter' ? 'on' : undefined} onClick={() => chooseGroup('chapter')}>
              按章
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={group === 'structure'}
              className={group === 'structure' ? 'on' : undefined}
              onClick={() => chooseGroup('structure')}
            >
              按冲突结构
            </button>
          </div>
        ) : null}
      </header>
      {view === 'table' ? (
        <DataTable
          bookId={storageId}
          slot="scene-columns"
          tableClass="scene-table data-table"
          columns={columns}
          rows={tableRows}
          rowKey={(row) => row.id}
          emptyText="没有符合的场次"
          filters={
            <>
              <label>
                冲突结构
                <select
                  aria-label="按冲突结构筛选"
                  value={structureFilter}
                  onChange={(event) => setStructureFilter(parseStructureFilter(event.currentTarget.value))}
                >
                  <option value="">全部</option>
                  <option value="active">主动</option>
                  <option value="reactive">反应</option>
                  <option value="empty">未填</option>
                </select>
              </label>
              <label>
                章
                <select
                  aria-label="按有没有章筛选"
                  value={chapterFilter}
                  onChange={(event) => setChapterFilter(parseChapterPresence(event.currentTarget.value))}
                >
                  <option value="">全部</option>
                  <option value="has">有章</option>
                  <option value="none">没章</option>
                </select>
              </label>
            </>
          }
          renderRow={(row, visible) => (
            <tr
              className={selectedId === row.id ? 'page-table-row is-selected' : 'page-table-row'}
              onClick={() => {
                setSelectedId(row.id)
                onOpenCard(row.id)
              }}
            >
              {visible.map((column) => (
                <td key={column.id}>{column.render(row)}</td>
              ))}
            </tr>
          )}
        />
      ) : group === 'chapter' ? (
        <SceneBoard
          label="按章"
          columns={chapterColumns(rows, state.chapters).map((label) => ({ id: label, label, droppable: chapterColumnDroppable(label) }))}
          rows={rows}
          columnOf={(row) => chapterColumnLabel(row.chapter)}
          canEdit={canEdit}
          onOpenCard={onOpenCard}
          onDrop={(cardId, columnId) =>
            onApply((current) => syncCardToNamedChapter(applySceneBoardDrop(current, cardId, 'chapter', columnId), cardId, columnId))
          }
        />
      ) : (
        <SceneBoard
          label="按冲突结构"
          columns={STRUCTURE_COLUMNS.map((column) => ({ id: column.id, label: column.label, droppable: column.droppable }))}
          rows={rows}
          columnOf={(row) => structureColumnId(row.structureKind)}
          canEdit={canEdit}
          onOpenCard={onOpenCard}
          onDrop={(cardId, columnId) => onApply((current) => applySceneBoardDrop(current, cardId, 'structure', columnId))}
        />
      )}
    </section>
  )
}

function SceneBoard({
  label,
  columns,
  rows,
  columnOf,
  canEdit,
  onOpenCard,
  onDrop,
}: {
  label: string
  columns: readonly { id: string; label: string; droppable: boolean }[]
  rows: readonly SceneRow[]
  columnOf: (row: SceneRow) => string
  canEdit: boolean
  onOpenCard: (cardId: string) => void
  onDrop: (cardId: string, columnId: string) => void
}) {
  return (
    <div className="scene-board" aria-label={label}>
      {columns.map((column) => (
        <section
          key={column.id}
          className="board-col"
          aria-label={column.label}
          data-droppable={column.droppable ? 'true' : 'false'}
          onDragOver={(event) => {
            if (!canEdit || !column.droppable) return
            event.preventDefault()
          }}
          onDrop={(event) => {
            if (!canEdit || !column.droppable) return
            takeSceneDrop(event, (cardId) => onDrop(cardId, column.id))
          }}
        >
          <h3>{column.label}</h3>
          {rows
            .filter((row) => columnOf(row) === column.id)
            .map((row) => (
              <article
                key={row.id}
                className="board-card"
                draggable={canEdit}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', `scene:${row.id}`)
                  event.dataTransfer.effectAllowed = 'move'
                }}
              >
                <button type="button" onClick={() => onOpenCard(row.id)}>
                  {row.title}
                </button>
                <p>{row.task}</p>
              </article>
            ))}
        </section>
      ))}
    </div>
  )
}

function takeSceneDrop(event: DragEvent<HTMLElement>, onCard: (cardId: string) => void) {
  const raw = event.dataTransfer.getData('text/plain')
  if (!raw.startsWith('scene:')) return
  event.preventDefault()
  onCard(raw.slice('scene:'.length))
}
