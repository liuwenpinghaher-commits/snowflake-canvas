import { describe, expect, it } from 'vitest'
import { applyBlockEvent, blockSessionFromText, blocksToText, filterSlash, textToBlocks } from '../src/block-editor.ts'
import {
  commitCardText,
  createCard,
  createDocument,
  editorText,
  frontText,
  serializeDocument,
} from '../src/document.ts'

function texts(blocks: readonly { text: string }[]) {
  return blocks.map((block) => block.text)
}

describe('块编辑：字符串和块往返', () => {
  it('空串、只有换行、多行旧正文都包成一块，再写回一个字不差', () => {
    for (const sample of ['', '\n', '\n\n', '门开了一条缝。\n冷气先进来。', '# 这不是标题']) {
      const blocks = textToBlocks(sample)
      expect(blocks).toHaveLength(1)
      expect(blocks[0]?.type).toBe('paragraph')
      expect(blocks[0]?.text).toBe(sample)
      expect(blocksToText(blocks)).toBe(sample)
    }
  })

  it('单段落写回后 JSON 没有 blocks 键，字段仍是字符串', () => {
    let state = createDocument('block-plain')
    state = createCard(state, {
      id: 'c1',
      layer: 'situation',
      x: 0,
      y: 0,
      body: '门口那个人其实是弟弟',
    })
    const card = state.snowflake.cards.c1
    if (!card) throw new Error('missing card')
    const text = editorText(card, null)
    const back = blocksToText(textToBlocks(text))
    expect(back).toBe('门口那个人其实是弟弟')
    state = commitCardText(state, 'c1', back, null, false)
    const doc = serializeDocument(state)
    const stored = doc.snowflake.cards.c1
    if (!stored) throw new Error('missing stored')
    expect(stored.body).toBe('门口那个人其实是弟弟')
    expect(typeof stored.body).toBe('string')
    expect(Object.keys(stored)).not.toContain('blocks')
    expect(JSON.stringify(doc)).not.toMatch(/"blocks"\s*:/)

    let paragraph = createDocument('block-field')
    paragraph = createCard(paragraph, {
      id: 'p1',
      layer: '一段',
      x: 0,
      y: 0,
      fields: { background: '她在雪夜开门。\n第二行仍是一块' },
    })
    const fieldCard = paragraph.snowflake.cards.p1
    if (!fieldCard) throw new Error('missing field card')
    const fieldText = editorText(fieldCard, 'background')
    expect(textToBlocks(fieldText)).toHaveLength(1)
    expect(blocksToText(textToBlocks(fieldText))).toBe(fieldText)
    paragraph = commitCardText(paragraph, 'p1', fieldText, 'background', false)
    const storedField = serializeDocument(paragraph).snowflake.cards.p1
    if (!storedField) throw new Error('missing stored field')
    expect(storedField.fields.background).toBe('她在雪夜开门。\n第二行仍是一块')
    expect(typeof storedField.fields.background).toBe('string')
    expect(Object.keys(storedField)).not.toContain('blocks')
    expect(JSON.stringify(storedField)).not.toMatch(/"blocks"\s*:/)
  })
})

