import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { applyBlockEvent, blockSessionFromText } from '../src/block-editor.ts'
import CastPage from '../src/CastPage.tsx'
import { createCard, createDocument, emptyArc, setCardBody, type AppState, type Entity } from '../src/document.ts'
import EncyclopediaPage from '../src/EncyclopediaPage.tsx'
import { mentionToken } from '../src/mention-mark.ts'
import MentionBacklinks from '../src/MentionBacklinks.tsx'
import { mentionLabel, mentionPreview, mentionsOf, shownCharCount, shownProse } from '../src/mentions.ts'
import { documentToBytes, parseCompleteDocument } from '../src/persist.ts'

function person(id: string, name: string): Entity {
  return {
    id,
    entityType: 'person',
    name,
    views: {},
    fields: {},
    arc: emptyArc(),
    premise: false,
  }
}

function jsonKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) jsonKeys(item, found)
    return found
  }
  if (!value || typeof value !== 'object') return found
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    found.push(key)
    jsonKeys(item, found)
  }
  return found
}

function mentionedState(): { state: AppState; token: string } {
  const token = mentionToken('card', 'b')
  if (!token) throw new Error('标记被拒绝')
  let state = createDocument('mentions')
  state = createCard(state, {
    id: 'a',
    layer: 'situation',
    x: 0,
    y: 0,
    body: `来源卡\n甲提到${token}。`,
  })
  state = createCard(state, {
    id: 'b',
    layer: 'situation',
    x: 40,
    y: 0,
    body: '旧名\n后文',
  })
  return { state, token }
}

