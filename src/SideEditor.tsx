import { useEffect, useRef, useState } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap, placeholder } from '@codemirror/view'
import {
  cardFace,
  choiceFields,
  defaultFieldKey,
  describeLayerChange,
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
import { PersonZones } from './CastPage.tsx'
import { entityForPersonCard, gradeVisibility } from './person-form.ts'
import { nextStepHint, pipelineGroupLabel, pipelineGroupProgress } from './card-layout.ts'
import ExpandPanel from './ExpandPanel.tsx'
import type { ShownCandidate } from './expand.ts'
import FoldPanel from './FoldPanel.tsx'
import { latestWriteSeq, writeSeqOf } from './persist.ts'

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

function changedSpan(before: string, after: string): { from: number; to: number; insert: string } {
  const max = Math.min(before.length, after.length)
  let head = 0
  while (head < max && before.charCodeAt(head) === after.charCodeAt(head)) head += 1
  let tail = 0
  while (tail < max - head && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) {
    tail += 1
  }
  return { from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) }
}

// 组合期间卡片被外部改了：两边改的位置不重叠时，把本次组合的字叠到外部改动上。
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
  onApply,
  onOpenIdea,
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
  onApply: (recipe: (state: AppState) => AppState) => void
  onOpenIdea: (cardId: string, sessionId?: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const editableRef = useRef<Compartment | null>(null)
  const composingRef = useRef(false)
  const externalHeldRef = useRef(false)
  const lastCommitRef = useRef<string | null>(null)
  const applyingRef = useRef(false)
  const appliedRef = useRef<{ editable: boolean; cardId: string | null; fieldKey: string | null } | null>(null)
  const cardTextRef = useRef('')
  const onCommitRef = useRef(onCommit)
  const canTypeRef = useRef(canType)
  const [fieldOverride, setFieldOverride] = useState<{
    cardId: string
    layer: Layer
    key: string | null
  } | null>(null)
  const [faceOpen, setFaceOpen] = useState(false)
  // 分组折叠只留在这栏，不写入 snowflake.json，也不进撤销。
  const [pipelineCollapsed, setPipelineCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setFaceOpen(false)
  }, [cardId])

  onCommitRef.current = onCommit
  canTypeRef.current = canType

  const fieldKey =
    card && cardId
      ? fieldOverride && fieldOverride.cardId === cardId && fieldOverride.layer === card.layer
        ? fieldOverride.key
        : defaultFieldKey(card)
      : null

  useEffect(() => {
    onAdoptField(fieldKey)
  }, [fieldKey, onAdoptField])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const editable = new Compartment()
    editableRef.current = editable

    // 编辑器里的全文属于 appliedRef 记下的那张卡、那个字段，写回只往那里写。
    const emitCommit = (text: string) => {
      if (!canTypeRef.current || applyingRef.current) return
      if (lastCommitRef.current === text) return
      const target = appliedRef.current
      if (!target?.cardId) return
      lastCommitRef.current = text
      onCommitRef.current(target.cardId, target.fieldKey, text)
    }

    const writeBackFull = (editor: EditorView) => {
      if (composingRef.current || editor.composing || applyingRef.current) return
      const doc = editor.state.doc.toString()
      if (!externalHeldRef.current) {
        emitCommit(doc)
        return
      }
      externalHeldRef.current = false
      const base = lastCommitRef.current ?? ''
      const theirs = cardTextRef.current
      const merged = theirs === base ? doc : (rebaseEdit(base, doc, theirs) ?? doc)
      if (merged !== doc) {
        applyingRef.current = true
        editor.dispatch({ changes: changedSpan(doc, merged) })
        applyingRef.current = false
      }
      lastCommitRef.current = theirs
      emitCommit(merged)
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
            if (applyingRef.current || !canTypeRef.current) return
            if (composingRef.current || update.view.composing) return
            if (!update.docChanged && update.state.doc.toString() === lastCommitRef.current) return
            writeBackFull(update.view)
          }),
          EditorView.domEventHandlers({
            compositionstart() {
              composingRef.current = true
              return false
            },
            compositionend(_event, editor) {
              composingRef.current = false
              // 上屏的字可能在组合结束之后才进编辑器；等这一轮更新落定再按全文写回。
              queueMicrotask(() => writeBackFull(editor))
              window.setTimeout(() => writeBackFull(editor), 0)
              window.setTimeout(() => writeBackFull(editor), 80)
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
  const personLayer = Boolean(
    card && (card.layer === 'renwubiao' || card.layer === 'renwugushi' || card.layer === 'renwudangan'),
  )
  const personEntity = cardId && personLayer ? entityForPersonCard(documentState, cardId) : undefined
  const visibility = gradeVisibility(personEntity?.fields.grade?.value ?? card?.fields.grade)
  const editable = Boolean(card) && canType && !personLayer

  cardTextRef.current = text
  const stateSeq = writeSeqOf(documentState)

  useEffect(() => {
    const view = viewRef.current
    const compartment = editableRef.current
    if (!view || !compartment) return
    const applied = appliedRef.current
    const composing = composingRef.current || view.composing
    const current = view.state.doc.toString()
    const sameTarget = applied !== null && applied.cardId === cardId && applied.fieldKey === fieldKey
    const effects = applied?.editable === editable ? [] : [compartment.reconfigure(EditorView.editable.of(editable))]
    if (!sameTarget) {
      // 换卡或换字段前，上一处还没写回的字先写回上一处。
      if (applied?.cardId && !composing && lastCommitRef.current !== null && current !== lastCommitRef.current) {
        if (canTypeRef.current) onCommitRef.current(applied.cardId, applied.fieldKey, current)
      }
      composingRef.current = false
      externalHeldRef.current = false
      applyingRef.current = true
      view.dispatch({ changes: { from: 0, to: current.length, insert: text }, effects })
      applyingRef.current = false
      appliedRef.current = { editable, cardId, fieldKey }
      lastCommitRef.current = text
      return
    }
    let changes: ReturnType<typeof changedSpan> | null = null
    if (current !== text) {
      // 编号对得上：卡片文字就是本编辑器刚写回的那一份，编辑器不重刷。
      const own = stateSeq !== 0 && stateSeq === latestWriteSeq()
      if (composing) {
        if (!own) externalHeldRef.current = true
      } else if (!own) {
        changes = changedSpan(current, text)
      }
    }
    if (changes || effects.length > 0) {
      applyingRef.current = true
      view.dispatch(changes ? { changes, effects } : { effects })
      applyingRef.current = false
    }
    if (changes) {
      externalHeldRef.current = false
      lastCommitRef.current = text
    }
    appliedRef.current = { editable, cardId, fieldKey }
  }, [text, editable, cardId, fieldKey, stateSeq, documentState])

  const later = card ? laterLayers(card.layer) : []
  const upcoming = card ? nextLayer(card.layer) : null
  const pipeline = pipelineGroupProgress(documentState.snowflake.cards)
  const stepHint = nextStepHint(documentState.snowflake.cards)

  return (
    <div className="side-editor">
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
        <div className="side-face-wrap">
          <div className="side-face-bar">
            <button type="button" onClick={() => setFaceOpen((open) => !open)}>
              {faceOpen ? '收起卡面' : '展开卡面'}
            </button>
          </div>
          <div className={faceOpen ? 'side-face is-open' : 'side-face'}>
            <p className="side-face-title">{face.title || '还没有写下内容'}</p>
            {showFaceBody ? <p className="side-face-body">{face.body}</p> : null}
            {face.meta ? <p className="side-face-meta">{face.meta}</p> : null}
            {warnOrphan ? (
              <p className="side-face-note">这段写在卡片正文里，不在当前字段。改字段会按字段重写正文，这段会被盖掉。</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {card && personLayer && personEntity ? (
        <div className="person-side" data-grade={visibility.level}>
          <PersonZones
            state={documentState}
            entity={personEntity}
            cardId={cardId}
            canEdit={canType}
            onApply={onApply}
            onOpenIdea={onOpenIdea}
          />
        </div>
      ) : card ? (
        <>
          <p className="hint">
            {upcoming
              ? `从这张卡片右边拖到空白处，默认长成${layerLabel(upcoming)}。`
              : '已经是最后一层，不能再往外长出新卡片。'}
          </p>
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
        </>
      ) : (
        <p className="hint">
          {groupSelected
            ? '这是分组，没有雪花卡片。删分组不会带走圈里的卡片。'
            : '点一张卡片，在这里改。空白处双击，或点「新建念头」，放一张念头。'}
        </p>
      )}

      <div className="cm-host" ref={hostRef} aria-label="卡片编辑器" hidden={personLayer} />

      {card ? (
        <>
          <div className="layer-pipeline">
            {later.length > 0 ? <p className="hint">改成更后面的层</p> : null}
            {stepHint ? <p className="hint layer-next-hint">{stepHint}</p> : null}
            {pipeline.map((group) => {
              const layers = group.layers.filter((layer) => later.includes(layer))
              const open = pipelineCollapsed[group.title] !== true
              return (
                <div key={group.title} className="layer-group">
                  <button
                    type="button"
                    className="layer-group-title"
                    aria-expanded={open}
                    onClick={() => {
                      setPipelineCollapsed((current) => ({ ...current, [group.title]: open }))
                    }}
                  >
                    {pipelineGroupLabel(group)}
                  </button>
                  {open && layers.length > 0 ? (
                    <div className="field-row">
                      {layers.map((layer) => (
                        <button
                          key={layer}
                          type="button"
                          onClick={() => {
                            if (!canType || !cardId || composingRef.current || viewRef.current?.composing) return
                            if (!window.confirm(describeLayerChange(card, layer))) return
                            onChangeLayer(cardId, layer)
                          }}
                        >
                          {layerLabel(layer)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
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
      ) : null}
    </div>
  )
}
