import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm?url'

const DB_PATH = '/snowflake-recovery.sqlite3'
const VFS_NAME = 'opfs-sahpool'

type InitWithLocate = (options?: {
  locateFile?: (path: string, prefix?: string) => string
}) => Promise<Sqlite3Static>

type Request =
  | { id: number; op: 'open' }
  | { id: number; op: 'read' }
  | { id: number; op: 'write'; bytes: ArrayBuffer }
  | { id: number; op: 'close' }

type Response = { id: number; ok: true; bytes: ArrayBuffer | null } | { id: number; ok: false; error: string }

let db: InstanceType<SAHPoolUtil['OpfsSAHPoolDb']> | null = null

function reply(message: Response, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

function copyBytes(value: unknown): Uint8Array | null {
  if (value == null) return null
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength))
  }
  return null
}

async function openDb(): Promise<void> {
  if (db) return
  const sqlite3 = await (sqlite3InitModule as InitWithLocate)({
    locateFile(path) {
      if (path.endsWith('.wasm')) return wasmUrl
      return path
    },
  })
  const pool = await sqlite3.installOpfsSAHPoolVfs({
    name: VFS_NAME,
    directory: '.snowflake-recovery',
  })
  if (pool.vfsName !== VFS_NAME) {
    throw new Error('恢复日志不可用')
  }
  db = new pool.OpfsSAHPoolDb(DB_PATH)
  db.exec(`CREATE TABLE IF NOT EXISTS recovery (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    body BLOB NOT NULL
  )`)
}

function readBytes(): ArrayBuffer | null {
  if (!db) throw new Error('恢复日志不可用')
  const value = db.selectValue('SELECT body FROM recovery WHERE id = 1')
  const bytes = copyBytes(value)
  if (!bytes) return null
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function writeBytes(bytes: ArrayBuffer): void {
  if (!db) throw new Error('恢复日志不可用')
  const copy = new Uint8Array(bytes)
  db.exec({
    sql: `INSERT INTO recovery(id, body) VALUES(1, ?)
      ON CONFLICT(id) DO UPDATE SET body = excluded.body`,
    bind: [copy],
  })
}

self.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data
  void (async () => {
    try {
      if (message.op === 'open') {
        await openDb()
        reply({ id: message.id, ok: true, bytes: null })
        return
      }
      if (message.op === 'read') {
        const bytes = readBytes()
        reply({ id: message.id, ok: true, bytes }, bytes ? [bytes] : [])
        return
      }
      if (message.op === 'write') {
        writeBytes(message.bytes)
        reply({ id: message.id, ok: true, bytes: null })
        return
      }
      db?.close()
      db = null
      reply({ id: message.id, ok: true, bytes: null })
    } catch (error) {
      const text = error instanceof Error ? error.message : '恢复日志不可用'
      reply({ id: message.id, ok: false, error: text })
    }
  })()
}
