#!/usr/bin/env bash
# 修复 1 验收：右侧编辑器快速连敲 AAA。
# 断言编辑器内容和落盘正文都是 AAA，焦点始终在编辑器。
# 浏览器拦截全部接口，临时端口只提供页面，不碰 8093 正本。
# 成功时最后一行是 ACCEPT_FIX1_OK。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${FIX1_PORT:-8765}"
export ROOT PORT

node --input-type=module << 'JS'
import { chromium } from 'playwright'

const port = process.env.PORT
const base = `http://127.0.0.1:${port}/xuehua/`
const seed = {
  canvas: {
    nodes: [
      { id: 'c1', type: 'text', x: 40, y: 40, width: 220, height: 120, text: '第一张' },
      { id: 'c2', type: 'text', x: 360, y: 40, width: 220, height: 120, text: '' },
    ],
    edges: [],
  },
  snowflake: {
    fileId: 'fix1-file',
    cards: {
      c1: { id: 'c1', layer: 'situation', fields: { body: '第一张' }, body: '第一张' },
      c2: { id: 'c2', layer: 'situation', fields: { body: '' }, body: '' },
    },
  },
}

function fail(detail) {
  console.error(`ACCEPT_FIX1_RED ${detail}`)
  process.exit(1)
}

const memory = { doc: structuredClone(seed), etag: 'W/"1"', puts: 0, gets: 0 }
const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/chris/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.route('**/*', async (route) => {
  const request = route.request()
  const url = request.url()
  const method = request.method()
  if (url.includes('/api/canvas') && method === 'GET') {
    memory.gets += 1
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
  if (method !== 'GET') {
    await route.fulfill({ status: 204, body: '' })
    return
  }
  await route.continue()
})

await page.goto(base, { waitUntil: 'networkidle' })
const cards = page.locator('.react-flow__node')
if ((await cards.count()) < 2) fail(`卡片数量 ${await cards.count()}`)
await cards.nth(1).click()
const editor = page.locator('.cm-content')
await editor.click()
const focusOf = () => page.evaluate(() => {
  const active = document.activeElement
  if (active && active.closest('.cm-content')) return 'editor'
  return active ? active.tagName : 'none'
})
if ((await focusOf()) !== 'editor') fail(`开敲前焦点不在编辑器: ${await focusOf()}`)
await page.keyboard.type('AAA', { delay: 15 })
await page.waitForTimeout(900)
const shown = (await editor.innerText()).replace(/\s+/g, '')
const focus = await focusOf()
let stored = ''
for (const card of Object.values(memory.doc.snowflake?.cards ?? {})) {
  const body = card.body || ''
  const fields = Object.values(card.fields || {}).join('')
  const blob = `${body}${fields}`
  if (blob.includes('A') && !blob.includes('第一张')) stored = blob
}
await browser.close()
if (shown !== 'AAA' || !stored.includes('AAA') || focus !== 'editor') {
  fail(`编辑器=${JSON.stringify(shown)} 落盘=${JSON.stringify(stored)} 焦点=${JSON.stringify(focus)} 读=${memory.gets} 写=${memory.puts}`)
}
console.log('ACCEPT_FIX1_OK')
JS
