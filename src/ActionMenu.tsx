import { useEffect, useRef } from 'react'

export interface ActionMenuItem {
  id: string
  label: string
  disabled?: boolean
  onSelect: () => void
}

export function ActionMenu({
  label,
  x,
  y,
  items,
  onClose,
}: {
  label: string
  x: number
  y: number
  items: ActionMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    const onPointer = (event: PointerEvent) => {
      const root = ref.current
      if (!root) return
      if (event.target instanceof Node && root.contains(event.target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  const width = 220
  const height = Math.min(320, items.length * 36 + 16)
  const left = Math.max(8, Math.min(x, window.innerWidth - width - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8))

  return (
    <div
      ref={ref}
      className="action-menu"
      role="menu"
      aria-label={label}
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (item.disabled) return
            item.onSelect()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
