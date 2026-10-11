import { useState, type DragEvent } from 'react'
import { frontText, type AppState } from './document.ts'
import {
  BEAT_LENGTHS,
  DEFAULT_BEAT_LENGTH,
  beatAnchors,
  chapterMark,
  createBeatSheet,
  placeBeat,
  resizeBeatSheet,
  sceneAppearanceNames,
  type BeatLength,
  type BeatSlot,
} from './chapter.ts'

function readDrag(event: DragEvent<HTMLElement>): string {
  return event.dataTransfer.getData('text/plain')
}

export default function ChapterPage({
  state,
  canEdit,
  onApply,
}: {
  state: AppState
  canEdit: boolean
  onApply: (recipe: (state: AppState) => AppState) => void
}) {
  const [tab, setTab] = useState<'scenes' | 'beats'>('scenes')
  const [length, setLength] = useState<BeatLength>(DEFAULT_BEAT_LENGTH)
  const [sheet, setSheet] = useState<BeatSlot[]>(() => createBeatSheet(DEFAULT_BEAT_LENGTH))
  const chapters = state.chapters ?? []
  const progress = chapterMark(chapters)
  const beatCards = Object.entries(state.snowflake.cards).filter(([, card]) => card.layer === 'changci')
  const anchors = beatAnchors(length)
  const anchorAt = new Map<number, string[]>()
  for (const anchor of anchors) {
    const labels = anchorAt.get(anchor.index) ?? []
    labels.push(anchor.label)
    anchorAt.set(anchor.index, labels)
  }

  function sceneTitle(sceneId: string): string {
    for (const chapter of chapters) {
      const scene = chapter.scenes.find((item) => item.id === sceneId)
      if (scene) return scene.title.trim() || '未命名场'
    }
    return '未命名场'
  }

  function hangScene(sceneId: string, index: number) {
    setSheet((current) =>
      current.map((slot, slotIndex) => {
        const sceneIds = slot.sceneIds.filter((id) => id !== sceneId)
        if (slotIndex === index) sceneIds.push(sceneId)
        return { sceneIds }
      }),
    )
  }

  function chooseLength(next: BeatLength) {
    setSheet((current) => resizeBeatSheet(current, next))
    setLength(next)
  }

  return (
    <section className="chapter-page" aria-label="章节">
      <header className="chapter-head">
        <h2>章节</h2>
        <p className="chapter-progress" aria-label="大纲进度">
          大纲 {progress.filled}/{progress.total}
        </p>
        <div className="chapter-tabs" role="tablist" aria-label="章节视图">
          <button type="button" role="tab" aria-selected={tab === 'scenes'} onClick={() => setTab('scenes')}>
            章场
          </button>
          <button type="button" role="tab" aria-selected={tab === 'beats'} onClick={() => setTab('beats')}>
            节拍表
          </button>
        </div>
      </header>
      {tab === 'scenes' ? (
        <div className="chapter-scenes" role="tabpanel">
          <div className="beat-tray" aria-label="场次卡">
            <p>场次</p>
            {beatCards.length === 0 ? <p>还没有场次卡。</p> : null}
            {beatCards.map(([id, card]) => (
              <span
                key={id}
                className="beat-chip"
                draggable={canEdit}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', `card:${id}`)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
              >
                {frontText(card) || '场次'}
              </span>
            ))}
          </div>
          {chapters.length === 0 ? <p>还没有章节。</p> : null}
          {chapters.map((chapter, index) => {
            const mark = chapterMark([chapter])
            return (
              <article key={chapter.id} className="chapter-block">
                <h3>
                  第{index + 1}章 {chapter.title.trim() || '未命名'} {mark.filled}/{mark.total}
                </h3>
                {chapter.scenes.map((scene) => {
                  const names = sceneAppearanceNames(state, scene)
                  return (
                    <div
                      key={scene.id}
                      className="scene-drop"
                      onDragOver={(event) => {
                        if (!canEdit) return
                        event.preventDefault()
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        if (!canEdit) return
                        const raw = readDrag(event)
                        if (!raw.startsWith('card:')) return
                        const cardId = raw.slice('card:'.length)
                        onApply((current) => placeBeat(current, scene.id, cardId))
                      }}
                    >
                      <p>{scene.title.trim() || '未命名场'}</p>
                      <ul>
                        {(scene.beatIds ?? []).map((id) => {
                          const card = state.snowflake.cards[id]
                          return <li key={id}>{card ? frontText(card) || '场次' : id}</li>
                        })}
                      </ul>
                      {names.map((name) => (
                        <p key={name}>出场：{name}</p>
                      ))}
                    </div>
                  )
                })}
              </article>
            )
          })}
        </div>
      ) : (
        <div className="chapter-beats" role="tabpanel">
          <div className="beat-lengths" aria-label="节拍尺长">
            {BEAT_LENGTHS.map((size) => (
              <button key={size} type="button" aria-pressed={length === size} onClick={() => chooseLength(size)}>
                {size}
              </button>
            ))}
          </div>
          <div className="scene-tray" aria-label="可挂上的场">
            {chapters.flatMap((chapter) =>
              chapter.scenes.map((scene) => (
                <span
                  key={scene.id}
                  className="beat-chip"
                  draggable={canEdit}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', `scene:${scene.id}`)
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  {scene.title.trim() || '未命名场'}
                </span>
              )),
            )}
          </div>
          <div className="beat-grid">
            {sheet.map((slot, index) => {
              const labels = anchorAt.get(index) ?? []
              return (
                <div
                  key={index}
                  className={labels.length > 0 ? 'beat-cell is-anchor' : 'beat-cell'}
                  onDragOver={(event) => {
                    if (!canEdit) return
                    event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    if (!canEdit) return
                    const raw = readDrag(event)
                    if (!raw.startsWith('scene:')) return
                    hangScene(raw.slice('scene:'.length), index)
                  }}
                >
                  <span className="beat-index">{index + 1}</span>
                  {labels.map((label) => (
                    <strong key={label}>{label}</strong>
                  ))}
                  {slot.sceneIds.map((id) => (
                    <span key={id}>{sceneTitle(id)}</span>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
