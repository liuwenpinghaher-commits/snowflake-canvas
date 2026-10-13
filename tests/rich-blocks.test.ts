import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBlockEvent, blockSessionFromText, blocksToText, filterSlash, textToBlocks } from '../src/block-editor.ts'
import {
  commitCardText,
  createCard,
  createDocument,
  emptyArc,
  ensureCardBlocks,
  markdownToBlocks,
  blocksToMarkdown,
  serializeDocument,
  type Entity,
  type ProseBlock,
} from '../src/document.ts'
import { pullFinalized } from '../src/encyclopedia.ts'
import { documentToBytes, parseCompleteDocument } from '../src/persist.ts'
import { composeEntityPage } from '../server/encyclopedia.mjs'
import { ASSET_LIMIT, listOrphanAssets, storeAsset } from '../server/assets.mjs'

const PICTURE = 'assets/ab/0123456789abcdef.jpg'

function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function person(): Entity {
  return {
    id: 'ned',
    entityType: 'person',
    name: '奈德',
    views: { renwubiao: 'card-ned' },
    fields: { motivation: { value: '守住临冬城', events: [] }, sentence: { value: '旧一句', events: [] } },
    arc: emptyArc(),
    premise: false,
    slug: 'world/ned-stark',
    cover: 'assets/cd/fedcba9876543210.png',
  }
}

describe('图片、文件和旧正文', () => {
  it('图片块删掉可见文字后保存，相对路径还在', () => {
    let state = createDocument('image-book')
    state = createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '城门口' })
    const image: ProseBlock = { id: 'img', type: 'image', text: '', alt: '', relativePath: PICTURE }
    state = commitCardText(state, 'c1', '', null, false, [image])
    const stored = serializeDocument(state).snowflake.cards.c1
    expect(stored?.blocks?.body?.[0]).toMatchObject({ type: 'image', alt: '', relativePath: PICTURE })

    const again = parseCompleteDocument(documentToBytes(state))
    expect(again?.state.snowflake.cards.c1?.blocks?.body?.[0]).toMatchObject({
      type: 'image',
      alt: '',
      relativePath: PICTURE,
    })

    let sentence = createDocument('sentence-book')
    sentence = createCard(sentence, { id: 's1', layer: '一句话', x: 0, y: 0, body: '旧一句' })
    sentence = commitCardText(sentence, 's1', '', null, false, [image])
    expect(serializeDocument(sentence).snowflake.cards.s1?.blocks?.sentence?.[0]).toMatchObject({
      type: 'image',
      alt: '',
      relativePath: PICTURE,
    })
  })

  it('老的纯文本正文打开后一字不丢，变成一段', () => {
    const original = '门口那个人其实是弟弟'
    const oldDoc = {
      canvas: { nodes: [], edges: [] },
      snowflake: {
        fileId: 'old-book',
        cards: { c1: { layer: 'situation', body: original, fields: {} } },
      },
    }
    const opened = parseCompleteDocument(bytesOf(oldDoc))
    expect(opened).not.toBeNull()
    if (!opened) return
    const card = opened.state.snowflake.cards.c1
    if (!card) throw new Error('missing card')
    expect(card.body).toBe(original)
    const wrapped = ensureCardBlocks(card)
    expect(wrapped.body).toBe(original)
    expect(wrapped.blocks?.body).toEqual([expect.objectContaining({ type: 'paragraph', text: original })])
    const editor = textToBlocks(card.body)
    expect(editor).toHaveLength(1)
    expect(editor[0]).toMatchObject({ type: 'paragraph', text: original })
    expect(blocksToText(editor)).toBe(original)
  })

  it('定稿里的图片标记拉回后仍是图片块', () => {
    let state = createDocument('pull-image')
    state = createCard(state, { id: 'idea-1', layer: 'situation', x: 0, y: 0, body: '卡片' })
    state = createCard(state, {
      id: 'card-ned',
      layer: 'renwubiao',
      x: 80,
      y: 0,
      fields: { name: '奈德', sentence: '旧一句' },
    })
    state = { ...state, entities: [person()] }
    const text = `城门口\n\n![城门](${PICTURE})`
    const saved = pullFinalized(state, {
      entityId: 'ned',
      ideaId: 'idea-1',
      text,
      requestId: 'req-image',
      at: '2026-10-13T00:00:00.000Z',
    })
    expect(saved.saved).toBe(true)
    const blocks = saved.state.snowflake.cards['card-ned']?.blocks?.sentence
    expect(blocks?.some((block) => block.type === 'image' && block.alt === '城门' && block.relativePath === PICTURE)).toBe(true)

    const round = markdownToBlocks(`![](${PICTURE})`)
    expect(round[0]).toMatchObject({ type: 'image', alt: '', relativePath: PICTURE })
    expect(blocksToMarkdown(round)).toBe(`![](${PICTURE})`)
  })

  it('斜杠菜单能插入图片和文件，封面不进定稿', () => {
    expect(filterSlash('').map((item) => item.type)).toEqual([
      'paragraph',
      'heading',
      'quote',
      'todo',
      'divider',
      'image',
      'file',
    ])
    let session = blockSessionFromText('')
    session = applyBlockEvent(session, { type: 'input', index: 0, text: '/', cursor: 1 })
    session = applyBlockEvent(session, { type: 'slashQuery', query: '图片' })
    session = applyBlockEvent(session, { type: 'slashPick', blockType: 'image' })
    expect(session.blocks[0]?.type).toBe('image')
    expect(session.blocks[0]?.relativePath).toBe('')

    session = blockSessionFromText('')
    session = applyBlockEvent(session, { type: 'input', index: 0, text: '/', cursor: 1 })
    session = applyBlockEvent(session, { type: 'slashQuery', query: '文件' })
    session = applyBlockEvent(session, { type: 'slashPick', blockType: 'file' })
    expect(session.blocks[0]?.type).toBe('file')

    const wire = blocksToText([{ id: 'i', type: 'image', text: '', alt: '', relativePath: PICTURE }])
    expect(textToBlocks(wire)[0]).toMatchObject({ type: 'image', alt: '', relativePath: PICTURE })

    const page = composeEntityPage(person(), {
      snowflake: {
        cards: {
          'card-ned': {
            blocks: {
              sentence: [{ id: 'i', type: 'image', text: '', alt: '', relativePath: PICTURE }],
            },
          },
        },
      },
    })
    expect(page).toContain(`![](${PICTURE})`)
    expect(page).not.toContain(person().cover)
  })
})

