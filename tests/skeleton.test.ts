import { describe, expect, it } from 'vitest'
import {
  CHANGCI_KEYS,
  LAYERS,
  PARAGRAPH_KEYS,
  PERSON_KEYS,
  RENWUDANGAN_KEYS,
  RENWUGUSHI_KEYS,
  SCENE_KEYS,
  YIYEDAGANG_KEYS,
  addGroup,
  applyComposition,
  changeToLaterLayer,
  commitCardText,
  createCard,
  createDocument,
  deleteSelection,
  describeLayerChange,
  frontText,
  linkCards,
  moveNode,
  serializeDocument,
  spawnChild,
  type AppState,
  type Layer,
} from '../src/document.ts'

const NODE_KEYS = ['id', 'type', 'x', 'y', 'width', 'height', 'text', 'color']
const EDGE_KEYS = ['id', 'fromNode', 'toNode', 'fromSide', 'toSide', 'fromEnd', 'toEnd', 'label', 'kind']

function cardOf(state: AppState, id: string) {
  const card = state.snowflake.cards[id]
  if (!card) throw new Error(`missing card ${id}`)
  return card
}

describe('雪花画布骨架', () => {
  it('十种 layer 都能创建，两张卡之间有边，拖动只改坐标', () => {
    let state = createDocument('file-1')
    state = createCard(state, {
      id: 'n-situation-1',
      layer: 'situation',
      x: 400,
      y: 10,
      body: '门口那个人其实是弟弟',
    })
    state = createCard(state, {
      id: 'n-sentence-1',
      layer: '一句话',
      x: 10,
      y: 400,
      body: '一个女人发现门口的陌生人是她以为死了的弟弟。',
    })
    state = createCard(state, {
      id: 'n-paragraph-1',
      layer: '一段',
      x: 200,
      y: 200,
      fields: {
        background: '她在雪夜开门。',
        disaster1: '弟弟不认得她。',
        disaster2: '',
        disaster3: '房子着了。',
        ending: '她把他留在门口。',
      },
    })
    state = createCard(state, {
      id: 'n-person-1',
      layer: 'renwubiao',
      x: 50,
      y: 50,
      fields: {
        name: '林晚',
        role: '姐姐',
        sentence: '门口的弟弟\n第二行不进正面',
        motivation: '要确认那是弟弟',
        goal: '带他回家',
        conflict: '他不承认',
        epiphany: '认错人也是一种救',
        paragraph: '她开门，发现弟弟。',
        grade: '',
      },
    })
    state = createCard(state, {
      id: 'n-page-1',
      layer: 'yiyedagang',
      x: 60,
      y: 60,
      fields: { background: '雪停之前她不能开门。后面还有。' },
    })
    state = createCard(state, {
      id: 'n-story-1',
      layer: 'renwugushi',
      x: 70,
      y: 70,
      fields: { who: '林晚', length: '一页', story: '她看见门口站着弟弟。' },
    })
    state = createCard(state, {
      id: 'n-dossier-1',
      layer: 'renwudangan',
      x: 75,
      y: 75,
      fields: { bodyName: '林晚', endingChange: '她不再追问' },
    })
    state = createCard(state, {
      id: 'n-scene-1',
      layer: '场景表',
      x: 80,
      y: 90,
      fields: {
        title: '雪夜开门',
        pov: '林晚',
        what: '她发现门口的人是弟弟',
        words: '800',
        chapter: '3',
        conflict: '认还是不认',
      },
    })
    state = createCard(state, {
      id: 'n-beat-1',
      layer: 'changci',
      x: 90,
      y: 100,
      fields: { alpha: '弟弟站在门口', task: '问出他为什么装死' },
    })
    state = createCard(state, {
      id: 'n-prose-1',
      layer: '正文草稿',
      x: 500,
      y: 5,
      body: '门开了一条缝。\n冷气先进来。',
    })
    state = linkCards(state, 'n-situation-1', 'n-sentence-1')
    state = addGroup(state, { id: 'g1', x: 1, y: 900 })

    const layers = new Set(Object.values(state.snowflake.cards).map((card) => card.layer))
    for (const layer of LAYERS) expect(layers.has(layer)).toBe(true)
    expect(state.canvas.edges.some((edge) => edge.fromNode === 'n-situation-1' && edge.toNode === 'n-sentence-1')).toBe(true)
    expect(state.snowflake.cards.g1).toBeUndefined()

    const before = cardOf(state, 'n-situation-1')
    const order = state.canvas.nodes.map((node) => node.id)
    state = moveNode(state, 'n-situation-1', 999, 2)
    const moved = state.canvas.nodes.find((node) => node.id === 'n-situation-1')
    expect(moved?.x === 999 || moved?.y === 2).toBe(true)
    expect(moved?.x).toBe(999)
    expect(cardOf(state, 'n-situation-1').body).toBe(before.body)
    expect(cardOf(state, 'n-situation-1').layer).toBe(before.layer)
    expect(state.canvas.nodes.map((node) => node.id)).toEqual(order)

    const doc = serializeDocument(state)
    expect(doc.canvas.nodes.length).toBeGreaterThan(0)
    expect(doc.canvas.edges.length).toBeGreaterThan(0)
    expect(doc.snowflake.fileId).toBe('file-1')
    expect(Object.keys(doc.snowflake.cards)).toHaveLength(10)
    expect(doc.canvas.nodes[0]?.id).toBe('n-situation-1')
    expect(doc.canvas.nodes[0]?.x).toBe(999)
    expect(doc.canvas.nodes[1]?.x).toBe(10)
    expect(JSON.stringify(doc)).not.toContain('activeId')

    for (const node of doc.canvas.nodes) {
      for (const key of Object.keys(node)) expect(NODE_KEYS).toContain(key)
    }
    for (const edge of doc.canvas.edges) {
      for (const key of Object.keys(edge)) expect(EDGE_KEYS).toContain(key)
    }

    const byLayer = Object.fromEntries(
      Object.values(doc.snowflake.cards).map((card) => [card.layer, card]),
    ) as Record<Layer, (typeof doc.snowflake.cards)[string]>

    expect(Object.keys(byLayer.situation.fields)).toEqual([])
    expect(byLayer.situation.body).toBe('门口那个人其实是弟弟')
    expect(Object.keys(byLayer['一句话'].fields)).toEqual(['sentence'])
    expect(byLayer['一句话'].body).toBe(byLayer['一句话'].fields.sentence)
    expect(Object.keys(byLayer['一段'].fields)).toEqual([...PARAGRAPH_KEYS])
    expect(Object.keys(byLayer.renwubiao.fields)).toEqual([...PERSON_KEYS])
    expect(Object.keys(byLayer.yiyedagang.fields)).toEqual([...YIYEDAGANG_KEYS])
    expect(Object.keys(byLayer.renwugushi.fields)).toEqual([...RENWUGUSHI_KEYS])
    expect(Object.keys(byLayer.renwudangan.fields)).toEqual([...RENWUDANGAN_KEYS])
    expect(Object.keys(byLayer['场景表'].fields)).toEqual([...SCENE_KEYS])
    expect(Object.keys(byLayer.changci.fields)).toEqual([...CHANGCI_KEYS])
    expect(Object.keys(byLayer['正文草稿'].fields)).toEqual([])
    expect(JSON.stringify(doc)).not.toContain('"layer":"人物"')

    const paragraph = cardOf(state, 'n-paragraph-1')
    expect(frontText(paragraph)).toBe('她在雪夜开门。「灾」「灾」')
    expect(frontText(cardOf(state, 'n-person-1'))).toBe('林晚，门口的弟弟')
    expect(frontText(cardOf(state, 'n-page-1'))).toBe('雪停之前她不能开门。')
    expect(frontText(cardOf(state, 'n-story-1'))).toBe('林晚')
    expect(frontText(cardOf(state, 'n-dossier-1'))).toBe('林晚')
    expect(frontText(cardOf(state, 'n-scene-1'))).toBe('雪夜开门 林晚 她发现门口的人是弟弟')
    expect(frontText(cardOf(state, 'n-beat-1'))).toBe('弟弟站在门口')
    expect(state.canvas.nodes.find((node) => node.id === 'n-prose-1')?.text).toBe('门开了一条缝。')
    expect(doc.canvas.nodes.find((node) => node.id === 'g1')?.type).toBe('group')
  })

  it('从卡片拖出下一层，也可以改成更后面的层', () => {
    let state = createDocument('file-2')
    state = createCard(state, { id: 'a', layer: 'situation', x: 0, y: 0, body: '卡片' })
    state = spawnChild(state, 'a', undefined, 300, 0, 'b')
    expect(cardOf(state, 'b').layer).toBe('一句话')
    expect(state.canvas.edges.some((edge) => edge.fromNode === 'a' && edge.toNode === 'b')).toBe(true)

    const skipped = spawnChild(state, 'a', 'renwubiao', 300, 160, 'c')
    expect(cardOf(skipped, 'c').layer).toBe('renwubiao')
    expect(skipped.canvas.edges.some((edge) => edge.fromNode === 'a' && edge.toNode === 'c')).toBe(true)

    const blocked = spawnChild(state, 'b', 'situation', 10, 10, 'nope')
    expect(blocked.snowflake.cards.nope).toBeUndefined()

    let last = createCard(createDocument('file-3'), { id: 'z', layer: '正文草稿', x: 0, y: 0, body: '正文' })
    const stayed = spawnChild(last, 'z')
    expect(stayed.canvas.nodes).toHaveLength(1)

    const changed = changeToLaterLayer(state, 'a', '场景表')
    expect(cardOf(changed, 'a').layer).toBe('场景表')
    expect(Object.keys(cardOf(changed, 'a').fields).slice(0, SCENE_KEYS.length)).toEqual([...SCENE_KEYS])
    const same = changeToLaterLayer(changed, 'a', 'situation')
    expect(cardOf(same, 'a').layer).toBe('场景表')
  })

  it('改成更后面的层：层名变了，非空内容还在目标卡里', () => {
    let state = createDocument('file-6')
    state = createCard(state, {
      id: 's',
      layer: '场景表',
      x: 0,
      y: 0,
      fields: { pov: '林晚', what: '她在门口停了三秒', conflict: '弟弟不肯进门', words: '' },
    })
    const changed = changeToLaterLayer(state, 's', 'changci')
    const card = cardOf(changed, 's')
    expect(card.layer).toBe('changci')
    expect(card.fields.conflict).toBe('弟弟不肯进门')
    expect(card.fields.adopted).toContain('林晚')
    expect(card.fields.adopted).toContain('她在门口停了三秒')
    expect(card.fields.adopted).not.toContain('预计字数')
    expect(card.body).toContain('林晚')
    expect(card.body).toContain('她在门口停了三秒')
    expect(describeLayerChange(cardOf(state, 's'), 'changci')).toContain('场次')

    let idea = createCard(createDocument('file-7'), { id: 'i', layer: 'situation', x: 0, y: 0, body: '门口那个人是弟弟' })
    idea = changeToLaterLayer(idea, 'i', '正文草稿')
    expect(cardOf(idea, 'i').layer).toBe('正文草稿')
    expect(cardOf(idea, 'i').body).toContain('门口那个人是弟弟')
  })

  it('删卡片连边一起删，删分组只删分组', () => {
    let state = createDocument('file-4')
    state = createCard(state, { id: 'a', layer: 'situation', x: 0, y: 0, body: '甲' })
    state = createCard(state, { id: 'b', layer: '一句话', x: 20, y: 0, body: '乙' })
    state = linkCards(state, 'a', 'b')
    state = addGroup(state, { id: 'g', x: 0, y: 0 })
    state = deleteSelection(state, 'b')
    expect(state.snowflake.cards.b).toBeUndefined()
    expect(state.canvas.nodes.some((node) => node.id === 'b')).toBe(false)
    expect(state.canvas.edges.some((edge) => edge.fromNode === 'b' || edge.toNode === 'b')).toBe(false)
    expect(state.snowflake.cards.a?.body).toBe('甲')
    state = deleteSelection(state, 'g')
    expect(state.canvas.nodes.some((node) => node.id === 'g')).toBe(false)
    expect(state.snowflake.cards.a?.layer).toBe('situation')
  })

  it('compositionstart 插入半截拼音 di 时卡片正文不变，compositionend 提交弟之后才含弟', () => {
    let state = createCard(createDocument('file-5'), {
      id: 'c1',
      layer: 'situation',
      x: 0,
      y: 80,
      body: '原',
    })
    let session = { cardId: 'c1', composing: false, draft: '原' }
    const untouched = commitCardText(state, 'c1', 'di', null, true)
    expect(untouched.snowflake.cards.c1?.body).toBe('原')
    expect(untouched.canvas.nodes.find((node) => node.id === 'c1')?.text).toBe('原')

    ;({ state, session } = applyComposition(state, session, { type: 'compositionstart' }, null))
    ;({ state, session } = applyComposition(state, session, { type: 'insert', text: 'di' }, null))
    expect(session.composing).toBe(true)
    expect(session.draft).toBe('di')
    expect(state.snowflake.cards.c1?.body).toBe('原')
    expect(state.canvas.nodes.find((node) => node.id === 'c1')?.text).not.toContain('di')

    ;({ state, session } = applyComposition(state, session, { type: 'compositionend', text: '弟' }, null))
    expect(session.composing).toBe(false)
    expect(state.snowflake.cards.c1?.body).toContain('弟')
    expect(state.snowflake.cards.c1?.body).not.toContain('di')
    expect(state.canvas.nodes.find((node) => node.id === 'c1')?.text).toContain('弟')
    expect(state.canvas.nodes.find((node) => node.id === 'c1')?.x).toBe(0)
    expect(state.canvas.nodes.find((node) => node.id === 'c1')?.y).toBe(80)
  })
})