describe('块编辑：回车、拖动、撤销', () => {
  it('段尾回车新建一块，块中间回车从光标拆开，三块拼回再拆开顺序还在', () => {
    let session = blockSessionFromText('甲')
    session = applyBlockEvent(session, { type: 'enter', index: 0, cursor: 1 })
    expect(texts(session.blocks)).toEqual(['甲', ''])
    expect(session.blocks.every((block) => block.type === 'paragraph')).toBe(true)

    session = blockSessionFromText('甲乙丙')
    session = applyBlockEvent(session, { type: 'enter', index: 0, cursor: 1 })
    session = applyBlockEvent(session, { type: 'enter', index: 1, cursor: 1 })
    expect(texts(session.blocks)).toEqual(['甲', '乙', '丙'])
    const wire = blocksToText(session.blocks)
    expect(texts(textToBlocks(wire))).toEqual(['甲', '乙', '丙'])

    let state = createDocument('block-split')
    state = createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '甲乙丙' })
    state = commitCardText(state, 'c1', wire, null, false)
    const doc = serializeDocument(state)
    const stored = doc.snowflake.cards.c1
    if (!stored) throw new Error('missing stored')
    expect(typeof stored.body).toBe('string')
    expect(stored.body).toBe('甲\n乙\n丙')
    expect(stored.blocks?.body?.map((block) => block.text)).toEqual(['甲', '乙', '丙'])
    expect(stored.blocks?.body?.every((block) => block.type === 'paragraph')).toBe(true)
    expect(JSON.stringify(doc)).toMatch(/"blocks"\s*:/)
    expect(frontText(state.snowflake.cards.c1!)).toBe('甲\n乙\n丙')

    const soft = blocksToText([
      { id: 'a', type: 'paragraph', text: '上\n下' },
      { id: 'b', type: 'paragraph', text: '尾' },
    ])
    let softState = createDocument('block-soft-face')
    softState = createCard(softState, { id: 'c1', layer: 'situation', x: 0, y: 0, body: soft })
    expect(frontText(softState.snowflake.cards.c1!)).toBe('上\n下\n尾')
  })

  it('撤销能回到拆之前', () => {
    let session = blockSessionFromText('甲乙')
    const before = texts(session.blocks)
    session = applyBlockEvent(session, { type: 'enter', index: 0, cursor: 1 })
    expect(session.blocks).toHaveLength(2)
    session = applyBlockEvent(session, { type: 'undo' })
    expect(texts(session.blocks)).toEqual(before)
    expect(session.blocks).toHaveLength(1)
  })

  it('拖动手柄交换两块后，拼回的顺序是交换后的', () => {
    let session = blockSessionFromText('甲乙')
    session = applyBlockEvent(session, { type: 'enter', index: 0, cursor: 1 })
    session = applyBlockEvent(session, { type: 'move', from: 0, to: 1 })
    expect(texts(textToBlocks(blocksToText(session.blocks)))).toEqual(['乙', '甲'])
  })
})

