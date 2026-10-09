import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect } from 'vite'

const EXPAND_PROXY_PATH = '/__snowflake/expand'
const EXPAND_UPSTREAM_HOST = '127.0.0.1'
const EXPAND_UPSTREAM_PORT = 18100
const EXPAND_UPSTREAM_PATH = '/v1/chat/completions'
const EXPAND_BODY_LIMIT = 1_000_000
const EXPAND_TIMEOUT_MS = 60_000
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EADDRNOTAVAIL', 'ECONNRESET'])

function readExpandKey(): string | undefined {
  const value = process.env.CPA_API_KEY
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value
}

function finish(res: ServerResponse, status: number, error: string): void {
  if (res.writableEnded) return
  if (!res.headersSent) {
    const body = JSON.stringify({ error })
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    res.end(body)
    return
  }
  res.end()
}

function upstreamReason(error: NodeJS.ErrnoException): string {
  const code = typeof error.code === 'string' ? error.code : ''
  const where = `${EXPAND_UPSTREAM_HOST}:${EXPAND_UPSTREAM_PORT}`
  if (UNREACHABLE_CODES.has(code)) return `连不上扩写服务（${where}，${code}）`
  return `扩写服务连接出错（${where}${code ? `，${code}` : ''}）`
}

function proxyExpand(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    finish(res, 405, '扩写只接受 POST 请求')
    return
  }
  const chunks: Buffer[] = []
  let size = 0
  let rejected = false
  req.on('data', (chunk: Buffer | string) => {
    if (rejected || res.writableEnded) return
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buf.length
    if (size > EXPAND_BODY_LIMIT) {
      rejected = true
      finish(res, 413, '扩写请求超过 1MB，没有转发')
      req.destroy()
      return
    }
    chunks.push(buf)
  })
  req.on('error', () => {
    finish(res, 400, '扩写请求没有读完')
  })
  req.on('end', () => {
    if (rejected || res.writableEnded) return
    const body = Buffer.concat(chunks)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(body.length),
      Host: `${EXPAND_UPSTREAM_HOST}:${EXPAND_UPSTREAM_PORT}`,
    }
    const key = readExpandKey()
    if (key) headers.Authorization = `Bearer ${key}`
    const upstream = httpRequest(
      {
        hostname: EXPAND_UPSTREAM_HOST,
        port: EXPAND_UPSTREAM_PORT,
        path: EXPAND_UPSTREAM_PATH,
        method: 'POST',
        headers,
      },
      (up) => {
        if (res.writableEnded) {
          up.resume()
          return
        }
        res.statusCode = up.statusCode ?? 502
        const contentType = up.headers['content-type']
        if (typeof contentType === 'string') res.setHeader('Content-Type', contentType)
        up.pipe(res)
      },
    )
    let timedOut = false
    upstream.setTimeout(EXPAND_TIMEOUT_MS, () => {
      timedOut = true
      upstream.destroy()
      finish(res, 504, `扩写服务 ${EXPAND_TIMEOUT_MS / 1000} 秒没有回复，超时`)
    })
    upstream.on('error', (error: NodeJS.ErrnoException) => {
      if (!timedOut) finish(res, 502, upstreamReason(error))
    })
    upstream.end(body)
  })
}

function snowflakeExpandProxy() {
  const attach = (middlewares: Connect.Server) => {
    middlewares.use(EXPAND_PROXY_PATH, (req, res) => {
      proxyExpand(req, res)
    })
  }
  return {
    name: 'snowflake-expand-proxy',
    configureServer(server: { middlewares: Connect.Server }) {
      attach(server.middlewares)
    },
    configurePreviewServer(server: { middlewares: Connect.Server }) {
      attach(server.middlewares)
    },
  }
}


// base 只改页面里的地址。静态服务把 dist 当根，不会剥掉 /xuehua/，
// 所以再复制一份到 dist/xuehua，反代才能按浏览器原始路径把文件转过去。
function publishUnderBase() {
  return {
    name: 'publish-under-base',
    apply: 'build' as const,
    closeBundle(): void {
      const dist = join(process.cwd(), 'dist')
      const nested = join(dist, 'xuehua')
      rmSync(nested, { recursive: true, force: true })
      mkdirSync(nested, { recursive: true })
      for (const name of readdirSync(dist)) {
        if (name === 'xuehua') continue
        cpSync(join(dist, name), join(nested, name), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  base: '/xuehua/',
  plugins: [react(), snowflakeExpandProxy(), publishUnderBase()],
  server: {
    host: '127.0.0.1',
  },
  preview: {
    host: '127.0.0.1',
  },
})
