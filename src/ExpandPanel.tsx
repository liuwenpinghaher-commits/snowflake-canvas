import type { ShownCandidate } from './expand.ts'

export default function ExpandPanel({
  canType,
  notice,
  candidates,
  onExpand,
  onConfirm,
  onDismiss,
}: {
  canType: boolean
  notice: string | null
  candidates: ShownCandidate[]
  onExpand: () => void
  onConfirm: (id: string) => void
  onDismiss: () => void
}) {
  return (
    <section className="expand-panel" aria-label="扩写候选">
      <div className="field-row">
        <button type="button" disabled={!canType} onClick={onExpand}>
          扩写
        </button>
        {candidates.length > 0 ? (
          <button type="button" onClick={onDismiss}>
            关掉候选
          </button>
        ) : null}
      </div>
      {notice ? (
        <p className="status-line" role="status">
          {notice}
        </p>
      ) : null}
      {candidates.map((item) => (
        <article key={item.id} className="candidate">
          <p>{item.text}</p>
          <button type="button" disabled={!canType} onClick={() => onConfirm(item.id)}>
            确认
          </button>
        </article>
      ))}
    </section>
  )
}
