import { useEffect, useState, type DragEvent } from 'react'
import {
  applySceneBoardDrop,
  chapterColumnLabel,
  chapterColumns,
  listScenes,
  STRUCTURE_COLUMNS,
  structureColumnId,
  type SceneGroup,
  type SceneRow,
} from './scene-board.ts'
import type { AppState } from './document.ts'
import { browserViewStore, readChoice, writeChoice } from './view-memory.ts'

type SceneView = 'table' | 'board'

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
  useEffect(() => {
    const store = browserViewStore()
    if (!initialView) setView(readChoice(store, storageId, 'scene', ['table', 'board'] as const, 'table'))
    if (!initialGroup) setGroup(readChoice(store, storageId, 'scene-group', ['chapter', 'structure'] as const, 'chapter'))
  }, [storageId, initialView, initialGroup])

  const rows = listScenes(state)

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
        <table className="scene-table">
          <thead>
            <tr>
              <th>标题</th>
              <th>章</th>
              <th>冲突结构</th>
              <th>本场任务</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={selectedId === row.id ? 'page-table-row is-selected' : 'page-table-row'}
                onClick={() => {
                  setSelectedId(row.id)
                  onOpenCard(row.id)
                }}
              >
                <td>{row.title}</td>
                <td>{row.chapter}</td>
                <td>{row.structureLabel}</td>
                <td>{row.task}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : group === 'chapter' ? (
        <SceneBoard
          label="按章"
          columns={chapterColumns(rows).map((label) => ({ id: label, label, droppable: false }))}
          rows={rows}
          columnOf={(row) => chapterColumnLabel(row.chapter)}
          canEdit={canEdit}
          onOpenCard={onOpenCard}
          onDrop={() => undefined}
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
