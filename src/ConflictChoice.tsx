import {
  CHAPTER_PROSE_CONFLICT_PREFIX,
  ENTITY_SLUG_CONFLICT_PREFIX,
  PENDING_PROSE_CONFLICT_PREFIX,
  type CardConflictView,
  type ConflictPick,
} from './persist.ts'

export default function ConflictChoice({
  conflict,
  onPick,
}: {
  conflict: CardConflictView
  onPick: (pick: ConflictPick) => void
}) {
  const pageName = conflict.cardId.startsWith(ENTITY_SLUG_CONFLICT_PREFIX)
  const chapterProse = conflict.cardId.startsWith(CHAPTER_PROSE_CONFLICT_PREFIX)
  const pendingProse = conflict.cardId.startsWith(PENDING_PROSE_CONFLICT_PREFIX)
  const title = pageName
    ? '这个页名两边不一样，选一边留下'
    : chapterProse
      ? '这场正文两边都改过，选一边留下'
      : pendingProse
        ? '这场待写两边不一样，选一边留下'
        : '这张卡两边都改过，选一边留下'
  const label = pageName ? '这个页名两边不一样' : chapterProse ? '这场正文两边都改过' : pendingProse ? '这场待写两边不一样' : '这张卡两边都改过'
  return (
    <section className="conflict-choice" aria-label={label}>
      <p className="conflict-choice-head">{title}</p>
      <p className="conflict-choice-line" title={conflict.serverText}>
        <span className="conflict-choice-side">服务器</span>
        {conflict.serverText}
      </p>
      <p className="conflict-choice-line" title={conflict.mineText}>
        <span className="conflict-choice-side">我的</span>
        {conflict.mineText}
      </p>
      <div className="conflict-choice-actions">
        <button type="button" onClick={() => onPick('server')}>
          用服务器的
        </button>
        <button type="button" onClick={() => onPick('mine')}>
          用我的
        </button>
      </div>
    </section>
  )
}
