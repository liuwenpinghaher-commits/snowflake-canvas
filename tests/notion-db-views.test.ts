import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CastPage from '../src/CastPage.tsx'
import { createCard, createDocument, emptyArc, serializeDocument, type AppState, type Entity } from '../src/document.ts'
import { mentionToken } from '../src/mention-mark.ts'
import { mentionsOf } from '../src/mentions.ts'
import { documentToBytes, parseCompleteDocument } from '../src/persist.ts'
import { gradeVisibility, readPersonField, setPersonGrade } from '../src/person-form.ts'
import { applySceneBoardDrop, chapterColumnDroppable, chapterColumns, listScenes } from '../src/scene-board.ts'
import ScenePage from '../src/ScenePage.tsx'
import { matchesSearch, moveColumn, personRowVisible, sceneRowVisible, sortByText, toggleSort } from '../src/table-view.ts'
import { readColumnLayout, viewStorageKey, writeColumnLayout, type ViewStore } from '../src/view-memory.ts'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function memoryStore(): ViewStore {
  const data = new Map<string, string>()
  return {
    getItem(key) {
      return data.has(key) ? (data.get(key) ?? null) : null
    },
    setItem(key, value) {
      data.set(key, value)
    },
  }
}

function person(id: string, name: string, cardId: string, grade: string, sentence = '守门的人', slug?: string): Entity {
  const entity: Entity = {
    id,
    entityType: 'person',
    name,
    views: { renwubiao: cardId },
    fields: {
      grade: { value: grade, events: [] },
      sentence: { value: sentence, events: [] },
      name: { value: name, events: [] },
    },
    arc: emptyArc(),
    premise: false,
  }
  if (slug) entity.slug = slug
  return entity
}

function columnIds(state: AppState, level: string): string[] {
  return (state.entities ?? [])
    .filter((entity) => entity.entityType === 'person')
    .filter((entity) => gradeVisibility(readPersonField(state, entity, 'grade')).level === level)
    .map((entity) => entity.id)
}

function section(html: string, label: string): string {
  const marker = `aria-label="${label}"`
  const start = html.indexOf(marker)
  if (start < 0) throw new Error(`没有列 ${label}`)
  const next = html.indexOf('aria-label="', start + marker.length)
  return html.slice(start, next < 0 ? html.length : next)
}


function withSceneFields(state: AppState, id: string, extra: Record<string, string>): AppState {
  const card = state.snowflake.cards[id]
  if (!card) throw new Error('场次没有建出来')
  return {
    ...state,
    snowflake: {
      ...state.snowflake,
      cards: {
        ...state.snowflake.cards,
        [id]: { ...card, fields: { ...card.fields, ...extra } },
      },
    },
  }
}

function reload(state: AppState): AppState {
  const loaded = parseCompleteDocument(documentToBytes(state))
  if (!loaded) throw new Error('正本没有读回来')
  return loaded.state
}

