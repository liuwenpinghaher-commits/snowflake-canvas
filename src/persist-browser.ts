import {
  CANONICAL_NAME,
  type ChannelBus,
  type ChannelMessage,
  type ClaimStore,
  type DirectoryAccess,
  type LockHandle,
  type PersistPorts,
  type RecoveryLog,
} from './persist.ts'

const HANDLE_DB = 'snowflake-canvas'
const HANDLE_STORE = 'handles'
const DIRECTORY_KEY = 'directory'
const CLAIM_KEY = 'snowflake-write-claim'

type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>

function directoryPicker(win: Window): DirectoryPicker | undefined {
  const picker = (win as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  return typeof picker === 'function' ? picker : undefined
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'NotFoundError'
}

export async function readNamed(directory: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | null> {
  try {
    const handle = await directory.getFileHandle(name)
    const file = await handle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

export async function writeTempBytes(
  directory: FileSystemDirectoryHandle,
  tempName: string,
  bytes: Uint8Array,
): Promise<void> {
  if (tempName === CANONICAL_NAME || !tempName.startsWith('.') || !tempName.endsWith('.tmp')) {
    throw new Error('只写临时文件')
  }
  const tempHandle = await directory.getFileHandle(tempName, { create: true })
  // 禁止对正本调用 createWritable。那条默认会先清空已有文件。这里只写临时文件，正本靠 move 替换。
  const sink = await tempHandle.createWritable()
  const payload = copyBytes(bytes)
  try {
    await sink.write(payload)
  } finally {
    await sink.close()
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(bytes.byteLength)
  const copy = new Uint8Array(buffer)
  copy.set(bytes)
  return copy
}

export async function moveTempOntoCanonical(
  directory: FileSystemDirectoryHandle,
  tempName: string,
  canonicalName: string,
): Promise<void> {
  const tempHandle = await directory.getFileHandle(tempName)
  const move = (
    tempHandle as FileSystemFileHandle & {
      move?: (parent: FileSystemDirectoryHandle, name: string) => Promise<void>
    }
  ).move
  if (typeof move !== 'function') throw new Error('move missing')
  await move.call(tempHandle, directory, canonicalName)
}

async function removeNamed(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await directory.removeEntry(name)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
}

async function listNames(directory: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = []
  for await (const [name] of directory.entries()) names.push(name)
  return names
}

function accessFromHandle(directory: FileSystemDirectoryHandle): DirectoryAccess {
  return {
    read: (name) => readNamed(directory, name),
    writeTemp: (name, bytes) => writeTempBytes(directory, name, bytes),
    move: (tempName, canonicalName) => moveTempOntoCanonical(directory, tempName, canonicalName),
    remove: (name) => removeNamed(directory, name),
    listNames: () => listNames(directory),
  }
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
  })
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openHandleDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB get failed'))
  })
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openHandleDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'))
  })
}

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

function isDirectoryHandle(value: unknown): value is PermissionHandle {
  return typeof value === 'object' && value !== null && 'getFileHandle' in value
}

function browserClaim(): ClaimStore {
  return {
    get() {
      try {
        return sessionStorage.getItem(CLAIM_KEY)
      } catch {
        return null
      }
    },
    set(fileId: string) {
      try {
        sessionStorage.setItem(CLAIM_KEY, fileId)
      } catch {
        // 本标签记不住接手标记时，刷新后保持只读，等作者再点「改由本页写入」。
      }
    },
  }
}

function browserChannel(): ChannelBus {
  const channel = new BroadcastChannel('snowflake-canvas-write')
  const listeners = new Set<(message: ChannelMessage) => void>()
  channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
    const data = event.data
    if (!data || (data.type !== 'writing' && data.type !== 'hello')) return
    for (const listener of [...listeners]) listener(data)
  }
  return {
    post(message) {
      channel.postMessage(message)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function tryAcquireLock(name: string): Promise<LockHandle | null> {
  const locks = navigator.locks
  if (!locks) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    locks
      .request(name, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null)
          return undefined
        }
        let release = () => {}
        const held = new Promise<void>((done) => {
          release = () => done()
        })
        resolve({ release })
        return held
      })
      .catch(reject)
  })
}

async function lockHeld(name: string): Promise<boolean> {
  if (!navigator.locks?.query) return false
  const state = await navigator.locks.query()
  return (state.held ?? []).some((item) => item.name === name)
}

export function triggerDownload(fileName: string, bytes: Uint8Array): void {
  const blob = new Blob([copyBytes(bytes)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}


const EXPAND_PROXY_PATH = '/__snowflake/expand'

function browserExpandFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (window.location.hostname !== '127.0.0.1') {
    return Promise.reject(new TypeError('扩写只允许本机'))
  }
  let target: URL
  try {
    target = new URL(String(input), window.location.origin)
  } catch {
    return Promise.reject(new TypeError('扩写只允许本机'))
  }
  if (target.hostname !== '127.0.0.1' || target.port !== '18100') {
    return Promise.reject(new TypeError('扩写只允许本机'))
  }
  const headers = new Headers(init?.headers)
  headers.delete('Authorization')
  return fetch(new URL(EXPAND_PROXY_PATH, window.location.origin), {
    method: init?.method ?? 'POST',
    headers,
    body: init?.body ?? null,
    redirect: 'manual',
  })
}

export function createBrowserPorts(ui: {
  openLog: () => Promise<RecoveryLog>
  askSaveAs: (fileName: string, bytes: Uint8Array) => Promise<boolean>
  askFirstDownload: (fileName: string, bytes: Uint8Array) => Promise<boolean>
  askSnapshotDownload: (fileName: string, bytes: Uint8Array) => Promise<boolean>
}): PersistPorts {
  let handle: PermissionHandle | null = null

  async function loadHandle(): Promise<PermissionHandle | null> {
    if (handle) return handle
    try {
      const stored = await idbGet(DIRECTORY_KEY)
      if (!isDirectoryHandle(stored)) return null
      handle = stored
      return handle
    } catch {
      return null
    }
  }

  return {
    protocol: window.location.protocol,
    hasDirectoryPicker: directoryPicker(window) !== undefined,
    now: () => new Date(),
    loadDirectory: async () => {
      const stored = await loadHandle()
      return stored ? accessFromHandle(stored) : null
    },
    pickDirectory: async () => {
      const picker = directoryPicker(window)
      if (!picker) return 'abort'
      try {
        const picked = await picker({ mode: 'readwrite', id: 'snowflake-canonical' })
        handle = picked as PermissionHandle
        await idbPut(DIRECTORY_KEY, picked)
        return accessFromHandle(picked)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return 'abort'
        throw error
      }
    },
    queryPermission: async () => {
      const stored = await loadHandle()
      if (!stored) return 'denied'
      const result = await stored.queryPermission({ mode: 'readwrite' })
      return result === 'granted' || result === 'prompt' ? result : 'denied'
    },
    requestPermission: async () => {
      const stored = await loadHandle()
      if (!stored) return 'denied'
      const result = await stored.requestPermission({ mode: 'readwrite' })
      return result === 'granted' || result === 'prompt' ? result : 'denied'
    },
    logFactory: () => ui.openLog(),
    tryAcquireLock,
    lockHeld,
    channel: browserChannel(),
    claim: browserClaim(),
    askSaveAs: ui.askSaveAs,
    askFirstDownload: ui.askFirstDownload,
    askSnapshotDownload: ui.askSnapshotDownload,
    expand: {
      apiKey: () => undefined,
      fetch: browserExpandFetch,
    },
    randomId: () => crypto.randomUUID(),
  }
}
