import { bookScopedPath } from './books.ts'

export interface StoredAsset {
  relativePath: string
  size: number
  name: string
}

function assetApi(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}${bookScopedPath(path)}`
}

export function assetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '')
  return assetApi(`/api/assets/${clean}`)
}

export async function uploadAsset(file: File): Promise<StoredAsset> {
  const body = new FormData()
  body.append('file', file, file.name)
  const response = await fetch(assetApi('/api/assets'), { method: 'POST', body, cache: 'no-store' })
  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown
    relativePath?: unknown
    size?: unknown
    name?: unknown
  }
  if (!response.ok || typeof payload.relativePath !== 'string' || !payload.relativePath) {
    const message = typeof payload.error === 'string' && payload.error ? payload.error : '文件没有收下'
    throw new Error(message)
  }
  const size = typeof payload.size === 'number' && Number.isFinite(payload.size) ? payload.size : file.size
  const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : file.name
  return { relativePath: payload.relativePath, size, name }
}
