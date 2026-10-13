import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NEXT_STEP_LAYERS,
  cardCountsAsDone,
  nextStepHint,
  pipelineGroupLabel,
  pipelineGroupProgress,
} from '../src/card-layout.ts'
import {
  createCard,
  createDocument,
  fieldKeys,
  isChoiceField,
  layerLabel,
  type Card,
  type Layer,
} from '../src/document.ts'

function labels(cards: Record<string, Card>): string[] {
  return pipelineGroupProgress(cards).map((group) => pipelineGroupLabel(group))
}

function emptyFields(layer: Layer): Record<string, string> {
  return Object.fromEntries(fieldKeys(layer).map((key) => [key, '']))
}

describe('分组流水线完成度', () => {
  it('空书四组都是 0', () => {
    const state = createDocument('empty')
    expect(labels(state.snowflake.cards)).toEqual(['立意 0/2', '人物 0/3', '结构 0/3', '成稿 0/1'])
  })

  it('只写一句话字段时立意是 1/2', () => {
    const state = createCard(createDocument('sentence'), {
      id: 's',
      layer: '一句话',
      x: 0,
      y: 0,
      fields: { sentence: '门口那个人是弟弟' },
    })
    expect(labels(state.snowflake.cards)).toContain('立意 1/2')
    expect(labels(state.snowflake.cards)).toContain('人物 0/3')
    const sentenceOnly: Card = {
      layer: '一句话',
      body: '',
      fields: { sentence: '门口那个人是弟弟' },
    }
    expect(cardCountsAsDone(sentenceOnly)).toBe(true)
    const bodyOnly: Card = {
      layer: '一句话',
      body: '门口那个人是弟弟',
      fields: { sentence: '' },
    }
    expect(cardCountsAsDone(bodyOnly)).toBe(false)
    expect(labels({ s: bodyOnly })[0]).toBe('立意 0/2')
    const blankSentence: Card = {
      layer: '一句话',
      body: '门口那个人是弟弟',
      fields: { sentence: '   ' },
    }
    expect(cardCountsAsDone(blankSentence)).toBe(false)
  })

  it('人物表只填了空字符串字段时人物仍是 0/3', () => {
    const state = createCard(createDocument('people'), {
      id: 'p',
      layer: 'renwubiao',
      x: 0,
      y: 0,
      fields: emptyFields('renwubiao'),
    })
    const card = state.snowflake.cards.p
    if (!card) throw new Error('人物表没有建出来')
    expect(card.body).toContain('名字：')
    expect(card.body.trim().length).toBeGreaterThan(0)
    expect(cardCountsAsDone(card)).toBe(false)
    expect(labels(state.snowflake.cards)).toContain('人物 0/3')
    const whitespace: Card = {
      layer: 'renwubiao',
      body: '林晚是门口的人',
      fields: { ...emptyFields('renwubiao'), name: '  \n' },
    }
    expect(cardCountsAsDone(whitespace)).toBe(false)
    expect(labels({ p: whitespace })).toContain('人物 0/3')
  })

  it('正文草稿 body 有字时成稿是 1/1', () => {
    const state = createCard(createDocument('draft'), {
      id: 'd',
      layer: '正文草稿',
      x: 0,
      y: 0,
      body: '她推开门。',
    })
    expect(labels(state.snowflake.cards)).toContain('成稿 1/1')
    const blank = createCard(createDocument('blank-draft'), {
      id: 'd',
      layer: '正文草稿',
      x: 0,
      y: 0,
      body: '  \n\t',
    })
    const blankCard = blank.snowflake.cards.d
    if (!blankCard) throw new Error('正文草稿没有建出来')
    expect(cardCountsAsDone(blankCard)).toBe(false)
    expect(labels(blank.snowflake.cards)).toContain('成稿 0/1')
  })

  it('下拉默认空值不算完成，选了非空值才算', () => {
    expect(
      cardCountsAsDone({
        layer: 'renwubiao',
        body: '类别：',
        fields: { ...emptyFields('renwubiao'), grade: '' },
      }),
    ).toBe(false)
    expect(cardCountsAsDone({ layer: 'renwubiao', body: '', fields: { grade: '主要' } })).toBe(true)
    expect(
      cardCountsAsDone({
        layer: 'renwugushi',
        body: '篇幅：',
        fields: { ...emptyFields('renwugushi'), length: '' },
      }),
    ).toBe(false)
    expect(cardCountsAsDone({ layer: 'renwugushi', body: '', fields: { length: '一页' } })).toBe(true)
    expect(
      cardCountsAsDone({
        layer: 'changci',
        body: '冲突结构：',
        fields: { ...emptyFields('changci'), structureKind: '' },
      }),
    ).toBe(false)
    expect(cardCountsAsDone({ layer: 'changci', body: '', fields: { structureKind: 'active' } })).toBe(true)
  })

  it('同一层多张卡只算一层，卡片不进四组', () => {
    const cards: Record<string, Card> = {
      a: { layer: '一段', body: '背景：雪', fields: { background: '雪夜' } },
      b: { layer: '一段', body: '背景：雨', fields: { background: '雨夜' } },
      c: { layer: 'situation', body: '一个卡片', fields: {} },
    }
    expect(labels(cards)).toEqual(['立意 1/2', '人物 0/3', '结构 0/3', '成稿 0/1'])
  })

  it('一段只剩空标签不算完成', () => {
    const state = createCard(createDocument('para'), {
      id: 'p',
      layer: '一段',
      x: 0,
      y: 0,
      fields: emptyFields('一段'),
    })
    const card = state.snowflake.cards.p
    if (!card) throw new Error('一段没有建出来')
    expect(card.body).toContain('背景：')
    expect(cardCountsAsDone(card)).toBe(false)
    expect(labels(state.snowflake.cards)[0]).toBe('立意 0/2')
  })

  it('做完一层提示下一步，全部写完不提示', () => {
    expect(NEXT_STEP_LAYERS.map((layer) => layerLabel(layer))).toEqual([
      '一句话',
      '一段',
      '人物表',
      '一页大纲',
      '人物故事',
      '人物档案',
      '场景表',
      '场次',
      '正文草稿',
    ])
    expect(nextStepHint({})).toBeNull()
    const sentence: Record<string, Card> = {
      s: { layer: '一句话', body: '', fields: { sentence: '门口' } },
    }
    expect(nextStepHint(sentence)).toBe('一句话写好了，下一步可以写一段')
    const both: Record<string, Card> = {
      ...sentence,
      p: { layer: '一段', body: '', fields: { background: '雪夜' } },
    }
    expect(nextStepHint(both)).toBe('一段写好了，下一步可以写人物表')
    const all: Record<string, Card> = {}
    for (const layer of NEXT_STEP_LAYERS) {
      if (layer === '正文草稿') {
        all[layer] = { layer, body: '正文', fields: {} }
        continue
      }
      if (layer === '一句话') {
        all[layer] = { layer, body: '', fields: { sentence: '一句' } }
        continue
      }
      const key = fieldKeys(layer).find((item) => !isChoiceField(item)) ?? fieldKeys(layer)[0]
      if (!key) throw new Error(`没有字段 ${layer}`)
      all[layer] = { layer, body: '', fields: { [key]: '有字' } }
    }
    expect(labels(all)).toEqual(['立意 2/2', '人物 3/3', '结构 3/3', '成稿 1/1'])
    expect(nextStepHint(all)).toBeNull()
  })

  it('侧栏用分组，不再把后面的层平铺成一排', () => {
    const side = readFileSync(join(process.cwd(), 'src/SideEditor.tsx'), 'utf8')
    expect(side).toContain('pipelineGroupProgress')
    expect(side).toContain('nextStepHint')
    expect(side).toContain('改成更后面的层')
    expect(side).toContain('window.confirm(describeLayerChange(card, layer))')
    expect(side).not.toContain('later.map')
    const host = side.indexOf('className="cm-host"')
    expect(host).toBeGreaterThan(0)
    expect(host).toBeLessThan(side.indexOf('改成更后面的层'))
  })
})
