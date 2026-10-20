// 按章标题切预览。确认前可以合并或拆开，确认后全文进场，不截断。

const CHAPTER_RE = /^(第[0-9０-９一二三四五六七八九十百千零〇两]+章.*|#{1,2} .+)$/u

export function previewImport(text) {
  const raw = typeof text === 'string' ? text : ''
  if (raw.trim() === '') {
    return { ok: false, error: '导入文本是空的，没有建章', chapters: [] }
  }
  const lines = raw.split(/\r?\n/u)
  const chapters = []
  let current = null
  let offset = 0
  const pushChapter = (title, start) => {
    current = { title, start, scenes: [] }
    chapters.push(current)
  }
  for (const line of lines) {
    const nextOffset = offset + line.length + 1
    if (CHAPTER_RE.test(line.trim())) {
      pushChapter(line.trim().replace(/^#{1,2}\s/u, ''), offset)
    } else if (!current) {
      pushChapter('正文', 0)
      current.scenes.push({ title: '第1场', text: line, start: offset })
    } else if (line.trim() === '---') {
      current.scenes.push({ title: `第${current.scenes.length + 1}场`, text: '', start: nextOffset })
    } else {
      if (current.scenes.length === 0) current.scenes.push({ title: '第1场', text: '', start: offset })
      const scene = current.scenes[current.scenes.length - 1]
      scene.text = scene.text ? `${scene.text}\n${line}` : line
    }
    offset = nextOffset
  }
  for (const chapter of chapters) {
    if (chapter.scenes.length === 0) chapter.scenes.push({ title: '第1场', text: '', start: chapter.start })
  }
  return { ok: true, error: '', chapters }
}

export function applyPlan(preview, plan) {
  if (!preview.ok) return preview
  const chapters = preview.chapters.map((chapter) => ({
    title: chapter.title,
    scenes: chapter.scenes.map((scene) => ({ ...scene })),
  }))
  const merges = Array.isArray(plan?.merges) ? plan.merges : []
  for (const pair of merges) {
    const [chapterIndex, left, right] = pair
    const chapter = chapters[chapterIndex]
    if (!chapter || !chapter.scenes[left] || !chapter.scenes[right]) continue
    const a = chapter.scenes[left]
    const b = chapter.scenes[right]
    a.text = [a.text, b.text].filter((part) => part && part.length > 0).join('\n')
    chapter.scenes.splice(right, 1)
  }
  const splits = Array.isArray(plan?.splits) ? plan.splits : []
  for (const item of splits) {
    const chapter = chapters[item.chapter]
    const scene = chapter?.scenes[item.scene]
    if (!scene) continue
    const at = Math.max(0, Math.min(scene.text.length, item.at || 0))
    const head = scene.text.slice(0, at)
    const tail = scene.text.slice(at)
    scene.text = head
    chapter.scenes.splice(item.scene + 1, 0, { title: '拆出的场', text: tail, start: scene.start + at })
  }
  return { ok: true, error: '', chapters }
}
