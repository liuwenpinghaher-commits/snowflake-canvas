import { useState } from 'react'
import { getCurrentBookId, readBookMeta } from './books.ts'
import { assembleContext, type ContextKey } from './context-pack.ts'
import type { AppState } from './document.ts'
import type { ShownCandidate } from './expand.ts'

function contextSource(state: AppState | null): Partial<Record<ContextKey, string>> {
  if (!state) return {}
  let previous = ''
  let current = ''
  for (const chapter of state.chapters ?? []) {
    for (const scene of chapter.scenes) {
      previous = current
      current = scene.prose
    }
  }
  const people = (state.entities ?? [])
    .map((entity) => entity.name.trim())
    .filter((name) => name.length > 0)
    .join('、')
  const activeBook = getCurrentBookId() ?? state.snowflake.fileId
  const meta = activeBook ? readBookMeta(activeBook) : null
  const skeleton = Object.values(state.snowflake.cards)
    .filter((card) => card.layer === '一句话' || card.layer === '一段' || card.layer === 'yiyedagang')
    .map((card) => card.body.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('\n')
  return {
    本场场景表: current,
    出场人物: people,
    上一场: previous,
    相关设定: people,
    骨架段: skeleton,
    风格约束: meta?.styleSample ?? '',
    禁写清单: meta?.forbidden ?? '',
  }
}

export default function ExpandPanel({
  canType,
  notice,
  candidates,
  documentState = null,
  onExpand,
  onConfirm,
  onDismiss,
}: {
  canType: boolean
  notice: string | null
  candidates: ShownCandidate[]
  documentState?: AppState | null
  onExpand: (extraContext?: string) => void
  onConfirm: (id: string) => void
  onDismiss: () => void
}) {
  const [omit, setOmit] = useState<string[]>([])
  const packed = assembleContext(contextSource(documentState), omit)
  return (
    <section className="expand-panel" aria-label="扩写候选">
      <div className="field-row">
        <button type="button" disabled={!canType} onClick={() => onExpand(packed.requestText)}>
          扩写
        </button>
        {candidates.length > 0 ? (
          <button type="button" onClick={onDismiss}>
            关掉候选
          </button>
        ) : null}
      </div>
      {packed.materials.some((item) => item.text.length > 0) ? (
        <ul aria-label="这次带了哪些材料">
          {packed.materials
            .filter((item) => item.text.length > 0)
            .map((item) => (
              <li key={item.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.included}
                    onChange={() => {
                      setOmit((current) =>
                        current.includes(item.key) ? current.filter((key) => key !== item.key) : [...current, item.key],
                      )
                    }}
                  />
                  {item.key}
                </label>
              </li>
            ))}
        </ul>
      ) : null}
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
