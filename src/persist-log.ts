import type { RecoveryLog } from './persist.ts'

type WorkerCall =
  | { op: 'open' }
  | { op: 'read' }
  | { op: 'write'; bytes: ArrayBuffer }
  | { op: 'close' }

type WorkerRequest = WorkerCall & { id: number }

type WorkerResponse = { id: number; ok: true; bytes: ArrayBuffer | null } | { id: number; ok: false; error: string }

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('恢复日志不可用')
}

export function openSahPoolRecoveryLog(): Promise<RecoveryLog> {
  const worker = new Worker(new URL('./persist-log-worker.ts', import.meta.url), { type: 'module' })
  let nextId = 1
  const pending = new Map<number, { resolve: (value: WorkerResponse) => void; reject: (error: Error) => void }>()

  const failAll = (error: Error) => {
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  }

  worker.onerror = (event) => {
    failAll(new Error(event.message || '恢复日志不可用'))
  }

  const call = (body: WorkerCall, transfer: Transferable[] = []) => {
    const id = nextId
    nextId += 1
    const request: WorkerRequest = { ...body, id }
    return new Promise<WorkerResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.postMessage(request, transfer)
    }).then((response) => {
      if (!response.ok) throw new Error(response.error)
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
