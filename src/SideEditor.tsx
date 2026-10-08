import { useEffect, useRef, useState } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view'
import {
  cardFace,
  choiceFields,
  defaultFieldKey,
  editorText,
  extraFieldKeys,
  fieldControlLabel,
  fieldGroups,
  fieldKeys,
  isChoiceField,
  laterLayers,
  layerLabel,
  nextLayer,
  type AppState,
  type Card,
  type Layer,
} from './document.ts'
import ExpandPanel from './ExpandPanel.tsx'
import type { ShownCandidate } from './expand.ts'
import FoldPanel from './FoldPanel.tsx'

function FieldButtons({
  card,
  cardId,
  fieldKey,
  onPick,
}: {
  card: Card
  cardId: string | null
  fieldKey: string | null
  onPick: (key: string) => void
}) {
  const groups = fieldGroups(card.layer)
  const extras = extraFieldKeys(card)
  const button = (key: string) => (
    <button
      key={key}
      type="button"
      className={key === fieldKey ? 'on' : ''}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!cardId) return
        onPick(key)
      }}
    >
      {fieldControlLabel(card.layer, key)}
    </button>
  )
  const textKeys = fieldKeys(card.layer).filter((key) => !isChoiceField(key))
  if (!groups) {
    return (
      <div className="field-row">
        {textKeys.map(button)}
        {extras.map(button)}
      </div>
    )
  }
  return (
    <>
      {groups.map((group) => (
        <div key={group.title} className="field-row">
          <span>{group.title}</span>
          {group.keys.map(button)}
        </div>
      ))}
      {extras.length > 0 ? <div className="field-row">{extras.map(button)}</div> : null}
    </>
  )
}

function eventData(event: Event): string {
  if (!('data' in event)) return ''
  const data = (event as CompositionEvent).data
  return typeof data === 'string' ? data : ''
}

function hasHan(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text)
}

function confirmedField(doc: string, pinyin: string, confirmed: string): string | null {
  if (!hasHan(confirmed)) return null
  if (pinyin && confirmed.includes(pinyin)) return null
  // Chrome 先把选好的字写进编辑器，再发组合结束。这时全文里已经没有拼音。
  if (!pinyin) {
    if (hasHan(doc) && !/^[A-Za-z]*$/.test(doc)) return doc
    if (doc.length === 0 || /^[A-Za-z]*$/.test(doc)) return confirmed
    return null
  }
  const at = doc.indexOf(pinyin)
  if (at < 0) {
    if (hasHan(doc)) return doc
    return null
  }
  const next = doc.slice(0, at) + confirmed + doc.slice(at + pinyin.length)
  if (next.includes(pinyin) || !hasHan(next)) return null
  return next
}

