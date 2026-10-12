import { useEffect, useRef, useState } from 'react'
import { history, historyKeymap, insertNewline, undo, undoDepth, defaultKeymap } from '@codemirror/commands'
import { Compartment, EditorState, Prec, Transaction } from '@codemirror/state'
import { drawSelection, EditorView, keymap, placeholder, type ViewUpdate } from '@codemirror/view'
import { latestWriteSeq } from './persist.ts'
import {
  applyBlockEvent,
  blockSessionFromBlocks,
  blocksToText,
  filterSlash,
  insertedSlashTrigger,
  isBlockWire,
  slashQueryOf,
  textToBlocks,
  type Block,
  type BlockType,
  type SlashState,
} from './block-editor.ts'

function changedSpan(before: string, after: string): { from: number; to: number; insert: string } {
  const max = Math.min(before.length, after.length)
  let head = 0
  while (head < max && before.charCodeAt(head) === after.charCodeAt(head)) head += 1
  let tail = 0
  while (
    tail < max - head &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail += 1
  }
  return { from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) }
}

function rebaseEdit(base: string, mine: string, theirs: string): string | null {
  const own = changedSpan(base, mine)
  const other = changedSpan(base, theirs)
  if (other.to <= own.from) {
    return base.slice(0, other.from) + other.insert + base.slice(other.to, own.from) + own.insert + base.slice(own.to)
  }
  if (other.from >= own.to) {
    return base.slice(0, own.from) + own.insert + base.slice(own.to, other.from) + other.insert + base.slice(other.to)
  }
  return null
}

function preservePlainId(current: readonly Block[], incoming: readonly Block[], text: string): Block[] {
  if (
    !isBlockWire(text) &&
    incoming.length === 1 &&
    incoming[0]?.type === 'paragraph' &&
    current.length === 1 &&
    current[0]?.type === 'paragraph'
  ) {
    return [{ ...current[0], text: incoming[0].text }]
  }
  return incoming.slice()
}

interface Handlers {
  onUpdate: (id: string, update: ViewUpdate) => void
  onEnter: (id: string, view: EditorView) => boolean
  onEscape: (id: string) => boolean
  onFocus: (id: string, view: EditorView) => void
  onCompositionStart: () => void
  onCompositionEnd: (id: string, view: EditorView) => void
  onBlur: (id: string, view: EditorView) => void
  undoStructural: (view: EditorView) => boolean
}

