export const MSG_STASHED_LOCAL = '暂存在本机'

export interface StashLog {
  chunks: string[]
}

export function createStash(): StashLog {
  return { chunks: [] }
}

export function stashText(log: StashLog, text: string): string {
  log.chunks.push(text)
  return MSG_STASHED_LOCAL
}

export function replayStash(log: StashLog): string {
  return log.chunks[log.chunks.length - 1] ?? ''
}
