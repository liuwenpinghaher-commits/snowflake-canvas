import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { discussCardName } from './card-layout.ts'
import CardDiscuss from './CardDiscuss.tsx'
import FlowCanvas from './FlowCanvas.tsx'
import SideEditor from './SideEditor.tsx'
import ConflictChoice from './ConflictChoice.tsx'
import BooksPage, { type NewBookInput } from './BooksPage.tsx'
import CastPage from './CastPage.tsx'
import ChapterPage from './ChapterPage.tsx'
import RelationPage from './RelationPage.tsx'
import {
  DEFAULT_BOOK_NAME,
  MSG_BOOK_UNSAVED,
  activateBookRemote,
  createBookRemote,
  defaultBookMeta,
  deleteBookRemote,
  dropBookMeta,
  fetchBooks,
  renameBookRemote,
  seedBookCanvas,
  setCurrentBookId,
  writeBookMeta,
  type BookItem,
} from './books.ts'
import { createBrowserPorts, triggerDownload } from './persist-browser.ts'
import {
  MSG_CARD_CONFLICT,
  MSG_KEEP_SNAPSHOT,
  MSG_SAVE_AS,
  MSG_VERSION_MOVED,
  MSG_WRITE_FAILED,
  MSG_WRITE_FAILED_SERVER,
  MSG_WRITING,
  SAVE_AS_WARNING,
  SNAPSHOT_SAVE_HINT,
  createPersistController,
  idleSnapshot,
  openDefaultRecoveryLog,
  type PersistController,
  type PersistSnapshot,
} from './persist.ts'
import {
  addGroup,
  cardFace,
  changeToLaterLayer,
  createCard,
  defaultFieldKey,
  deleteSelection,
  layerLabel,
  linkCards,
  moveNode,
  adoptIntoCard,
  spawnChild,
  type Layer,
} from './document.ts'

const UNDOABLE = { undoable: true }
const CONFIRM_DELETE = '删除这张卡片？删错了可以点撤销。服务器模式下也可以用回退到这一版找回。'

export const DRAWER_WIDTH_KEY = 'snowflake-drawer-width'
export const DRAWER_WIDTH_MIN = 380
export const DRAWER_WIDTH_MAX = 520
export const DRAWER_WIDTH_DEFAULT = 380

export const LINE_HEIGHT_KEY = 'snowflake-discuss-line-height'
export const LINE_HEIGHTS = [1.4, 1.5, 1.7] as const
export const LINE_HEIGHT_DEFAULT = 1.5

const HINT_SEEN_KEY = 'snowflake-hint-seen'

export function readLineHeight(raw: string | null | undefined): number {
  const value = Number(raw)
  return (LINE_HEIGHTS as readonly number[]).includes(value) ? value : LINE_HEIGHT_DEFAULT
}

function readStored<T>(key: string, parse: (raw: string | null) => T, fallback: T): T {
  try {
    return parse(window.localStorage.getItem(key))
  } catch {
    return fallback
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 浏览器拒绝写入时，只在本页生效。
  }
}

export function readDrawerWidth(raw: string | null | undefined): number {
  if (typeof raw !== 'string') return DRAWER_WIDTH_DEFAULT
  const text = raw.trim()
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return DRAWER_WIDTH_DEFAULT
  const value = Number(text)
  if (!Number.isFinite(value) || value < DRAWER_WIDTH_MIN || value > DRAWER_WIDTH_MAX) return DRAWER_WIDTH_DEFAULT
  return Math.round(value)
}

function clampDrawerWidth(value: number): number {
  const rounded = Math.round(value)
  if (rounded < DRAWER_WIDTH_MIN) return DRAWER_WIDTH_MIN
  if (rounded > DRAWER_WIDTH_MAX) return DRAWER_WIDTH_MAX
  return rounded
}

function readStoredDrawerWidth(): number {
  try {
    return readDrawerWidth(window.localStorage.getItem(DRAWER_WIDTH_KEY))
  } catch {
    return DRAWER_WIDTH_DEFAULT
  }
}

