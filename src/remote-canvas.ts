async function readConflictBytes(response: Response): Promise<Uint8Array | null> {
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
  return new TextEncoder().encode(JSON.stringify(document))
}

function api(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${path}`
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

export async function loadRemote(): Promise<RemoteLoad | null> {
  let response: Response
  try {
    response = await fetch(api('/api/canvas'), { cache: 'no-store' })
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
  return { etag, bytes: new TextEncoder().encode(JSON.stringify(document)) }
}

export async function saveRemote(bytes: Uint8Array, etag: string): Promise<RemoteSave> {
  let response: Response
  try {
    response = await fetch(api('/api/canvas'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      body: bytes.slice(),
      cache: 'no-store',
    })
  } catch {
    return { ok: false, conflict: false }
  }
  if (response.status === 412) {
    const rejected = response.headers.get('etag') || ''
    try {
      const again = await fetch(api('/api/canvas'), { cache: 'no-store' })
      const fresh = again.ok ? again.headers.get('etag') || '' : ''
      const etag = fresh || rejected
      if (!etag) return { ok: false, conflict: false }
      const bytes = again.ok ? await readConflictBytes(again) : null
      if (bytes) return { ok: false, conflict: true, etag, bytes }
      return { ok: false, conflict: true, etag }
    } catch {
      if (!rejected) return { ok: false, conflict: false }
      return { ok: false, conflict: true, etag: rejected }
    }
  }
  if (!response.ok) return { ok: false, conflict: false }
  return { ok: true, etag: response.headers.get('etag') || '' }
}

export async function keepRemote(etag: string): Promise<RemoteKeep> {
  let response: Response
  try {
    response = await fetch(api('/api/canvas/keep'), {
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

export async function listRemoteSnapshots(): Promise<RemoteSnapshotItem[] | null> {
  let response: Response
  try {
    response = await fetch(api('/api/canvas/snapshots'), { cache: 'no-store' })
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

export async function rollbackRemote(name: string, etag: string): Promise<RemoteRollback> {
  let response: Response
  try {
    response = await fetch(api('/api/canvas/rollback'), {
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
