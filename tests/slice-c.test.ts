import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { estimateSnowCardHeight } from '../src/card-layout.ts'
import {
  applySediment,
  createCard,
  createDocument,
  emptyArc,
  type Entity,
  type SedimentEvent,
} from '../src/document.ts'
import {
  applyManualField,
  gradeVisibility,
  mergePendingEntity,
  traceField,
  traceIdeaFields,
} from '../src/person-form.ts'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

function person(id: string, name = '奈德'): Entity {
  return { id, entityType: 'person', name, views: {}, fields: {}, arc: emptyArc(), premise: false }
}

describe('切片 C 前端', () => {
  it('画布估高不随展开态变高，卡面路径不再调用展开全文', () => {
    const body = Array.from({ length: 20 }, () => '一二三四五六七八九十').join('\n')
    const base = { title: '标题', body, meta: '12 字', width: 280 }
    expect(estimateSnowCardHeight({ ...base, expanded: true })).toBe(estimateSnowCardHeight({ ...base, expanded: false }))
    expect(estimateSnowCardHeight({ ...base, expanded: true, overflows: true })).toBe(
      estimateSnowCardHeight({ ...base, expanded: false, overflows: false }),
    )
    const flow = read('src/FlowCanvas.tsx')
    const snow = flow.slice(flow.indexOf('function SnowCard('), flow.indexOf('function SnowGroup('))
    expect(snow).not.toContain('snowExpandLabel(')
    expect(snow).not.toContain('展开全文')
    expect(flow).not.toContain('expandedIds')
    expect(read('src/card-layout.ts')).not.toContain('function snowExpandLabel')
  })

  it('折叠属于人物表格行，不在画布卡面上', () => {
    const cast = read('src/CastPage.tsx')
    expect(cast).toContain('各行的展开只留在这一页的内存里')
    expect(cast).toContain('刷新后全部收起')
    expect(cast).toContain("aria-expanded={open}")
    const flow = read('src/FlowCanvas.tsx')
    expect(flow).not.toContain('expandedIds')
    expect(flow).not.toContain('snowExpandLabel')
  })

  it('角标能从字段走到念头标题，再从念头走回字段', () => {
    let state = createDocument('trace')
    state = createCard(state, { id: 'idea-12', layer: 'situation', x: 0, y: 0, body: '奈德与小指头' })
    state = { ...state, entities: [person('p1')] }
    const event: SedimentEvent = {
      id: 'e1',
      requestId: 'r1',
      kind: 'discuss',
      ideaId: 'idea-12',
      sessionId: 'sess-2',
      adoptionKey: 'adopt-1',
      at: '2026-10-11T14:02:00.000Z',
      target: { entityType: 'person', entityId: 'p1', fieldKey: 'motivation' },
      action: 'append',
      quote: '荣誉不是筹码',
      status: 'written',
    }
    state = applySediment(state, event)
    const hits = traceField(state, 'p1', 'motivation')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.ideaTitle).toBe('奈德与小指头')
    expect(hits[0]?.ideaId).toBe('idea-12')
    expect(traceIdeaFields(state, 'idea-12')).toEqual([{ entityId: 'p1', fieldKey: 'motivation' }])

    const failed = applySediment(state, {
      ...event,
      id: 'e2',
      requestId: 'r2',
      at: '2026-10-11T15:00:00.000Z',
      quote: '另一句',
      status: 'failed',
    })
    expect(traceField(failed, 'p1', 'motivation').find((hit) => hit.eventId === 'e2')?.label).toBe('百科没写上')
  })

  it('手填必须挂念头，账本是 manual 且没有会话号', () => {
    let state = createDocument('manual')
    state = createCard(state, { id: 'idea', layer: 'situation', x: 0, y: 0, body: '门口的人' })
    state = createCard(state, { id: 'pcard', layer: 'renwubiao', x: 40, y: 0, fields: { name: '奈德', grade: '主要' } })
    const blocked = applyManualField(state, {
      cardId: 'pcard',
      entityId: null,
      fieldKey: 'motivation',
      text: '要守住誓言',
      ideaId: '',
      requestId: 'no-idea',
      at: '2026-10-11T00:00:00.000Z',
    })
    expect(blocked).toBe(state)
    const saved = applyManualField(state, {
      cardId: 'pcard',
      entityId: null,
      fieldKey: 'motivation',
      text: '要守住誓言',
      ideaId: 'idea',
      requestId: 'm1',
      at: '2026-10-11T00:00:01.000Z',
    })
    expect(saved).not.toBe(state)
    const manual = saved.sediment?.find((item) => item.requestId === 'm1')
    expect(manual?.kind).toBe('manual')
    expect(manual?.ideaId).toBe('idea')
    expect(manual?.sessionId).toBeUndefined()
    expect(saved.entities?.find((item) => item.views.renwubiao === 'pcard')?.fields.motivation?.value).toBe('要守住誓言')
    expect(traceField(saved, manual?.target.entityId ?? '', 'motivation')).toEqual([])
  })

  it('NPC 只露出名字、角色、一句；主要露出叙事功能全套', () => {
    const npc = gradeVisibility('NPC')
    expect(npc.shown).toEqual(['name', 'role', 'sentence'])
    expect(npc.narrative).toBe(false)
    expect(npc.more).toBe(true)
    const lead = gradeVisibility('主要')
    expect(lead.narrative).toBe(true)
    expect(lead.arc).toBe(true)
    expect(lead.shown).toEqual(
      expect.arrayContaining(['sentence', 'paragraph', 'motivation', 'goal', 'conflict', 'epiphany', 'arc']),
    )
    expect(gradeVisibility('次要').narrative).toBe(true)
    expect(gradeVisibility('次要').arc).toBe(false)
    expect(gradeVisibility('路人').summaryOnly).toBe(true)
    expect(gradeVisibility('').level).toBe('主要')
    expect(read('src/CastPage.tsx')).toContain('gradeVisibility(')
    expect(read('src/SideEditor.tsx')).toContain('gradeVisibility(')
  })

  it('同名多张卡能接上已有合并；对不上时不假装合并成功', () => {
    let state = createDocument('merge')
    state = createCard(state, { id: 'a', layer: 'situation', x: 0, y: 0, body: '甲' })
    state = createCard(state, { id: 'b', layer: 'situation', x: 20, y: 0, body: '乙' })
    state = { ...state, pendingEntities: [{ name: '林晚', cardIds: ['a', 'b'] }] }
    const merged = mergePendingEntity(state, '林晚')
    expect(merged.attached).toBe(true)
    expect(merged.state.snowflake.cards.b).toBeUndefined()
    expect(merged.state.pendingEntities?.some((item) => item.name === '林晚')).toBe(false)
    const ghost = { ...state, pendingEntities: [{ name: '鬼', cardIds: ['nope', 'also'] }] }
    const missing = mergePendingEntity(ghost, '鬼')
    expect(missing.attached).toBe(false)
    expect(missing.state).toBe(ghost)
  })
})