function storeDrawerWidth(value: number): void {
  try {
    window.localStorage.setItem(DRAWER_WIDTH_KEY, String(value))
  } catch {
    // 浏览器拒绝写入时，这次拖动仍然改当前宽度。
  }
}

function useWideDrawer(): boolean {
  const query = '(min-width: 761px)'
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const sync = () => setWide(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  return wide
}

function DrawerResizer({ width, onWidth }: { width: number; onWidth: (next: number) => void }) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const moveTo = (clientX: number) => {
    const current = drag.current
    if (!current) return
    onWidth(clampDrawerWidth(current.startWidth + (current.startX - clientX)))
  }
  return (
    <div
      className="drawer-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调节讨论抽屉宽度"
      aria-valuemin={DRAWER_WIDTH_MIN}
      aria-valuemax={DRAWER_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const next = clampDrawerWidth(width + (event.key === 'ArrowRight' ? 10 : -10))
        onWidth(next)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return
        moveTo(event.clientX)
      }}
      onPointerUp={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return
        moveTo(event.clientX)
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    />
  )
}


type SaveDialog = {
  title: string
  fileName: string
  bytes: Uint8Array
  resolve: (accepted: boolean) => void
}

function countChars(text: string): number {
  return [...text.replace(/\s/g, '')].length
}

function syncLabel(view: PersistSnapshot['view']): { text: string; tone: 'ok' | 'busy' | 'bad' | 'muted' } {
  if (view.stopped || view.messages.includes(MSG_WRITE_FAILED) || view.messages.includes(MSG_WRITE_FAILED_SERVER)) return { text: '没保存上', tone: 'bad' }
  if (view.writing) return { text: '正在保存', tone: 'busy' }
  if (view.readonlyOther) return { text: '只读', tone: 'muted' }
  if (view.downloadMode) return { text: '要手动另存', tone: 'muted' }
  if (view.needChoice || view.needPermission) return { text: '还没开始保存', tone: 'muted' }
  return { text: '已保存', tone: 'ok' }
}

function canonLabel(view: PersistSnapshot['view']): string {
  if (view.messages.includes('正本在服务器')) return '正本在服务器'
  if (view.downloadMode) return '正本靠下载另存'
  if (view.needChoice) return '还没选正本'
  return '正本在本地目录'
}

function versionOf(view: PersistSnapshot['view']): string | null {
  for (const text of view.messages) {
    const hit = /^版本 (\d+)$/.exec(text)
    if (hit) return hit[1]
  }
  return null
}

// 这些状态已经在顶栏的小标签和菜单里，不再单独占一行。
function inChip(text: string): boolean {
  return text === '正本在服务器' || text === MSG_WRITING || /^版本 \d+$/.test(text)
}