describe('附件只列出没人引用的，不删除', () => {
  it('白名单收下图片，零引用列出来，目录里的文件还在', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-assets-'))
    try {
      const kept = await storeAsset(dir, { bytes: Buffer.from('png-bytes'), filename: 'door.png', mime: 'image/png' })
      const orphan = await storeAsset(dir, { bytes: Buffer.from('pdf-bytes'), filename: 'note.pdf', mime: 'application/pdf' })
      expect(kept.ok).toBe(true)
      expect(orphan.ok).toBe(true)
      if (!kept.ok || !orphan.ok) return
      expect(kept.relativePath).toMatch(/^assets\/[0-9a-f]{2}\/[0-9a-f]{16}\.png$/)
      writeFileSync(join(dir, 'snowflake.json'), JSON.stringify({ cover: kept.relativePath }))
      const refused = await storeAsset(dir, { bytes: Buffer.from('exe'), filename: 'run.exe', mime: 'application/octet-stream' })
      expect(refused.ok).toBe(false)
      const tooBig = await storeAsset(dir, {
        bytes: Buffer.alloc(ASSET_LIMIT + 1),
        filename: 'big.png',
        mime: 'image/png',
      })
      expect(tooBig.ok).toBe(false)
      const before = readdirSync(join(dir, 'assets'), { recursive: true }).map(String).sort()
      const listed = await listOrphanAssets(dir)
      expect(listed).toEqual([orphan.relativePath])
      expect(listed).not.toContain(kept.relativePath)
      const after = readdirSync(join(dir, 'assets'), { recursive: true }).map(String).sort()
      expect(after).toEqual(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
