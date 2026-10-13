import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CastPage from '../src/CastPage.tsx'
import {
  addEdge,
  createCard,
  createDocument,
  emptyArc,
  serializeDocument,
  type CanvasEdge,
  type Entity,
  type EntityType,
} from '../src/document.ts'
import { gradeVisibility, PERSON_GRADE_COLUMNS, readPersonField, setPersonGrade } from '../src/person-form.ts'
import RelationPage from '../src/RelationPage.tsx'
import { endpointLabel, relationKindText, relationTableRows, relationWord } from '../src/relation-table.ts'
import { buildRelationGraph, defaultRelationFilter, edgeKindLabel } from '../src/relations.ts'
import { applySceneBoardDrop, chapterColumns, listScenes } from '../src/scene-board.ts'
import ScenePage from '../src/ScenePage.tsx'
import { bookTree, treeJump } from '../src/side-tree.ts'
import { openRowRecord, readChoice, readIdList, viewStorageKey, writeChoice, writeIdList, type ViewStore } from '../src/view-memory.ts'

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

function person(id: string, name: string, cardId: string, grade: string): Entity {
  return {
    id,
    entityType: 'person',
    name,
    views: { renwubiao: cardId },
    fields: {
      grade: { value: grade, events: [] },
      sentence: { value: '守门的人', events: [] },
    },
    arc: emptyArc(),
    premise: false,
  }
}

function entity(id: string, entityType: EntityType, name: string): Entity {
  return { id, entityType, name, views: {}, fields: {}, arc: emptyArc(), premise: false }
}