export default function SideEditor({
  cardId,
  card,
  documentState,
  groupSelected,
  canType,
  onCommit,
  onAdoptField,
  onChangeLayer,
  expandNotice,
  candidates,
  onExpand,
  onConfirmCandidate,
  onDismissCandidates,
}: {
  cardId: string | null
  card: Card | null
  documentState: AppState
  groupSelected: boolean
  canType: boolean
  onCommit: (cardId: string, fieldKey: string | null, text: string) => void
  onAdoptField: (fieldKey: string | null) => void
  onChangeLayer: (cardId: string, layer: Layer) => void
  expandNotice: string | null
  candidates: ShownCandidate[]
  onExpand: (cardId: string, fieldKey: string | null) => void
  onConfirmCandidate: (id: string) => void
  onDismissCandidates: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const editableRef = useRef<Compartment | null>(null)
  const composingRef = useRef(false)
  const pendingConfirmRef = useRef(false)
  const pinyinRef = useRef('')
  const lastCommitRef = useRef<string | null>(null)
  const applyingRef = useRef(false)
  const appliedRef = useRef<{ text: string; editable: boolean; cardId: string | null } | null>(null)
  const cardIdRef = useRef(cardId)
  const fieldKeyRef = useRef<string | null>(null)
  const onCommitRef = useRef(onCommit)
  const canTypeRef = useRef(canType)
  const [fieldOverride, setFieldOverride] = useState<{
    cardId: string
    layer: Layer
    key: string | null
  } | null>(null)

  cardIdRef.current = cardId
  onCommitRef.current = onCommit
  canTypeRef.current = canType

  const fieldKey =
    card && cardId
      ? fieldOverride && fieldOverride.cardId === cardId && fieldOverride.layer === card.layer
        ? fieldOverride.key
        : defaultFieldKey(card)
      : null
  fieldKeyRef.current = fieldKey

  useEffect(() => {
    onAdoptField(fieldKey)
  }, [fieldKey, onAdoptField])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const editable = new Compartment()
    editableRef.current = editable

    const emitCommit = (text: string) => {
      if (!canTypeRef.current || applyingRef.current) return
      if (lastCommitRef.current === text) return
      const currentId = cardIdRef.current
      if (!currentId) return
      lastCommitRef.current = text
      pendingConfirmRef.current = false
      pinyinRef.current = ''
      onCommitRef.current(currentId, fieldKeyRef.current, text)
    }

    const noteDraft = (update: { state: EditorState; changes: { iterChanges: (f: (fromA: number, toA: number, fromB: number, toB: number, inserted: { toString(): string }) => void) => void } }) => {
      let inserted = ''
      update.changes.iterChanges((_fromA, _toA, _fromB, _toB, insertedText) => {
        inserted += insertedText.toString()
      })
      if (/^[A-Za-z]+$/.test(inserted)) pinyinRef.current = inserted
      const full = update.state.doc.toString()
      if (!pinyinRef.current && /^[A-Za-z]+$/.test(full)) pinyinRef.current = full
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: '',
        extensions: [
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          placeholder('在这里写'),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          editable.of(EditorView.editable.of(false)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || applyingRef.current) return
            if (!canTypeRef.current) return
            if (composingRef.current || update.view.composing) {
              noteDraft(update)
              return
            }
            if (pendingConfirmRef.current) {
              const text = update.state.doc.toString()
              const pinyin = pinyinRef.current
              if (pinyin && text.includes(pinyin)) return
              if (!hasHan(text)) return
              emitCommit(text)
              return
            }
            emitCommit(update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            compositionstart() {
              composingRef.current = true
              pendingConfirmRef.current = false
              pinyinRef.current = ''
              return false
            },
            compositionupdate(event) {
              composingRef.current = true
              const data = eventData(event)
              if (/^[A-Za-z]+$/.test(data)) pinyinRef.current = data
              return false
            },
            compositionend(event, editor) {
              composingRef.current = false
              const data = eventData(event)
              const doc = editor.state.doc.toString()
              const next = confirmedField(doc, pinyinRef.current, data)
              if (!next) {
                pendingConfirmRef.current = true
                return false
              }
              if (doc !== next) {
                applyingRef.current = true
                editor.dispatch({ changes: { from: 0, to: doc.length, insert: next } })
                applyingRef.current = false
              }
              if (editor.composing || editor.state.doc.toString() !== next) {
                pendingConfirmRef.current = true
                return false
              }
              pendingConfirmRef.current = false
              emitCommit(next)
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
    return () => {
      view.destroy()
      viewRef.current = null
      editableRef.current = null
      appliedRef.current = null
    }
  }, [])

  const text = card ? editorText(card, fieldKey) : ''
  const face = card ? cardFace(card) : null
  const heldInField = Boolean(
    card &&
      face &&
      Object.values(card.fields).some((value) => {
        const trimmed = value.trim()
        if (!trimmed) return false
        const titleOk = face.title.trim().length === 0 || trimmed.includes(face.title.trim())
        const bodyOk = face.body.trim().length === 0 || trimmed.includes(face.body.trim())
        return titleOk && bodyOk
      }),
  )
  const showFaceBody = Boolean(face && face.body.trim() && face.body.trim() !== text.trim())
  const warnOrphan = Boolean(
    card &&
      face &&
      (face.title || face.body) &&
      !heldInField &&
      card.layer !== 'situation' &&
      card.layer !== '正文草稿' &&
      card.layer !== '一句话',
  )
  const editable = Boolean(card) && canType

  useEffect(() => {
    const view = viewRef.current
    const compartment = editableRef.current
    if (!view || !compartment) return
    const applied = appliedRef.current
    const cardSame = applied?.cardId === cardId
    if (!cardSame) {
      pendingConfirmRef.current = false
      composingRef.current = false
      pinyinRef.current = ''
      lastCommitRef.current = null
    }
    // 挂起只挡住同一张卡的回写。切卡后挂起已清，必须把编辑器换成这张卡的正文。
    if (cardSame && (composingRef.current || view.composing || pendingConfirmRef.current)) return
    const current = view.state.doc.toString()
    const textSame = current === text
    const editableSame = applied?.editable === editable
    if (textSame && editableSame && cardSame) return
    if (!textSame && cardSame && lastCommitRef.current !== null && lastCommitRef.current !== text) return
    applyingRef.current = true
    const effects = compartment.reconfigure(EditorView.editable.of(editable))
    if (!textSame && !editableSame) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: text },
        effects,
      })
    } else if (!textSame) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: text } })
    } else {
      view.dispatch({ effects })
    }
    applyingRef.current = false
    appliedRef.current = { text, editable, cardId }
    lastCommitRef.current = text
  }, [text, editable, cardId])

  const later = card ? laterLayers(card.layer) : []
  const upcoming = card ? nextLayer(card.layer) : null

  return (
    <aside className="side">
      <div className="side-head">
        {card ? (
          <>
            <strong>{layerLabel(card.layer)}</strong>
            <p className="hint">输入法选字结束前，这张卡片上的字不会变。</p>
          </>
        ) : groupSelected ? (
          <strong>分组</strong>
        ) : (
          <strong>还没有打开卡片。点一张卡片，在这里改。</strong>
        )}
      </div>

      {card && face ? (
        <div className="side-face">
          <p className="side-face-title">{face.title || '还没有写下内容'}</p>
          {showFaceBody ? <p className="side-face-body">{face.body}</p> : null}
          {face.meta ? <p className="side-face-meta">{face.meta}</p> : null}
          {warnOrphan ? (
            <p className="side-face-note">这段写在卡片正文里，不在当前字段。改字段会按字段重写正文，这段会被盖掉。</p>
          ) : null}
        </div>
      ) : null}

      {card ? (
        <>
          <p className="hint">
            {upcoming
              ? `从这张卡片右边拖到空白处，默认长成${layerLabel(upcoming)}。`
              : '已经是最后一层，不能再往外长出新卡片。'}
          </p>
          {later.length > 0 ? (
            <div className="field-row">
              <span>改成更后面的层</span>
              {later.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  onClick={() => {
                    if (!canType || !cardId || composingRef.current || viewRef.current?.composing) return
                    onChangeLayer(cardId, layer)
                  }}
                >
                  {layerLabel(layer)}
                </button>
              ))}
            </div>
          ) : null}
          {choiceFields(card.layer).map((choice) => {
            const current = card.fields[choice.key] ?? ''
            const options = choice.options.some((option) => option.value === current)
              ? choice.options
              : [{ value: current, label: current }, ...choice.options]
            return (
              <label key={choice.key} className="fold-field field-row">
                {choice.label}
                <select
                  aria-label={choice.label}
                  value={current}
                  onChange={(event) => {
                    if (!canType || !cardId || composingRef.current || viewRef.current?.composing) return
                    onCommit(cardId, choice.key, event.target.value)
                  }}
                >
                  {options.map((option) => (
                    <option key={option.value || 'empty'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
          {card.layer === 'changci' ? (
            <p className="hint">主动时写目标、冲突、挫折；反应时写反应、两难、决定。这些都可以空着。</p>
          ) : null}
          {fieldKeys(card.layer).some((key) => !isChoiceField(key)) || extraFieldKeys(card).length > 0 ? (
            <FieldButtons
              card={card}
              cardId={cardId}
              fieldKey={fieldKey}
              onPick={(key) => {
                if (composingRef.current || viewRef.current?.composing) return
                if (!cardId) return
                setFieldOverride({ cardId, layer: card.layer, key })
              }}
            />
          ) : (
            <p className="hint">全文</p>
          )}
          {cardId ? (
            <FoldPanel key={`${cardId}:${card.layer}`} cardId={cardId} card={card} documentState={documentState} />
          ) : null}
          {cardId ? (
            <ExpandPanel
              canType={canType}
              notice={expandNotice}
              candidates={candidates.filter((item) => item.cardId === cardId)}
              onExpand={() => {
                if (!canType || composingRef.current || viewRef.current?.composing) return
                onExpand(cardId, fieldKey)
              }}
              onConfirm={(id) => {
                if (!canType || composingRef.current || viewRef.current?.composing) return
                onConfirmCandidate(id)
              }}
              onDismiss={onDismissCandidates}
            />
          ) : null}
        </>
      ) : (
        <p className="hint">
          {groupSelected
            ? '这是分组，没有雪花卡片。删分组不会带走圈里的卡片。'
            : '点一张卡片，在这里改。空白处双击，或点「新建念头」，放一张念头。'}
        </p>
      )}

      <div className="cm-host" ref={hostRef} aria-label="卡片编辑器" />
    </aside>
  )
}
