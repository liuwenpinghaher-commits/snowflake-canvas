import type { RecoveryLog } from './persist.ts'

type WorkerCall =
  | { op: 'open' }
  | { op: 'read' }
  | { op: 'write'; bytes: ArrayBuffer }
  | { op: 'close' }

type WorkerRequest = WorkerCall & { id: number }

type WorkerResponse = { id: number; ok: true; bytes: ArrayBuffer | null } | { id: number; ok: false; error: string }

type Waiter = { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }

const REPLY_TIMEOUT_MS = 15_000

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('恢复日志不可用')
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { id?: unknown; ok?: unknown; error?: unknown }
  if (typeof record.id !== 'number' || !Number.isInteger(record.id)) return false
  if (record.ok === true) return true
  return record.ok === false && typeof record.error === 'string'
}

export function openSahPoolRecoveryLog(): Promise<RecoveryLog> {
  const worker = new Worker(new URL('./persist-log-worker.ts', import.meta.url), { type: 'module' })
  let nextId = 1
  const pending = new Map<number, Waiter>()
  const settled = new Set<number>()

  const take = (id: number): Waiter | null => {
    const waiter = pending.get(id)
    if (!waiter) return null
    pending.delete(id)
    settled.add(id)
    return waiter
  }

  const failAll = (error: Error) => {
    const waiters = [...pending.entries()]
    pending.clear()
    for (const [id, waiter] of waiters) {
      settled.add(id)
      waiter.reject(error)
    }
  }

  worker.onerror = (event) => {
    failAll(new Error(event.message || '恢复日志不可用'))
  }

  worker.onmessageerror = () => {
    failAll(new Error('恢复日志不可用'))
  }

  worker.onmessage = (event: MessageEvent<unknown>) => {
    if (!isWorkerResponse(event.data)) {
      failAll(new Error('恢复日志不可用'))
      return
    }
    const data = event.data
    const waiter = take(data.id)
    if (!waiter) {
      if (!settled.has(data.id)) failAll(new Error('恢复日志不可用'))
      return
    }
    if (!data.ok) {
      waiter.reject(new Error(data.error || '恢复日志不可用'))
      return
    }
    waiter.resolve(data)
  }

  const call = (body: WorkerCall, transfer: Transferable[] = []) => {
    const id = nextId
    nextId += 1
    const request: WorkerRequest = { ...body, id }
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiter = take(id)
        if (!waiter) return
        waiter.reject(new Error('恢复日志不可用'))
      }, REPLY_TIMEOUT_MS)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        worker.postMessage(request, transfer)
      } catch (error) {
        const waiter = take(id)
        waiter?.reject(asError(error))
      }
    }).then((response) => {
      if (!response.ok) throw new Error(response.error || '恢复日志不可用')
      return response
    })
  }

  return call({ op: 'open' }).then(
    () => ({
      async read() {
        const response = await call({ op: 'read' })
        return response.bytes ? new Uint8Array(response.bytes) : null
      },
      async write(bytes: Uint8Array) {
        const buffer = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(buffer).set(bytes)
        await call({ op: 'write', bytes: buffer }, [buffer])
      },
      async close() {
        try {
          await call({ op: 'close' })
        } finally {
          worker.terminate()
        }
      },
    }),
    (error) => {
      worker.terminate()
      throw asError(error)
    },
  )
}
