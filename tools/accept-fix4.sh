#!/usr/bin/env bash
# 修复 4 验收：两个标签同时改不同卡片时，后写的人不得用旧快照盖掉先写的人。
# 临时端口只提供页面。浏览器拦截全部请求，正本在内存里模拟 If-Match。不碰 8093。
# 失败打印 ACCEPT_FIX4_RED 并以非 0 退出。成功时最后一行恰好是 ACCEPT_FIX4_OK。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [ -n "${FIX4_PORT:-}" ]; then
  PORT="${FIX4_PORT}"
else
  PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
fi
if [ "${PORT}" = "8093" ]; then
  echo "ACCEPT_FIX4_RED 禁止使用 8093" >&2
  exit 1
fi

export ROOT PORT
DEV_PID=""
cleanup() {
  if [ -n "${DEV_PID}" ]; then
    kill "${DEV_PID}" 2>/dev/null || true
    wait "${DEV_PID}" 2>/dev/null || true
    DEV_PID=""
  fi
}
trap cleanup EXIT

node_modules/.bin/vite --host 127.0.0.1 --port "${PORT}" --strictPort >/tmp/accept-fix4-vite.log 2>&1 &
DEV_PID=$!
ready=0
for _ in $(seq 1 80); do
  if node --input-type=module -e 'try { const r = await fetch(process.argv[1]); process.exit(r.ok ? 0 : 1) } catch { process.exit(1) }' "http://127.0.0.1:${PORT}/xuehua/"; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "${ready}" -ne 1 ]; then
  echo "ACCEPT_FIX4_RED 临时页面起不来 port=${PORT}" >&2
  tail -n 30 /tmp/accept-fix4-vite.log >&2 || true
  exit 1
fi

node --input-type=module << 'JS'
import { chromium } from 'playwright'

const port = process.env.PORT
const base = `http://127.0.0.1:${port}/xuehua/`
const seed = {
  canvas: {
    nodes: [
      { id: 'c1', type: 'text', x: 40, y: 40, width: 220, height: 120, text: '甲' },
      { id: 'c2', type: 'text', x: 360, y: 40, width: 220, height: 120, text: '乙' },
    ],
    edges: [],
  },
  snowflake: {
    fileId: 'fix4-file',
    cards: {
      c1: { id: 'c1', layer: 'situation', fields: {}, body: '甲' },
      c2: { id: 'c2', layer: 'situation', fields: {}, body: '乙' },
    },
  },
}

function fail(detail) {
  console.error(`ACCEPT_FIX4_RED ${detail}`)
  process.exit(1)
}

const memory = {
  doc: structuredClone(seed),
  etag: 'W/"1"',
  puts: [],
}

function cardBlob(id) {
  const card = memory.doc?.snowflake?.cards?.[id]
  const node = (memory.doc?.canvas?.nodes ?? []).find((item) => item.id === id)
  return JSON.stringify({ card, node })
}

async function handle(route) {
  const request = route.request()
  const url = request.url()
  const method = request.method()
  if (url.includes('/api/canvas') && !url.includes('/api/canvas/') && method === 'GET') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { ETag: memory.etag },
      body: JSON.stringify({ document: memory.doc }),
    })
    return
  }
  if (url.includes('/api/canvas') && !url.includes('/api/canvas/') && method === 'PUT') {
    const ifMatch = request.headers()['if-match'] || ''
    const raw = request.postData() || '{}'
    if (ifMatch !== memory.etag) {
      memory.puts.push({ ifMatch, status: 412, etag: memory.etag, body: raw.slice(0, 240) })
      await route.fulfill({
        status: 412,
        contentType: 'application/json',
        headers: { ETag: memory.etag },
        body: JSON.stringify({ error: 'conflict' }),
      })
      return
    }
    let next
    try {
      next = JSON.parse(raw)
    } catch {
      await route.fulfill({ status: 400, body: 'bad json' })
      return
    }
    const version = Number(String(memory.etag).replace(/\D/g, '')) + 1
    memory.doc = next
    memory.etag = `W/"${version}"`
    memory.puts.push({ ifMatch, status: 200, etag: memory.etag, c1: cardBlob('c1'), c2: cardBlob('c2') })
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
}

