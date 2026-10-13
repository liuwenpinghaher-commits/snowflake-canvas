import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCard, createDocument, type AppState, type Entity } from '../src/document.ts'
import { finishGhostEdit } from '../src/CastPage.tsx'
import { commitPersonField, readPersonField } from '../src/person-form.ts'
import {
  CANONICAL_NAME,
  createMemoryChannel,
  createPersistController,
  parseCompleteDocument,
  type ChannelBus,
  type DirectoryAccess,
  type PersistPorts,
  type RecoveryLog,
} from '../src/persist.ts'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

class MemDir implements DirectoryAccess {
  files = new Map<string, Uint8Array>()

  async read(name: string): Promise<Uint8Array | null> {
    const found = this.files.get(name)
    return found ? found.slice() : null
  }

  async writeTemp(name: string, bytes: Uint8Array): Promise<void> {
    this.files.set(name, bytes.slice())
  }

  async move(tempName: string, canonicalName: string): Promise<void> {
    const body = this.files.get(tempName)
    if (!body) throw new Error('missing temp')
    this.files.set(canonicalName, body.slice())
    this.files.delete(tempName)
  }

  async remove(name: string): Promise<void> {
    this.files.delete(name)
  }
}

class FakeLog implements RecoveryLog {
  bytes: Uint8Array | null = null

  async read(): Promise<Uint8Array | null> {
    return this.bytes ? this.bytes.slice() : null
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes.slice()
  }
}

function harness(mem = new MemDir()) {
  const log = new FakeLog()
  const channel: ChannelBus = createMemoryChannel()
  let stored = false
  const claim = { value: null as string | null }
  const ports: PersistPorts = {
    protocol: 'http:',
    hasDirectoryPicker: true,
    now: () => new Date(2026, 9, 13, 11, 31, 0),
    loadDirectory: async () => (stored ? mem : null),
    pickDirectory: async () => {
      stored = true
      return mem
    },
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    logFactory: async () => log,
    tryAcquireLock: async () => ({ release() {} }),
    lockHeld: async () => false,
    channel,
    claim: {
      get: () => claim.value,
      set: (fileId) => {
        claim.value = fileId
      },
    },
    askSaveAs: async () => true,
    askFirstDownload: async () => true,
    randomId: () => 'ghost-file',
  }
  const ctl = createPersistController(ports)
  return {
    mem,
    ctl,
    markStored() {
      stored = true
    },
  }
}

function buildPerson(fileId: string): AppState {
  let state = createDocument(fileId)
  state = createCard(state, {
    id: 'pcard',
    layer: 'renwubiao',
    x: 0,
    y: 0,
    fields: { name: '奈德', role: '守门人', grade: '主要', sentence: '守住城门' },
  })
  state = createCard(state, { id: 'idea', layer: 'situation', x: 40, y: 0, body: '门口的人' })
  return state
}

function personOf(state: AppState): Entity {
  const entity = (state.entities ?? []).find((item) => item.views.renwubiao === 'pcard')
  if (!entity) throw new Error('重进后没有这个人')
  return entity
}

async function blurSave(fieldKey: string, from: string, to: string, ideaId = '') {
  const h = harness()
  await h.ctl.selectDirectory()
  const fileId = h.ctl.snapshot().state.snowflake.fileId
  await h.ctl.mutate(() => buildPerson(fileId))
  const input = {
    cardId: 'pcard',
    entityId: null,
    fieldKey,
    ideaId,
    requestId: `req-${fieldKey}-${ideaId || 'loose'}`,
    at: '2026-10-13T03:31:00.000Z',
  }
  const shown = finishGhostEdit(from, to, (text) => {
    const preview = commitPersonField(h.ctl.snapshot().state, { ...input, text })
    return preview !== h.ctl.snapshot().state
  })
  if (shown !== from) {
    await h.ctl.mutate((current) => commitPersonField(current, { ...input, text: to }))
  }
  const bytes = h.mem.files.get(CANONICAL_NAME)
  if (!bytes) throw new Error('正本没有写入')
  const parsed = parseCompleteDocument(bytes)
  if (!parsed) throw new Error('正本不是完整 JSON')
  const again = harness(h.mem)
  again.markStored()
  await again.ctl.start()
  return { shown, state: again.ctl.snapshot().state, bytes }
}