describe('块编辑：斜杠、待办、引用、分隔线和软换行', () => {
  it('斜杠后输入「标题」能插入标题；Esc 关闭且斜杠留下；词中间的斜杠不打开', () => {
    let session = blockSessionFromText('')
    session = applyBlockEvent(session, { type: 'input', index: 0, text: '/', cursor: 1 })
    expect(session.slash).not.toBeNull()
    session = applyBlockEvent(session, { type: 'slashQuery', query: '标题' })
    expect(filterSlash(session.slash?.query ?? '').some((item) => item.label === '标题' && item.type === 'heading')).toBe(
      true,
    )
    session = applyBlockEvent(session, { type: 'slashPick', blockType: 'heading' })
    expect(session.blocks[0]?.type).toBe('heading')
    expect(session.slash).toBeNull()
    expect(textToBlocks(blocksToText(session.blocks))[0]?.type).toBe('heading')

    let closed = blockSessionFromText('')
    closed = applyBlockEvent(closed, { type: 'input', index: 0, text: '/', cursor: 1 })
    closed = applyBlockEvent(closed, { type: 'escape' })
    expect(closed.slash).toBeNull()
    expect(closed.blocks[0]?.text).toContain('/')
    expect(blocksToText(closed.blocks)).toContain('/')

    let ratio = blockSessionFromText('每秒 3')
    ratio = applyBlockEvent(ratio, { type: 'input', index: 0, text: '每秒 3/', cursor: '每秒 3/'.length })
    expect(ratio.slash).toBeNull()
    ratio = applyBlockEvent(ratio, { type: 'input', index: 0, text: '每秒 3/4', cursor: '每秒 3/4'.length })
    expect(ratio.slash).toBeNull()
    expect(ratio.blocks).toHaveLength(1)
    expect(ratio.blocks[0]?.text).toBe('每秒 3/4')

    let selected = blockSessionFromText('甲')
    selected = applyBlockEvent(selected, { type: 'escape' })
    expect(selected.selected).toBe(0)
    expect(selected.blocks).toHaveLength(1)
  })

  it('待办勾选、分隔线、引用、块内软换行都能写回再读出', () => {
    const quote = textToBlocks(blocksToText([{ id: 'a', type: 'quote', text: '他说夜里冷' }]))
    expect(quote[0]).toMatchObject({ type: 'quote', text: '他说夜里冷' })

    const todo = textToBlocks(blocksToText([{ id: 'a', type: 'todo', text: '买菜', checked: true }]))
    expect(todo[0]).toMatchObject({ type: 'todo', text: '买菜', checked: true })

    const open = textToBlocks(blocksToText([{ id: 'a', type: 'todo', text: '买菜', checked: false }]))
    expect(open[0]).toMatchObject({ type: 'todo', text: '买菜', checked: false })

    const divider = textToBlocks(blocksToText([{ id: 'a', type: 'divider', text: '' }]))
    expect(divider[0]).toMatchObject({ type: 'divider', text: '' })

    expect(blocksToText([{ id: 'a', type: 'heading', text: '题' }])).toBe('@@sf-blocks\nh 题')
    expect(blocksToText([{ id: 'a', type: 'todo', text: '买', checked: true }])).toBe('@@sf-blocks\nt1 买')
    expect(blocksToText([{ id: 'a', type: 'todo', text: '买', checked: false }])).toBe('@@sf-blocks\nt0 买')
    expect(blocksToText([{ id: 'a', type: 'quote', text: '引' }])).toBe('@@sf-blocks\nq 引')
    expect(blocksToText([{ id: 'a', type: 'divider', text: '' }])).toBe('@@sf-blocks\nd')
    expect(
      blocksToText([
        { id: 'a', type: 'paragraph', text: '上\n下' },
        { id: 'b', type: 'paragraph', text: '尾' },
      ]),
    ).toBe('@@sf-blocks\np 上\\n下\np 尾')

    let session = blockSessionFromText('门开了')
    session = applyBlockEvent(session, { type: 'shiftEnter', index: 0, cursor: 1 })
    expect(session.blocks).toHaveLength(1)
    expect(session.blocks[0]?.text).toBe('门\n开了')
    expect(blocksToText(session.blocks)).toBe('门\n开了')
    expect(textToBlocks(blocksToText(session.blocks))[0]?.text).toBe('门\n开了')
  })
})

describe('块编辑：输入法组字', () => {
  it('compositionstart 期间插入半截拼音不拆块，compositionend 才提交', () => {
    let session = blockSessionFromText('原')
    session = applyBlockEvent(session, { type: 'compositionstart' })
    session = applyBlockEvent(session, { type: 'insert', text: 'di' })
    expect(session.composing).toBe(true)
    expect(session.draft).toBe('di')
    expect(session.blocks).toHaveLength(1)
    expect(session.blocks[0]?.text).toBe('原')
    expect(blocksToText(session.blocks)).toBe('原')

    session = applyBlockEvent(session, { type: 'insert', text: 'di\n' })
    expect(session.blocks).toHaveLength(1)
    expect(session.blocks[0]?.text).toBe('原')
    session = applyBlockEvent(session, { type: 'enter', index: 0, cursor: 1 })
    expect(session.blocks).toHaveLength(1)
    expect(session.blocks[0]?.text).toBe('原')

    session = applyBlockEvent(session, { type: 'compositionend', text: '弟' })
    expect(session.composing).toBe(false)
    expect(session.blocks).toHaveLength(1)
    expect(session.blocks[0]?.text).toContain('弟')
    expect(session.blocks[0]?.text).not.toContain('di')
  })
})
