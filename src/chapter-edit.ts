import type { AppState, BookChapter, BookScene } from './document.ts'

function nextId(prefix: string, used: Set<string>): string {
  let n = used.size + 1
  while (used.has(`${prefix}-${n}`)) n += 1
  return `${prefix}-${n}`
}

function usedIds(state: AppState): Set<string> {
  const ids = new Set<string>()
  for (const chapter of state.chapters ?? []) {
    ids.add(chapter.id)
    for (const scene of chapter.scenes) ids.add(scene.id)
  }
  return ids
}

function blankScene(id: string, title: string): BookScene {
  return { id, title, ideaIds: [], prose: '', beatIds: [] }
}

export function addChapter(state: AppState, title: string, id?: string): AppState {
  const chapters = [...(state.chapters ?? [])]
  const sceneId = id ? `${id}-s1` : undefined
  const chapterId = id ?? nextId('chapter', usedIds(state))
  const chapter: BookChapter = {
    id: chapterId,
    title,
    scenes: [blankScene(sceneId ?? `${chapterId}-s1`, '第1场')],
  }
  chapters.push(chapter)
  return { ...state, chapters }
}

export function addScene(state: AppState, chapterId: string, title: string, id?: string): AppState {
  const chapters = (state.chapters ?? []).map((chapter) => {
    if (chapter.id !== chapterId) return chapter
    const ids = usedIds(state)
    const sceneId = id ?? nextId('scene', ids)
    return { ...chapter, scenes: [...chapter.scenes, blankScene(sceneId, title)] }
  })
  return { ...state, chapters }
}

export function renameChapter(state: AppState, chapterId: string, title: string): AppState {
  return {
    ...state,
    chapters: (state.chapters ?? []).map((chapter) => (chapter.id === chapterId ? { ...chapter, title } : chapter)),
  }
}

export function buildBlankChapters(state: AppState, chapterCount = 3, sceneCount = 2): AppState {
  let next: AppState = { ...state, chapters: [] }
  for (let index = 0; index < chapterCount; index += 1) {
    const chapterId = `blank-ch-${index + 1}`
    next = addChapter(next, `第${index + 1}章`, chapterId)
    for (let sceneIndex = 1; sceneIndex < sceneCount; sceneIndex += 1) {
      next = addScene(next, chapterId, `第${sceneIndex + 1}场`, `blank-ch-${index + 1}-s${sceneIndex + 1}`)
    }
  }
  return next
}

export function chapterPageCanCreate(state: AppState): boolean {
  const built = buildBlankChapters(state)
  const chapters = built.chapters ?? []
  return chapters.length === 3 && chapters.every((chapter) => chapter.scenes.length === 2)
}

export function updateSceneProse(state: AppState, sceneId: string, prose: string): AppState {
  return {
    ...state,
    chapters: (state.chapters ?? []).map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes.map((scene) => (scene.id === sceneId ? { ...scene, prose } : scene)),
    })),
  }
}

export function renameScene(state: AppState, sceneId: string, title: string): AppState {
  return {
    ...state,
    chapters: (state.chapters ?? []).map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes.map((scene) => (scene.id === sceneId ? { ...scene, title } : scene)),
    })),
  }
}

export function removeChapter(state: AppState, chapterId: string): AppState {
  return { ...state, chapters: (state.chapters ?? []).filter((chapter) => chapter.id !== chapterId) }
}

export function removeScene(state: AppState, sceneId: string): AppState {
  return {
    ...state,
    chapters: (state.chapters ?? []).map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes.filter((scene) => scene.id !== sceneId),
    })),
  }
}

export function attachCardToNamedChapter(state: AppState, cardId: string, chapterTitle: string): AppState {
  const chapters = [...(state.chapters ?? [])]
  let chapter = chapters.find((item) => item.title === chapterTitle)
  if (!chapter) {
    chapter = { id: `linked-${cardId}`, title: chapterTitle, scenes: [] }
    chapters.push(chapter)
  }
  const scenes = chapter.scenes.some((scene) => scene.beatIds.includes(cardId))
    ? chapter.scenes
    : [...chapter.scenes, { id: `beat-${cardId}`, title: chapterTitle, ideaIds: [], prose: '', beatIds: [cardId] }]
  return {
    ...state,
    chapters: chapters.map((item) => (item.id === chapter.id ? { ...item, scenes } : item)),
  }
}

export function updateSceneStep(state: AppState, sceneId: string, step: string): AppState {
  const trimmed = step.trim()
  return {
    ...state,
    chapters: (state.chapters ?? []).map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene
        const next: BookScene = { ...scene }
        if (trimmed) next.step = trimmed
        else delete next.step
        return next
      }),
    })),
  }
}

export function updateSceneFailure(state: AppState, sceneId: string, failure: boolean): AppState {
  return {
    ...state,
    chapters: (state.chapters ?? []).map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene
        const next: BookScene = { ...scene }
        if (failure) next.failure = true
        else delete next.failure
        return next
      }),
    })),
  }
}

export function saveSceneRevision(state: AppState, sceneId: string, at: string, kind = '手写'): AppState {
  return {
    ...state,
    chapters: (state.chapters ?? []).map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene
        const existing = [...(scene.revisions ?? [])]
        if (existing.length > 0 && existing[existing.length - 1]?.body === scene.prose) return scene
        existing.push({ body: scene.prose, at, kind })
        return { ...scene, revisions: existing.slice(-20) }
      }),
    })),
  }
}

export function rollbackSceneRevision(state: AppState, sceneId: string, revIndex: number, nowLabel: string): AppState {
  return {
    ...state,
    chapters: (state.chapters ?? []).map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene
        const revs = [...(scene.revisions ?? [])]
        const target = revs[revIndex]
        if (!target) return scene
        if (scene.prose !== target.body) {
          revs.push({ body: scene.prose, at: `${nowLabel}（回退前留底）`, kind: '手写' })
        }
        return { ...scene, prose: target.body, revisions: revs.slice(-20) }
      }),
    })),
  }
}

export function acceptSuggestionToScene(
  state: AppState,
  suggestionId: string,
  targetSceneId: string,
  nowLabel: string,
): AppState {
  const suggestion = (state.suggestions ?? []).find((item) => item.id === suggestionId)
  if (!suggestion) return state
  const chapters = (state.chapters ?? []).map((chapter) => ({
    ...chapter,
    scenes: chapter.scenes.map((scene) => {
      if (scene.id !== targetSceneId) return scene
      const revs = [...(scene.revisions ?? [])]
      if (scene.prose.trim()) revs.push({ body: scene.prose, at: `${nowLabel}（采纳前留底）`, kind: '手写' })
      const nextProse = [scene.prose.trim(), suggestion.text.trim()].filter(Boolean).join('\n\n')
      revs.push({ body: nextProse, at: nowLabel, kind: '采纳' })
      const beatIds = scene.beatIds.includes(suggestion.cardId)
        ? scene.beatIds
        : [...scene.beatIds, suggestion.cardId]
      return {
        ...scene,
        prose: nextProse,
        beatIds,
        revisions: revs.slice(-20),
      }
    }),
  }))
  return {
    ...state,
    chapters,
    suggestions: (state.suggestions ?? []).filter((item) => item.id !== suggestionId),
  }
}

export function dismissSuggestion(state: AppState, suggestionId: string): AppState {
  return {
    ...state,
    suggestions: (state.suggestions ?? []).filter((item) => item.id !== suggestionId),
  }
}