export default function BlockField({
  cardId,
  fieldKey,
  text,
  editable,
  canType,
  stateSeq,
  onCommit,
  onPovLeave,
  composingRef,
  viewRef,
}: {
  cardId: string | null
  fieldKey: string | null
  text: string
  editable: boolean
  canType: boolean
  stateSeq: number
  onCommit: (cardId: string, fieldKey: string | null, text: string) => void
  onPovLeave?: (cardId: string, text: string) => void
  composingRef: { current: boolean }
  viewRef: { current: { composing: boolean } | null }
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => textToBlocks(text))
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const blocksRef = useRef(blocks)
  const pastRef = useRef<Block[][]>([])
  const slashRef = useRef<SlashState | null>(null)
  const selectedRef = useRef<number | null>(null)
  const activeRef = useRef(0)
  const viewsRef = useRef(new Map<string, EditorView>())
  const compartmentsRef = useRef(new Map<string, Compartment>())
  const focusRef = useRef<{ id: string; cursor: number } | null>(null)
  const applyingRef = useRef(false)
  const externalHeldRef = useRef(false)
  const aliveRef = useRef(true)
  const editableRef = useRef(editable)
  const canTypeRef = useRef(canType)
  const textRef = useRef(text)
  const lastCommitRef = useRef<string | null>(text)
  const onCommitRef = useRef(onCommit)
  const onPovLeaveRef = useRef(onPovLeave)
  const appliedRef = useRef({ editable, cardId, fieldKey })
  const handlersRef = useRef<Handlers>(null as unknown as Handlers)

  editableRef.current = editable
  canTypeRef.current = canType
  textRef.current = text
  onCommitRef.current = onCommit
  onPovLeaveRef.current = onPovLeave

  const readBlocks = (): Block[] =>
    blocksRef.current.map((block) => {
      const view = viewsRef.current.get(block.id)
      if (!view || applyingRef.current) return block
      return { ...block, text: view.state.doc.toString() }
    })

  const emitCommit = (wire: string) => {
    if (!canTypeRef.current || applyingRef.current) return
    if (lastCommitRef.current === wire) return
    const target = appliedRef.current
    if (!target.cardId) return
    lastCommitRef.current = wire
    onCommitRef.current(target.cardId, target.fieldKey, wire)
  }

  const patchView = (id: string, next: string) => {
    const view = viewsRef.current.get(id)
    if (!view) return
    const current = view.state.doc.toString()
    if (current === next) return
    applyingRef.current = true
    view.dispatch({
      changes: changedSpan(current, next),
      annotations: Transaction.addToHistory.of(false),
    })
    applyingRef.current = false
  }

  const syncSlash = (index: number, doc: string, cursor: number, before?: string) => {
    const open = slashRef.current
    if (open && open.index === index) {
      const query = slashQueryOf(doc, cursor)
      if (query === null) {
        slashRef.current = null
        setSlash(null)
      } else if (query !== open.query) {
        slashRef.current = { index, query }
        setSlash(slashRef.current)
      }
      return
    }
    if (!open && before !== undefined && insertedSlashTrigger(before, doc, cursor)) {
      slashRef.current = { index, query: slashQueryOf(doc, cursor) ?? '' }
      setSlash(slashRef.current)
    }
  }

  const commitSession = (
    session: ReturnType<typeof applyBlockEvent>,
    focus?: { id: string; cursor: number },
  ) => {
    blocksRef.current = session.blocks
    pastRef.current = session.past
    slashRef.current = session.slash
    selectedRef.current = session.selected
    activeRef.current = session.active
    setBlocks(session.blocks)
    setSlash(session.slash)
    setSelected(session.selected)
    for (const block of session.blocks) patchView(block.id, block.text)
    if (focus) focusRef.current = focus
    emitCommit(blocksToText(session.blocks))
  }

  const sessionNow = () => {
    const session = blockSessionFromBlocks(readBlocks(), pastRef.current)
    session.active = activeRef.current
    session.slash = slashRef.current
    session.selected = selectedRef.current
    session.composing = composingRef.current
    return session
  }

  const writeBackFull = (editor: EditorView, id: string) => {
    if (!aliveRef.current || composingRef.current || editor.composing || applyingRef.current) return
    const doc = editor.state.doc.toString()
    const index = blocksRef.current.findIndex((block) => block.id === id)
    if (index < 0) return
    if (!externalHeldRef.current) {
      blocksRef.current = blocksRef.current.map((block, item) => (item === index ? { ...block, text: doc } : block))
      syncSlash(index, doc, editor.state.selection.main.head)
      emitCommit(blocksToText(blocksRef.current))
      return
    }
    externalHeldRef.current = false
    const base = lastCommitRef.current ?? ''
    const theirs = textRef.current
    const plain = !isBlockWire(base) && !isBlockWire(theirs) && blocksRef.current.length === 1 && !isBlockWire(doc)
    if (plain) {
      const merged = theirs === base ? doc : (rebaseEdit(base, doc, theirs) ?? doc)
      if (merged !== doc) {
        applyingRef.current = true
        editor.dispatch({
          changes: changedSpan(doc, merged),
          annotations: Transaction.addToHistory.of(false),
        })
        applyingRef.current = false
      }
      blocksRef.current = blocksRef.current.map((block, item) => (item === index ? { ...block, text: merged } : block))
      lastCommitRef.current = theirs
      emitCommit(merged)
      return
    }
    blocksRef.current = blocksRef.current.map((block, item) => (item === index ? { ...block, text: doc } : block))
    lastCommitRef.current = theirs
    emitCommit(blocksToText(blocksRef.current))
  }

  handlersRef.current = {
    onUpdate(id, update) {
      viewRef.current = update.view
      if (applyingRef.current || !canTypeRef.current) return
      if (composingRef.current || update.view.composing) return
      if (!update.docChanged) return
      const index = blocksRef.current.findIndex((block) => block.id === id)
      if (index < 0) return
      activeRef.current = index
      if (externalHeldRef.current) {
        writeBackFull(update.view, id)
        return
      }
      const before = update.startState.doc.toString()
      const after = update.state.doc.toString()
      blocksRef.current = blocksRef.current.map((block, item) => (item === index ? { ...block, text: after } : block))
      syncSlash(index, after, update.state.selection.main.head, before)
      emitCommit(blocksToText(blocksRef.current))
    },
    onEnter(id, view) {
      if (composingRef.current || view.composing || !canTypeRef.current || !editableRef.current) return false
      const index = blocksRef.current.findIndex((block) => block.id === id)
      if (index < 0) return true
      const sel = view.state.selection.main
      const start = Math.min(sel.from, sel.to)
      const end = Math.max(sel.from, sel.to)
      let blocksNow = readBlocks()
      if (start !== end && blocksNow[index]) {
        const current = blocksNow[index].text
        const collapsed = current.slice(0, start) + current.slice(end)
        blocksNow = blocksNow.map((block, item) => (item === index ? { ...block, text: collapsed } : block))
      }
      let session = blockSessionFromBlocks(blocksNow, pastRef.current)
      session.active = index
      session.slash = slashRef.current
      session.selected = selectedRef.current
      session = applyBlockEvent(session, { type: 'enter', index, cursor: start })
      const focus = session.blocks[session.active]
      commitSession(session, focus ? { id: focus.id, cursor: 0 } : undefined)
      return true
    },
    onEscape(id) {
      if (composingRef.current) return false
      const index = blocksRef.current.findIndex((block) => block.id === id)
      let session = sessionNow()
      session.active = index < 0 ? session.active : index
      session = applyBlockEvent(session, { type: 'escape' })
      blocksRef.current = session.blocks
      pastRef.current = session.past
      slashRef.current = session.slash
      selectedRef.current = session.selected
      activeRef.current = session.active
      setBlocks(session.blocks)
      setSlash(session.slash)
      setSelected(session.selected)
      return true
    },
    onFocus(id, view) {
      viewRef.current = view
      const index = blocksRef.current.findIndex((block) => block.id === id)
      if (index >= 0) activeRef.current = index
    },
    onCompositionStart() {
      composingRef.current = true
    },
    onCompositionEnd(id, view) {
      composingRef.current = false
      const run = () => {
        if (!aliveRef.current) return
        writeBackFull(view, id)
      }
      queueMicrotask(run)
      window.setTimeout(run, 0)
      window.setTimeout(run, 80)
    },
    onBlur(id, view) {
      const target = appliedRef.current
      if (!target.cardId || target.fieldKey !== 'pov') return
      const index = blocksRef.current.findIndex((block) => block.id === id)
      const doc = view.state.doc.toString()
      if (index >= 0) {
        blocksRef.current = blocksRef.current.map((block, item) => (item === index ? { ...block, text: doc } : block))
      }
      onPovLeaveRef.current?.(target.cardId, blocksToText(blocksRef.current))
    },
    undoStructural(view) {
      if (composingRef.current || view.composing) return false
      if (undoDepth(view.state) > 0) return undo(view)
      if (pastRef.current.length === 0) return false
      let session = sessionNow()
      session = applyBlockEvent(session, { type: 'undo' })
      const focus = session.blocks[Math.min(session.active, session.blocks.length - 1)]
      commitSession(session, focus ? { id: focus.id, cursor: focus.text.length } : undefined)
      return true
    },
  }

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      const applied = appliedRef.current
      const wire = blocksToText(blocksRef.current)
      if (
        applied.cardId &&
        !composingRef.current &&
        canTypeRef.current &&
        lastCommitRef.current !== null &&
        wire !== lastCommitRef.current
      ) {
        onCommitRef.current(applied.cardId, applied.fieldKey, wire)
      }
      composingRef.current = false
      viewRef.current = null
    }
  }, [composingRef, viewRef])

  useEffect(() => {
    const applied = appliedRef.current
    const same = applied.cardId === cardId && applied.fieldKey === fieldKey
    if (applied.editable !== editable) {
      applyingRef.current = true
      for (const [id, view] of viewsRef.current) {
        const compartment = compartmentsRef.current.get(id)
        if (!compartment) continue
        view.dispatch({ effects: compartment.reconfigure(EditorView.editable.of(editable)) })
      }
      applyingRef.current = false
    }
    if (!same) {
      if (applied.cardId && !composingRef.current && canTypeRef.current && lastCommitRef.current !== null) {
        const wire = blocksToText(blocksRef.current)
        if (wire !== lastCommitRef.current) onCommitRef.current(applied.cardId, applied.fieldKey, wire)
      }
      composingRef.current = false
      externalHeldRef.current = false
      slashRef.current = null
      selectedRef.current = null
      pastRef.current = []
      const next = textToBlocks(text)
      blocksRef.current = next
      setBlocks(next)
      setSlash(null)
      setSelected(null)
      lastCommitRef.current = text
      appliedRef.current = { editable, cardId, fieldKey }
      return
    }
    const wire = blocksToText(readBlocks())
    if (wire === text) {
      appliedRef.current = { editable, cardId, fieldKey }
      return
    }
    const own = stateSeq !== 0 && stateSeq === latestWriteSeq()
    const composing = composingRef.current || Boolean(viewRef.current?.composing)
    if (composing) {
      if (!own) externalHeldRef.current = true
      appliedRef.current = { editable, cardId, fieldKey }
      return
    }
    if (!own) {
      const next = preservePlainId(blocksRef.current, textToBlocks(text), text)
      blocksRef.current = next
      pastRef.current = []
      slashRef.current = null
      setBlocks(next)
      setSlash(null)
      lastCommitRef.current = text
      externalHeldRef.current = false
      for (const block of next) patchView(block.id, block.text)
    }
    appliedRef.current = { editable, cardId, fieldKey }
  }, [text, cardId, fieldKey, editable, stateSeq, composingRef, viewRef])

  const pick = (blockType: BlockType) => {
    if (composingRef.current || !canTypeRef.current) return
    let session = sessionNow()
    session = applyBlockEvent(session, { type: 'slashPick', blockType })
    const focus = session.blocks[session.active]
    commitSession(session, focus ? { id: focus.id, cursor: focus.text.length } : undefined)
  }

  const moveBlock = (from: number, to: number) => {
    if (composingRef.current || !canTypeRef.current || !editableRef.current) return
    let session = sessionNow()
    session = applyBlockEvent(session, { type: 'move', from, to })
    commitSession(session)
  }

  const toggleTodo = (index: number) => {
    if (composingRef.current || !canTypeRef.current || !editableRef.current) return
    let session = sessionNow()
    session = applyBlockEvent(session, { type: 'toggleTodo', index })
    commitSession(session)
  }

  const enterDivider = (index: number) => {
    if (composingRef.current || !canTypeRef.current || !editableRef.current) return
    let session = sessionNow()
    session.active = index
    session = applyBlockEvent(session, { type: 'enter', index, cursor: 0 })
    const focus = session.blocks[session.active]
    commitSession(session, focus ? { id: focus.id, cursor: 0 } : undefined)
  }

  return (
    <div className={blocks.length === 1 ? 'sf-blocks is-single' : 'sf-blocks'}>
      {blocks.map((block, index) => (
        <BlockRow
          key={block.id}
          block={block}
          index={index}
          selected={selected === index}
          slash={slash && slash.index === index ? slash : null}
          editableRef={editableRef}
          applyingRef={applyingRef}
          composingRef={composingRef}
          viewsRef={viewsRef}
          compartmentsRef={compartmentsRef}
          focusRef={focusRef}
          handlersRef={handlersRef}
          onPick={pick}
          onMove={moveBlock}
          onToggle={() => toggleTodo(index)}
          onDividerEnter={() => enterDivider(index)}
        />
      ))}
    </div>
  )
}

