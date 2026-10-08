import { useState } from 'react'
import type { AppState, Card } from './document.ts'
import {
  REASON_BEAT_TASK,
  REASON_DRAFT_TASK,
  REASON_SCENE_TASK,
  SUGGEST_NOTE,
  connectedSceneTask,
  foldIntoScene,
  sceneCardTask,
  type SuggestAction,
} from './suggest.ts'
import { saveSuggestionFile } from './suggest-save.ts'

export default function FoldPanel({
  cardId,
  card,
  documentState,
}: {
  cardId: string
  card: Card
  documentState: AppState
}) {
  const [action, setAction] = useState<SuggestAction>('existing-scene')
  const [beatId, setBeatId] = useState('')
  const [supplement, setSupplement] = useState('')
  const [reason, setReason] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const [busy, setBusy] = useState(false)

  if (card.layer !== '场景表' && card.layer !== 'changci' && card.layer !== '正文草稿') return null

  const sceneMissing = card.layer === '场景表' && sceneCardTask(card) === ''
  const beatMissing =
    card.layer === 'changci' &&
    (card.fields.task ?? '').trim() === '' &&
    connectedSceneTask(documentState, cardId) === null
  const needSupplement =
    card.layer === '正文草稿' && action === 'new-draft-scene' && connectedSceneTask(documentState, cardId) === null

  const fold = () => {
    setSavedNote('')
    const result = foldIntoScene(documentState, {
      cardId,
      action,
      beatId,
      intentSupplement: supplement,
    })
    if (!result.ok) {
      setReason(result.reason)
      return
    }
    setReason('')
    setBusy(true)
    void saveSuggestionFile(cardId, result.json)
      .then((via) => {
        setSavedNote(
          via === 'cancelled'
            ? '没有保存文件。'
            : '建议包已交给浏览器保存。它不会写进画布，也不会写进设定图。',
        )
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <fieldset className="fold-panel">
      <legend>折进此场</legend>
      <p className="hint">{SUGGEST_NOTE}</p>
      <div className="fold-choice">
        <label>
          <input
            type="radio"
            name={`fold-action-${cardId}`}
            checked={action === 'existing-scene'}
            onChange={() => {
              setAction('existing-scene')
              setReason('')
              setSavedNote('')
            }}
          />
          已有场
        </label>
        <label>
          <input
            type="radio"
            name={`fold-action-${cardId}`}
            checked={action === 'new-draft-scene'}
            onChange={() => {
              setAction('new-draft-scene')
              setReason('')
              setSavedNote('')
            }}
          />
          新草稿场
        </label>
      </div>
      {action === 'existing-scene' ? (
        <label className="fold-field">
          已有场编号，可以不填
          <input
            value={beatId}
            onChange={(event) => {
              setBeatId(event.target.value)
              setReason('')
            }}
          />
        </label>
      ) : (
        <p className="hint">新草稿场不会带已有场的编号。</p>
      )}
      {needSupplement ? (
        <>
          <p className="hint">{REASON_DRAFT_TASK}</p>
          <label className="fold-field">
            补一句本场任务
            <input
              value={supplement}
              onChange={(event) => {
                setSupplement(event.target.value)
                setReason('')
              }}
            />
          </label>
        </>
      ) : null}
      {card.layer === '正文草稿' && action === 'new-draft-scene' && !needSupplement ? (
        <p className="hint">本场任务优先用相连场次的本场任务；没有就用场景表的「这一场发生什么」，空着再用标题。</p>
      ) : null}
      {sceneMissing ? <p className="hint">{REASON_SCENE_TASK}</p> : null}
      {beatMissing ? <p className="hint">{REASON_BEAT_TASK}</p> : null}
      <div className="fold-actions">
        <button type="button" onClick={fold} disabled={busy}>
          {busy ? '正在保存' : '折进此场'}
        </button>
      </div>
      {reason ? (
        <p className="hint" role="status">
          {reason}
        </p>
      ) : null}
      {savedNote ? (
        <p className="hint" role="status">
          {savedNote}
        </p>
      ) : null}
    </fieldset>
  )
}