describe('块编辑：内联引用', () => {
  it('id 里有 ] 或换行就拒绝', () => {
    expect(mentionToken('card', 'a]b')).toBeNull()
    expect(mentionToken('entity', 'a\nb')).toBeNull()
    expect(mentionToken('card', 'ok-1')).toBe('[[sf:card:ok-1]]')
  })

  it('A 提到 B 后，B 能数到一处；反向列表不写进 snowflake.json，也不自动建边', () => {
    const { state, token } = mentionedState()
    const hits = mentionsOf(state, 'card', 'b')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ sourceCardId: 'a', fieldKey: 'body', targetKind: 'card', targetId: 'b' })
    expect(state.canvas.edges).toEqual([])

    const bytes = documentToBytes(state)
    const text = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(text) as { canvas: { edges: unknown[] } }
    expect(parsed.canvas.edges).toEqual([])
    expect(text).toContain(token)
    expect(text).not.toContain('处提到')
    const keys = jsonKeys(parsed)
    expect(keys).not.toContain('backlinks')
    expect(keys).not.toContain('mentions')
    expect(keys).not.toContain('mentionHits')

    const loaded = parseCompleteDocument(bytes)
    expect(loaded).not.toBeNull()
    expect(mentionsOf(loaded!.state, 'card', 'b')).toHaveLength(1)
    expect(loaded!.state.canvas.edges).toEqual([])
  })

  it('改名后显示名变，标记里的 id 不变；删掉目标后是找不到，正文还在', () => {
    const { state, token } = mentionedState()
    const renamed = setCardBody(state, 'b', '新名\n后文')
    const body = renamed.snowflake.cards.a?.body ?? ''
    expect(mentionLabel(renamed, 'card', 'b')).toBe('新名')
    expect(shownProse(body, renamed)).toBe('来源卡\n甲提到新名。')
    expect(body).toContain(token)
    expect(body).not.toContain('新名')
    const renamedHits = mentionsOf(renamed, 'card', 'b')
    expect(mentionPreview(renamed, renamedHits[0]!)).toBe('来源卡\n甲提到新名。')

    const cards = { ...renamed.snowflake.cards }
    delete cards.b
    const deleted = { ...renamed, snowflake: { ...renamed.snowflake, cards } }
    const kept = deleted.snowflake.cards.a?.body ?? ''
    expect(mentionLabel(deleted, 'card', 'b')).toBe('找不到')
    expect(shownProse(kept, deleted)).toBe('来源卡\n甲提到找不到。')
    expect(kept).toContain('甲提到')
    expect(kept).toContain(token)
    const deletedHits = mentionsOf(deleted, 'card', 'b')
    expect(mentionPreview(deleted, deletedHits[0]!)).toBe('来源卡\n甲提到找不到。')
    expect(mentionPreview(deleted, deletedHits[0]!)).not.toContain('[[sf:')
  })

  it('标记本身不计进字数，显示出来的名字计进字数', () => {
    const token = mentionToken('entity', 'e1')
    if (!token) throw new Error('标记被拒绝')
    let state = createDocument('chars')
    state = createCard(state, { id: 'a', layer: 'situation', x: 0, y: 0, body: `见${token}` })
    state = { ...state, entities: [person('e1', '奈德')] }
    const body = state.snowflake.cards.a?.body ?? ''
    expect(shownProse(body, state)).toBe('见奈德')
    expect(shownCharCount(body, state)).toBe([...'见奈德'].length)
    expect(shownCharCount(token, state)).toBe([...'奈德'].length)
    expect([...token].length).toBeGreaterThan(shownCharCount(token, state))

    const renamed = { ...state, entities: [person('e1', '艾德史塔克')] }
    expect(shownProse(body, renamed)).toBe('见艾德史塔克')
    expect(shownCharCount(body, renamed)).toBe([...'见艾德史塔克'].length)
    expect(body).toContain('[[sf:entity:e1]]')
    expect(body).not.toContain('艾德史塔克')
  })

  it('悬停来源时预览那一块的可见正文，不新开页面', () => {
    const { state, token } = mentionedState()
    const card = state.snowflake.cards.a
    if (!card) throw new Error('missing card')
    const withBlocks = {
      ...state,
      snowflake: {
        ...state.snowflake,
        cards: {
          ...state.snowflake.cards,
          a: {
            ...card,
            blocks: {
              body: [
                { id: 'blk-pre', type: 'paragraph' as const, text: '前一段' },
                { id: 'blk-hit', type: 'paragraph' as const, text: `甲提到${token}。` },
              ],
            },
          },
        },
      },
    }
    const hits = mentionsOf(withBlocks, 'card', 'b')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.blockId).toBe('blk-hit')
    const preview = mentionPreview(withBlocks, hits[0]!)
    expect(preview).toBe('甲提到旧名。')
    expect(preview).not.toContain('前一段')
    expect(preview).not.toContain('[[sf:')

    const html = renderToStaticMarkup(
      createElement(MentionBacklinks, {
        state: withBlocks,
        kind: 'card',
        id: 'b',
        onOpen: () => {},
      }),
    )
    expect(html).toContain('1 处提到')
    expect(html).toContain('甲提到旧名。')
    expect(html).toContain('mention-preview')
    expect(html).not.toContain('[[sf:')
    expect(html).not.toContain('href=')
    expect(withBlocks.canvas.edges).toEqual([])
  })

  it('人物页和百科页的实体也能看到 N 处提到', () => {
    const token = mentionToken('entity', 'ned')
    if (!token) throw new Error('标记被拒绝')
    let state = createDocument('pages')
    state = createCard(state, { id: 'a', layer: 'situation', x: 0, y: 0, body: `甲见${token}` })
    state = { ...state, entities: [person('ned', '奈德')] }
    const cast = renderToStaticMarkup(
      createElement(CastPage, {
        state,
        canEdit: false,
        onApply: () => {},
        onOpenIdea: () => {},
        onOpenMention: () => {},
      }),
    )
    const encyclopedia = renderToStaticMarkup(
      createElement(EncyclopediaPage, {
        state,
        canEdit: false,
        bookId: null,
        onApply: () => {},
        onOpenMention: () => {},
      }),
    )
    expect(mentionsOf(state, 'entity', 'ned')).toHaveLength(1)
    expect(cast).toContain('1 处提到')
    expect(cast).toContain('甲见奈德')
    expect(encyclopedia).toContain('1 处提到')
    expect(encyclopedia).toContain('甲见奈德')
    expect(cast).not.toContain('[[sf:')
    expect(encyclopedia).not.toContain('[[sf:')
  })

  it('组字期间不打开引用面板', () => {
    let idle = blockSessionFromText('甲')
    idle = applyBlockEvent(idle, { type: 'input', index: 0, text: '甲[[', cursor: 3 })
    expect(idle.mention).toEqual({ index: 0, start: 1, query: '' })

    let session = blockSessionFromText('甲')
    session = applyBlockEvent(session, { type: 'input', index: 0, text: '甲[[', cursor: 3 })
    expect(session.mention).not.toBeNull()
    session = applyBlockEvent(session, { type: 'compositionstart' })
    expect(session.composing).toBe(true)
    expect(session.mention).toBeNull()
    expect(session.blocks[0]?.text).toBe('甲[[')

    session = applyBlockEvent(session, { type: 'input', index: 0, text: '甲[[[', cursor: 4 })
    expect(session.composing).toBe(true)
    expect(session.mention).toBeNull()
    expect(session.blocks[0]?.text).toBe('甲[[')

    session = applyBlockEvent(session, { type: 'insert', text: 'jia[' })
    expect(session.composing).toBe(true)
    expect(session.mention).toBeNull()
    expect(session.blocks[0]?.text).toBe('甲[[')

    session = applyBlockEvent(session, { type: 'compositionend', text: '甲[' })
    expect(session.composing).toBe(false)
    expect(session.mention).toBeNull()
    expect(session.blocks[0]?.text).toBe('甲[')
  })
})