describe('Notion 切刀5', () => {
  it('人物拖到另一列后，表格读到的类别跟着变成那一档', () => {
    expect(PERSON_GRADE_COLUMNS).toEqual(['主要', '次要', 'NPC', '路人'])
    let state = createDocument('grades')
    state = createCard(state, {
      id: 'pcard',
      layer: 'renwubiao',
      x: 0,
      y: 0,
      fields: { name: '奈德', grade: '主要', sentence: '守门的人' },
    })
    state = { ...state, entities: [person('ned', '奈德', 'pcard', '主要')] }
    expect(setPersonGrade(state, 'ned', '配角')).toBe(state)
    const next = setPersonGrade(state, 'ned', '次要')
    const updated = next.entities?.find((item) => item.id === 'ned')
    if (!updated) throw new Error('人物不见了')
    expect(updated.fields.grade?.value).toBe('次要')
    expect(next.snowflake.cards.pcard?.fields.grade).toBe('次要')
    expect(gradeVisibility(readPersonField(next, updated, 'grade')).level).toBe('次要')
    expect(readPersonField(next, updated, 'sentence')).toBe('守门的人')

    const html = renderToStaticMarkup(
      createElement(CastPage, {
        state: createDocument('empty-cast'),
        canEdit: false,
        onApply: () => undefined,
        onOpenIdea: () => undefined,
        initialView: 'board',
      }),
    )
    expect(html).toContain('人物看板')
    for (const label of PERSON_GRADE_COLUMNS) expect(html).toContain(`aria-label="${label}"`)
    expect(html).not.toContain('这本书还没有人物实体')
  })

  it('重新读本地记录后，展开的人和看板还在，正本里没有视图类型', () => {
    const store = memoryStore()
    writeChoice(store, 'book-a', 'cast', 'board')
    writeIdList(store, 'book-a', 'cast-open', ['ned'])
    writeChoice(store, 'book-a', 'scene', 'board')
    writeChoice(store, 'book-a', 'scene-group', 'structure')
    writeChoice(store, 'book-a', 'relation', 'table')
    writeChoice(store, 'book-a', 'tree', 'collapsed')

    expect(readChoice(store, 'book-a', 'cast', ['table', 'board'] as const, 'table')).toBe('board')
    expect(readIdList(store, 'book-a', 'cast-open')).toEqual(['ned'])
    expect(openRowRecord(readIdList(store, 'book-a', 'cast-open')).ned).toBe(true)
    expect(readChoice(store, 'book-b', 'cast', ['table', 'board'] as const, 'table')).toBe('table')
    expect(readIdList(store, 'book-b', 'cast-open')).toEqual([])
    expect(readChoice(store, 'book-a', 'scene-group', ['chapter', 'structure'] as const, 'chapter')).toBe('structure')
    expect(readChoice(store, 'book-a', 'relation', ['graph', 'table'] as const, 'graph')).toBe('table')
    expect(readChoice(store, 'book-a', 'tree', ['open', 'collapsed'] as const, 'open')).toBe('collapsed')
    expect(viewStorageKey('book-a', 'cast')).toBe('snowflake-view:book-a:cast')
    expect(viewStorageKey('book-a', 'cast')).not.toBe(viewStorageKey('book-b', 'cast'))

    let state = createDocument('grades')
    state = createCard(state, {
      id: 'pcard',
      layer: 'renwubiao',
      x: 0,
      y: 0,
      fields: { name: '奈德', grade: '主要', sentence: '守门的人' },
    })
    state = { ...state, entities: [person('ned', '奈德', 'pcard', '主要')] }
    const graded = setPersonGrade(state, 'ned', 'NPC')
    const json = JSON.stringify(serializeDocument(graded))
    expect(json).not.toContain('snowflake-view')
    expect(json).not.toContain('cast-open')
    expect(json).not.toContain('scene-group')
    expect(json).toContain('"grade":"NPC"')
    expect(read('src/CastPage.tsx')).toContain('readIdList')
    expect(read('src/CastPage.tsx')).toContain('刷新后仍展开')
    expect(read('src/CastPage.tsx')).not.toContain('刷新后全部收起')
  })

  it('关系表的行就是当前筛选下的那些边，从、到、种类对得上', () => {
    let state = createDocument('rel')
    state = createCard(state, { id: 'idea-1', layer: 'situation', x: 0, y: 0, body: '门口的卡片' })
    state = createCard(state, { id: 'idea-2', layer: 'situation', x: 20, y: 0, body: '城里的卡片' })
    state = createCard(state, { id: 'beat', layer: 'changci', x: 40, y: 0, fields: { task: '进门' } })
    state = {
      ...state,
      entities: [entity('ent-person', 'person', '奈德'), entity('ent-place', 'place', '临冬城')],
    }
    state = addEdge(state, 'beat', 'ent-person', 'appears-in')
    state = addEdge(state, 'ent-person', 'ent-place', 'relates-entity')
    state = addEdge(state, 'idea-1', 'idea-2', 'relates', { relation: '冲突' })
    state = {
      ...state,
      canvas: {
        ...state.canvas,
        edges: state.canvas.edges.map((edge) => (edge.kind === 'relates-entity' ? { ...edge, label: '旧识' } : edge)),
      },
    }
    const edges = state.canvas.edges
    const filter = defaultRelationFilter()
    const rows = relationTableRows(state, filter)
    const graph = buildRelationGraph(state, filter)
    expect(rows.map((row) => row.id).sort()).toEqual(graph.edges.map((edge) => edge.id).sort())
    expect(state.canvas.edges).toBe(edges)
    expect(rows.length).toBeLessThan(edges.length)

    const appear = edges.find((edge) => edge.kind === 'appears-in')
    expect(rows.find((row) => row.id === appear?.id)).toMatchObject({
      from: endpointLabel(state, 'beat'),
      to: '奈德',
      kind: edgeKindLabel('appears-in'),
      relation: '',
    })
    expect(rows.find((row) => row.relation === '旧识')).toMatchObject({
      from: '奈德',
      to: '临冬城',
      kind: '实体关系',
    })

    const openedFilter = { ...filter, ideaLayer: true, groups: { ...filter.groups, relates: true } }
    const opened = relationTableRows(state, openedFilter)
    expect(opened.map((row) => row.id).sort()).toEqual(buildRelationGraph(state, openedFilter).edges.map((edge) => edge.id).sort())
    const relate = opened.find((row) => row.relation === '冲突')
    expect(relate?.kind).toBe(edgeKindLabel('relates', '冲突'))
    expect(relate?.from).toBe(endpointLabel(state, 'idea-1'))
    expect(relate?.to).toBe(endpointLabel(state, 'idea-2'))

    const bare: CanvasEdge = { id: 'bare', fromNode: 'a', toNode: 'b' }
    expect(relationKindText(bare)).toBe('')
    expect(relationWord(bare)).toBe('')
    expect(relationWord({ ...bare, label: '旧识' })).toBe('旧识')
    expect(relationWord({ ...bare, relation: '冲突', label: '别的' })).toBe('冲突')
    expect(endpointLabel(state, 'missing-node')).toBe('missing-node')

    const html = renderToStaticMarkup(createElement(RelationPage, { state, initialView: 'table' }))
    expect(html).toContain('关系表')
    expect(html).toContain('奈德')
    expect(html).toContain('旧识')
    expect(html).toContain('>出场<')
    expect(read('src/RelationPage.tsx')).toContain('relationTableRows')
    expect(read('src/RelationPage.tsx')).not.toContain('addEdge')
  })

  it('场次按冲突结构拖过去会改 structureKind，按章拖过去会改 chapter', () => {
    let state = createDocument('scenes')
    state = createCard(state, {
      id: 'sc1',
      layer: 'changci',
      x: 0,
      y: 0,
      fields: { task: '进门', structureKind: 'active', alpha: '城门' },
    })
    const card = state.snowflake.cards.sc1
    if (!card) throw new Error('场次没有建出来')
    state = {
      ...state,
      chapters: [{ id: 'ch1', title: '第一章', scenes: [] }],
      snowflake: {
        ...state.snowflake,
        cards: {
          ...state.snowflake.cards,
          sc1: { ...card, fields: { ...card.fields, chapter: '第一章' } },
        },
      },
    }
    const moved = applySceneBoardDrop(state, 'sc1', 'structure', 'reactive')
    expect(moved.snowflake.cards.sc1?.fields.structureKind).toBe('reactive')
    expect(moved.snowflake.cards.sc1?.fields.chapter).toBe('第一章')
    expect(moved.chapters).toBe(state.chapters)
    expect(listScenes(moved)[0]?.structureLabel).toBe('反应')
    expect(applySceneBoardDrop(moved, 'sc1', 'structure', 'empty')).toBe(moved)
    expect(moved.snowflake.cards.sc1?.fields.structureKind).toBe('reactive')
    const chapterMoved = applySceneBoardDrop(state, 'sc1', 'chapter', '第二章')
    expect(chapterMoved.snowflake.cards.sc1?.fields.chapter).toBe('第二章')
    expect(chapterMoved.snowflake.cards.sc1?.fields.structureKind).toBe('active')
    expect(chapterMoved.snowflake.cards.sc1?.fields.task).toBe('进门')
    expect(chapterMoved.snowflake.cards.sc1?.fields.alpha).toBe('城门')
    expect(chapterMoved.chapters).toBe(state.chapters)
    expect(chapterMoved.snowflake.cards.sc1?.fields).not.toHaveProperty('act')
    expect(applySceneBoardDrop(state, 'sc1', 'chapter', '未分章')).toBe(state)
    expect(applySceneBoardDrop(chapterMoved, 'sc1', 'chapter', '第二章')).toBe(chapterMoved)
    expect(chapterColumns([])).toEqual(['未分章'])

    const empty = createDocument('empty-scene')
    const structureHtml = renderToStaticMarkup(
      createElement(ScenePage, {
        state: empty,
        canEdit: false,
        onApply: () => undefined,
        onOpenCard: () => undefined,
        initialView: 'board',
        initialGroup: 'structure',
      }),
    )
    expect(structureHtml).toContain('aria-label="主动"')
    expect(structureHtml).toContain('aria-label="反应"')
    expect(structureHtml).toContain('aria-label="未填"')
    const chapterHtml = renderToStaticMarkup(
      createElement(ScenePage, {
        state: empty,
        canEdit: false,
        onApply: () => undefined,
        onOpenCard: () => undefined,
        initialView: 'board',
        initialGroup: 'chapter',
      }),
    )
    expect(chapterHtml).toContain('未分章')
    expect(read('src/ScenePage.tsx')).toContain('applySceneBoardDrop')
  })

  it('左树叶子指向人物页和章节页', () => {
    const state = {
      ...createDocument('tree'),
      entities: [entity('ned', 'person', '奈德'), entity('winter', 'place', '临冬城')],
      chapters: [{ id: 'ch-1', title: '城门夜雨', scenes: [] }],
    }
    const tree = bookTree('冰与火', state)
    const person = tree.children?.find((node) => node.label === '人物')?.children?.find((node) => node.label === '奈德')
    if (!person) throw new Error('人物叶子没有')
    expect(treeJump(person)).toEqual({ page: 'cast', entityId: 'ned' })
    const chapter = tree.children?.find((node) => node.label === '章节')?.children?.find((node) => node.label === '城门夜雨')
    if (!chapter) throw new Error('章节叶子没有')
    expect(treeJump(chapter)).toEqual({ page: 'chapter', chapterId: 'ch-1' })
    const place = tree.children?.find((node) => node.label === '百科')?.children?.find((node) => node.label === '临冬城')
    expect(place ? treeJump(place).page : '').toBe('encyclopedia')
    expect(read('src/App.tsx')).toContain('treeJump')
    expect(read('src/App.tsx')).toContain('label="更多"')
  })
})