function NamedMenu({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const root = rootRef.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="named-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        {label}
      </button>
      {open ? (
        <div id={id} className="named-menu-pop">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export default function App() {
  const [snap, setSnap] = useState<PersistSnapshot>(() => idleSnapshot())
  const [dialog, setDialog] = useState<SaveDialog | null>(null)
  const [snapName, setSnapName] = useState('')
  const ctlRef = useRef<PersistController | null>(null)
  const flashTimer = useRef<number | null>(null)
  const shiftChain = useRef<Promise<unknown>>(Promise.resolve())
  const [flashCardId, setFlashCardId] = useState<string | null>(null)
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const adoptFieldRef = useRef<string | null>(null)
  const [page, setPage] = useState<'canvas' | 'books' | 'cast' | 'relation' | 'encyclopedia' | 'chapter'>('canvas')
  const [discussFocus, setDiscussFocus] = useState<{ cardId: string; sessionId?: string } | null>(null)
  const [wizardOnOpen, setWizardOnOpen] = useState(false)
  const [controlFolded, setControlFolded] = useState(false)
  const [lineHeight, setLineHeight] = useState(() => readStored(LINE_HEIGHT_KEY, readLineHeight, LINE_HEIGHT_DEFAULT))
  const [hintOpen, setHintOpen] = useState(() => readStored(HINT_SEEN_KEY, (raw) => raw !== '1', false))
  const seedRef = useRef<{ bookId: string; text: string } | null>(null)
  const lastVersionRef = useRef<{ bookId: string | null; version: string | null }>({ bookId: null, version: null })
  const [books, setBooks] = useState<BookItem[]>([])
  const [bookId, setBookId] = useState<string | null>(null)
  const [booksLoaded, setBooksLoaded] = useState(false)
  const [bookBusy, setBookBusy] = useState(false)
  const [bookNotice, setBookNotice] = useState<string | null>(null)
  const wideDrawer = useWideDrawer()
  const [drawerWidth, setDrawerWidth] = useState(() => readStoredDrawerWidth())

  useEffect(() => {
    let cancelled = false
    void fetchBooks().then((list) => {
      if (cancelled) return
      if (list) {
        setBooks(list.books)
        setBookId(list.activeBookId)
      }
      setBooksLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!booksLoaded) return
    setCurrentBookId(bookId)
    const ctl = createPersistController(
      createBrowserPorts({
        bookId,
        openLog: openDefaultRecoveryLog,
        askSaveAs: (fileName, bytes) =>
          new Promise((resolve) => {
            setDialog({ title: MSG_SAVE_AS, fileName, bytes, resolve })
          }),
        askFirstDownload: (fileName, bytes) =>
          new Promise((resolve) => {
            setDialog({ title: '选择正本', fileName, bytes, resolve })
          }),
        askSnapshotDownload: (fileName, bytes) =>
          new Promise((resolve) => {
            setDialog({ title: MSG_KEEP_SNAPSHOT, fileName, bytes, resolve })
          }),
      }),
      setSnap,
    )
    ctlRef.current = ctl
    const params = new URLSearchParams(window.location.search)
    const hook = window as Window & { __snowflakeReadLog?: () => Promise<string> }
    if (params.get('e2e-bind') === 'directory') {
      hook.__snowflakeReadLog = async () => {
        const bytes = await ctl.readRecoveryLog()
        if (bytes && bytes.byteLength > 0) return new TextDecoder().decode(bytes)
        const log = await openDefaultRecoveryLog()
        try {
          const fresh = await log.read()
          return fresh && fresh.byteLength > 0 ? new TextDecoder().decode(fresh) : ''
        } finally {
          await log.close?.()
        }
      }
    }
    void ctl.start()
    return () => {
      if (hook.__snowflakeReadLog) delete hook.__snowflakeReadLog
      ctl.dispose()
      ctlRef.current = null
    }
  }, [booksLoaded, bookId])

  useEffect(() => {
    setDismissedId(null)
  }, [bookId])

  // 正本版本号往上走，说明这本书刚写进去过，书籍页的「更新时间」跟着走。
  const liveVersion = versionOf(snap.view)
  useEffect(() => {
    const last = lastVersionRef.current
    if (bookId && liveVersion && last.bookId === bookId && last.version && last.version !== liveVersion) {
      writeBookMeta(bookId, { updatedAt: new Date().toISOString() })
    }
    lastVersionRef.current = { bookId, version: liveVersion }
  }, [bookId, liveVersion])

  // 向导里贴的设定文字，等新书能写了再放成第一张念头卡。
  useEffect(() => {
    const seed = seedRef.current
    if (!seed || seed.bookId !== bookId || !snap.view.canEdit) return
    seedRef.current = null
    void ctlRef.current?.mutate((current) => createCard(current, { layer: 'situation', x: 80, y: 80, body: seed.text }), UNDOABLE)
  }, [bookId, snap.view.canEdit])

  useEffect(() => {
    const card = snap.state.activeId ? snap.state.snowflake.cards[snap.state.activeId] : undefined
    adoptFieldRef.current = card ? defaultFieldKey(card) : null
    // 只在换卡时回到默认字段。打字会换 cards 对象，不能写进依赖，否则会盖掉作者刚选的字段。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.state.activeId])

  // 换书前先让当前这本写完（同一条写入队列），写不干净就留在原书。
  const leaveCurrentBook = async (): Promise<boolean> => {
    const ctl = ctlRef.current
    if (!ctl) return false
    if (await ctl.holdForSwitch()) return true
    setBookNotice(MSG_BOOK_UNSAVED)
    return false
  }

  const enterBook = (id: string, list: BookItem[]) => {
    setDismissedId(null)
    setSnap(idleSnapshot())
    setBooks(list.map((item) => ({ ...item, active: item.id === id })))
    setBookId(id)
    void fetchBooks().then((fresh) => {
      if (fresh) setBooks(fresh.books.map((item) => ({ ...item, active: item.id === id })))
    })
  }

  const switchBook = async (targetId: string) => {
    if (bookBusy || !bookId || targetId === bookId) return
    setBookBusy(true)
    setBookNotice(null)
    try {
      if (!(await leaveCurrentBook())) return
      if (!(await activateBookRemote(targetId))) {
        ctlRef.current?.releaseHold()
        setBookNotice('没有换过去，还在原来这本书')
        return
      }
      enterBook(targetId, books)
    } finally {
      setBookBusy(false)
    }
  }

  const openIdea = (cardId: string, sessionId?: string) => {
    setPage('canvas')
    setDismissedId(null)
    setDiscussFocus(sessionId ? { cardId, sessionId } : { cardId })
    ctlRef.current?.select(cardId)
  }

  const openBooks = (wizard: boolean) => {
    setWizardOnOpen(wizard)
    setPage('books')
  }

  const createBook = async (input: NewBookInput): Promise<boolean> => {
    if (bookBusy || !bookId) return false
    setBookBusy(true)
    setBookNotice(null)
    try {
      if (!(await leaveCurrentBook())) return false
      const created = await createBookRemote(input.name.trim() || DEFAULT_BOOK_NAME)
      if (!created) {
        ctlRef.current?.releaseHold()
        setBookNotice('新书没有建成，还在原来这本书')
        return false
      }
      writeBookMeta(created.id, { ...defaultBookMeta(), ...input.meta })
      if (input.importDoc && !(await seedBookCanvas(created.id, input.importDoc))) {
        setBookNotice('新书建好了，但导入的画布没放进去，新书是空白的')
      }
      if (input.seedText) seedRef.current = { bookId: created.id, text: input.seedText }
      enterBook(created.id, [...books, created])
      setPage('canvas')
      return true
    } finally {
      setBookBusy(false)
    }
  }

  const openBook = async (targetId: string) => {
    if (targetId !== bookId) await switchBook(targetId)
    setPage('canvas')
  }

  const renameBook = async (id: string, name: string): Promise<boolean> => {
    const renamed = await renameBookRemote(id, name)
    if (!renamed) return false
    setBooks((list) => list.map((item) => (item.id === id ? { ...item, name: renamed.name } : item)))
    writeBookMeta(id, { updatedAt: new Date().toISOString() })
    return true
  }

  const removeBook = async (id: string): Promise<string | null> => {
    if (id === bookId) return '正在写的这本不能删，先换到别的书'
    setBookBusy(true)
    try {
      const result = await deleteBookRemote(id)
      if (!result.ok) return result.error
      dropBookMeta(id)
      setBooks((list) => list.filter((item) => item.id !== id))
      return null
    } finally {
      setBookBusy(false)
    }
  }

  const { state, view } = snap
  const activeNode = state.canvas.nodes.find((node) => node.id === state.activeId) ?? null
  const activeCard = state.activeId ? (state.snowflake.cards[state.activeId] ?? null) : null
  const canEdit = view.canEdit
  const conflictIds = new Set(view.conflicts.map((item) => item.cardId))
  const activeConflict = view.conflicts.find((item) => item.cardId === state.activeId) ?? null
  const drawerOpen = Boolean(activeCard && state.activeId !== dismissedId)
  const discussName = activeCard ? discussCardName(cardFace(activeCard).title, layerLabel(activeCard.layer)) : ''
  const activeWords = activeCard ? countChars(activeCard.body) : 0
  const activeAdopted = Boolean(activeCard && (activeCard.fields.adopted ?? '').trim())
  const bookWords = Object.values(state.snowflake.cards).reduce((sum, card) => sum + countChars(card.body), 0)
  const currentBook = books.find((book) => book.id === bookId) ?? null
  const noCards = Object.keys(state.snowflake.cards).length === 0
  const sync = syncLabel(view)
  const version = versionOf(view)

  const closeHint = () => {
    setHintOpen(false)
    store(HINT_SEEN_KEY, '1')
  }

  const createThought = () => {
    void ctlRef.current?.mutate((current) => {
      const shift = current.canvas.nodes.length * 28
      return createCard(current, { layer: 'situation', x: 80 + shift, y: 80 + shift, body: '' })
    }, UNDOABLE)
  }

  const closeDialog = (accepted: boolean) => {
    if (!dialog) return
    if (accepted) triggerDownload(dialog.fileName, dialog.bytes)
    dialog.resolve(accepted)
    setDialog(null)
  }

  const closeDrawer = () => {
    if (state.activeId) setDismissedId(state.activeId)
  }

  const onShift = (moves: { id: string; x: number; y: number }[]) => {
    const ctl = ctlRef.current
    if (!ctl || !canEdit || moves.length === 0) return
    const job = shiftChain.current.then(() =>
      ctl.mutate(
        (current) => moves.reduce((next, move) => moveNode(next, move.id, move.x, move.y), current),
        UNDOABLE,
      ),
    )
    shiftChain.current = job.then(
      () => undefined,
      () => undefined,
    )
  }

  return (
    <div className="app" style={{ '--discuss-line-height': String(lineHeight) } as CSSProperties}>
      <header className="topbar">
        <div className="top-book">
          {bookId && books.length > 0 ? (
            <>
              <select
                aria-label="当前书"
                className="book-select"
                value={bookId}
                disabled={bookBusy}
                onChange={(event) => void switchBook(event.currentTarget.value)}
              >
                {books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.name}
                  </option>
                ))}
              </select>
              <span className="top-words" aria-label="这本书的总字数">
                {bookWords} 字
              </span>
            </>
          ) : booksLoaded ? null : (
            <span className="top-words">正在读书目…</span>
          )}
        </div>
        <div className="top-actions">
          <span className={`top-chip is-${sync.tone}`} role="status" aria-label={`保存状态：${sync.text}`}>
            {sync.text}
          </span>
          <span className="top-chip is-muted" aria-label={`正本状态：${canonLabel(view)}`}>
            {canonLabel(view)}
          </span>
          <button
            type="button"
            className="primary"
            disabled={!canEdit}
            onClick={createThought}
          >
            新建念头
          </button>
          <NamedMenu id="version-menu-pop" label="版本">
            <p className="menu-facts">
              雪花画布{currentBook ? ` · ${currentBook.name}` : ''}
              <br />
              {version ? `版本 ${version}` : '版本 —'} · {canonLabel(view)}
            </p>
            <button type="button" disabled={!canEdit} onClick={() => void ctlRef.current?.keepVersion()}>
              {MSG_KEEP_SNAPSHOT}
            </button>
            {view.downloadMode && !view.fileProtocol ? (
              <label className="file-pick">
                选快照回退
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (!file) return
                    void file.arrayBuffer().then((buffer) => {
                      void ctlRef.current?.rollbackToBytes(new Uint8Array(buffer))
                    })
                  }}
                />
              </label>
            ) : (
              <>
                <select
                  aria-label="已有快照"
                  className="snap-select"
                  value={snapName}
                  onChange={(event) => setSnapName(event.currentTarget.value)}
                >
                  <option value="">选择一份快照</option>
                  {view.snapshotOptions.map((option) => (
                    <option key={option.name} value={option.name}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!canEdit || snapName.length === 0}
                  onClick={() => void ctlRef.current?.rollbackTo(snapName)}
                >
                  回退到这一版
                </button>
              </>
            )}
          </NamedMenu>
          <NamedMenu id="books-menu-pop" label="书籍">
            {bookId ? (
              <>
                <button type="button" disabled={bookBusy} onClick={() => openBooks(false)}>
                  书籍管理
                </button>
                <button type="button" disabled={bookBusy} onClick={() => openBooks(true)}>
                  新建书
                </button>
              </>
            ) : null}
          </NamedMenu>
          <NamedMenu id="settings-menu-pop" label="设置">
            <label className="menu-row">
              讨论行高
              <select
                aria-label="讨论行高"
                value={String(lineHeight)}
                onChange={(event) => {
                  const next = readLineHeight(event.currentTarget.value)
                  setLineHeight(next)
                  store(LINE_HEIGHT_KEY, String(next))
                }}
              >
                <option value="1.4">紧 1.4</option>
                <option value="1.5">标准 1.5</option>
                <option value="1.7">松 1.7</option>
              </select>
            </label>
            <button type="button" onClick={() => setHintOpen(true)}>
              操作说明
            </button>
            {view.needChoice && !view.fileProtocol ? (
              <button type="button" onClick={() => void ctlRef.current?.selectDirectory()}>
                选择正本
              </button>
            ) : null}
            {view.needPermission ? (
              <button type="button" onClick={() => void ctlRef.current?.requestPermission()}>
                允许读写
              </button>
            ) : null}
            {view.readonlyOther ? (
              <button type="button" onClick={() => void ctlRef.current?.claimWrite()}>
                改由本页写入
              </button>
            ) : null}
            {view.downloadMode && !view.fileProtocol ? (
              <label className="file-pick">
                打开正本
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (!file) return
                    void file.arrayBuffer().then((buffer) => {
                      void ctlRef.current?.openLocalFile(new Uint8Array(buffer), file.name)
                    })
                  }}
                />
              </label>
            ) : null}
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => {
                void ctlRef.current?.mutate((current) => {
                  const shift = current.canvas.nodes.length * 24
                  return addGroup(current, { x: 40 + shift, y: 40 + shift })
                }, UNDOABLE)
              }}
            >
              新建分组
            </button>
            <button
              type="button"
              disabled={!canEdit || !state.activeId}
              onClick={() => {
                if (!window.confirm(CONFIRM_DELETE)) return
                void ctlRef.current?.mutate(
                  (current) => (current.activeId ? deleteSelection(current, current.activeId) : current),
                  UNDOABLE,
                )
              }}
            >
              删除
            </button>
            <button type="button" disabled={!canEdit || !view.canUndo} onClick={() => void ctlRef.current?.undo()}>
              撤销
            </button>
          </NamedMenu>
        </div>
      </header>
      <nav className="primary-nav" aria-label="页面">
        {(
          [
            ['canvas', '画布'],
            ['cast', '人物'],
            ['relation', '关系'],
            ['encyclopedia', '百科'],
            ['chapter', '章节'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={page === id ? 'on' : ''}
            aria-current={page === id ? 'page' : undefined}
            onClick={() => setPage(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="status-strip">
        {view.notices.map((notice) =>
          notice.kind === 'error' ? (
            <p key={notice.text} className="status-line is-error" role="alert">
              出错：{notice.text}
              {view.stopped && (notice.text === MSG_WRITE_FAILED || notice.text === MSG_WRITE_FAILED_SERVER) ? (
                <button type="button" onClick={() => void ctlRef.current?.retryWrite()}>
                  重试保存
                </button>
              ) : null}
            </p>
          ) : inChip(notice.text) ? null : (
            <p key={notice.text} className="status-line" role="status">
              {notice.text}
            </p>
          ),
        )}
        {bookNotice ? (
          <p className="status-line is-error" role="alert">
            出错：{bookNotice}
          </p>
        ) : null}
      </div>
      {page === 'cast' ? (
        <CastPage
          state={state}
          canEdit={canEdit}
          onApply={(recipe) => {
            void ctlRef.current?.mutate(recipe, UNDOABLE)
          }}
          onOpenIdea={openIdea}
        />
      ) : null}
      {page === 'relation' ? <RelationPage state={state} /> : null}
      {page === 'encyclopedia' ? (
        <section className="later-page" aria-label="百科">
          <h2>百科</h2>
          <p>这一页下一刀才做。</p>
        </section>
      ) : null}
      {page === 'chapter' ? (
        <ChapterPage
          state={state}
          canEdit={canEdit}
          onApply={(recipe) => {
            void ctlRef.current?.mutate(recipe, UNDOABLE)
          }}
        />
      ) : null}
      {page === 'canvas' || page === 'books' ? (
      <main className="workspace">
        <h1 className="sr-only">{currentBook?.name || '未命名书'}</h1>
        {noCards || hintOpen ? (
          <div className="canvas-hint" role="note">
            <p>空白处双击放一张念头。点一张卡片，左边改字段，右边单独打开讨论；窄屏时字段收在底部。从卡片右边拖出去，长出后面的层。</p>
            {noCards ? (
              <button type="button" disabled={!canEdit} onClick={createThought}>
                新建念头
              </button>
            ) : (
              <button type="button" onClick={closeHint}>
                知道了
              </button>
            )}
          </div>
        ) : null}
        {drawerOpen && activeCard && state.activeId ? (
          <aside className={controlFolded ? 'control-pane is-folded' : 'control-pane'} aria-label="这张卡的字段">
            <div className="drawer-head card-head">
              <div className="card-head-top">
                <span className="card-head-layer">{layerLabel(activeCard.layer)}</span>
                <span className="card-head-actions">
                  <button type="button" className="control-fold" aria-expanded={!controlFolded} onClick={() => setControlFolded((value) => !value)}>
                    {controlFolded ? '展开字段' : '收起字段'}
                  </button>
                  <button type="button" onClick={closeDrawer}>
                    关闭
                  </button>
                </span>
              </div>
              <h2 className="discuss-heading card-head-title">{cardFace(activeCard).title || discussName}</h2>
              <p className="card-head-meta">
                {activeWords} 字{activeAdopted ? ' · 已采纳过' : ''}
              </p>
            </div>
            {activeConflict ? (
              <ConflictChoice
                conflict={activeConflict}
                onPick={(pick) => void ctlRef.current?.resolveCardConflict(activeConflict.cardId, pick)}
              />
            ) : null}
            {controlFolded ? null : (
              <div className="side-fields">
                <div className="side-fields-body">
                  <SideEditor
                    cardId={state.activeId}
                    card={activeCard}
                    documentState={state}
                    groupSelected={activeNode?.type === 'group'}
                    canType={canEdit}
                    onCommit={(cardId, fieldKey, text) => {
                      void ctlRef.current?.commitText(cardId, fieldKey, text)
                    }}
                    onAdoptField={(key) => {
                      adoptFieldRef.current = key
                    }}
                    onChangeLayer={(cardId, layer: Layer) => {
                      void ctlRef.current?.mutate((current) => changeToLaterLayer(current, cardId, layer), UNDOABLE)
                    }}
                    expandNotice={view.expandNotice}
                    candidates={view.candidates}
                    onExpand={(cardId, fieldKey) => {
                      void ctlRef.current?.requestCandidates(cardId, fieldKey)
                    }}
                    onConfirmCandidate={(id) => {
                      void ctlRef.current?.confirmCandidate(id)
                    }}
                    onDismissCandidates={() => ctlRef.current?.dismissCandidates()}
                    onApply={(recipe) => {
                      void ctlRef.current?.mutate(recipe, UNDOABLE)
                    }}
                    onOpenIdea={openIdea}
                  />
                </div>
              </div>
            )}
          </aside>
        ) : null}
        <ReactFlowProvider>
          <FlowCanvas
            nodes={state.canvas.nodes}
            edges={state.canvas.edges}
            cards={state.snowflake.cards}
            activeId={state.activeId}
            conflictIds={conflictIds}
            canEdit={canEdit}
            onMove={(id, x, y) => {
              if (!canEdit) return
              void ctlRef.current?.mutate((current) => moveNode(current, id, x, y), UNDOABLE)
            }}
            onShift={onShift}
            onSelect={(id) => {
              setDismissedId(null)
              ctlRef.current?.select(id)
            }}
            onSpawn={(fromId, x, y) => {
              if (!canEdit) return
              void ctlRef.current?.mutate((current) => spawnChild(current, fromId, undefined, x, y), UNDOABLE)
            }}
            onLink={(fromId, toId) => {
              if (!canEdit) return
              void ctlRef.current?.mutate((current) => linkCards(current, fromId, toId), UNDOABLE)
            }}
            onCreateAt={(x, y) => {
              if (!canEdit) return
              void ctlRef.current?.mutate(
                (current) => createCard(current, { layer: 'situation', x, y, body: '' }),
                UNDOABLE,
              )
            }}
            flashCardId={flashCardId}
          />
        </ReactFlowProvider>
        {drawerOpen && activeCard && state.activeId ? (
          <aside className="session-pane" style={wideDrawer ? { width: drawerWidth } : undefined} aria-label={`讨论：${discussName}`}>
            {wideDrawer ? (
              <DrawerResizer
                width={drawerWidth}
                onWidth={(next) => {
                  setDrawerWidth(next)
                  storeDrawerWidth(next)
                }}
              />
            ) : null}
            <div className="discuss-dock">
              <CardDiscuss
                key={state.activeId}
                cardId={state.activeId}
                cardBody={activeCard.body}
                onClose={closeDrawer}
                entities={state.entities ?? []}
                edges={state.canvas.edges}
                cards={state.snowflake.cards}
                focusSessionId={discussFocus?.cardId === state.activeId ? discussFocus.sessionId : undefined}
                onSedimentDone={() => {
                  void ctlRef.current?.reloadRemote()
                }}
                onCommitBody={async (cardId, text) => {
                  await ctlRef.current?.mutate((current) => {
                    const next = adoptIntoCard(current, cardId, text, adoptFieldRef.current)
                    return next === current ? { ...current } : next
                  })
                  const messages = ctlRef.current?.snapshot().view.messages ?? []
                  if (messages.includes(MSG_VERSION_MOVED)) throw new Error(MSG_VERSION_MOVED)
                  if (messages.includes(MSG_CARD_CONFLICT)) throw new Error(MSG_CARD_CONFLICT)
                  const failedWrite = [MSG_WRITE_FAILED, MSG_WRITE_FAILED_SERVER].find((item) => messages.includes(item))
                  if (failedWrite) throw new Error(failedWrite)
                  setFlashCardId(cardId)
                  if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
                  flashTimer.current = window.setTimeout(() => {
                    flashTimer.current = null
                    setFlashCardId((current) => (current === cardId ? null : current))
                  }, 1600)
                }}
              />
            </div>
          </aside>
        ) : null}
      </main>
      ) : null}
      {page === 'books' ? (
        <BooksPage
          books={books}
          currentBookId={bookId}
          busy={bookBusy}
          version={version}
          startWizard={wizardOnOpen}
          onBack={() => setPage('canvas')}
          onOpen={(id) => void openBook(id)}
          onCreate={createBook}
          onRename={renameBook}
          onDelete={removeBook}
        />
      ) : null}
      {dialog ? (
        <div className="modal-back" role="presentation">
          <div className="modal" role="dialog" aria-label={dialog.title}>
            <h2>{dialog.title}</h2>
            <p>{dialog.title === MSG_KEEP_SNAPSHOT ? SNAPSHOT_SAVE_HINT : SAVE_AS_WARNING}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => closeDialog(false)}>
                取消
              </button>
              <button type="button" onClick={() => closeDialog(true)}>
                下载
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
