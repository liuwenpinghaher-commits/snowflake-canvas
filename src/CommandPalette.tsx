import { useEffect, useRef } from 'react'
import type { PaletteHit } from './command-palette.ts'

export default function CommandPalette({
  query,
  hits,
  activeIndex,
  onQuery,
  onActive,
  onPick,
  onClose,
}: {
  query: string
  hits: PaletteHit[]
  activeIndex: number
  onQuery: (value: string) => void
  onActive: (index: number) => void
  onPick: (hit: PaletteHit) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const root = ref.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  useEffect(() => {
    const selected = ref.current?.querySelector('[aria-selected="true"]')
    if (selected instanceof HTMLElement) selected.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, hits])

  const pickActive = () => {
    const hit = hits[activeIndex]
    if (hit) onPick(hit)
  }

  return (
    <div className="palette-layer" ref={ref}>
      <div className="palette" role="dialog" aria-label="命令面板">
        <input
          autoFocus
          data-palette-input="true"
          aria-label="搜索并跳转"
          aria-controls="palette-list"
          aria-activedescendant={hits.length > 0 ? `palette-opt-${activeIndex}` : undefined}
          placeholder="搜索卡片、人物、章节或工作面"
          value={query}
          onChange={(event) => onQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key === 'Process') return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (hits.length === 0) return
              onActive(Math.min(hits.length - 1, activeIndex + 1))
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              onActive(Math.max(0, activeIndex - 1))
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              pickActive()
            }
          }}
        />
        {hits.length === 0 ? (
          <p className="palette-empty">没有匹配</p>
        ) : (
          <ul id="palette-list" className="palette-list" role="listbox" aria-label="搜索结果">
            {hits.map((hit, index) => (
              <li key={hit.key}>
                <button
                  id={`palette-opt-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => onActive(index)}
                  onClick={() => onPick(hit)}
                >
                  <span>{hit.label}</span>
                  <span className="palette-hint">{hit.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
