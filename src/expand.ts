import { editorText, frontText, type AppState, type Card } from './document.ts'

export const EXPAND_MODEL = 'deepseek-flash'
export const DEFAULT_EXPAND_URL = 'http://127.0.0.1:18100/v1/chat/completions'
export const MSG_CANDIDATE_MISS = '候选没取到'
export const MSG_EXPAND_UNREACHABLE = '连不上扩写服务'
export const MSG_EXPAND_TIMEOUT = '扩写请求超时，没等到回复'
export const MSG_EXPAND_TARGET = '扩写地址不是本机 127.0.0.1:18100，请求没有发出'
export const MSG_EXPAND_UNUSABLE = '扩写返回的内容不可用'
export const MSG_EXPAND_NO_CARD = '这张卡片已经不在，没有扩写'
export const EXPAND_TIMEOUT_MS = 70_000

export interface ExpandRequest {
  cardId: string
  layer: string
  text: string
  parentSummary: string
  neighborSummaries: string[]
}

export interface ExpandCandidate {
  id: string
  text: string
}

export interface ShownCandidate extends ExpandCandidate {
  cardId: string
  fieldKey: string | null
}

export interface ExpandClientOptions {
  baseURL?: string
  apiKey?: () => string | undefined
  fetch?: typeof fetch
  connect?: () => void
  maxTokens?: number
  timeoutMs?: number
}

export type ExpandResult = { ok: true; candidates: ExpandCandidate[] } | { ok: false; reason: string }

const EXPAND_SYSTEM = [
  '你只根据用户消息里的这一张卡片写候选。',
  '用户消息是 JSON，只有 cardId、layer、text、parentSummary、neighborSummaries。',
  '只回复 JSON：{"candidates":[{"id":"c1","text":"候选正文"}]}。',
  '可以给一条到三条。text 是尚未写回卡片的文字。',
  '不要加入其它字段。',
].join('')

export function readCpaApiKey(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  const value = proc?.env?.['CPA_API_KEY']
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value
}

export function expandTargetAllowed(baseURL: string): boolean {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.hostname !== '127.0.0.1') return false
  if (url.port !== '18100') return false
  return true
}

export function cardSummary(card: Card): string {
  const front = frontText(card).trim()
  if (front) return front
  return [...card.body.trim()].slice(0, 40).join('')
}

export function buildExpandRequest(
  state: AppState,
  cardId: string,
  fieldKey: string | null,
): ExpandRequest | null {
  const card = state.snowflake.cards[cardId]
  if (!card) return null
  const parentEdge = state.canvas.edges.find(
    (edge) => edge.toNode === cardId && state.snowflake.cards[edge.fromNode],
  )
  const parent = parentEdge ? state.snowflake.cards[parentEdge.fromNode] : undefined
  const placed = Object.entries(state.snowflake.cards)
    .filter(([, item]) => item.layer === card.layer)
    .map(([id, item]) => {
      const node = state.canvas.nodes.find((entry) => entry.id === id)
      return { id, item, x: node?.x ?? 0, y: node?.y ?? 0 }
    })
    .sort((left, right) => left.x - right.x || left.y - right.y || left.id.localeCompare(right.id))
  const index = placed.findIndex((item) => item.id === cardId)
  const neighbors: { item: Card }[] = []
  if (index > 0) neighbors.push(placed[index - 1])
  if (index >= 0 && index < placed.length - 1) neighbors.push(placed[index + 1])
  return {
    cardId,
    layer: card.layer,
    text: editorText(card, fieldKey),
    parentSummary: parent ? cardSummary(parent) : '',
    neighborSummaries: neighbors.map((item) => cardSummary(item.item)).filter((text) => text.length > 0),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expandUserContent(input: ExpandRequest): string {
  return JSON.stringify({
    cardId: input.cardId,
    layer: input.layer,
    text: input.text,
    parentSummary: input.parentSummary,
    neighborSummaries: input.neighborSummaries,
  })
}

export function expandChatBody(input: ExpandRequest, maxTokens: number): {
  model: typeof EXPAND_MODEL
  messages: { role: 'system' | 'user'; content: string }[]
  max_tokens: number
  thinking: { type: 'disabled' }
} {
  return {
    model: EXPAND_MODEL,
    messages: [
      { role: 'system', content: EXPAND_SYSTEM },
      { role: 'user', content: expandUserContent(input) },
    ],
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
  }
}

function stripFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() ?? trimmed
}

function asCandidates(value: unknown): ExpandCandidate[] | null {
  if (!isRecord(value) || !Array.isArray(value.candidates) || value.candidates.length === 0) return null
  const out: ExpandCandidate[] = []
  const used = new Set<string>()
  for (const item of value.candidates) {
    if (!isRecord(item) || typeof item.text !== 'string' || item.text.length === 0) return null
    let id = typeof item.id === 'string' && item.id.trim().length > 0 ? item.id.trim() : `c${out.length + 1}`
    let unique = id
    let extra = 2
    while (used.has(unique)) {
      unique = `${id}-${extra}`
      extra += 1
    }
    used.add(unique)
    out.push({ id: unique, text: item.text })
  }
  return out
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function shapeModelText(content: string): ExpandCandidate[] | null {
  const trimmed = stripFence(content).trim()
  if (!trimmed) return null
  const parsed = tryParse(trimmed)
  if (parsed !== undefined && isRecord(parsed) && 'candidates' in parsed) return asCandidates(parsed)
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const embedded = tryParse(trimmed.slice(start, end + 1))
    if (embedded !== undefined && isRecord(embedded) && 'candidates' in embedded) return asCandidates(embedded)
  }
  return [{ id: 'c1', text: trimmed }]
}

function readContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const part of content) {
    if (typeof part === 'string') parts.push(part)
    else if (isRecord(part) && typeof part.text === 'string') parts.push(part.text)
  }
  if (parts.length === 0) return null
  return parts.join('')
}

