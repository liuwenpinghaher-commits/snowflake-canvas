import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCard, createDocument, linkCards, serializeDocument, type AppState, type Layer } from '../src/document.ts'
import {
  REASON_DRAFT_TASK,
  REASON_LAYER,
  REASON_SCENE_TASK,
  SLOT_WHERE,
  SUGGEST_NOTE,
  foldIntoScene,
  suggestionFileName,
  type FoldResult,
} from '../src/suggest.ts'

function packOf(result: FoldResult) {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason)
  return JSON.parse(result.json) as {
    kind: string
    source: string
    note: string
    items: Array<{
      cardId: string
      action: string
      beatId: string | null
      slot: string
      text: string
      where: string
    }>
  }
}

function sceneState(fields: Record<string, string>, id = 'n-scene-1'): AppState {
  return createCard(createDocument('file-suggest'), {
    id,
    layer: '场景表',
    x: 0,
    y: 0,
    fields,
  })
}

describe('折进此场', () => {
  it('场景表折出 kind/source 正确，一条 intent，where 是本场任务，这一场发生什么优先于标题', () => {
    const state = sceneState({
      title: '雪夜开门',
      pov: '林晚',
      what: '她发现门口的人是弟弟',
      legacySummary: '更长的一场',
    })
    const before = JSON.stringify(serializeDocument(state))
    const result = foldIntoScene(state, { cardId: 'n-scene-1', action: 'existing-scene', beatId: '' })
    expect(JSON.stringify(serializeDocument(state))).toBe(before)
    expect(JSON.stringify(serializeDocument(state))).not.toContain('she-ding-tu-suggestion')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.json.startsWith('{\n  "kind": "she-ding-tu-suggestion"')).toBe(true)
    expect(result.json).toBe(JSON.stringify(JSON.parse(result.json), null, 2))
    expect(result.json).not.toContain('writesNarra')

    const pack = packOf(result)
    expect(pack.kind).toBe('she-ding-tu-suggestion')
    expect(pack.source).toBe('snowflake-canvas')
    expect(pack.note).toBe(SUGGEST_NOTE)
    expect(Object.keys(pack).sort()).toEqual(['items', 'kind', 'note', 'source'])
    expect(pack.items).toHaveLength(1)
    expect(pack.items[0]).toEqual({
      cardId: 'n-scene-1',
      action: 'existing-scene',
      beatId: null,
      slot: 'intent',
      text: '她发现门口的人是弟弟',
      where: '本场任务',
    })
    expect(pack.items[0]?.text).not.toBe('雪夜开门')

    const titled = foldIntoScene(
      sceneState({ title: '只有标题', what: '   ', pov: '' }, 'n-scene-2'),
      { cardId: 'n-scene-2', action: 'new-draft-scene', beatId: 'beat-should-drop' },
    )
    const titledPack = packOf(titled)
    expect(titledPack.items).toHaveLength(1)
    expect(titledPack.items[0]).toMatchObject({
      cardId: 'n-scene-2',
      action: 'new-draft-scene',
      beatId: null,
      slot: 'intent',
      text: '只有标题',
      where: '本场任务',
    })

    const empty = foldIntoScene(
      sceneState({ title: '  ', what: '', pov: '林晚', legacySummary: '不进本场任务' }),
      { cardId: 'n-scene-1', action: 'existing-scene' },
    )
    expect(empty).toEqual({ ok: false, reason: REASON_SCENE_TASK })
    expect(REASON_SCENE_TASK).toContain('本场任务')

    const kept = foldIntoScene(state, { cardId: 'n-scene-1', action: 'existing-scene', beatId: '  beat-7  ' })
    expect(packOf(kept).items[0]?.beatId).toBe('beat-7')
    expect(suggestionFileName('n-scene-1')).toBe('suggestion-n-scene-1.json')
    expect(SLOT_WHERE).toEqual({
      intent: '本场任务',
      value_shift: '价值转折',
      say_text: '对白',
      think_text: '内心',
      do_text: '动作',
    })
  })

  it('正文草稿默认 do_text，where 是动作', () => {
    let state = createDocument('file-prose')
    state = createCard(state, {
      id: 'n-prose-1',
      layer: '正文草稿',
      x: 10,
      y: 20,
      body: '她拦住门口那个人，问他这些年藏在哪里。',
    })
    const result = foldIntoScene(state, { cardId: 'n-prose-1', action: 'existing-scene', beatId: '   ' })
    const pack = packOf(result)
    expect(pack.items).toHaveLength(1)
    expect(pack.items[0]).toEqual({
      cardId: 'n-prose-1',
      action: 'existing-scene',
      beatId: null,
      slot: 'do_text',
      text: '她拦住门口那个人，问他这些年藏在哪里。',
      where: '动作',
    })
    expect(pack.items.some((item) => item.slot === 'intent')).toBe(false)
    expect(pack.items.some((item) => item.slot === 'do_text')).toBe(true)
  })

  it('正文草稿选 new-draft-scene 且相连场景表写了这一场发生什么：包里同时有 do_text 和 intent', () => {
    let state = createDocument('file-link')
    state = createCard(state, {
      id: 'n-scene-1',
      layer: '场景表',
      x: 0,
      y: 0,
      fields: {
        title: '雪夜开门',
        what: '她必须在弟弟离开前问出他为什么装死。',
        pov: '林晚',
      },
    })
    state = createCard(state, {
      id: 'n-prose-1',
      layer: '正文草稿',
      x: 40,
      y: 0,
      body: '她拦住门口那个人，问他这些年藏在哪里。',
    })
    state = createCard(state, {
      id: 'n-person-1',
      layer: 'renwubiao',
      x: 0,
      y: 80,
      fields: { name: '不该当成任务' },
    })
    state = linkCards(state, 'n-person-1', 'n-prose-1')
    state = linkCards(state, 'n-scene-1', 'n-prose-1')

    const result = foldIntoScene(state, {
      cardId: 'n-prose-1',
      action: 'new-draft-scene',
      beatId: 'beat-9',
      intentSupplement: '不该覆盖场景表',
    })
    const pack = packOf(result)
    expect(pack.items.map((item) => item.slot)).toEqual(['do_text', 'intent'])
    expect(pack.items[0]).toMatchObject({
      cardId: 'n-prose-1',
      action: 'new-draft-scene',
      beatId: null,
      slot: 'do_text',
      where: '动作',
      text: '她拦住门口那个人，问他这些年藏在哪里。',
    })
    expect(pack.items[1]).toEqual({
      cardId: 'n-scene-1',
      action: 'new-draft-scene',
      beatId: null,
      slot: 'intent',
      text: '她必须在弟弟离开前问出他为什么装死。',
      where: '本场任务',
    })

    let titled = createDocument('file-title-fallback')
    titled = createCard(titled, {
      id: 'n-scene-9',
      layer: '场景表',
      x: 0,
      y: 0,
      fields: { title: '标题当本场任务', what: '  ', pov: '' },
    })
    titled = createCard(titled, { id: 'n-prose-9', layer: '正文草稿', x: 30, y: 0, body: '动作一句。' })
    titled = linkCards(titled, 'n-prose-9', 'n-scene-9')
    const reversed = foldIntoScene(titled, { cardId: 'n-prose-9', action: 'new-draft-scene' })
    expect(reversed.ok).toBe(false)
    titled = linkCards(titled, 'n-scene-9', 'n-prose-9')
    const fromTitle = packOf(foldIntoScene(titled, { cardId: 'n-prose-9', action: 'new-draft-scene' }))
    expect(fromTitle.items.find((item) => item.slot === 'intent')?.text).toBe('标题当本场任务')
  })

  it('正文草稿选 new-draft-scene 但没有相连场景表、也没补本场任务：不生成文件，reason 里有本场任务', () => {
    let state = createDocument('file-missing')
    state = createCard(state, { id: 'n-prose-1', layer: '正文草稿', x: 0, y: 0, body: '只有动作。' })
    state = createCard(state, {
      id: 'n-scene-empty',
      layer: '场景表',
      x: 0,
      y: 40,
      fields: { title: ' ', what: '', pov: '', legacySummary: '更长也不算' },
    })
    state = linkCards(state, 'n-scene-empty', 'n-prose-1')

    const missing = foldIntoScene(state, { cardId: 'n-prose-1', action: 'new-draft-scene', intentSupplement: '   ' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.reason).toBe(REASON_DRAFT_TASK)
      expect(missing.reason).toContain('本场任务')
    }
    expect(missing).not.toHaveProperty('json')
    expect(missing).not.toHaveProperty('items')
    expect(JSON.stringify(serializeDocument(state))).not.toContain('she-ding-tu-suggestion')
  })

  it('补上本场任务之后才 ok:true，且 intent 条目的 text 就是补的那句', () => {
    const state = createCard(createDocument('file-fill'), {
      id: 'n-prose-1',
      layer: '正文草稿',
      x: 0,
      y: 0,
      body: '她站在门口。',
    })
    const blocked = foldIntoScene(state, { cardId: 'n-prose-1', action: 'new-draft-scene' })
    expect(blocked.ok).toBe(false)

    const filled = '她必须问出弟弟为什么装死。'
    const result = foldIntoScene(state, {
      cardId: 'n-prose-1',
      action: 'new-draft-scene',
      intentSupplement: filled,
    })
    expect(result.ok).toBe(true)
    const pack = packOf(result)
    const intent = pack.items.find((item) => item.slot === 'intent')
    expect(intent).toEqual({
      cardId: 'n-prose-1',
      action: 'new-draft-scene',
      beatId: null,
      slot: 'intent',
      text: filled,
      where: '本场任务',
    })
    expect(pack.items.some((item) => item.slot === 'do_text' && item.text === '她站在门口。')).toBe(true)
  })

  it('slot 之外的键进不了包', () => {
    const state = sceneState({
      title: '雪夜开门',
      what: '她发现门口的人是弟弟',
      pov: '',
    })
    const result = foldIntoScene(state, {
      cardId: 'n-scene-1',
      action: 'existing-scene',
      extraSlots: [
        { slot: 'prose', text: '整段散文不进包' },
        { slot: 'writesNarra', text: 'false' },
        { slot: 'say_text', text: '他说你好' },
        { slot: 'intent', text: '不覆盖已有的本场任务' },
      ],
    })
    const pack = packOf(result)
    expect(pack.items.map((item) => item.slot)).toEqual(['intent', 'say_text'])
    expect(pack.items[0]?.text).toBe('她发现门口的人是弟弟')
    expect(pack.items[1]).toMatchObject({ slot: 'say_text', text: '他说你好', where: '对白' })
    expect(result.ok && result.json).not.toContain('整段散文不进包')
    expect(result.ok && result.json).not.toContain('prose')
    expect(result.ok && result.json).not.toContain('writesNarra')
    for (const item of pack.items) {
      expect(Object.keys(item).sort()).toEqual(['action', 'beatId', 'cardId', 'slot', 'text', 'where'])
      expect(['intent', 'value_shift', 'do_text', 'say_text', 'think_text']).toContain(item.slot)
    }
  })

  it('人物表、一页大纲、人物故事、人物档案、一句话、一段和卡片不能折出建议', () => {
    const layers: Layer[] = ['renwubiao', 'yiyedagang', 'renwugushi', 'renwudangan', '一句话', '一段', 'situation']
    expect(REASON_LAYER).toContain('场景表')
    expect(REASON_LAYER).toContain('场次')
    expect(REASON_LAYER).toContain('正文草稿')
    expect(REASON_LAYER).not.toContain('changci')
    expect(REASON_LAYER).not.toContain('renwubiao')
    for (const layer of layers) {
      let state = createDocument(`file-${layer}`)
      state = createCard(state, {
        id: 'n-nope',
        layer,
        x: 0,
        y: 0,
        body: layer === '一句话' || layer === 'situation' ? '不能直接进场' : '',
        fields:
          layer === 'renwubiao'
            ? { name: '林晚', sentence: '门口的弟弟' }
            : layer === '一段' || layer === 'yiyedagang'
              ? { background: '她在雪夜开门。' }
              : layer === 'renwugushi'
                ? { who: '林晚' }
                : layer === 'renwudangan'
                  ? { bodyName: '林晚' }
                  : undefined,
      })
      const result = foldIntoScene(state, { cardId: 'n-nope', action: 'existing-scene', beatId: 'beat-1' })
      expect(result).toEqual({ ok: false, reason: REASON_LAYER })
      expect(result).not.toHaveProperty('items')
      expect(result).not.toHaveProperty('json')
    }
  })

  it('场次可以折出建议，本场任务优先用 task', () => {
    let state = createDocument('file-beat')
    state = createCard(state, {
      id: 'n-scene-1',
      layer: '场景表',
      x: 0,
      y: 0,
      fields: { what: '场景里的一句', title: '雪夜' },
    })
    state = createCard(state, {
      id: 'n-beat-1',
      layer: 'changci',
      x: 20,
      y: 0,
      fields: { task: '场次上的本场任务', alpha: '弟弟站在门口' },
    })
    state = linkCards(state, 'n-scene-1', 'n-beat-1')
    const fromBeat = packOf(foldIntoScene(state, { cardId: 'n-beat-1', action: 'existing-scene' }))
    expect(fromBeat.items).toEqual([
      {
        cardId: 'n-beat-1',
        action: 'existing-scene',
        beatId: null,
        slot: 'intent',
        text: '场次上的本场任务',
        where: '本场任务',
      },
    ])

    state = createCard(state, {
      id: 'n-prose-1',
      layer: '正文草稿',
      x: 40,
      y: 0,
      body: '她问了一句。',
    })
    state = linkCards(state, 'n-scene-1', 'n-prose-1')
    state = linkCards(state, 'n-beat-1', 'n-prose-1')
    const fromProse = packOf(foldIntoScene(state, { cardId: 'n-prose-1', action: 'new-draft-scene' }))
    expect(fromProse.items.find((item) => item.slot === 'intent')).toMatchObject({
      cardId: 'n-beat-1',
      text: '场次上的本场任务',
    })

    let viaScene = createDocument('file-beat-empty')
    viaScene = createCard(viaScene, {
      id: 'n-scene-2',
      layer: '场景表',
      x: 0,
      y: 0,
      fields: { what: '上游场景的这一场', title: '' },
    })
    viaScene = createCard(viaScene, {
      id: 'n-beat-2',
      layer: 'changci',
      x: 20,
      y: 0,
      fields: { task: '   ', alpha: '门口' },
    })
    viaScene = createCard(viaScene, {
      id: 'n-prose-2',
      layer: '正文草稿',
      x: 40,
      y: 0,
      body: '她没有让他进门。',
    })
    viaScene = linkCards(viaScene, 'n-scene-2', 'n-beat-2')
    viaScene = linkCards(viaScene, 'n-beat-2', 'n-prose-2')
    const upstream = packOf(foldIntoScene(viaScene, { cardId: 'n-prose-2', action: 'new-draft-scene' }))
    expect(upstream.items.find((item) => item.slot === 'intent')).toMatchObject({
      cardId: 'n-scene-2',
      text: '上游场景的这一场',
    })
  })

  it('产品源码 src 不含设定图写入路径', () => {
    const banned = [
      '/api/' + 'commit',
      '/api/' + 'paste',
      '/api/' + 'suggest',
      '/api/' + 'drafts/' + 'patch',
      'writes' + 'Narra',
    ]
    const root = join(process.cwd(), 'src')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        const text = readFileSync(full, 'utf8')
        for (const token of banned) {
          if (text.includes(token)) hits.push(`${full} ${token}`)
        }
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
