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
import { bookScopedPath } from './books.ts'
import {
  acceptSuggestionToScene,
  addChapter,
  addScene,
  dismissSuggestion,
  removeChapter,
  removeScene,
  renameChapter,
  renameScene,
  rollbackSceneRevision,
  saveSceneRevision,
  updateSceneFailure,
  updateSceneProse,
  updateSceneStep,
} from './chapter-edit.ts'
import { diffTextParts } from './diff-text.ts'
import { exportIssues, locateExportIssue } from './export-precheck.ts'
import { proseEditorWritable, sceneEditor } from './scene-prose.ts'
import { gapReport, type GapView } from './structure-gaps.ts'

const STRUCTURE_FRAMES: Record<string, string[]> = {
  雪花十层: ['起因', '经过', '转折', '高潮', '结局'],
  启程转合: ['起', '承', '转', '合'],
  故事八步: ['日常', '诱因', '入局', '试炼', '中点', '绝境', '决战', '归来'],
}

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
  const [frameKind, setFrameKind] = useState<string>('雪花十层')
  const [dismissedGaps, setDismissedGaps] = useState<string[]>([])
  const [showDiff, setShowDiff] = useState(false)
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
        <button type="button" disabled={!canEdit} onClick={() => onApply((current) => addChapter(current, '未命名章'))}>
          新建章
        </button>
        <div className="chapter-tabs" role="tablist" aria-label="章节视图">
          <button type="button" role="tab" aria-selected={tab === 'scenes'} onClick={() => setTab('scenes')}>
            章场
          </button>
          <button type="button" role="tab" aria-selected={tab === 'beats'} onClick={() => setTab('beats')}>
            节拍表
          </button>
        </div>
        <div className="export-bar" aria-label="导出全书">
          <a className="export-link" href={`${bookScopedPath('/api/export')}?format=md`} download>
            导出 Markdown
          </a>
          <a className="export-link" href={`${bookScopedPath('/api/export')}?format=txt`} download>
            导出 TXT
          </a>
          <a className="export-link" href={`${bookScopedPath('/api/export')}?format=docx`} download>
            导出 DOCX
          </a>
          <a className="export-link" href={`${bookScopedPath('/api/export')}?format=epub`} download>
            导出 EPUB
          </a>
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
          {exportIssues(state).length > 0 ? (
            <ul aria-label="导出前要补的">
              {exportIssues(state).map((issue) => (
                <li key={`${issue.sceneId}:${issue.message}`}>
                  <button type="button" onClick={() => setSelectedKey(locateExportIssue(exportIssues(state), issue.message))}>
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="chapter-workspace">
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
                    <input
                      aria-label={`第${index + 1}章章名`}
                      defaultValue={chapter.title}
                      onClick={(event) => event.stopPropagation()}
                      onBlur={(event) => {
                        const title = event.currentTarget.value
                        onApply((current) => renameChapter(current, chapter.id, title))
                      }}
                    />
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={(event) => {
                        event.stopPropagation()
                        onApply((current) => addScene(current, chapter.id, '未命名场'))
                      }}
                    >
                      新建场
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={(event) => {
                        event.stopPropagation()
                        onApply((current) => removeChapter(current, chapter.id))
                      }}
                    >
                      删除章
                    </button>
                  </div>
                  <ul>
                    {chapter.scenes.map((scene) => {
                      const names = sceneAppearanceNames(state, scene)
                      const sceneBeats = scene.beatIds ?? []
                      return (
                        <li key={scene.id}>
                          <div
                            id={`chapter-${scene.id}`}
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
                            <input
                              aria-label={`${scene.title.trim() || '未命名场'}场名`}
                              defaultValue={scene.title}
                              onClick={(event) => event.stopPropagation()}
                              onBlur={(event) => {
                                const title = event.currentTarget.value
                                onApply((current) => renameScene(current, scene.id, title))
                              }}
                            />
                            {(() => {
                              const editor = sceneEditor(state, scene.id)
                              if (!editor || !proseEditorWritable(editor)) return null
                              return (
                                <textarea
                                  readOnly={false}
                                  disabled={!canEdit}
                                  aria-label={`${scene.title.trim() || '未命名场'}正文`}
                                  value={editor.text}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={(event) => {
                                    const prose = event.currentTarget.value
                                    onApply((current) => updateSceneProse(current, scene.id, prose))
                                  }}
                                  onBlur={() => {
                                    if (!scene.prose.trim()) return
                                    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
                                    onApply((current) => saveSceneRevision(current, scene.id, stamp))
                                  }}
                                />
                              )
                            })()}
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={(event) => {
                                event.stopPropagation()
                                onApply((current) => removeScene(current, scene.id))
                              }}
                            >
                              删除场
                            </button>
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
          {(() => {
            const allScenes = chapters.flatMap((ch, chIdx) =>
              ch.scenes.map((sc, scIdx) => ({ chapter: ch, chapterIndex: chIdx, scene: sc, sceneIndex: scIdx })),
            )
            const activeItem = allScenes.find((item) => item.scene.id === selectedKey) ?? allScenes[0] ?? null
            const steps = STRUCTURE_FRAMES[frameKind] ?? STRUCTURE_FRAMES['雪花十层']!
            const appearingNames = Array.from(
              new Set(allScenes.flatMap((item) => sceneAppearanceNames(state, item.scene))),
            )
            const outlineNames = (state.entities ?? [])
              .filter((e) => e.entityType === 'person')
              .map((e) => e.name.trim())
              .filter(Boolean)
            const foreshadows = state.canvas.edges
              .filter((edge) => edge.kind === 'foreshadow')
              .map((edge) => ({
                id: edge.id,
                name: `${edge.fromNode}→${edge.toNode}`,
                plant: edge.fromNode,
                payoff: edge.foreshadow === '回收' ? edge.toNode : null,
              }))
            const gapView: GapView = {
              kind: frameKind,
              steps,
              points: steps.join('、'),
              slug: state.snowflake.fileId,
              dismissed: dismissedGaps,
              scenes: allScenes.map((item) => ({
                id: item.scene.id,
                step: item.scene.step ?? '',
                failure: item.scene.failure === true,
              })),
              foreshadows,
              outlineNames,
              appearingNames,
            }
            const gaps = gapReport(gapView)
            const persistedRevs = activeItem ? activeItem.scene.revisions ?? [] : []
            const previousBody = persistedRevs.length > 0 ? persistedRevs[persistedRevs.length - 1]!.body : ''
            const diffParts = activeItem && showDiff ? diffTextParts(previousBody, activeItem.scene.prose) : []
            const suggestions = state.suggestions ?? []

            return (
              <aside className="scene-detail-pane" aria-label="场次工作台与结构检查">
                {activeItem ? (
                  <div className="scene-inspector">
                    <div className="scene-inspector-head">
                      <h4>
                        第{activeItem.chapterIndex + 1}章 · {activeItem.scene.title.trim() || '未命名场'}
                      </h4>
                      <span className="scene-word-count">{[...activeItem.scene.prose.replace(/\s/gu, '')].length} 字</span>
                    </div>
                    <div className="scene-step-controls">
                      <label>
                        结构步骤
                        <select
                          aria-label="本场结构步骤"
                          disabled={!canEdit}
                          value={activeItem.scene.step ?? ''}
                          onChange={(e) => {
                            const val = e.currentTarget.value
                            onApply((current) => updateSceneStep(current, activeItem.scene.id, val))
                          }}
                        >
                          <option value="">未标步骤</option>
                          {steps.map((stepName) => (
                            <option key={stepName} value={stepName}>
                              {stepName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="scene-failure-check">
                        <input
                          type="checkbox"
                          aria-label="本场受阻或失败"
                          disabled={!canEdit}
                          checked={activeItem.scene.failure === true}
                          onChange={(e) => {
                            const checked = e.currentTarget.checked
                            onApply((current) => updateSceneFailure(current, activeItem.scene.id, checked))
                          }}
                        />
                        受阻/失败尝试
                      </label>
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => {
                          const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
                          onApply((current) => saveSceneRevision(current, activeItem.scene.id, stamp))
                        }}
                      >
                        存为历史稿
                      </button>
                      <button type="button" onClick={() => setShowDiff((v) => !v)}>
                        {showDiff ? '收起版本对比' : `查看版本对比（${persistedRevs.length}）`}
                      </button>
                    </div>
                    {showDiff ? (
                      <div className="diff-view" aria-label="正本修订对比">
                        <p className="diff-caption">与最近一版历史稿对比（已持久化 {persistedRevs.length} 稿）：</p>
                        <div className="diff-body">
                          {diffParts.map((part, idx) => (
                            <span key={idx} className={`diff-${part.kind}`}>
                              {part.text}
                            </span>
                          ))}
                        </div>
                        {persistedRevs.length > 0 ? (
                          <div className="revision-list">
                            {persistedRevs.map((rev, idx) => (
                              <button
                                key={`${rev.at}-${idx}`}
                                type="button"
                                disabled={!canEdit}
                                onClick={() => {
                                  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
                                  onApply((current) => rollbackSceneRevision(current, activeItem.scene.id, idx, stamp))
                                }}
                              >
                                回退到第{idx + 1}稿（{rev.at}）
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="hint">点左侧任意一场，在这里查看字数、标注结构步骤、对比修订历史与单场回退。</p>
                )}
                {suggestions.length > 0 ? (
                  <div className="suggestion-inbox" aria-label="本书建议箱">
                    <h4>折进此场建议箱（{suggestions.length}）</h4>
                    <ul className="gap-list">
                      {suggestions.map((sug) => (
                        <li key={sug.id} className="gap-item">
                          <span>
                            <strong>[{sug.where}]</strong> {sug.text.slice(0, 60)}
                          </span>
                          <span className="row-actions">
                            {activeItem ? (
                              <button
                                type="button"
                                disabled={!canEdit}
                                onClick={() => {
                                  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false })
                                  onApply((current) => acceptSuggestionToScene(current, sug.id, activeItem.scene.id, stamp))
                                }}
                              >
                                采纳到当前场
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => onApply((current) => dismissSuggestion(current, sug.id))}
                            >
                              忽略
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="gap-panel" aria-label="结构缺口检查">
                  <div className="gap-panel-head">
                    <h4>结构缺口检查</h4>
                    <select aria-label="结构框架" value={frameKind} onChange={(e) => setFrameKind(e.currentTarget.value)}>
                      {Object.keys(STRUCTURE_FRAMES).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {gaps.length === 0 ? (
                    <p className="hint">当前结构框架下没有未处理的缺口。</p>
                  ) : (
                    <ul className="gap-list">
                      {gaps.map((item) => (
                        <li key={item.id} className="gap-item">
                          <span>{item.message}</span>
                          <button
                            type="button"
                            onClick={() => setDismissedGaps((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))}
                          >
                            我有意这样写
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </aside>
            )
          })()}
          </div>
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
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      const chapterId = chapters[0]?.id
                      if (!chapterId) {
                        onApply((current) => addChapter(current, '未命名章'))
                        return
                      }
                      onApply((current) => addScene(current, chapterId, `第${index + 1}格`))
                    }}
                  >
                    新建场
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
