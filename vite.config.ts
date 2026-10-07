import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect } from 'vite'

const EXPAND_PROXY_PATH = '/__snowflake/expand'
const EXPAND_UPSTREAM_HOST = '127.0.0.1'
const EXPAND_UPSTREAM_PORT = 18100
const EXPAND_UPSTREAM_PATH = '/v1/chat/completions'
const EXPAND_BODY_LIMIT = 1_000_000

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function readExpandKey(): string | undefined {
  const value = process.env.CPA_API_KEY
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value
}

function finish(res: ServerResponse, status: number): void {
  if (res.writableEnded) return
  if (!res.headersSent) res.statusCode = status
  res.end()
}

function proxyExpand(req: IncomingMessage, res: ServerResponse): void {
  if (!isLoopback(req.socket.remoteAddress)) {
    finish(res, 403)
    return
  }
  if (req.method !== 'POST') {
    finish(res, 405)
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
      finish(res, 413)
      req.destroy()
      return
    }
    chunks.push(buf)
  })
  req.on('error', () => {
    finish(res, 400)
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
    upstream.setTimeout(60_000, () => {
      upstream.destroy()
      finish(res, 504)
    })
    upstream.on('error', () => {
      finish(res, 502)
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

export default defineConfig({
  plugins: [react(), snowflakeExpandProxy()],
  server: {
    host: '127.0.0.1',
  },
  preview: {
    host: '127.0.0.1',
  },
})
