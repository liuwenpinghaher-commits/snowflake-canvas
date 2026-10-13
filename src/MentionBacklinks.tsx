import { cardFace, type AppState } from './document.ts'
import { mentionPreview, mentionsOf, shownProse, type MentionHit, type MentionKind } from './mentions.ts'

export default function MentionBacklinks({
  state,
  kind,
  id,
  onOpen,
}: {
  state: AppState
  kind: MentionKind
  id: string
  onOpen: (hit: MentionHit) => void
}) {
  const hits = mentionsOf(state, kind, id)
  if (hits.length === 0) return null
  return (
    <section className="mention-backlinks" aria-label="提到这里">
      <style>{`
        .mention-backlinks .mention-preview { display: none; margin: 4px 0 0; white-space: pre-wrap; }
        .mention-backlinks li:hover .mention-preview,
        .mention-backlinks li:focus-within .mention-preview { display: block; }
      `}</style>
      <p className="mention-backlinks-count">{hits.length} 处提到</p>
      <ul>
        {hits.map((hit) => {
          const card = state.snowflake.cards[hit.sourceCardId]
          const rawTitle = card ? cardFace(card).title : ''
          const title = !card ? '找不到' : shownProse(rawTitle, state).trim() || '未命名卡片'
          const preview = mentionPreview(state, hit)
          return (
            <li key={`${hit.sourceCardId}:${hit.fieldKey}:${hit.blockId}:${hit.ordinal}`}>
              <button type="button" title={preview} onClick={() => onOpen(hit)}>
                {title}
              </button>
              <p className="mention-preview" role="note">
                {preview}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 和反向列表同一计数：mentionsOf。0 次不显示。 */
export function MentionCountBadge({
  state,
  kind,
  id,
}: {
  state: AppState
  kind: MentionKind
  id: string
}) {
  const count = mentionsOf(state, kind, id).length
  if (count <= 0) return null
  return <span className="mention-badge">提到 {count} 次</span>
}