describe('人物和场次表', () => {
  it('人物拖到相邻列后，类别已变，重新列出仍在新列', () => {
    let state = createDocument('grades')
    state = createCard(state, {
      id: 'pcard',
      layer: 'renwubiao',
      x: 0,
      y: 0,
      fields: { name: '奈德', grade: '主要', sentence: '守门的人' },
    })
    state = createCard(state, {
      id: 'pcard-2',
      layer: 'renwubiao',
      x: 20,
      y: 0,
      fields: { name: '琼恩', grade: '次要', sentence: '墙下的人' },
    })
    state = {
      ...state,
      entities: [person('ned', '奈德', 'pcard', '主要'), person('jon', '琼恩', 'pcard-2', '次要', '墙下的人')],
    }
    expect(columnIds(state, '主要')).toEqual(['ned'])
    expect(read('src/CastPage.tsx')).toContain('setPersonGrade')
    const moved = setPersonGrade(state, 'ned', '次要')
    const ned = moved.entities?.find((entity) => entity.id === 'ned')
    if (!ned) throw new Error('人物不见了')
    expect(readPersonField(moved, ned, 'grade')).toBe('次要')
    expect(columnIds(moved, '次要').sort()).toEqual(['jon', 'ned'])
    expect(columnIds(moved, '主要')).toEqual([])
    const again = reload(moved)
    expect(columnIds(again, '次要').sort()).toEqual(['jon', 'ned'])
    expect(columnIds(again, '主要')).toEqual([])
    const html = renderToStaticMarkup(
      createElement(CastPage, {
        state: again,
        canEdit: true,
        onApply: () => undefined,
        onOpenIdea: () => undefined,
        initialView: 'board',
      }),
    )
    expect(section(html, '次要')).toContain('奈德')
    expect(section(html, '主要')).not.toContain('奈德')
    expect(JSON.stringify(serializeDocument(again))).not.toContain('snowflake-view')
  })

  it('场次拖到另一章会改 chapter，未分章和未填仍拒绝，刷新后仍在新章', () => {
    let state = createDocument('scenes')
    state = createCard(state, {
      id: 'sc1',
      layer: 'changci',
      x: 0,
      y: 0,
      fields: { title: '城门', task: '进门', structureKind: 'active', chapter: '第一章' },
    })
    state = createCard(state, {
      id: 'sc2',
      layer: 'changci',
      x: 20,
      y: 0,
      fields: { title: '厅里', task: '问答', structureKind: 'reactive', chapter: '第二章' },
    })
    state = withSceneFields(state, 'sc1', { title: '城门', chapter: '第一章' })
    state = withSceneFields(state, 'sc2', { title: '厅里', chapter: '第二章' })
    expect(chapterColumnDroppable('第一章')).toBe(true)
    expect(chapterColumnDroppable('未分章')).toBe(false)
    expect(applySceneBoardDrop(state, 'sc1', 'chapter', '未分章')).toBe(state)
    expect(applySceneBoardDrop(state, 'sc1', 'structure', 'empty')).toBe(state)
    const moved = applySceneBoardDrop(state, 'sc1', 'chapter', '第二章')
    const fields = moved.snowflake.cards.sc1?.fields
    expect(fields?.chapter).toBe('第二章')
    expect(fields?.title).toBe('城门')
    expect(fields?.task).toBe('进门')
    expect(fields?.structureKind).toBe('active')
    expect(fields).not.toHaveProperty('act')
    expect(moved.chapters).toBe(state.chapters)
    expect(listScenes(moved).find((row) => row.id === 'sc1')?.chapter).toBe('第二章')
    const again = reload(moved)
    expect(listScenes(again).find((row) => row.id === 'sc1')?.chapter).toBe('第二章')
    expect(chapterColumns(listScenes(again))).toContain('第二章')
    expect(JSON.stringify(again.snowflake.cards.sc1?.fields)).not.toContain('幕')
    const html = renderToStaticMarkup(
      createElement(ScenePage, {
        state: again,
        canEdit: true,
        onApply: () => undefined,
        onOpenCard: () => undefined,
        initialView: 'board',
        initialGroup: 'chapter',
      }),
    )
    expect(section(html, '第二章')).toContain('城门')
    expect(section(html, '第二章')).toContain('data-droppable="true"')
    expect(section(html, '未分章')).toContain('data-droppable="false"')
    expect(read('src/scene-board.ts')).not.toContain('幕')
    expect(read('src/ScenePage.tsx')).not.toContain('幕')
  })

  it('文本列能排序，搜索和筛选只看这张表的可见文字', () => {
    const people = [
      { name: '奈德', sentence: '守门的人', grade: '主要' },
      { name: '琼恩', sentence: '墙下的人', grade: '次要' },
    ]
    expect(toggleSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(toggleSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(sortByText(people, (row) => row.name, 'asc').map((row) => row.name)).toEqual(['奈德', '琼恩'])
    expect(sortByText(people, (row) => row.name, 'desc').map((row) => row.name)).toEqual(['琼恩', '奈德'])
    const bySentence = sortByText(people, (row) => row.sentence, 'asc').map((row) => row.name)
    expect(sortByText(people, (row) => row.sentence, 'desc').map((row) => row.name)).toEqual([...bySentence].reverse())
    expect(new Set(bySentence)).toEqual(new Set(['奈德', '琼恩']))
    expect(matchesSearch(['奈德', '守门的人', '主要'], '守门')).toBe(true)
    expect(matchesSearch(['奈德', '守门的人', '主要'], '百科页')).toBe(false)
    expect(personRowVisible('次要', true, '次要', 'bound')).toBe(true)
    expect(personRowVisible('主要', true, '次要', '')).toBe(false)
    expect(personRowVisible('主要', false, '', 'unbound')).toBe(true)
    expect(personRowVisible('主要', true, '', 'unbound')).toBe(false)
    expect(sceneRowVisible('active', '第一章', 'active', 'has')).toBe(true)
    expect(sceneRowVisible('empty', '', 'empty', 'none')).toBe(true)
    expect(sceneRowVisible('reactive', '第二章', 'active', '')).toBe(false)
    expect(sceneRowVisible('active', '', '', 'has')).toBe(false)

    let state = createDocument('table')
    state = createCard(state, {
      id: 'pcard',
      layer: 'renwubiao',
      x: 0,
      y: 0,
      fields: { name: '奈德', grade: '主要', sentence: '守门的人' },
    })
    state = { ...state, entities: [person('ned', '奈德', 'pcard', '主要', '守门的人', 'world/ned')] }
    const cast = renderToStaticMarkup(
      createElement(CastPage, {
        state,
        canEdit: false,
        onApply: () => undefined,
        onOpenIdea: () => undefined,
        initialView: 'table',
      }),
    )
    expect(cast).toContain('aria-label="搜索这张表"')
    expect(cast).toContain('aria-label="按类别筛选"')
    expect(cast).toContain('已绑定')
    expect(cast).toContain('未绑定')
    expect(cast).toMatch(/class="col-sort">\s*名字/)
    expect(cast).toMatch(/class="col-sort">\s*一句/)
    expect(cast).toContain('<span class="col-label">类别</span>')
    expect(cast).toContain('class="on"')
    expect(cast).not.toContain('aria-pressed')

    let scenes = createDocument('scene-table')
    scenes = createCard(scenes, {
      id: 'sc1',
      layer: 'changci',
      x: 0,
      y: 0,
      fields: { title: '城门', task: '进门', structureKind: 'active', chapter: '第一章' },
    })
    const scene = renderToStaticMarkup(
      createElement(ScenePage, {
        state: scenes,
        canEdit: false,
        onApply: () => undefined,
        onOpenCard: () => undefined,
        initialView: 'table',
      }),
    )
    expect(scene).toContain('aria-label="按冲突结构筛选"')
    expect(scene).toContain('aria-label="按有没有章筛选"')
    expect(scene).toContain('>有章<')
    expect(scene).toContain('>没章<')
    expect(scene).toContain('>未填<')
    expect(scene).toMatch(/class="col-sort">\s*标题/)
    expect(scene).toMatch(/class="col-sort">\s*本场任务/)
    expect(scene).toContain('<span class="col-label">章</span>')
    expect(scene).toContain('<span class="col-label">冲突结构</span>')
    expect(scene).not.toContain('aria-pressed')
  })

  it('列宽、显隐和顺序记在这本书的浏览器键里，换一本书不串，也不进正本', () => {
    const store = memoryStore()
    const ids = ['name', 'grade', 'sentence', 'bind']
    writeColumnLayout(store, 'book-a', 'cast-columns', {
      order: ['sentence', 'name', 'grade', 'bind'],
      hidden: ['bind'],
      widths: { name: 240, sentence: 10 },
    })
    const saved = readColumnLayout(store, 'book-a', 'cast-columns', ids)
    expect(saved.order).toEqual(['sentence', 'name', 'grade', 'bind'])
    expect(saved.hidden).toEqual(['bind'])
    expect(saved.widths.name).toBe(240)
    expect(saved.widths.sentence).toBeUndefined()
    expect(readColumnLayout(store, 'book-b', 'cast-columns', ids)).toEqual({
      order: ids,
      hidden: [],
      widths: {},
    })
    expect(viewStorageKey('book-a', 'cast-columns')).toBe('snowflake-view:book-a:cast-columns')
    expect(viewStorageKey('book-a', 'scene-columns')).not.toBe(viewStorageKey('book-b', 'scene-columns'))
    expect(moveColumn(ids, 'bind', 'name')).toEqual(['bind', 'name', 'grade', 'sentence'])
    const json = JSON.stringify(serializeDocument(createDocument('plain')))
    expect(json).not.toContain('snowflake-view')
    expect(json).not.toContain('cast-columns')
    expect(read('src/view-memory.ts')).toContain('列定制和展开的行同一套')
    const css = read('src/index.css')
    expect(css).toContain('button.on')
    expect(css).toContain('--state-selected')
    expect(css).toContain(".beat-lengths button[aria-pressed='true']")
  })

  it('人物表和人物卡用同一套计数显示提到几次，零次不显示', () => {
    const token = mentionToken('entity', 'ned')
    if (!token) throw new Error('标记被拒绝')
    let state = createDocument('mentions')
    state = createCard(state, { id: 'src', layer: 'situation', x: 0, y: 0, body: `甲见${token}` })
    state = createCard(state, {
      id: 'pcard',
      layer: 'renwubiao',
      x: 10,
      y: 0,
      fields: { name: '奈德', grade: '主要', sentence: '守门的人' },
    })
    state = createCard(state, {
      id: 'pcard-2',
      layer: 'renwubiao',
      x: 30,
      y: 0,
      fields: { name: '琼恩', grade: '次要', sentence: '墙下的人' },
    })
    state = {
      ...state,
      entities: [person('ned', '奈德', 'pcard', '主要'), person('jon', '琼恩', 'pcard-2', '次要', '墙下的人')],
    }
    expect(mentionsOf(state, 'entity', 'ned')).toHaveLength(1)
    expect(mentionsOf(state, 'entity', 'jon')).toHaveLength(0)
    const table = renderToStaticMarkup(
      createElement(CastPage, {
        state,
        canEdit: false,
        onApply: () => undefined,
        onOpenIdea: () => undefined,
        initialView: 'table',
      }),
    )
    const board = renderToStaticMarkup(
      createElement(CastPage, {
        state,
        canEdit: false,
        onApply: () => undefined,
        onOpenIdea: () => undefined,
        initialView: 'board',
      }),
    )
    expect(table).toContain('mention-badge')
    expect(table).toContain('提到 1 次')
    expect(board).toContain('提到 1 次')
    expect(table).not.toContain('提到 0 次')
    expect(board).not.toContain('提到 0 次')
    expect(table).toContain('琼恩')
    expect(read('src/MentionBacklinks.tsx')).toContain('mentionsOf')
  })
})
