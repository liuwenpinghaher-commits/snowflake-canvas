import { Fragment, useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { matchesSearch, moveColumn, sortByText, toggleSort, type SortState } from './table-view.ts'
import { browserViewStore, readColumnLayout, writeColumnLayout, type ColumnLayout } from './view-memory.ts'

export interface DataColumn<Row> {
  id: string
  label: string
  sortable: boolean
  search: boolean
  defaultWidth: number
  text: (row: Row) => string
  render: (row: Row) => ReactNode
}

const COLUMN_MIME = 'application/x-snow-column'

export default function DataTable<Row>({
  bookId,
  slot,
  tableClass,
  columns,
  rows,
  rowKey,
  emptyText,
  filters,
  trailingWidth,
  renderRow,
}: {
  bookId: string
  slot: string
  tableClass: string
  columns: readonly DataColumn<Row>[]
  rows: readonly Row[]
  rowKey: (row: Row) => string
  emptyText: string
  filters?: ReactNode
  trailingWidth?: number
  renderRow: (row: Row, visible: readonly DataColumn<Row>[], colSpan: number) => ReactNode
}) {
  const columnKey = columns.map((column) => column.id).join('\0')
  const [layout, setLayout] = useState<ColumnLayout>(() =>
    readColumnLayout(browserViewStore(), bookId, slot, columns.map((column) => column.id)),
  )
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  useEffect(() => {
    setLayout(readColumnLayout(browserViewStore(), bookId, slot, columnKey.split('\0')))
    setQuery('')
    setSort(null)
    setMenuOpen(false)
  }, [bookId, slot, columnKey])

  const byId = new Map(columns.map((column) => [column.id, column]))
  const ordered = layout.order.map((id) => byId.get(id)).filter((column): column is DataColumn<Row> => Boolean(column))
  const visible = ordered.filter((column) => !layout.hidden.includes(column.id))
  const colSpan = visible.length + (trailingWidth ? 1 : 0)
  const searched = rows.filter((row) =>
    matchesSearch(
      visible.filter((column) => column.search).map((column) => column.text(row)),
      query,
    ),
  )
  const sortColumn = sort ? columns.find((column) => column.id === sort.key && column.sortable) : undefined
  const shown = sort && sortColumn ? sortByText(searched, (row) => sortColumn.text(row), sort.dir) : searched

  const persist = (next: ColumnLayout) => {
    layoutRef.current = next
    setLayout(next)
    writeColumnLayout(browserViewStore(), bookId, slot, next)
  }

  const toggleHidden = (id: string) => {
    const current = layoutRef.current
    const hidden = current.hidden.includes(id) ? current.hidden.filter((item) => item !== id) : [...current.hidden, id]
    const stillVisible = current.order.filter((item) => byId.has(item) && !hidden.includes(item))
    if (stillVisible.length === 0) return
    persist({ ...current, hidden })
  }

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>, id: string, width: number) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const onMove = (ev: PointerEvent) => {
      const nextWidth = Math.round(Math.min(720, Math.max(72, width + ev.clientX - startX)))
      const current = layoutRef.current
      persist({ ...current, widths: { ...current.widths, [id]: nextWidth } })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onGripStart = (event: DragEvent<HTMLElement>, id: string) => {
    event.dataTransfer.setData(COLUMN_MIME, id)
    event.dataTransfer.effectAllowed = 'move'
  }

  const onHeadOver = (event: DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes(COLUMN_MIME)) return
    event.preventDefault()
  }

  const onHeadDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    const from = event.dataTransfer.getData(COLUMN_MIME)
    if (!from) return
    event.preventDefault()
    event.stopPropagation()
    const current = layoutRef.current
    persist({ ...current, order: moveColumn(current.order, from, targetId) })
  }

  const widthOf = (column: DataColumn<Row>) => layout.widths[column.id] ?? column.defaultWidth

  return (
    <div className="data-table-wrap">
      <div className="table-tools">
        <input
          type="search"
          className="table-search"
          aria-label="搜索这张表"
          placeholder="搜索"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {filters}
        <div className="col-menu">
          <button type="button" aria-expanded={menuOpen} aria-label="列" onClick={() => setMenuOpen((open) => !open)}>
            列
          </button>
          {menuOpen ? (
            <div className="col-menu-pop" role="group" aria-label="显示哪些列">
              {columns.map((column) => {
                const shownColumn = !layout.hidden.includes(column.id)
                return (
                  <label key={column.id}>
                    <input
                      type="checkbox"
                      checked={shownColumn}
                      disabled={shownColumn && visible.length === 1}
                      onChange={() => toggleHidden(column.id)}
                    />
                    {column.label}
                  </label>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>
      <table className={tableClass}>
        <colgroup>
          {visible.map((column) => (
            <col key={column.id} style={{ width: widthOf(column) }} />
          ))}
          {trailingWidth ? <col style={{ width: trailingWidth }} /> : null}
        </colgroup>
        <thead>
          <tr>
            {visible.map((column) => {
              const active = sort?.key === column.id
              const mark = active ? (sort?.dir === 'asc' ? ' ↑' : ' ↓') : ''
              return (
                <th
                  key={column.id}
                  aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  onDragOver={onHeadOver}
                  onDrop={(event) => onHeadDrop(event, column.id)}
                >
                  <span
                    className="col-grip"
                    draggable
                    aria-label={`调整${column.label}列顺序`}
                    onDragStart={(event) => onGripStart(event, column.id)}
                  >
                    ⋮⋮
                  </span>
                  {column.sortable ? (
                    <button type="button" className="col-sort" onClick={() => setSort((current) => toggleSort(current, column.id))}>
                      {column.label}
                      {mark}
                    </button>
                  ) : (
                    <span className="col-label">{column.label}</span>
                  )}
                  <span
                    className="col-resize"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`调整${column.label}列宽`}
                    onPointerDown={(event) => startResize(event, column.id, widthOf(column))}
                  />
                </th>
              )
            })}
            {trailingWidth ? <th aria-label="操作" /> : null}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={Math.max(colSpan, 1)}>{emptyText}</td>
            </tr>
          ) : (
            shown.map((row) => <Fragment key={rowKey(row)}>{renderRow(row, visible, colSpan)}</Fragment>)
          )}
        </tbody>
      </table>
    </div>
  )
}
