import { cardFace, type AppState, type EntityType } from './document.ts'

export const WORK_SURFACES = [
  { id: 'canvas', label: '画布' },
  { id: 'cast', label: '人物' },
  { id: 'relation', label: '关系' },
  { id: 'encyclopedia', label: '百科' },
  { id: 'chapter', label: '章节' },
] as const

export type SurfaceId = (typeof WORK_SURFACES)[number]['id']

export type PaletteKind = 'book' | 'card' | 'entity' | 'chapter' | 'surface'

export interface PaletteHit {
  key: string
  kind: PaletteKind
  targetId: string
  label: string
  hint: string
}

const ENTITY_HINT: Record<EntityType, string> = {
  person: '人物',
  place: '地点',
  org: '组织',
  concept: '概念',
  theme: '主题',
  'foreshadow-line': '伏笔线',
}

function matches(label: string, query: string): boolean {
  if (!query) return true
  return label.toLowerCase().includes(query)
}

export function isSurfaceId(id: string): id is SurfaceId {
  return WORK_SURFACES.some((item) => item.id === id)
}

export function paletteHits(input: { bookName: string; state: AppState; query: string; limit?: number }): PaletteHit[] {
  const query = input.query.trim().toLowerCase()
  const limit = input.limit ?? 80
  const hits: PaletteHit[] = []

  for (const surface of WORK_SURFACES) {
    if (!matches(surface.label, query)) continue
    hits.push({
      key: `surface:${surface.id}`,
      kind: 'surface',
      targetId: surface.id,
      label: surface.label,
      hint: '工作面',
    })
  }

  const bookName = input.bookName.trim()
  if (bookName && matches(bookName, query)) {
    hits.push({
      key: 'book:current',
      kind: 'book',
      targetId: 'current',
      label: bookName,
      hint: '当前的书',
    })
  }

  const seen = new Set<string>()
  const pushCard = (id: string) => {
    if (seen.has(id)) return
    const card = input.state.snowflake.cards[id]
    if (!card) return
    seen.add(id)
    const title = cardFace(card).title.trim() || '未命名卡片'
    if (!matches(title, query)) return
    hits.push({ key: `card:${id}`, kind: 'card', targetId: id, label: title, hint: '卡片' })
  }
  for (const node of input.state.canvas.nodes) pushCard(node.id)
  for (const id of Object.keys(input.state.snowflake.cards)) pushCard(id)

  for (const entity of input.state.entities ?? []) {
    const name = entity.name.trim() || '未命名'
    if (!matches(name, query)) continue
    hits.push({
      key: `entity:${entity.id}`,
      kind: 'entity',
      targetId: entity.id,
      label: name,
      hint: ENTITY_HINT[entity.entityType],
    })
  }

  for (const chapter of input.state.chapters ?? []) {
    const title = chapter.title.trim() || '未命名章节'
    if (!matches(title, query)) continue
    hits.push({
      key: `chapter:${chapter.id}`,
      kind: 'chapter',
      targetId: chapter.id,
      label: title,
      hint: '章节',
    })
  }

  return hits.slice(0, limit)
}
