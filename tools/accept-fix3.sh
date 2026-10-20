#!/usr/bin/env bash
# 修复 3 验收：场景表采纳一段讨论后，再改「视角」，这段还在正文或「采纳」字段里。
# 浏览器拦截全部接口，临时端口只提供页面，不碰 8093 正本。
# 成功时最后一行是 ACCEPT_FIX3_OK。没保住时打印 ACCEPT_FIX3_RED。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${FIX3_PORT:-8767}"
export ROOT PORT

node --input-type=module << 'JS'
import { chromium } from 'playwright'

const port = process.env.PORT
const base = `http://127.0.0.1:${port}/xuehua/`
const adopted = '门外那个人是弟弟，雪还没停。'
const seed = {
  canvas: {
    nodes: [
      { id: 'scene', type: 'text', x: 80, y: 80, width: 240, height: 140, text: '门口' },
    ],
    edges: [],
  },
  snowflake: {
    fileId: 'fix3-file',
    cards: {
      scene: {
        id: 'scene',
        layer: '场景表',
        fields: { pov: '', what: '雪还没停', words: '', chapter: '', title: '门口', conflict: '' },
        body: '视角：\n这一场发生什么：雪还没停\n预计字数：\n章号：\n标题（画布附加，不是雪花法原列）：门口\n冲突：',
      },
    },
  },
}

function fail(detail) {
  console.error(`ACCEPT_FIX3_RED ${detail}`)
  process.exit(1)
}

const memory = { doc: structuredClone(seed), etag: 'W/"1"', puts: 0 }
const browser = await chromium.launch({
  headless: true,
  executablePath: `${process.env.HOME || ''}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.route('**/*', async (route) => {
  const request = route.request()
  const url = request.url()
  const method = request.method()
  if (url.includes('/api/canvas') && method === 'GET') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ETag: memory.etag },
      body: JSON.stringify({ document: memory.doc }),
    })
    return
  }
  if (url.includes('/api/canvas') && method === 'PUT') {
    memory.puts += 1
    const version = Number(memory.etag.replace(/\D/g, '')) + 1
    memory.doc = JSON.parse(request.postData() || '{}')
    memory.etag = `W/"${version}"`
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ETag: memory.etag },
      body: JSON.stringify({ ok: true }),
    })
    return
  }
  if (url.includes('/api/discuss/session') && method === 'GET') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [{ sessionId: 's1', title: '念头讨论', createdAt: '2026-10-08T12:00:00.000Z', cardId: 'scene' }],
        sessionId: 's1',
      }),
    })
    return
  }
  if (url.includes('/api/discuss/messages') && method === 'GET') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          { role: 'user', content: '这场门口是谁', at: '2026-10-08T12:00:01.000Z' },
          { role: 'assistant', content: adopted, at: '2026-10-08T12:00:02.000Z' },
        ],
      }),
    })
    return
  }
  if (method !== 'GET') {
    await route.fulfill({ status: 204, body: '' })
    return
  }
  await route.continue()
})

await page.goto(base, { waitUntil: 'networkidle' })
const card = page.locator('.react-flow__node').first()
// 页面返回之后画布还要再画场景表卡。立刻数会把「还没画出来」误判成没有卡。
const nodeWaitMs = 15000
const nodeWaitStart = Date.now()
let sceneCardReady = false
try {
  await card.waitFor({ state: 'visible', timeout: nodeWaitMs })
  sceneCardReady = (await card.count()) >= 1
} catch {
  sceneCardReady = false
}
if (!sceneCardReady) {
  const waited = Date.now() - nodeWaitStart
  let title = ''
  let preview = ''
  try { title = await page.title() } catch { title = '' }
  try {
    preview = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 80)
  } catch {
    preview = ''
  }
  try { await browser.close() } catch { /* 超时后关掉浏览器，避免残留 */ }
  fail(`没有场景表卡 等了${waited}ms 标题=${JSON.stringify(title)} 正文前80=${JSON.stringify(preview)}`)
}
await card.dblclick()
const adopt = page.getByRole('button', { name: '采纳进本念头' }).last()
await adopt.waitFor({ timeout: 4000 })
await adopt.click()
await page.waitForTimeout(400)
const close = page.getByRole('button', { name: '关闭' })
if (await close.count()) await close.click()
await page.waitForTimeout(200)

const editor = page.locator('.cm-content')
await editor.click()
await page.keyboard.type('我', { delay: 30 })
await page.waitForTimeout(800)
const scene = memory.doc.snowflake?.cards?.scene
const body = scene?.body || ''
const fields = scene?.fields || {}
const blob = `${body}\n${Object.values(fields).join('\n')}`
await browser.close()
if (!blob.includes(adopted)) {
  fail(`采纳内容丢了 正文=${JSON.stringify(body)} 字段=${JSON.stringify(fields)} 写=${memory.puts}`)
}
console.log('ACCEPT_FIX3_OK')
JS
