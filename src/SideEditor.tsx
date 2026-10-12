import { useEffect, useRef, useState } from 'react'
import { visibleProse, type Block } from './block-editor.ts'
import BlockField from './BlockField.tsx'
import { mentionLabel, mentionTargets, type MentionJump } from './mentions.ts'
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
  markBookPremise,
  readCellBlocks,
  nextLayer,
  type AppState,
  type Card,
  type Layer,
} from './document.ts'
import { PersonZones } from './CastPage.tsx'
import { entityForPersonCard, formatGrowthLine, gradeVisibility, traceIdeaFields } from './person-form.ts'
import { nextStepHint, pipelineGroupLabel, pipelineGroupProgress } from './card-layout.ts'
import ExpandPanel from './ExpandPanel.tsx'
import type { ShownCandidate } from './expand.ts'
import FoldPanel from './FoldPanel.tsx'
import { writeSeqOf } from './persist.ts'

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
  onOpenField,
  onPovLeave,
  mentionJump = null,
}: {
  cardId: string | null
  card: Card | null
  documentState: AppState
  groupSelected: boolean
  canType: boolean
  onCommit: (cardId: string, fieldKey: string | null, text: string, blocks?: readonly Block[]) => void
  onAdoptField: (fieldKey: string | null) => void
  onChangeLayer: (cardId: string, layer: Layer) => void
  expandNotice: string | null
  candidates: ShownCandidate[]
  onExpand: (cardId: string, fieldKey: string | null) => void
  onConfirmCandidate: (id: string) => void
  onDismissCandidates: () => void
  onApply: (recipe: (state: AppState) => AppState) => void
  onOpenIdea: (cardId: string, sessionId?: string, adoptionKey?: string, draft?: string) => void
  onOpenField: (entityId: string, fieldKey: string) => void
  onPovLeave?: (cardId: string, text: string) => void
  mentionJump?: MentionJump | null
}) {
  const viewRef = useRef<{ composing: boolean } | null>(null)
  const composingRef = useRef(false)
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

  useEffect(() => {
    if (!mentionJump || !card || !cardId || mentionJump.cardId !== cardId) return
    const key = mentionJump.fieldKey
    if (key === 'body') return
    const allowed =
      fieldKeys(card.layer).includes(key) ||
      extraFieldKeys(card).includes(key) ||
      Object.prototype.hasOwnProperty.call(card.fields, key)
    if (!allowed) return
    setFieldOverride((current) => {
      if (current && current.cardId === cardId && current.layer === card.layer && current.key === key) return current
      return { cardId, layer: card.layer, key }
    })
    // 只在点开某一处时切到那一格。正文每次保存都会换 card，不能放进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionJump?.nonce, mentionJump?.cardId, cardId])

  const fieldKey =
    card && cardId
      ? fieldOverride && fieldOverride.cardId === cardId && fieldOverride.layer === card.layer
        ? fieldOverride.key
        : defaultFieldKey(card)
      : null

  useEffect(() => {
    onAdoptField(fieldKey)
  }, [fieldKey, onAdoptField])


  const text = card ? editorText(card, fieldKey) : ''
  const face = card ? cardFace(card) : null
  const heldInField = Boolean(
    card &&
      face &&
      Object.values(card.fields).some((value) => {
        const trimmed = visibleProse(value).trim()
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

  const stateSeq = writeSeqOf(documentState)
  const targets = mentionTargets(documentState)
  const labelsKey = targets.map((item) => `${item.kind}:${item.id}:${item.label}`).join('\n')


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
          {card.layer === 'changci' && cardId ? (
            <label className="fold-field field-row">
              视角
              <input
                aria-label="视角"
                key={`${cardId}:${card.fields.pov ?? ''}`}
                defaultValue={card.fields.pov ?? ''}
                disabled={!canType}
                onBlur={(event) => {
                  if (!canType) return
                  onPovLeave?.(cardId, event.target.value)
                }}
              />
            </label>
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

      <div className="cm-host" aria-label="卡片编辑器" hidden={personLayer}>
        {personLayer ? null : (
          <BlockField
            key={`${cardId ?? ''}|${fieldKey ?? ''}`}
            cardId={cardId}
            fieldKey={fieldKey}
            text={text}
            storedBlocks={card ? readCellBlocks(card, fieldKey) : undefined}
            editable={editable}
            canType={canType}
            stateSeq={stateSeq}
            onCommit={onCommit}
            onPovLeave={onPovLeave}
            composingRef={composingRef}
            viewRef={viewRef}
            mentionTargets={targets}
            labelsKey={labelsKey}
            labelOf={(kind, id) => mentionLabel(documentState, kind, id)}
            focusBlockId={mentionJump && mentionJump.cardId === cardId ? mentionJump.blockId : null}
            focusNonce={mentionJump && mentionJump.cardId === cardId ? mentionJump.nonce : 0}
          />
        )}
      </div>

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
          {card && card.layer === 'situation' && cardId ? (
            <>
              <button type="button" disabled={!canType} onClick={() => onApply((current) => markBookPremise(current, cardId))}>
                标为全书前提
              </button>
              <IdeaGrowthList state={documentState} ideaId={cardId} onOpen={onOpenField} />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function IdeaGrowthList({
  state,
  ideaId,
  onOpen,
}: {
  state: AppState
  ideaId: string
  onOpen: (entityId: string, fieldKey: string) => void
}) {
  const hits = traceIdeaFields(state, ideaId)
  if (hits.length === 0) return null
  return (
    <section className="idea-growth" aria-label="这条念头长出了什么">
      <h3>这条念头长出了什么</h3>
      <ul>
        {hits.map((hit) => {
          const line = formatGrowthLine(state, hit)
          return (
            <li key={`${hit.entityId}:${hit.fieldKey}`}>
              <button type="button" onClick={() => onOpen(hit.entityId, hit.fieldKey)}>
                {line.label}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