const browser = await chromium.launch({
  headless: true,
  executablePath: `${process.env.HOME || ''}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  args: ['--no-sandbox'],
})

async function openPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.route('**/*', handle)
  const page = await context.newPage()
  await page.goto(base, { waitUntil: 'networkidle' })
  const deadline = Date.now() + 12000
  let status = ''
  while (Date.now() < deadline) {
    status = await page.locator('.status-line').allTextContents().then((items) => items.join(' | ')).catch(() => '')
    const cards = await page.locator('.react-flow__node').count()
    if (status.includes('正本在服务器') && status.includes('版本 1') && cards >= 2) break
    await page.waitForTimeout(100)
  }
  if (!status.includes('正本在服务器')) {
    const body = await page.locator('body').innerText().catch(() => '')
    fail(`没有进入正本在服务器 status=${JSON.stringify(status)} body=${JSON.stringify(body.slice(0, 300))}`)
  }
  return page
}

async function replaceBody(page, title, next) {
  const node = page.locator('.react-flow__node').filter({ has: page.locator('.snow-title', { hasText: title }) }).first()
  const box = await node.boundingBox()
  if (!box) fail(`找不到卡片 ${title}`)
  await page.mouse.click(box.x + box.width / 2, box.y + 28)
  const editor = page.locator('.cm-content')
  await editor.click()
  const readyDeadline = Date.now() + 4000
  let shown = ''
  let editable = null
  while (Date.now() < readyDeadline) {
    shown = ((await editor.innerText().catch(() => '')) || '').replace(/\s+/g, '')
    editable = await editor.getAttribute('contenteditable')
    if (editable === 'true' && shown.includes(title)) break
    await page.waitForTimeout(80)
  }
  if (editable !== 'true' || !shown.includes(title)) {
    fail(`编辑器没打开 ${title} editable=${editable} shown=${JSON.stringify(shown)}`)
  }
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText(next)
  const wroteDeadline = Date.now() + 2500
  while (Date.now() < wroteDeadline) {
    const text = ((await editor.innerText().catch(() => '')) || '').replace(/\s+/g, '')
    if (text.includes(next)) return text
    await page.waitForTimeout(80)
  }
  const text = ((await editor.innerText().catch(() => '')) || '').replace(/\s+/g, '')
  fail(`编辑器没写成 ${next}，现在是 ${JSON.stringify(text)}`)
}

async function waitUntil(pred, timeout, label) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (pred()) return
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  fail(`${label} 超时 etag=${memory.etag} c1=${cardBlob('c1')} c2=${cardBlob('c2')} puts=${JSON.stringify(memory.puts)}`)
}

const pageA = await openPage()
const pageB = await openPage()
await replaceBody(pageA, '乙', '乙乙')
await waitUntil(() => cardBlob('c2').includes('乙乙') && memory.etag !== 'W/"1"', 8000, '页 A 写入')
const afterA = memory.etag
const putsAfterA = memory.puts.length

await replaceBody(pageB, '甲', '甲甲')
await waitUntil(() => memory.puts.length > putsAfterA, 8000, '页 B 尝试写入')
const quietStart = Date.now()
let lastPuts = memory.puts.length
let lastChange = Date.now()
while (Date.now() - quietStart < 8000) {
  if (memory.puts.length !== lastPuts) {
    lastPuts = memory.puts.length
    lastChange = Date.now()
  }
  const writing = await pageB.locator('.status-line', { hasText: '正在写入' }).count()
  if (writing === 0 && Date.now() - lastChange > 600) break
  await pageB.waitForTimeout(80)
}

const c1 = cardBlob('c1')
const c2 = cardBlob('c2')
const notice = (await pageB.locator('.status-line').allTextContents()).join(' | ')
const merged = c1.includes('甲甲') && c2.includes('乙乙')
const prompted = c2.includes('乙乙') && c1.includes('甲') && !c1.includes('甲甲') && notice.includes('版本已更新，请再试')
await browser.close()
if (merged || prompted) {
  console.log('ACCEPT_FIX4_OK')
  process.exit(0)
}
fail(`正本被盖或没有提示 c1=${c1} c2=${c2} notice=${JSON.stringify(notice)} etagA=${afterA} etag=${memory.etag} puts=${JSON.stringify(memory.puts)}`)
JS