describe('人物字段隐形框，不选卡片也能落盘', () => {
  it('人物名编辑后失焦提交，重进页面仍是新名字', async () => {
    const saved = await blurSave('name', '奈德', '林晚')
    expect(saved.shown).toBe('林晚')
    const entity = personOf(saved.state)
    expect(readPersonField(saved.state, entity, 'name')).toBe('林晚')
    expect(entity.name).toBe('林晚')
    expect(saved.state.snowflake.cards.pcard?.fields.name).toBe('林晚')
    expect(saved.state.sediment ?? []).toEqual([])
    expect(new TextDecoder().decode(saved.bytes)).toContain('林晚')
  })

  it('角色编辑后失焦提交，重进页面仍是新角色', async () => {
    const saved = await blurSave('role', '守门人', '引路人')
    expect(saved.shown).toBe('引路人')
    const entity = personOf(saved.state)
    expect(readPersonField(saved.state, entity, 'role')).toBe('引路人')
    expect(saved.state.snowflake.cards.pcard?.fields.role).toBe('引路人')
    expect(saved.state.sediment ?? []).toEqual([])
  })

  it('类别改完即提交，重进页面仍是新类别', async () => {
    const saved = await blurSave('grade', '主要', 'NPC')
    expect(saved.shown).toBe('NPC')
    const entity = personOf(saved.state)
    expect(readPersonField(saved.state, entity, 'grade')).toBe('NPC')
    expect(saved.state.snowflake.cards.pcard?.fields.grade).toBe('NPC')
    expect(saved.state.sediment ?? []).toEqual([])
  })

  it('选了卡片时，改动仍归到那条卡片', async () => {
    const saved = await blurSave('role', '守门人', '守夜人', 'idea')
    expect(saved.shown).toBe('守夜人')
    const entity = personOf(saved.state)
    expect(readPersonField(saved.state, entity, 'role')).toBe('守夜人')
    const manual = (saved.state.sediment ?? []).find((item) => item.requestId === 'req-role-idea')
    expect(manual?.kind).toBe('manual')
    expect(manual?.ideaId).toBe('idea')
    expect(manual?.sessionId).toBeUndefined()
    expect(manual?.target.fieldKey).toBe('role')
    expect(manual?.quote).toBe('守夜人')
  })

  it('名字清空时不落盘，字段回到提交前', async () => {
    const h = harness()
    await h.ctl.selectDirectory()
    const fileId = h.ctl.snapshot().state.snowflake.fileId
    await h.ctl.mutate(() => buildPerson(fileId))
    const before = h.mem.files.get(CANONICAL_NAME)?.slice()
    const input = {
      cardId: 'pcard',
      entityId: null,
      fieldKey: 'name',
      ideaId: '',
      requestId: 'req-blank-name',
      at: '2026-10-13T03:31:00.000Z',
    }
    const shown = finishGhostEdit('奈德', '   ', (text) => {
      const preview = commitPersonField(h.ctl.snapshot().state, { ...input, text })
      return preview !== h.ctl.snapshot().state
    })
    expect(shown).toBe('奈德')
    expect(commitPersonField(h.ctl.snapshot().state, { ...input, text: '   ' })).toBe(h.ctl.snapshot().state)
    expect(before).toBeTruthy()
    const bytes = h.mem.files.get(CANONICAL_NAME)
    expect(bytes && Buffer.from(bytes).equals(Buffer.from(before!))).toBe(true)
  })

  it('页面文案不再要求先选卡片，保存按钮已去掉', () => {
    const cast = read('src/CastPage.tsx')
    expect(cast).toContain('归入卡片/视图（可选）')
    expect(cast).toContain('finishGhostEdit')
    expect(cast).toContain('commitPersonField')
    expect(cast).toContain('onBlur')
    expect(cast).toContain("event.key === 'Escape'")
    expect(cast).not.toContain('不选卡片不能保存')
    expect(cast).not.toContain('保存类别')
    expect(cast).not.toContain('>保存<')
    expect(cast).toContain('去讨论')
    expect(cast).toContain('新建一条卡片')
    expect(cast).toContain('沉淀账本')
  })
})

