export interface ObjectOp {
  op: 'text' | 'set'
  path: (string | number)[]
  start?: number
  deleteCount?: number
  insert?: string
  value?: unknown
  missing?: boolean
}
export function diffDocuments(before: unknown, after: unknown): ObjectOp[]
export function applyObjectOps(doc: unknown, ops: readonly ObjectOp[]): unknown
