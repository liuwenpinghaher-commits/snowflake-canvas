import { describe, expect, it } from 'vitest'
import {
  LAYERS,
  commitCardText,
  createCard,
  createDocument,
  frontText,
  layerLabel,
  nextLayer,
  serializeDocument,
  setCardBody,
  spawnChild,
  type Layer,
} from '../src/document.ts'
import { parseCompleteDocument } from '../src/persist.ts'

const LABEL: Record<Layer, string> = {
  situation: '念头',
  一句话: '一句话',
  一段: '一段',
  renwubiao: '人物表',
  yiyedagang: '一页大纲',
  renwugushi: '人物故事',
  renwudangan: '人物档案',
  场景表: '场景表',
  changci: '场次',
  正文草稿: '正文草稿',
}

function node(id: string, x: number) {
  return { id, type: 'text', x, y: 0, width: 280, height: 120, text: id, color: '1' }
}

function load(document: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(document))
  const parsed = parseCompleteDocument(bytes)
  expect(parsed).not.toBeNull()
  if (!parsed) throw new Error('旧档没有打开')
  return parsed.state
}

describe('十层雪花', () => {
  it('界面层名是中文，十层颜色互不重复，默认下一层按这个顺序', () => {
    expect(LAYERS.map((layer) => layerLabel(layer))).toEqual(Object.values(LABEL))
    expect(layerLabel('situation')).toBe('念头')
    let layer: Layer | null = 'situation'
    const seen: Layer[] = []
    while (layer) {
      seen.push(layer)
      layer = nextLayer(layer)
    }
    expect(seen).toEqual([...LAYERS])
    const colors = LAYERS.map((item) => {
      const state = createCard(createDocument(item), { id: 'c', layer: item, x: 0, y: 0 })
      return state.canvas.nodes[0]?.color
    })
    expect(new Set(colors).size).toBe(LAYERS.length)
  })

  it('从念头按默认顺序长出十层，边把相邻两层连上', () => {
    let state = createDocument('chain')
    state = createCard(state, { id: 'n0', layer: 'situation', x: 0, y: 0, body: '门口那个人' })
    for (let index = 1; index < LAYERS.length; index += 1) {
      state = spawnChild(state, `n${index - 1}`, undefined, index * 40, 0, `n${index}`)
    }
    expect(LAYERS.map((_, index) => state.snowflake.cards[`n${index}`]?.layer)).toEqual([...LAYERS])
    for (let index = 0; index < LAYERS.length - 1; index += 1) {
      expect(
        state.canvas.edges.some((edge) => edge.fromNode === `n${index}` && edge.toNode === `n${index + 1}`),
      ).toBe(true)
    }
    expect(Object.values(state.snowflake.cards)).toHaveLength(10)
  })

  it('缺的层不挡：场景表可以直接长出正文草稿，人物表可以直接长出场景表', () => {
    let state = createDocument('skip-scene')
    state = createCard(state, {
      id: 'scene',
      layer: '场景表',
      x: 0,
      y: 0,
      fields: { what: '她开门', title: '雪夜' },
    })
    state = spawnChild(state, 'scene', '正文草稿', 80, 0, 'prose')
    expect(state.snowflake.cards.prose?.layer).toBe('正文草稿')
    expect(Object.values(state.snowflake.cards).some((card) => card.layer === 'changci')).toBe(false)
    expect(state.canvas.edges.some((edge) => edge.fromNode === 'scene' && edge.toNode === 'prose')).toBe(true)

    let people = createDocument('skip-person')
    people = createCard(people, { id: 'person', layer: 'renwubiao', x: 0, y: 0, fields: { name: '林晚' } })
    people = spawnChild(people, 'person', '场景表', 80, 0, 'scene')
    expect(people.snowflake.cards.scene?.layer).toBe('场景表')
    expect(people.snowflake.cards.person?.layer).toBe('renwubiao')
  })

  it('旧六层文档打开后人物变成人物表，场景表和正文草稿的挂载还在', () => {
    const phrase = '门口的弟弟'
    const full = '她在雪夜确认门口的人是弟弟。'
    const notes = '先别写死年龄'
    const summary = '她发现门口的人是弟弟'
    const longer = '更长的一场摘要'
    const sceneNotes = '夜里'
    const state = load({
      canvas: {
        nodes: ['sit', 'sent', 'para', 'person', 'scene', 'prose'].map((id, index) => node(id, index * 20)),
        edges: [
          {
            id: 'e-scene-prose',
            fromNode: 'scene',
            toNode: 'prose',
            fromSide: 'right',
            toSide: 'left',
            toEnd: 'arrow',
          },
        ],
      },
      snowflake: {
        fileId: 'file-old',
        cards: {
          sit: { layer: 'situation', body: '门口那个人其实是弟弟', fields: {} },
          sent: { layer: '一句话', body: '她发现弟弟还活着。', fields: { sentence: '她发现弟弟还活着。' } },
          para: {
            layer: '一段',
            body: '背景：雪夜。',
            fields: { background: '雪夜。', disaster1: '', disaster2: '', disaster3: '', ending: '' },
          },
          person: {
            layer: '人物',
            body: '旧人物正文',
            fields: {
              name: '林晚',
              motivation: '要确认',
              goal: '带他回家',
              conflict: '他不承认',
              epiphany: '认错人也是救',
              phraseSummary: phrase,
              paragraphSummary: '她开了门。',
              fullSummary: full,
              notes,
            },
          },
          scene: {
            layer: '场景表',
            body: '旧场景正文',
            fields: {
              title: '雪夜开门',
              pov: '林晚',
              summarySentence: summary,
              summaryFull: longer,
              notes: sceneNotes,
            },
          },
          prose: { layer: '正文草稿', body: '门开了一条缝。', fields: {} },
        },
      },
    })

    const person = state.snowflake.cards.person
    const scene = state.snowflake.cards.scene
    expect(person?.layer).toBe('renwubiao')
    expect(person?.fields.sentence).toBe(phrase)
    expect(person?.fields.paragraph).toBe('她开了门。')
    expect(person?.fields.name).toBe('林晚')
    expect(person?.fields.legacyFullSummary).toBe(full)
    expect(person?.fields.legacyNotes).toBe(notes)
    expect(person?.fields.fullSummary).toBeUndefined()
    expect(person?.fields.phraseSummary).toBeUndefined()
    expect(scene?.layer).toBe('场景表')
    expect(scene?.fields.what).toBe(summary)
    expect(scene?.fields.title).toBe('雪夜开门')
    expect(scene?.fields.pov).toBe('林晚')
    expect(scene?.fields.legacySummary).toBe(`${longer}\n\n${sceneNotes}`)
    expect(scene?.fields.words).toBe('')
    expect(scene?.fields.chapter).toBe('')
    expect(scene?.fields.conflict).toBe('')
    expect(state.snowflake.cards.prose?.layer).toBe('正文草稿')
    expect(state.canvas.edges.some((edge) => edge.fromNode === 'scene' && edge.toNode === 'prose')).toBe(true)
    expect(Object.values(state.snowflake.cards).some((card) => card.layer === 'changci')).toBe(false)
    expect(Object.values(state.snowflake.cards).some((card) => card.layer === 'yiyedagang')).toBe(false)
    expect(Object.values(state.snowflake.cards).some((card) => card.layer === 'renwugushi')).toBe(false)
    expect(Object.values(state.snowflake.cards).some((card) => card.layer === 'renwudangan')).toBe(false)
    expect(Object.keys(state.snowflake.cards)).toHaveLength(6)

    const saved = serializeDocument(state)
    expect(JSON.stringify(saved)).not.toContain('"layer":"人物"')
    const again = load(saved)
    expect(again.snowflake.cards.person?.fields.sentence).toBe(phrase)
    expect(again.snowflake.cards.person?.fields.legacyFullSummary).toBe(full)
    expect(again.snowflake.cards.person?.fields.legacyNotes).toBe(notes)
    expect(again.snowflake.cards.scene?.fields.what).toBe(summary)
    expect(again.snowflake.cards.scene?.fields.legacySummary).toBe(`${longer}\n\n${sceneNotes}`)
    expect(again.canvas.edges.some((edge) => edge.fromNode === 'scene' && edge.toNode === 'prose')).toBe(true)
  })

  it('旧人物已经长出人物故事时，全文摘要和备注进故事，不另造空卡', () => {
    const state = load({
      canvas: {
        nodes: [node('person', 0), node('story', 40)],
        edges: [{ id: 'e1', fromNode: 'person', toNode: 'story' }],
      },
      snowflake: {
        fileId: 'file-story',
        cards: {
          person: {
            layer: '人物',
            body: '',
            fields: { name: '林晚', phraseSummary: '门口的弟弟', fullSummary: '全文在故事里', notes: '备注也在' },
          },
          story: { layer: 'renwugushi', body: '', fields: { who: '林晚', length: '', story: '她已经写过开头。' } },
        },
      },
    })
    expect(Object.keys(state.snowflake.cards)).toEqual(['person', 'story'])
    expect(state.snowflake.cards.person?.fields.legacyFullSummary).toBeUndefined()
    expect(state.snowflake.cards.story?.fields.story).toContain('她已经写过开头。')
    expect(state.snowflake.cards.story?.fields.story).toContain('全文在故事里')
    expect(state.snowflake.cards.story?.fields.story).toContain('备注也在')
  })

  it('认不出的层名不会让整份文档打不开，原文留在念头正文开头', () => {
    const state = load({
      canvas: { nodes: [node('odd', 0), node('sent', 20)], edges: [] },
      snowflake: {
        fileId: 'file-odd',
        cards: {
          odd: { layer: '怪层', body: '原来的正文', fields: { foo: '栏里的字' } },
          sent: { layer: '一句话', body: '一句还在', fields: { sentence: '一句还在' } },
        },
      },
    })
    const odd = state.snowflake.cards.odd
    expect(odd?.layer).toBe('situation')
    expect(odd?.body.startsWith('原层：怪层')).toBe(true)
    expect(odd?.body).toContain('原来的正文')
    expect(odd?.body).toContain('foo：栏里的字')
    expect(state.snowflake.cards.sent?.layer).toBe('一句话')
    expect(state.snowflake.cards.sent?.body).toBe('一句还在')
  })

  it('人物表类别可以空着，采纳正文不改层名，正面短文不为空', () => {
    let state = createDocument('fields')
    state = createCard(state, {
      id: 'person',
      layer: 'renwubiao',
      x: 0,
      y: 0,
      fields: { name: '林晚', sentence: '门口的弟弟', grade: '' },
    })
    expect(state.snowflake.cards.person?.fields.grade).toBe('')
    state = commitCardText(state, 'person', '主要', 'grade', false)
    expect(state.snowflake.cards.person?.layer).toBe('renwubiao')
    expect(state.snowflake.cards.person?.fields.grade).toBe('主要')
    expect(state.snowflake.cards.person?.fields.sentence).toBe('门口的弟弟')
    state = commitCardText(state, 'person', '', 'grade', false)
    expect(state.snowflake.cards.person?.fields.grade).toBe('')

    state = setCardBody(state, 'person', '采纳进来的一句')
    expect(state.snowflake.cards.person?.layer).toBe('renwubiao')
    expect(state.snowflake.cards.person?.fields.name).toBe('林晚')
    expect(state.snowflake.cards.person?.body).toBe('采纳进来的一句')

    state = createCard(state, {
      id: 'page',
      layer: 'yiyedagang',
      x: 10,
      y: 0,
      fields: { background: '雪还没停。', fourPages: '' },
    })
    state = createCard(state, {
      id: 'dossier',
      layer: 'renwudangan',
      x: 20,
      y: 0,
      fields: { endingChange: '她放下了门闩' },
    })
    state = createCard(state, {
      id: 'beat',
      layer: 'changci',
      x: 30,
      y: 0,
      fields: { task: '问出原因' },
    })
    expect(frontText(state.snowflake.cards.page!)).toBe('雪还没停。')
    expect(frontText(state.snowflake.cards.dossier!)).toBe('她放下了门闩')
    expect(frontText(state.snowflake.cards.beat!)).toBe('问出原因')
    expect(state.snowflake.cards.page?.fields.fourPages).toBe('')
  })
})
