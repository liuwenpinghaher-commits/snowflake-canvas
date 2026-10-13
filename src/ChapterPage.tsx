import { useEffect, useState, type DragEvent } from 'react'
import { frontText, resolveProseFork, type AppState } from './document.ts'
import {
  BEAT_LENGTHS,
  beatAnchors,
  chapterMark,
  hangSceneOnBeat,
  placeBeat,
  readBookBeats,
  sceneAppearanceNames,
  setBeatLength,
  type BeatLength,
} from './chapter.ts'

function readDrag(event: DragEvent<HTMLElement>): string {
  return event.dataTransfer.getData('text/plain')
}

export default function ChapterPage({
  state,
  canEdit,
  onApply,
  focusId = null,
  focusNonce = 0,
}: {
  state: AppState
  canEdit: boolean
  onApply: (recipe: (state: AppState) => AppState) => void
  focusId?: string | null
  focusNonce?: number
}) {
  const [tab, setTab] = useState<'scenes' | 'beats'>('scenes')
  const [selectedKey, setSelectedKey] = useState<string | null>(focusId)
  const [dropSceneId, setDropSceneId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusId) return
    setTab('scenes')
    setSelectedKey(focusId)
  }, [focusId, focusNonce])
  useEffect(() => {
    if (!focusId || tab !== 'scenes') return
    document.getElementById(`chapter-${focusId}`)?.scrollIntoView({ block: 'nearest' })
  }, [focusId, focusNonce, tab])
  const chapters = state.chapters ?? []
  const storedBeats = readBookBeats(chapters)
  const length = storedBeats.length
  const sheet = storedBeats.slots
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
    onApply((current) => hangSceneOnBeat(current, sceneId, index))
  }

  function chooseLength(next: BeatLength) {
    onApply((current) => setBeatLength(current, next))
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
          <ul className="chapter-tree">
            {chapters.map((chapter, index) => {
              const mark = chapterMark([chapter])
              return (
                <li key={chapter.id}>
                  <div
                    id={`chapter-${chapter.id}`}
                    className={selectedKey === chapter.id ? 'chapter-tree-row is-selected' : 'chapter-tree-row'}
                    data-depth="0"
                    onClick={() => setSelectedKey(chapter.id)}
                  >
                    <h3>
                      第{index + 1}章 {chapter.title.trim() || '未命名'} {mark.filled}/{mark.total}
                    </h3>
                  </div>
                  <ul>
                    {chapter.scenes.map((scene) => {
                      const names = sceneAppearanceNames(state, scene)
                      const sceneBeats = scene.beatIds ?? []
                      return (
                        <li key={scene.id}>
                          <div
                            className={'chapter-tree-row scene-drop' + (selectedKey === scene.id ? ' is-selected' : '') + (dropSceneId === scene.id ? ' is-drop' : '')}
                            data-depth="1"
                            onClick={() => setSelectedKey(scene.id)}
                            onDragOver={(event) => {
                              if (!canEdit) return
                              event.preventDefault()
                              setDropSceneId(scene.id)
                            }}
                            onDragLeave={() => {
                              setDropSceneId((current) => (current === scene.id ? null : current))
                            }}
                            onDrop={(event) => {
                              event.preventDefault()
                              setDropSceneId(null)
                              if (!canEdit) return
                              const raw = readDrag(event)
                              if (!raw.startsWith('card:')) return
                              onApply((current) => placeBeat(current, scene.id, raw.slice('card:'.length)))
                            }}
                          >
                            <p>{scene.title.trim() || '未命名场'}</p>
                            {scene.proseFork ? (
                              <div className="prose-fork row-actions">
                                <p>正文分叉</p>
                                <button type="button" disabled={!canEdit} onClick={(event) => { event.stopPropagation(); onApply((current) => resolveProseFork(current, scene.id, 'scene')) }}>
                                  留场上的
                                </button>
                                <button type="button" disabled={!canEdit} onClick={(event) => { event.stopPropagation(); onApply((current) => resolveProseFork(current, scene.id, 'card')) }}>
                                  留卡上的
                                </button>
                              </div>
                            ) : null}
                          </div>
                          {sceneBeats.length > 0 || names.length > 0 ? (
                            <ul>
                              {sceneBeats.map((id) => {
                                const card = state.snowflake.cards[id]
                                return (
                                  <li key={id}>
                                    <div className="chapter-tree-row" data-depth="2">
                                      <span>{card ? frontText(card) || '场次' : id}</span>
                                    </div>
                                  </li>
                                )
                              })}
                              {names.map((name) => (
                                <li key={name}>
                                  <div className="chapter-tree-row" data-depth="2">
                                    <p>出场：{name}</p>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
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
