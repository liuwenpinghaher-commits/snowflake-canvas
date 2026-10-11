import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { estimateSnowCardHeight } from '../src/card-layout.ts'
import { bodyTextForCard, cardFace, type Card } from '../src/document.ts'

describe('画布卡面不再按溢出决定展开全文', () => {
  it('卡面正文为空时，改量字段里比标题更长的那段', () => {
    const card: Card = {
      layer: 'renwubiao',
      body: '',
      fields: { name: '甲', sentence: '', paragraph: '段'.repeat(80) },
    }
    expect(cardFace(card).body).toBe('')
    const prose = bodyTextForCard(card)
    expect(prose.where).toBe('fields')
    expect(prose.fieldKey).toBe('paragraph')
    expect(prose.text).toBe('段'.repeat(80))
    const sentence: Card = { layer: 'situation', body: '一个人在门口站着。', fields: {} }
    expect(cardFace(sentence).body).toBe('')
    expect(bodyTextForCard(sentence).text).toBe('')
  })

  it('卡面没有展开全文或收起，估高不随展开态变高', () => {
    const flow = readFileSync(join(process.cwd(), 'src/FlowCanvas.tsx'), 'utf8')
    const snow = flow.slice(flow.indexOf('function SnowCard('), flow.indexOf('function SnowGroup('))
    expect(snow).not.toContain('展开全文')
    expect(snow).not.toContain('收起')
    expect(flow).not.toContain('snowExpandLabel(')
    const line = '一二三四五六七八九十'
    const body = Array.from({ length: 20 }, () => line).join('\n')
    const collapsed = estimateSnowCardHeight({ title: '标题', body, meta: '', width: 280, expanded: false, overflows: true })
    const expanded = estimateSnowCardHeight({ title: '标题', body, meta: '', width: 280, expanded: true, overflows: true })
    expect(expanded).toBe(collapsed)
  })
})
