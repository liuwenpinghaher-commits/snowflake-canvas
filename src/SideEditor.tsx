import { useEffect, useRef, useState } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view'
import {
  FIELD_LABEL,
  defaultFieldKey,
  editorText,
  fieldKeys,
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

export default function SideEditor({
  cardId,
  card,
  documentState,
  groupSelected,
  canType,
  onCommit,
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
  const applyingRef = useRef(false)
  const appliedRef = useRef<{ text: string; editable: boolean } | null>(null)
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
    const host = hostRef.current
    if (!host) return
    const editable = new Compartment()
    editableRef.current = editable
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
            if (composingRef.current || update.view.composing) return
            const currentId = cardIdRef.current
            if (!currentId) return
            onCommitRef.current(currentId, fieldKeyRef.current, update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            compositionstart() {
              composingRef.current = true
              return false
            },
            compositionend(_event, view) {
              composingRef.current = false
              queueMicrotask(() => {
                if (!canTypeRef.current || composingRef.current || applyingRef.current) return
                const currentId = cardIdRef.current
                if (!currentId) return
                onCommitRef.current(currentId, fieldKeyRef.current, view.state.doc.toString())
              })
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
  const editable = Boolean(card) && canType

  useEffect(() => {
    const view = viewRef.current
    const compartment = editableRef.current
    if (!view || !compartment) return
    if (composingRef.current || view.composing) return
    const applied = appliedRef.current
    const current = view.state.doc.toString()
    const textSame = current === text
    const editableSame = applied?.editable === editable
    if (textSame && editableSame) return
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
    appliedRef.current = { text, editable }
  }, [text, editable])

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
          <strong>还没有打开卡片</strong>
        )}
      </div>

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
          {fieldKeys(card.layer).length > 0 ? (
            <div className="field-row">
              {fieldKeys(card.layer).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={key === fieldKey ? 'on' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (composingRef.current || viewRef.current?.composing) return
                    if (!cardId) return
                    setFieldOverride({ cardId, layer: card.layer, key })
                  }}
                >
                  {FIELD_LABEL[key] ?? key}
                </button>
              ))}
            </div>
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
