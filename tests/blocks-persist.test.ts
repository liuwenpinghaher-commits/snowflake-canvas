import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import ts from 'typescript'
import { blocksToText, textToBlocks } from '../src/block-editor.ts'
import {
  commitCardText,
  createCard,
  createDocument,
  readCellBlocks,
  serializeDocument,
  type ProseBlock,
} from '../src/document.ts'
import { documentToBytes, mergeDocuments, parseCompleteDocument } from '../src/persist.ts'

const CUT1 = 'a32aab965c2f8711f1f8b1e9ad50329a0c1860ae'
const OLD_FILES = ['document.ts', 'expand.ts', 'snapshot.ts', 'persist.ts'] as const

type OldCard = { body: string; fields: Record<string, string>; blocks?: unknown }
type OldParsed = { state: { snowflake: { cards: Record<string, OldCard> } } } | null

let oldDir = ''
let oldParse: ((bytes: Uint8Array) => OldParsed) | null = null

function transpileOld(source: string, fileName: string): string {
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName,
  }).outputText
  return javascript.replace(/from (['"])(\.\/[^'"]+)\.ts\1/g, 'from $1$2.js$1')
}

async function cut1Parse(): Promise<(bytes: Uint8Array) => OldParsed> {
  if (oldParse) return oldParse
  oldDir = mkdtempSync(join(tmpdir(), 'sf-cut1-'))
  for (const name of OLD_FILES) {
    const source = execFileSync('git', ['show', `${CUT1}:src/${name}`], { encoding: 'utf8' })
    writeFileSync(join(oldDir, name.replace(/\.ts$/, '.js')), transpileOld(source, name))
  }
  const loaded = (await import(pathToFileURL(join(oldDir, 'persist.js')).href)) as {
    parseCompleteDocument: (bytes: Uint8Array) => OldParsed
  }
  oldParse = loaded.parseCompleteDocument
  return oldParse
}

afterAll(() => {
  if (oldDir) rmSync(oldDir, { recursive: true, force: true })
})

function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function jsonOf(bytes: Uint8Array): { snowflake: { cards: Record<string, { body: string; fields: Record<string, string>; blocks?: unknown }> } } {
  return JSON.parse(new TextDecoder().decode(bytes)) as {
    snowflake: { cards: Record<string, { body: string; fields: Record<string, string>; blocks?: unknown }> }
  }
}

describe('块数组落盘：旧构建能读，没拆块不写数组', () => {
  it('没有块数组的旧 JSON，新代码读出再序列化仍没有块数组，旧构建读得回原来的正文', async () => {
    const oldDoc = {
      canvas: { nodes: [], edges: [] },
      snowflake: {
        fileId: 'old-book',
        cards: {
          c1: { layer: 'situation', body: '门口那个人其实是弟弟', fields: {} },
          p1: {
            layer: '一段',
            body: '背景：她在雪夜开门。\n灾难一：\n灾难二：\n灾难三：\n结局：',
            fields: {
              background: '她在雪夜开门。',
              disaster1: '',
              disaster2: '',
              disaster3: '',
              ending: '',
            },
          },
        },
      },
    }
    const opened = parseCompleteDocument(bytesOf(oldDoc))
    expect(opened).not.toBeNull()
    if (!opened) return
    expect(opened.state.snowflake.cards.c1?.blocks).toBeUndefined()
    expect(readCellBlocks(opened.state.snowflake.cards.c1!, null)).toBeUndefined()
    const again = documentToBytes(opened.state)
    const saved = jsonOf(again)
    expect(JSON.stringify(saved)).not.toMatch(/"blocks"\s*:/)
    expect(saved.snowflake.cards.c1?.body).toBe('门口那个人其实是弟弟')
    expect(saved.snowflake.cards.p1?.fields.background).toBe('她在雪夜开门。')

    const parseOld = await cut1Parse()
    const back = parseOld(again)
    expect(back).not.toBeNull()
    expect(back?.state.snowflake.cards.c1?.body).toBe('门口那个人其实是弟弟')
    expect(back?.state.snowflake.cards.p1?.fields.background).toBe('她在雪夜开门。')
    expect(back?.state.snowflake.cards.c1?.blocks).toBeUndefined()
  })

  it('只改段落里的字、或只改 @@sf-blocks 的文字，不新增块数组键', () => {
    let plain = createDocument('plain-edit')
    plain = createCard(plain, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '门口' })
    plain = commitCardText(plain, 'c1', '门口那个人', null, false)
    const plainDoc = serializeDocument(plain)
    expect(plainDoc.snowflake.cards.c1?.body).toBe('门口那个人')
    expect(plainDoc.snowflake.cards.c1?.blocks).toBeUndefined()

    const wire = blocksToText([
      { id: 'a', type: 'paragraph', text: '甲' },
      { id: 'b', type: 'paragraph', text: '乙' },
    ])
    let wired = createDocument('wire-edit')
    wired = createCard(wired, { id: 'c1', layer: 'situation', x: 0, y: 0, body: wire })
    const edited = blocksToText([
      { id: 'a', type: 'paragraph', text: '甲改' },
      { id: 'b', type: 'paragraph', text: '乙' },
    ])
    wired = commitCardText(wired, 'c1', edited, null, false)
    const wiredDoc = serializeDocument(wired)
    expect(wiredDoc.snowflake.cards.c1?.blocks).toBeUndefined()
    expect(wiredDoc.snowflake.cards.c1?.body).toBe(edited)
    expect(textToBlocks(wiredDoc.snowflake.cards.c1?.body ?? '').map((block) => block.text)).toEqual(['甲改', '乙'])
  })

  it('用户拆过块后写出块数组，字符串是可见文字；旧构建跳过数组，正文还在', async () => {
    const blocks: ProseBlock[] = [
      { id: 'b1', type: 'paragraph', text: '甲' },
      { id: 'b2', type: 'heading', text: '乙' },
      { id: 'b3', type: 'todo', text: '买菜', checked: true },
      { id: 'b4', type: 'quote', text: '他说夜里冷' },
      { id: 'b5', type: 'divider', text: '' },
    ]
    let state = createDocument('split-book')
    state = createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '甲乙' })
    state = commitCardText(state, 'c1', blocksToText(blocks), null, false, blocks)
    const doc = serializeDocument(state)
    const stored = doc.snowflake.cards.c1
    if (!stored) throw new Error('missing stored')
    expect(stored.body).toBe('甲\n乙\n买菜\n他说夜里冷\n')
    expect(typeof stored.body).toBe('string')
    expect(stored.blocks?.body).toEqual([
      { id: 'b1', type: 'paragraph', text: '甲' },
      { id: 'b2', type: 'heading', text: '乙' },
      { id: 'b3', type: 'todo', text: '买菜', checked: true },
      { id: 'b4', type: 'quote', text: '他说夜里冷' },
      { id: 'b5', type: 'divider', text: '' },
    ])
    expect(JSON.stringify(stored.fields)).not.toMatch(/\[/)

    let fieldState = createDocument('split-field')
    fieldState = createCard(fieldState, {
      id: 'p1',
      layer: '一段',
      x: 0,
      y: 0,
      fields: { background: '她在雪夜开门。', disaster1: '第一灾' },
    })
    const fieldBlocks: ProseBlock[] = [
      { id: 'f1', type: 'paragraph', text: '她在雪夜开门。' },
      { id: 'f2', type: 'quote', text: '第二行' },
    ]
    fieldState = commitCardText(fieldState, 'p1', blocksToText(fieldBlocks), 'background', false, fieldBlocks)
    const fieldCard = serializeDocument(fieldState).snowflake.cards.p1
    if (!fieldCard) throw new Error('missing field card')
    expect(fieldCard.fields.background).toBe('她在雪夜开门。\n第二行')
    expect(fieldCard.fields.disaster1).toBe('第一灾')
    expect(typeof fieldCard.fields.background).toBe('string')
    expect(fieldCard.blocks?.background).toEqual(fieldBlocks)
    expect(fieldCard.blocks?.disaster1).toBeUndefined()

    const parseOld = await cut1Parse()
    const back = parseOld(documentToBytes(state))
    expect(back).not.toBeNull()
    expect(back?.state.snowflake.cards.c1?.body).toBe('甲\n乙\n买菜\n他说夜里冷\n')
    expect(back?.state.snowflake.cards.c1?.blocks).toBeUndefined()
    const fieldBack = parseOld(documentToBytes(fieldState))
    expect(fieldBack).not.toBeNull()
    expect(fieldBack?.state.snowflake.cards.p1?.fields.background).toBe('她在雪夜开门。\n第二行')
    expect(fieldBack?.state.snowflake.cards.p1?.fields.disaster1).toBe('第一灾')
    expect(fieldBack?.state.snowflake.cards.p1?.blocks).toBeUndefined()
  })

  it('夹具里的新形状：旧构建跳过块数组且一个字不丢；新代码以块数组为准，不再反解 @@sf-blocks', async () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/blocks-new-shape.json', import.meta.url), 'utf8')) as {
      snowflake: { cards: Record<string, { body: string; fields: Record<string, string> }> }
    }
    const raw = bytesOf(fixture)
    const parseOld = await cut1Parse()
    const oldRead = parseOld(raw)
    expect(oldRead).not.toBeNull()
    expect(oldRead?.state.snowflake.cards.c1?.body).toBe('@@sf-blocks\np 字符串里的甲\nh 字符串里的乙')
    expect(oldRead?.state.snowflake.cards.c1?.blocks).toBeUndefined()
    expect(oldRead?.state.snowflake.cards.c2?.fields.background).toBe('她在雪夜开门。')
    expect(oldRead?.state.snowflake.cards.c2?.fields.disaster1).toBe('第一灾')
    expect(oldRead?.state.snowflake.cards.c2?.body).toBe('背景原文不动')
    expect(oldRead?.state.snowflake.cards.c2?.blocks).toBeUndefined()

    const opened = parseCompleteDocument(raw)
    expect(opened).not.toBeNull()
    if (!opened) return
    const situation = opened.state.snowflake.cards.c1
    const paragraph = opened.state.snowflake.cards.c2
    if (!situation || !paragraph) throw new Error('missing fixture cards')
    expect(readCellBlocks(situation, null)?.map((block) => `${block.type}:${block.text}`)).toEqual(['paragraph:甲', 'heading:乙'])
    expect(textToBlocks(situation.body).map((block) => block.text)).toEqual(['字符串里的甲', '字符串里的乙'])
    expect(readCellBlocks(paragraph, 'background')?.map((block) => block.type)).toEqual(['paragraph', 'quote'])
    expect(textToBlocks(paragraph.fields.background ?? '')).toHaveLength(1)

    const saved = jsonOf(documentToBytes(opened.state))
    expect(saved.snowflake.cards.c1?.body).toBe('甲\n乙')
    expect(saved.snowflake.cards.c1?.blocks).toEqual({
      body: [
        { id: 'b1', type: 'paragraph', text: '甲' },
        { id: 'b2', type: 'heading', text: '乙' },
      ],
    })
    expect(saved.snowflake.cards.c2?.fields.background).toBe('她在雪夜开门。\n第二行')
    expect(saved.snowflake.cards.c2?.fields.disaster1).toBe('第一灾')
    expect(saved.snowflake.cards.c2?.body).toBe('背景原文不动')

    const oldSaved = parseOld(documentToBytes(opened.state))
    expect(oldSaved).not.toBeNull()
    expect(oldSaved?.state.snowflake.cards.c1?.body).toBe('甲\n乙')
    expect(oldSaved?.state.snowflake.cards.c1?.blocks).toBeUndefined()
    expect(oldSaved?.state.snowflake.cards.c2?.fields.background).toBe('她在雪夜开门。\n第二行')
    expect(oldSaved?.state.snowflake.cards.c2?.fields.disaster1).toBe('第一灾')
    expect(oldSaved?.state.snowflake.cards.c2?.body).toBe('背景原文不动')
  })

  it('这一格已经有块数组时，再写成一段也仍写出数组；待办勾选会被合并看成改动', () => {
    let state = createDocument('keep-array')
    state = createCard(state, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '甲' })
    state = commitCardText(state, 'c1', blocksToText([{ id: 'b1', type: 'paragraph', text: '甲' }, { id: 'b2', type: 'paragraph', text: '乙' }]), null, false, [
      { id: 'b1', type: 'paragraph', text: '甲' },
      { id: 'b2', type: 'paragraph', text: '乙' },
    ])
    state = commitCardText(state, 'c1', '甲乙合一', null, false, [{ id: 'b1', type: 'paragraph', text: '甲乙合一' }])
    const kept = serializeDocument(state).snowflake.cards.c1
    expect(kept?.blocks?.body).toEqual([{ id: 'b1', type: 'paragraph', text: '甲乙合一' }])
    expect(kept?.body).toBe('甲乙合一')

    const unchecked: ProseBlock[] = [{ id: 't', type: 'todo', text: '买菜', checked: false }]
    const checked: ProseBlock[] = [{ id: 't', type: 'todo', text: '买菜', checked: true }]
    let baseState = createDocument('merge-book')
    baseState = createCard(baseState, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '买菜' })
    baseState = commitCardText(baseState, 'c1', blocksToText(unchecked), null, false, unchecked)
    let localState = createDocument('merge-book')
    localState = createCard(localState, { id: 'c1', layer: 'situation', x: 0, y: 0, body: '买菜' })
    localState = commitCardText(localState, 'c1', blocksToText(checked), null, false, checked)
    const baseBytes = documentToBytes(baseState)
    const localBytes = documentToBytes(localState)
    const merged = mergeDocuments(baseBytes, baseBytes, localBytes)
    expect(merged.kind).toBe('merged')
    if (merged.kind !== 'merged') return
    const parsed = parseCompleteDocument(merged.bytes)
    expect(parsed?.state.snowflake.cards.c1?.blocks?.body?.[0]).toMatchObject({ id: 't', type: 'todo', text: '买菜', checked: true })
    expect(parsed?.state.snowflake.cards.c1?.body).toBe('买菜')
  })
})
