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
  | { ok: true; etag: string; snapshotCount: number }
  | { ok: false; message: string }

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
  let payload: { error?: string; snapshots?: unknown[] } = {}
  try {
    payload = (await response.json()) as { error?: string; snapshots?: unknown[] }
  } catch {
    payload = {}
  }
  if (!response.ok) {
    return { ok: false, message: payload.error || '留下这一版失败' }
  }
  return {
    ok: true,
    etag: response.headers.get('etag') || '',
    snapshotCount: Array.isArray(payload.snapshots) ? payload.snapshots.length : 0,
  }
}