export function candidatesFromProxyPayload(payload: unknown): ExpandCandidate[] | null {
  if (isRecord(payload) && 'candidates' in payload && !('choices' in payload)) return asCandidates(payload)
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) return null
  const message = payload.choices[0].message
  if (!isRecord(message)) return null
  const content = readContent(message.content)
  if (content === null) return null
  return shapeModelText(content)
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false
  const name = (error as { name: unknown }).name
  return name === 'TimeoutError' || name === 'AbortError'
}

function errorText(payload: unknown): string {
  if (!isRecord(payload)) return ''
  const error = payload.error
  if (typeof error === 'string') return error.trim()
  if (isRecord(error) && typeof error.message === 'string') return error.message.trim()
  return ''
}

async function statusReason(response: Response): Promise<string> {
  let detail = ''
  try {
    const text = await response.text()
    detail = errorText(tryParse(text))
  } catch {
    detail = ''
  }
  const head = `扩写服务返回 HTTP ${response.status}`
  return detail ? `${head}：${[...detail].slice(0, 200).join('')}` : head
}

export async function requestExpandCandidates(
  input: ExpandRequest,
  options: ExpandClientOptions = {},
): Promise<ExpandResult> {
  const baseURL = options.baseURL ?? DEFAULT_EXPAND_URL
  if (!expandTargetAllowed(baseURL)) return { ok: false, reason: MSG_EXPAND_TARGET }
  options.connect?.()
  const fetchImpl = options.fetch ?? globalThis.fetch
  const apiKey = options.apiKey ? options.apiKey() : readCpaApiKey()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const timeoutMs = options.timeoutMs ?? EXPAND_TIMEOUT_MS
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
  let response: Response
  try {
    response = await fetchImpl(baseURL, {
      method: 'POST',
      headers,
      body: JSON.stringify(expandChatBody(input, options.maxTokens ?? 800)),
      redirect: 'manual',
      signal,
    })
  } catch (error) {
    return { ok: false, reason: isTimeout(error) ? MSG_EXPAND_TIMEOUT : MSG_EXPAND_UNREACHABLE }
  }
  if (!response.ok) return { ok: false, reason: await statusReason(response) }
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    return { ok: false, reason: isTimeout(error) ? MSG_EXPAND_TIMEOUT : MSG_EXPAND_UNREACHABLE }
  }
  const payload = tryParse(text)
  if (payload === undefined) return { ok: false, reason: MSG_EXPAND_UNUSABLE }
  const candidates = candidatesFromProxyPayload(payload)
  if (!candidates) return { ok: false, reason: MSG_CANDIDATE_MISS }
  return { ok: true, candidates }
}
