import {
  outlineProgress,
  type AppState,
  type BookChapter,
  type BookScene,
} from './document.ts'

export const BEAT_LENGTHS = [40, 60, 80, 120] as const
export type BeatLength = (typeof BEAT_LENGTHS)[number]
export const DEFAULT_BEAT_LENGTH: BeatLength = 60

export interface BeatSlot {
  sceneIds: string[]
}

export interface BeatAnchor {
  key: 'hook' | 'plot1' | 'mid' | 'plot2' | 'ending'
  label: string
  index: number
}

const ANCHOR_SPECS: readonly {
  key: BeatAnchor['key']
  label: string
  fraction: number
  pin?: 'start' | 'end'
}[] = [
  { key: 'hook', label: '悬念', fraction: 0, pin: 'start' },
  { key: 'plot1', label: '第一情节点', fraction: 0.225 },
  { key: 'mid', label: '中间点', fraction: 0.5 },
  { key: 'plot2', label: '第二情节点', fraction: 0.725 },
  { key: 'ending', label: '结局', fraction: 1, pin: 'end' },
]

/** 节拍表只决定有几格。大纲进度看场上的 beatIds，不看这张表满不满。 */
export function createBeatSheet(length: BeatLength = DEFAULT_BEAT_LENGTH): BeatSlot[] {
  return Array.from({ length }, () => ({ sceneIds: [] }))
}

export function beatAnchors(length: number): BeatAnchor[] {
  const span = Math.max(length - 1, 0)
  return ANCHOR_SPECS.map((spec) => {
    let index = 0
    if (spec.pin === 'end') index = span
    else if (spec.pin !== 'start') index = Math.round(spec.fraction * span)
    return { key: spec.key, label: spec.label, index }
  })
}

/** 换尺长时按原来在尺上的百分比落到最近的格，已挂上的场不丢。 */
export function resizeBeatSheet(slots: readonly BeatSlot[], nextLength: BeatLength): BeatSlot[] {
  const next = createBeatSheet(nextLength)
  const prevSpan = Math.max(slots.length - 1, 1)
  const nextSpan = Math.max(nextLength - 1, 0)
  slots.forEach((slot, index) => {
    if (slot.sceneIds.length === 0) return
    const ratio = slots.length <= 1 ? 0 : index / prevSpan
    const dest = Math.min(next.length - 1, Math.max(0, Math.round(ratio * nextSpan)))
    const bucket = next[dest]
    if (!bucket) return
    for (const id of slot.sceneIds) {
      if (!bucket.sceneIds.includes(id)) bucket.sceneIds.push(id)
    }
  })
  return next
}

/** 把一张场次卡放进一场。同一张再放一次不会重复。不是场次卡则原样返回。 */
export function placeBeat(state: AppState, sceneId: string, cardId: string): AppState {
  const card = state.snowflake.cards[cardId]
  if (!card || card.layer !== 'changci') return state
  const chapters = state.chapters ?? []
  let found = false
  let changed = false
  const nextChapters: BookChapter[] = chapters.map((chapter) => {
    let chapterChanged = false
    const scenes = chapter.scenes.map((scene) => {
      if (scene.id !== sceneId) return scene
      found = true
      const beatIds = scene.beatIds ?? []
      if (beatIds.includes(cardId)) return scene
      chapterChanged = true
      changed = true
      return { ...scene, beatIds: [...beatIds, cardId] }
    })
    if (!chapterChanged) return chapter
    return { ...chapter, scenes }
  })
  if (!found || !changed) return state
  return { ...state, chapters: nextChapters }
}

const CAST_TYPES = new Set(['person', 'place', 'org'])

/** 这场上指向人物、地点、组织的出场边，只返回名字。 */
export function sceneAppearanceNames(state: AppState, scene: BookScene): string[] {
  const fromIds = new Set<string>([scene.id, ...(scene.beatIds ?? [])])
  for (const edge of state.canvas.edges) {
    if (edge.kind === 'chapter-in' && edge.fromNode === scene.id) fromIds.add(edge.toNode)
  }
  const byId = new Map((state.entities ?? []).map((entity) => [entity.id, entity]))
  const names: string[] = []
  const seen = new Set<string>()
  for (const edge of state.canvas.edges) {
    if (edge.kind !== 'appears-in' || !fromIds.has(edge.fromNode)) continue
    const entity = byId.get(edge.toNode)
    if (!entity || !CAST_TYPES.has(entity.entityType) || seen.has(entity.id)) continue
    const name = entity.name.trim()
    if (!name) continue
    seen.add(entity.id)
    names.push(name)
  }
  return names
}

export function chapterMark(chapters: readonly BookChapter[] | undefined): { filled: number; total: number } {
  return outlineProgress(chapters)
}

function storedLength(value: number): value is BeatLength {
  return (BEAT_LENGTHS as readonly number[]).includes(value)
}

/** 旧书没有 beats 时按 60 格空表显示。节拍表只认 slots，大纲进度不看这里。 */
export function readBookBeats(chapters: readonly BookChapter[] | undefined): { length: BeatLength; slots: BeatSlot[] } {
  for (const chapter of chapters ?? []) {
    const beats = chapter.beats
    if (!beats || !storedLength(beats.length) || !Array.isArray(beats.slots) || beats.slots.length !== beats.length) continue
    return { length: beats.length, slots: beats.slots.map((sceneIds) => ({ sceneIds: [...sceneIds] })) }
  }
  return { length: DEFAULT_BEAT_LENGTH, slots: createBeatSheet(DEFAULT_BEAT_LENGTH) }
}

export function writeBookBeats(state: AppState, length: BeatLength, slots: readonly BeatSlot[]): AppState {
  const beats = { length, slots: slots.map((slot) => [...slot.sceneIds]) }
  return { ...state, chapters: (state.chapters ?? []).map((chapter) => ({ ...chapter, beats })) }
}

export function hangSceneOnBeat(state: AppState, sceneId: string, index: number): AppState {
  const known = (state.chapters ?? []).some((chapter) => chapter.scenes.some((scene) => scene.id === sceneId))
  if (!known) return state
  const current = readBookBeats(state.chapters)
  if (index < 0 || index >= current.slots.length) return state
  const slots = current.slots.map((slot) => ({ sceneIds: slot.sceneIds.filter((id) => id !== sceneId) }))
  const bucket = slots[index]
  if (!bucket) return state
  bucket.sceneIds.push(sceneId)
  return writeBookBeats(state, current.length, slots)
}

export function setBeatLength(state: AppState, length: BeatLength): AppState {
  const current = readBookBeats(state.chapters)
  if (current.length === length && (state.chapters ?? []).every((chapter) => chapter.beats?.length === length)) return state
  const slots = current.length === length ? current.slots : resizeBeatSheet(current.slots, length)
  return writeBookBeats(state, length, slots)
}
