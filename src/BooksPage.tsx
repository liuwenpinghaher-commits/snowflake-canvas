import { useEffect, useMemo, useState } from 'react'
import {
  BOOK_GENRES,
  BOOK_STATUSES,
  COVER_COLORS,
  COVER_COLOR_NAMES,
  DEFAULT_BOOK_NAME,
  POV_CHOICES,
  fetchBookStats,
  readBookMeta,
  readImportFile,
  writeBookMeta,
  type BookItem,
  type BookMeta,
  type BookStats,
  type ImportPreview,
} from './books.ts'
import { LAYERS, layerLabel, type Layer } from './document.ts'

export interface NewBookInput {
  name: string
  meta: Partial<BookMeta>
  importDoc: unknown | null
  seedText: string
}

type Sort = 'recent' | 'name' | 'words'

const WIZARD_STEPS = ['设定导入', '默认值', '名称和题材', '建书'] as const

function formatTime(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatWords(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)} 万字`
  return `${value} 字`
}

function Cover({ name, color }: { name: string; color: string }) {
  return (
    <div className="book-cover" style={{ background: color }} aria-hidden="true">
      <span>{name.slice(0, 8)}</span>
    </div>
  )
}

function NewBookWizard({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean
  onCancel: () => void
  onCreate: (input: NewBookInput) => Promise<boolean>
}) {
  const [step, setStep] = useState(0)
  const [importMode, setImportMode] = useState<'none' | 'json' | 'text'>('none')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [seedText, setSeedText] = useState('')
  const [status, setStatus] = useState<BookMeta['status']>('构思中')
  const [targetWords, setTargetWords] = useState('')
  const [pov, setPov] = useState<string>('未定')
  const [language, setLanguage] = useState('中文')
  const [name, setName] = useState('')
  const [genre, setGenre] = useState<string>('未定')
  const [penName, setPenName] = useState('')
  const [series, setSeries] = useState('')
  const [intro, setIntro] = useState('')
  const [cover, setCover] = useState<string>(COVER_COLORS[0])
  const [failed, setFailed] = useState<string | null>(null)

  const target = Math.max(0, Math.round(Number(targetWords) || 0))
  const finalName = name.trim() || DEFAULT_BOOK_NAME
  const importReady = importMode === 'none' || (importMode === 'json' ? preview !== null : seedText.trim().length > 0)

  const submit = async () => {
    setFailed(null)
    const ok = await onCreate({
      name: finalName,
      meta: { status, targetWords: target, pov, language, genre, penName: penName.trim(), series: series.trim(), intro: intro.trim(), cover },
      importDoc: importMode === 'json' ? (preview?.document ?? null) : null,
      seedText: importMode === 'text' ? seedText.trim() : '',
    })
    if (!ok) setFailed('新书没有建成，还在原来这本书。可以再点一次建书。')
  }

  return (
    <section className="wizard" aria-label="新建书">
      <ol className="wizard-steps">
        {WIZARD_STEPS.map((label, index) => (
          <li key={label} className={index === step ? 'is-on' : index < step ? 'is-done' : ''} aria-current={index === step ? 'step' : undefined}>
            <span className="wizard-num">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="wizard-body">
        {step === 0 ? (
          <fieldset>
            <legend>已有设定要带进来吗？</legend>
            <label className="wizard-choice">
              <input type="radio" name="import" checked={importMode === 'none'} onChange={() => setImportMode('none')} />
              不导入，从空白画布开始
            </label>
            <label className="wizard-choice">
              <input type="radio" name="import" checked={importMode === 'text'} onChange={() => setImportMode('text')} />
              贴一段设定文字，建书后放成第一张念头卡
            </label>
            <label className="wizard-choice">
              <input type="radio" name="import" checked={importMode === 'json'} onChange={() => setImportMode('json')} />
              导入一份雪花画布 JSON（之前导出或下载另存的正本）
            </label>
            {importMode === 'text' ? (
              <textarea
                className="wizard-seed"
                aria-label="设定文字"
                placeholder="世界观、主角、开头的念头……"
                value={seedText}
                onChange={(event) => setSeedText(event.currentTarget.value)}
              />
            ) : null}
            {importMode === 'json' ? (
              <div className="wizard-import">
                <input
                  type="file"
                  accept=".json,application/json"
                  aria-label="选择雪花画布 JSON"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    if (!file) return
                    void file.text().then((text) => {
                      const read = readImportFile(text)
                      setPreview(read)
                      setImportError(read ? null : '这份文件不是雪花画布的正本 JSON，读不出画布')
                    })
                  }}
                />
                {preview ? (
                  <p className="wizard-preview" role="status">
                    读到 {preview.stats.cards} 张卡，共 {formatWords(preview.stats.words)}。建书时整份放进新书，不动现在这本。
                  </p>
                ) : null}
                {importError ? (
                  <p className="status-line is-error" role="alert">
                    出错：{importError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </fieldset>
        ) : null}
        {step === 1 ? (
          <fieldset className="wizard-grid">
            <legend>这本书的默认值，之后都能在档案里改</legend>
            <label>
              状态
              <select value={status} onChange={(event) => setStatus(event.currentTarget.value as BookMeta['status'])}>
                {BOOK_STATUSES.filter((item) => item !== '归档').map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              目标字数
              <input inputMode="numeric" placeholder="例如 300000，可空" value={targetWords} onChange={(event) => setTargetWords(event.currentTarget.value.replace(/[^\d]/g, ''))} />
            </label>
            <label>
              视角
              <select value={pov} onChange={(event) => setPov(event.currentTarget.value)}>
                {POV_CHOICES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              语言
              <input value={language} onChange={(event) => setLanguage(event.currentTarget.value)} />
            </label>
          </fieldset>
        ) : null}
        {step === 2 ? (
          <fieldset className="wizard-grid">
            <legend>书名和题材</legend>
            <label className="span-2">
              书名
              <input autoFocus placeholder={DEFAULT_BOOK_NAME} value={name} maxLength={80} onChange={(event) => setName(event.currentTarget.value)} />
            </label>
            <label>
              题材
              <select value={genre} onChange={(event) => setGenre(event.currentTarget.value)}>
                {BOOK_GENRES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              笔名
              <input value={penName} onChange={(event) => setPenName(event.currentTarget.value)} />
            </label>
            <label>
              系列
              <input value={series} onChange={(event) => setSeries(event.currentTarget.value)} />
            </label>
            <div className="cover-pick">
              封面颜色
              <div role="radiogroup" aria-label="封面颜色">
                {COVER_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={cover === color}
                    aria-label={COVER_COLOR_NAMES[color]}
                    className={cover === color ? 'swatch on' : 'swatch'}
                    style={{ background: color }}
                    onClick={() => setCover(color)}
                  />
                ))}
              </div>
            </div>
            <label className="span-2">
              一句话简介
              <input value={intro} onChange={(event) => setIntro(event.currentTarget.value)} />
            </label>
          </fieldset>
        ) : null}
        {step === 3 ? (
          <div className="wizard-review">
            <Cover name={finalName} color={cover} />
            <dl>
              <dt>书名</dt>
              <dd>{finalName}</dd>
              <dt>题材</dt>
              <dd>{genre}</dd>
              <dt>状态</dt>
              <dd>{status}</dd>
              <dt>目标字数</dt>
              <dd>{target ? formatWords(target) : '未定'}</dd>
              <dt>视角</dt>
              <dd>{pov}</dd>
              <dt>设定</dt>
              <dd>
                {importMode === 'none'
                  ? '空白画布'
                  : importMode === 'text'
                    ? `一张念头卡（${[...seedText.trim()].length} 字）`
                    : `导入 ${preview?.stats.cards ?? 0} 张卡`}
              </dd>
            </dl>
            <p className="wizard-note">建好后会先把现在这本写完，再换到新书的画布。</p>
            {failed ? (
              <p className="status-line is-error" role="alert">
                出错：{failed}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="wizard-bar">
        <button type="button" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <span className="wizard-gap" />
        {step > 0 ? (
          <button type="button" onClick={() => setStep(step - 1)} disabled={busy}>
            上一步
          </button>
        ) : null}
        {step < WIZARD_STEPS.length - 1 ? (
          <button type="button" className="primary" disabled={!importReady} onClick={() => setStep(step + 1)}>
            下一步
          </button>
        ) : (
          <button type="button" className="primary" disabled={busy || !importReady} onClick={() => void submit()}>
            {busy ? '正在建书…' : '建书'}
          </button>
        )}
      </div>
    </section>
  )
}

function BookProfile({
  book,
  stats,
  isCurrent,
  busy,
  version,
  onOpen,
  onRename,
  onDelete,
  onMeta,
}: {
  book: BookItem
  stats: BookStats | null | undefined
  isCurrent: boolean
  busy: boolean
  version: string | null
  onOpen: () => void
  onRename: (name: string) => Promise<boolean>
  onDelete: () => Promise<string | null>
  onMeta: (meta: BookMeta) => void
}) {
  const [meta, setMeta] = useState(() => readBookMeta(book.id))
  const [name, setName] = useState(book.name)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMeta(readBookMeta(book.id))
    setName(book.name)
    setConfirming(false)
    setError(null)
  }, [book.id, book.name])

  const patch = (next: Partial<BookMeta>) => {
    const saved = writeBookMeta(book.id, { ...next, updatedAt: new Date().toISOString() })
    setMeta(saved)
    onMeta(saved)
  }

  const words = stats?.words ?? 0
  const percent = meta.targetWords > 0 ? Math.min(100, Math.round((words / meta.targetWords) * 100)) : null
  const shownVersion = isCurrent && version ? version : stats?.version != null ? String(stats.version) : '—'

  return (
    <section className="book-profile" aria-label={`档案：${book.name}`}>
      <div className="profile-head">
        <Cover name={name || book.name} color={meta.cover} />
        <div className="profile-title">
          <input
            aria-label="书名"
            className="profile-name"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.currentTarget.value)}
            onBlur={() => {
              const next = name.trim()
              if (!next || next === book.name) {
                setName(book.name)
                return
              }
              void onRename(next).then((ok) => {
                if (!ok) {
                  setName(book.name)
                  setError('改名没成功，书名不变')
                }
              })
            }}
          />
          <p className="profile-sub">
            {formatWords(words)}
            {meta.targetWords > 0 ? ` / 目标 ${formatWords(meta.targetWords)}` : ''}
            {percent !== null ? ` · ${percent}%` : ''}
          </p>
          {percent !== null ? (
            <div className="profile-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <span style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </div>
        <button type="button" className="primary" disabled={busy} onClick={onOpen}>
          {isCurrent ? '回到画布' : '打开这本'}
        </button>
      </div>
      <div className="profile-grid">
        <label>
          状态
          <select value={meta.status} onChange={(event) => patch({ status: event.currentTarget.value as BookMeta['status'] })}>
            {BOOK_STATUSES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          题材
          <select value={meta.genre} onChange={(event) => patch({ genre: event.currentTarget.value })}>
            {(BOOK_GENRES as readonly string[]).includes(meta.genre) ? null : <option>{meta.genre}</option>}
            {BOOK_GENRES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          目标字数
          <input
            inputMode="numeric"
            value={meta.targetWords || ''}
            placeholder="未定"
            onChange={(event) => patch({ targetWords: Math.round(Number(event.currentTarget.value.replace(/[^\d]/g, '')) || 0) })}
          />
        </label>
        <label>
          视角
          <select value={meta.pov} onChange={(event) => patch({ pov: event.currentTarget.value })}>
            {POV_CHOICES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          笔名
          <input value={meta.penName} onChange={(event) => patch({ penName: event.currentTarget.value })} />
        </label>
        <label>
          系列
          <input value={meta.series} onChange={(event) => patch({ series: event.currentTarget.value })} />
        </label>
        <label>
          语言
          <input value={meta.language} onChange={(event) => patch({ language: event.currentTarget.value })} />
        </label>
        <div className="cover-pick">
          封面颜色
          <div role="radiogroup" aria-label="封面颜色">
            {COVER_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={meta.cover === color}
                aria-label={COVER_COLOR_NAMES[color]}
                className={meta.cover === color ? 'swatch on' : 'swatch'}
                style={{ background: color }}
                onClick={() => patch({ cover: color })}
              />
            ))}
          </div>
        </div>
        <label className="span-2">
          一句话简介
          <input value={meta.intro} onChange={(event) => patch({ intro: event.currentTarget.value })} />
        </label>
      </div>
      <dl className="profile-facts">
        <dt>创建</dt>
        <dd>{formatTime(meta.createdAt)}</dd>
        <dt>最后修改</dt>
        <dd>{formatTime(meta.updatedAt)}</dd>
        <dt>正本位置</dt>
        <dd>服务器（本机 8093 的数据目录）</dd>
        <dt>当前版本</dt>
        <dd>{shownVersion}</dd>
      </dl>
      <div className="profile-layers">
        <h3>雪花层进度</h3>
        {stats ? (
          <ul>
            {LAYERS.filter((layer) => (stats.layers[layer] ?? 0) > 0).map((layer) => (
              <li key={layer}>
                <span>{layerLabel(layer as Layer)}</span>
                <span>{stats.layers[layer]} 张</span>
              </li>
            ))}
            <li className="is-empty">
              <span>还空着的卡</span>
              <span>{stats.emptyCards} 张</span>
            </li>
          </ul>
        ) : (
          <p className="profile-muted">{stats === null ? '读不到这本书的正本' : '正在读…'}</p>
        )}
      </div>
      <div className="profile-danger">
        {confirming ? (
          <>
            <p role="alert">
              删掉「{book.name}」会把它在服务器上的整个目录一起删掉：正本、所有快照和讨论记录。删了不能撤销，也不能回退。确定要删吗？
            </p>
            <div className="profile-danger-bar">
              <button type="button" onClick={() => setConfirming(false)}>
                不删了
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  void onDelete().then((failure) => {
                    setConfirming(false)
                    if (failure) setError(failure)
                  })
                }}
              >
                确定删除
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="danger-quiet"
            disabled={busy || isCurrent}
            title={isCurrent ? '正在画布上写的这本不能删，先换到别的书' : undefined}
            onClick={() => setConfirming(true)}
          >
            {isCurrent ? '正在写的这本不能删' : '删除这本书'}
          </button>
        )}
        {error ? (
          <p className="status-line is-error" role="alert">
            出错：{error}
          </p>
        ) : null}
      </div>
    </section>
  )
}

export default function BooksPage({
  books,
  currentBookId,
  busy,
  version,
  startWizard,
  onBack,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  books: BookItem[]
  currentBookId: string | null
  busy: boolean
  version: string | null
  startWizard: boolean
  onBack: () => void
  onOpen: (id: string) => void
  onCreate: (input: NewBookInput) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<boolean>
  onDelete: (id: string) => Promise<string | null>
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [showArchived, setShowArchived] = useState(false)
  const [selected, setSelected] = useState<string | null>(currentBookId)
  const [wizard, setWizard] = useState(startWizard)
  const [stats, setStats] = useState<Record<string, BookStats | null>>({})
  const [metaTick, setMetaTick] = useState(0)

  const bookKey = books.map((book) => book.id).join(',')
  useEffect(() => {
    let cancelled = false
    for (const book of books) {
      void fetchBookStats(book.id).then((result) => {
        if (!cancelled) setStats((current) => ({ ...current, [book.id]: result }))
      })
    }
    return () => {
      cancelled = true
    }
    // 书目变了才重读，书名改动不用重算字数。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey])

  const rows = useMemo(() => {
    void metaTick
    const needle = query.trim().toLowerCase()
    const list = books
      .map((book) => ({ book, meta: readBookMeta(book.id), stats: stats[book.id] }))
      .filter(({ book, meta }) => {
        if (!showArchived && meta.status === '归档') return false
        if (!needle) return true
        return [book.name, meta.series, meta.penName, meta.genre].some((text) => text.toLowerCase().includes(needle))
      })
    list.sort((a, b) => {
      if (sort === 'name') return a.book.name.localeCompare(b.book.name, 'zh-Hans-CN')
      if (sort === 'words') return (b.stats?.words ?? 0) - (a.stats?.words ?? 0)
      return (b.meta.updatedAt || '').localeCompare(a.meta.updatedAt || '')
    })
    return list
  }, [books, stats, query, sort, showArchived, metaTick])

  const selectedBook = books.find((book) => book.id === selected) ?? null

  return (
    <main className="books-page" aria-label="书籍管理">
      <header className="books-head">
        <button type="button" onClick={onBack} disabled={!currentBookId}>
          ← 回到画布
        </button>
        <h1>书籍</h1>
        <input
          type="search"
          className="books-search"
          aria-label="搜索书名、系列、笔名"
          placeholder="搜索书名、系列、笔名"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <select aria-label="排序" value={sort} onChange={(event) => setSort(event.currentTarget.value as Sort)}>
          <option value="recent">最近改过</option>
          <option value="name">书名</option>
          <option value="words">字数</option>
        </select>
        <label className="books-archived">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.currentTarget.checked)} />
          显示已归档
        </label>
        <button type="button" className="primary" disabled={busy} onClick={() => setWizard(true)}>
          新建书
        </button>
      </header>
      <div className="books-body">
        <div className="books-shelf">
          {wizard ? (
            <NewBookWizard
              busy={busy}
              onCancel={() => setWizard(false)}
              onCreate={async (input) => {
                const ok = await onCreate(input)
                if (ok) setWizard(false)
                return ok
              }}
            />
          ) : null}
          {rows.length === 0 ? <p className="profile-muted">{query ? '没有对得上的书' : '还没有书'}</p> : null}
          <ul className="books-grid">
            {rows.map(({ book, meta, stats: bookStats }) => (
              <li key={book.id}>
                <button
                  type="button"
                  className={book.id === selected ? 'book-card is-on' : 'book-card'}
                  aria-pressed={book.id === selected}
                  onClick={() => setSelected(book.id)}
                  onDoubleClick={() => onOpen(book.id)}
                >
                  <Cover name={book.name} color={meta.cover} />
                  <span className="book-card-text">
                    <span className="book-card-name">
                      {book.name}
                      {book.id === currentBookId ? <span className="book-badge">正在写</span> : null}
                    </span>
                    <span className="book-card-meta">
                      {meta.genre} · <span className="book-status">{meta.status}</span>
                    </span>
                    <span className="book-card-meta">
                      {bookStats ? `${formatWords(bookStats.words)} · ${bookStats.cards} 张卡` : bookStats === null ? '读不到正本' : '正在读…'}
                    </span>
                    <span className="book-card-meta">
                      {meta.updatedAt ? `更新 ${formatTime(meta.updatedAt)}` : bookStats?.version != null ? `版本 ${bookStats.version}` : '更新 —'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {selectedBook ? (
          <BookProfile
            book={selectedBook}
            stats={stats[selectedBook.id]}
            isCurrent={selectedBook.id === currentBookId}
            busy={busy}
            version={version}
            onOpen={() => onOpen(selectedBook.id)}
            onRename={(name) => onRename(selectedBook.id, name)}
            onDelete={async () => {
              const failure = await onDelete(selectedBook.id)
              if (!failure) setSelected(currentBookId)
              return failure
            }}
            onMeta={() => setMetaTick((tick) => tick + 1)}
          />
        ) : null}
      </div>
    </main>
  )
}
