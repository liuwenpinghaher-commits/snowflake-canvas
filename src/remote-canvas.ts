import { diffDocuments } from '../server/db/object-ops.mjs'
import { bookScopedPath } from './books.ts'

const remembered = new Map<string, Uint8Array>()

function rememberKey(bookId: string | null | undefined, etag: string): string {
  return `${bookId ?? ''}\n${etag}`
}

function remember(bookId: string | null | undefined, etag: string, bytes: Uint8Array): void {
  if (!etag) return
  remembered.set(rememberKey(bookId, etag), bytes.slice())
}

function decodeJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes))
}

function opsPacket(before: Uint8Array | undefined, after: Uint8Array): string {
  const next = decodeJson(after)
  if (!before) return JSON.stringify({ ops: [{ op: 'set', path: [], value: next }] })
  return JSON.stringify({ ops: diffDocuments(decodeJson(before), next) })
}

function canvasBytes(payload: unknown): Uint8Array | null {
  const document =
    payload && typeof payload === 'object' && payload !== null && 'document' in payload
      ? (payload as { document: unknown }).document
      : payload
  if (!document || typeof document !== 'object' || Array.isArray(document)) return null
  if (!('canvas' in document) || !('snowflake' in document)) return null
  return new TextEncoder().encode(JSON.stringify(document))
}

async function readConflictBytes(response: Response): Promise<Uint8Array | null> {
  try {
    return canvasBytes(await response.json())
  } catch {
    return null
  }
}

function api(path: string, bookId?: string | null): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${bookScopedPath(path, bookId ?? null)}`
}

export interface RemoteLoad {
  etag: string
  bytes: Uint8Array
}

export type RemoteSave =
  | { ok: true; etag: string }
  | { ok: false; conflict: true; etag: string; bytes?: Uint8Array }
  | { ok: false; conflict: false }

export type RemoteKeep =
  | { ok: true; etag: string; snapshotCount: number; snapshotName?: string; timeline?: 'ok' | 'skipped' }
  | { ok: false; message: string }

export interface RemoteSnapshotItem {
  name: string
  savedAt: string
}

export type RemoteRollback =
  | { ok: true; etag: string; bytes: Uint8Array }
  | { ok: false; conflict: true; etag: string; bytes?: Uint8Array }
  | { ok: false; conflict: false; message: string }

export async function loadRemote(bookId?: string | null): Promise<RemoteLoad | null> {
  let response: Response
  try {
    response = await fetch(api('/api/canvas', bookId), { cache: 'no-store' })
  } catch {
    return null
  }
  if (!response.ok) return null
  const etag = response.headers.get('etag') || ''
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return null
  }
  const document =
    payload && typeof payload === 'object' && payload !== null && 'document' in payload
      ? (payload as { document: unknown }).document
      : payload
  const bytes = new TextEncoder().encode(JSON.stringify(document))
  remember(bookId, etag, bytes)
  return { etag, bytes }
}

export async function saveRemote(bytes: Uint8Array, etag: string, bookId?: string | null): Promise<RemoteSave> {
  const packet = opsPacket(remembered.get(rememberKey(bookId, etag)), bytes)
  let response: Response
  try {
    response = await fetch(api('/api/canvas', bookId), {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      body: packet,
      cache: 'no-store',
    })
  } catch {
    return { ok: false, conflict: false }
  }
  if (response.status === 412) {
    const rejected = response.headers.get('etag') || ''
    try {
      const again = await fetch(api('/api/canvas', bookId), { cache: 'no-store' })
      const fresh = again.ok ? again.headers.get('etag') || '' : ''
      const nextEtag = fresh || rejected
      if (!nextEtag) return { ok: false, conflict: false }
      const conflictBytes = again.ok ? await readConflictBytes(again) : null
      if (conflictBytes) remember(bookId, nextEtag, conflictBytes)
      if (conflictBytes) return { ok: false, conflict: true, etag: nextEtag, bytes: conflictBytes }
      return { ok: false, conflict: true, etag: nextEtag }
    } catch {
      if (!rejected) return { ok: false, conflict: false }
      return { ok: false, conflict: true, etag: rejected }
    }
  }
  if (!response.ok) return { ok: false, conflict: false }
  const savedEtag = response.headers.get('etag') || ''
  const savedBytes = await readConflictBytes(response)
  remember(bookId, savedEtag, savedBytes ?? bytes)
  return { ok: true, etag: savedEtag }
}

export async function keepRemote(etag: string, bookId?: string | null): Promise<RemoteKeep> {
  let response: Response
  try {
    response = await fetch(api('/api/canvas/keep', bookId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      body: '{}',
      cache: 'no-store',
    })
  } catch {
    return { ok: false, message: '留下这一版没有连上服务器' }
  }
  let payload: { error?: string; snapshotCount?: unknown; snapshotName?: unknown; timeline?: unknown } = {}
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    payload = {}
  }
  if (!response.ok) {
    return { ok: false, message: payload.error || '留下这一版失败' }
  }
  return {
    ok: true,
    etag: response.headers.get('etag') || '',
    snapshotCount: typeof payload.snapshotCount === 'number' ? payload.snapshotCount : 0,
    snapshotName: typeof payload.snapshotName === 'string' ? payload.snapshotName : undefined,
    timeline: payload.timeline === 'skipped' ? 'skipped' : 'ok',
  }
}

export async function listRemoteSnapshots(bookId?: string | null): Promise<RemoteSnapshotItem[] | null> {
  let response: Response
  try {
    response = await fetch(api('/api/canvas/snapshots', bookId), { cache: 'no-store' })
  } catch {
    return null
  }
  if (!response.ok) return null
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return null
  }
  if (!Array.isArray(payload)) return null
  const items: RemoteSnapshotItem[] = []
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue
    const { name, savedAt } = item as { name?: unknown; savedAt?: unknown }
    if (typeof name !== 'string') continue
    items.push({ name, savedAt: typeof savedAt === 'string' ? savedAt : '' })
  }
  return items
}

export async function rollbackRemote(name: string, etag: string, bookId?: string | null): Promise<RemoteRollback> {
  let response: Response
  try {
    response = await fetch(api('/api/canvas/rollback', bookId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      body: JSON.stringify({ name }),
      cache: 'no-store',
    })
  } catch {
    return { ok: false, conflict: false, message: '回退没有连上服务器' }
  }
  if (response.status === 412) {
    const fresh = response.headers.get('etag') || ''
    const bytes = await readConflictBytes(response)
    if (!fresh) return { ok: false, conflict: false, message: '版本已更新，请再试' }
    return bytes ? { ok: false, conflict: true, etag: fresh, bytes } : { ok: false, conflict: true, etag: fresh }
  }
  if (!response.ok) {
    let message = '回退失败'
    try {
      const payload = (await response.json()) as { error?: unknown }
      if (typeof payload.error === 'string' && payload.error) message = payload.error
    } catch {
      // 没有错误正文就用默认说法。
    }
    return { ok: false, conflict: false, message }
  }
  const bytes = await readConflictBytes(response)
  if (!bytes) return { ok: false, conflict: false, message: '回退结果读不出来' }
  return { ok: true, etag: response.headers.get('etag') || '', bytes }
}
