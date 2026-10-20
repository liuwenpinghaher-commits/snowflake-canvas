export const CONTEXT_CAPS = {
  本场场景表: 2000,
  出场人物: 2000,
  上一场: 800,
  相关设定: 2000,
  骨架段: 1000,
  风格约束: 1000,
  禁写清单: 1000,
} as const

export type ContextKey = keyof typeof CONTEXT_CAPS

export interface ContextMaterial {
  key: ContextKey
  text: string
  included: boolean
}

const ORDER: ContextKey[] = ['本场场景表', '出场人物', '上一场', '相关设定', '骨架段', '风格约束', '禁写清单']

export function assembleContext(source: Partial<Record<ContextKey, string>>, omit: readonly string[] = []): {
  materials: ContextMaterial[]
  requestText: string
} {
  const skipped = new Set(omit)
  const materials: ContextMaterial[] = []
  const chunks: string[] = []
  for (const key of ORDER) {
    const cap = CONTEXT_CAPS[key]
    const raw = source[key] ?? ''
    const clipped = key === '上一场' ? [...raw].slice(-cap).join('') : [...raw].slice(0, cap).join('')
    const included = !skipped.has(key) && clipped.length > 0
    materials.push({ key, text: clipped, included })
    if (included) chunks.push(`【${key}】\n${clipped}`)
  }
  return { materials, requestText: chunks.join('\n\n') }
}