function BlockRow({
  block,
  index,
  selected,
  slash,
  editableRef,
  applyingRef,
  composingRef,
  viewsRef,
  compartmentsRef,
  focusRef,
  handlersRef,
  onPick,
  onMove,
  onToggle,
  onDividerEnter,
}: {
  block: Block
  index: number
  selected: boolean
  slash: SlashState | null
  editableRef: { current: boolean }
  applyingRef: { current: boolean }
  composingRef: { current: boolean }
  viewsRef: { current: Map<string, EditorView> }
  compartmentsRef: { current: Map<string, Compartment> }
  focusRef: { current: { id: string; cursor: number } | null }
  handlersRef: { current: Handlers }
  onPick: (type: BlockType) => void
  onMove: (from: number, to: number) => void
  onToggle: () => void
  onDividerEnter: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || block.type === 'divider') return
    const compartment = new Compartment()
    compartmentsRef.current.set(block.id, compartment)
    const id = block.id
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: block.text,
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          placeholder('在这里写'),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-z',
                run: (editor) => handlersRef.current.undoStructural(editor),
              },
              {
                key: 'Shift-Enter',
                run: (editor) => {
                  if (composingRef.current || editor.composing) return false
                  return insertNewline(editor)
                },
              },
              {
                key: 'Enter',
                run: (editor) => handlersRef.current.onEnter(id, editor),
              },
              {
                key: 'Escape',
                run: () => handlersRef.current.onEscape(id),
              },
            ]),
          ),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          compartment.of(EditorView.editable.of(editableRef.current)),
          EditorView.updateListener.of((update) => {
            if (applyingRef.current) return
            handlersRef.current.onUpdate(id, update)
          }),
          EditorView.domEventHandlers({
            focus(_event, editor) {
              handlersRef.current.onFocus(id, editor)
              return false
            },
            blur(_event, editor) {
              handlersRef.current.onBlur(id, editor)
              return false
            },
            compositionstart() {
              handlersRef.current.onCompositionStart()
              return false
            },
            compositionend(_event, editor) {
              handlersRef.current.onCompositionEnd(id, editor)
              return false
            },
          }),
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
            '.cm-content': { fontFamily: 'inherit' },
          }),
        ],
      }),
    })
    viewRef.current = view
    viewsRef.current.set(id, view)
    const focus = focusRef.current
    if (focus && focus.id === id) {
      const cursor = Math.min(focus.cursor, view.state.doc.length)
      view.dispatch({ selection: { anchor: cursor } })
      view.focus()
      focusRef.current = null
    }
    return () => {
      view.destroy()
      if (viewRef.current === view) viewRef.current = null
      viewsRef.current.delete(id)
      compartmentsRef.current.delete(id)
    }
  }, [applyingRef, block.id, block.type, compartmentsRef, composingRef, editableRef, focusRef, handlersRef, viewsRef])

  useEffect(() => {
    const view = viewRef.current
    if (!view || block.type === 'divider') return
    if (composingRef.current || view.composing) return
    const current = view.state.doc.toString()
    if (current !== block.text) {
      applyingRef.current = true
      view.dispatch({
        changes: changedSpan(current, block.text),
        annotations: Transaction.addToHistory.of(false),
      })
      applyingRef.current = false
    }
    const focus = focusRef.current
    if (focus && focus.id === block.id) {
      const cursor = Math.min(focus.cursor, view.state.doc.length)
      view.dispatch({ selection: { anchor: cursor } })
      view.focus()
      focusRef.current = null
    }
  }, [applyingRef, block.id, block.text, block.type, composingRef, focusRef])

  const items = slash ? filterSlash(slash.query) : []
  return (
    <div
      className={selected ? `sf-block is-selected sf-${block.type}` : `sf-block sf-${block.type}`}
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        const raw = event.dataTransfer.getData('text/plain')
        if (!/^\d+$/.test(raw)) return
        const from = Number(raw)
        onMove(from, index)
      }}
    >
      <button
        type="button"
        className="sf-handle"
        draggable
        aria-label="拖动这一块"
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', String(index))
          event.dataTransfer.effectAllowed = 'move'
        }}
      >
        ⋮⋮
      </button>
      {block.type === 'todo' ? (
        <input
          type="checkbox"
          aria-label={block.checked ? '待办已完成' : '待办未完成'}
          checked={Boolean(block.checked)}
          onChange={onToggle}
        />
      ) : null}
      {block.type === 'divider' ? (
        <hr
          className="sf-divider"
          aria-label="分隔线"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onDividerEnter()
            }
          }}
        />
      ) : (
        <div className={`sf-editor sf-${block.type}`} ref={hostRef} />
      )}
      {slash ? (
        <ul className="sf-slash" role="listbox" aria-label="块类型">
          {items.map((item, itemIndex) => (
            <li key={item.type}>
              <button
                type="button"
                aria-selected={itemIndex === 0}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(item.type)}
              >
                {item.label}
              </button>
            </li>
          ))}
          {items.length === 0 ? <li className="sf-slash-empty">没有这一项</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
