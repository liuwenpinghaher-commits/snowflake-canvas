#!/usr/bin/env bash
# 第 5 批窄屏走查：320×720 下量画布高度、卡片是否在画布里、讨论面板和「发送」是否在视口内可点；
# 1280×800 下把画布缩小后再开讨论，量浮窗宽度和字号是否跟着缩放。
# 临时端口只提供页面，浏览器拦截全部接口，不碰 8093 正本和 session.json。
# 成功时最后一行是 BATCH5_NARROW_OK；数字写进 tools/batch5-narrow.json。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${BATCH5_PORT:-8771}"
SHOT="${BATCH5_SHOT:-$ROOT/.kanban-sentinels/t_aafc2e4b-320.png}"
export ROOT PORT SHOT

node_modules/.bin/vite --host 127.0.0.1 --port "${PORT}" --strictPort >/tmp/batch5-narrow-vite.log 2>&1 &
DEV_PID=$!
cleanup() {
  kill "${DEV_PID}" 2>/dev/null || true
  wait "${DEV_PID}" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/xuehua/"; then break; fi
  sleep 0.5
done

node --input-type=module << 'JS'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const base = `http://127.0.0.1:${process.env.PORT}/xuehua/`
const out = join(process.env.ROOT, 'tools', 'batch5-narrow.json')
// 卡片故意放在右下远处：不自动看全稿时，320 宽的画布里一张都看不到。
const seed = {
  canvas: {
    nodes: [
      { id: 'c1', type: 'text', x: 700, y: 520, width: 260, height: 120, text: '雪夜里有人敲门' },
      { id: 'c2', type: 'text', x: 1060, y: 520, width: 260, height: 120, text: '门外是失散的弟弟' },
      { id: 'c3', type: 'text', x: 880, y: 760, width: 260, height: 120, text: '两人决定天亮前离开' },
    ],
    edges: [{ id: 'e1', fromNode: 'c1', toNode: 'c2' }],
  },
  snowflake: {
    fileId: 'batch5-file',
    cards: {
      c1: { layer: 'situation', body: '雪夜里有人敲门', fields: {} },
      c2: { layer: 'situation', body: '门外是失散的弟弟', fields: {} },
      c3: { layer: 'situation', body: '两人决定天亮前离开', fields: {} },
    },
  },
}

const memory = { doc: structuredClone(seed), etag: 'W/"1"' }
const result = { ok: false, failures: [] }
const fail = (detail) => result.failures.push(detail)

const browser = await chromium.launch({
  headless: true,
  executablePath: `${process.env.HOME || ''}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

async function intercept(page) {
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = request.url()
    const method = request.method()
    const json = (body, headers = {}) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) })
    if (url.includes('/api/canvas/snapshots')) return json({ snapshots: [] })
    if (url.includes('/api/canvas') && method === 'GET') return json({ document: memory.doc }, { ETag: memory.etag })
    if (url.includes('/api/canvas') && method === 'PUT') {
      memory.doc = JSON.parse(request.postData() || '{}')
      memory.etag = `W/"${Number(memory.etag.replace(/\D/g, '')) + 1}"`
      return json({ ok: true }, { ETag: memory.etag })
    }
    if (url.includes('/api/discuss/session')) {
      return json({
        sessions: [{ sessionId: 's1', title: '念头讨论', createdAt: '2026-10-09T03:00:00.000Z', cardId: 'c1' }],
        sessionId: 's1',
        cardId: 'c1',
      })
    }
    if (url.includes('/api/discuss/messages')) {
      return json({
        messages: [
          { role: 'user', content: '敲门的人为什么不说话', at: '2026-10-09T03:00:01.000Z' },
          { role: 'assistant', content: '他怕一开口，屋里的人就认出他的声音。', at: '2026-10-09T03:00:02.000Z' },
        ],
        hasMore: false,
      })
    }
    if (url.includes('/api/')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
}

async function waitCards(page) {
  await page.locator('.react-flow__node-snowCard').first().waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(600)
}

try {
  const page = await browser.newPage({ viewport: { width: 320, height: 720 } })
  await intercept(page)
  await page.goto(base, { waitUntil: 'networkidle' })
  await waitCards(page)
  const narrow = await page.evaluate(() => {
    const canvas = document.querySelector('.canvas-wrap').getBoundingClientRect()
    const cards = [...document.querySelectorAll('.react-flow__node-snowCard')].map((node) => node.getBoundingClientRect())
    const inside = cards.filter(
      (r) => r.right > canvas.left && r.left < canvas.right && r.bottom > canvas.top && r.top < canvas.bottom,
    ).length
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      topbarHeight: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
      canvas: { top: Math.round(canvas.top), height: Math.round(canvas.height), width: Math.round(canvas.width) },
      cardsTotal: cards.length,
      cardsInsideCanvas: inside,
      pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth,
    }
  })
  result.narrow = narrow
  if (!(narrow.canvas.height > 240)) fail(`320×720 画布高度 ${narrow.canvas.height}px，不大于 240`)
  if (narrow.cardsInsideCanvas < 1) fail('打开页面后画布里一张卡都看不到，没有自动看全稿')
  if (narrow.pageScrollsSideways) fail('320 宽页面横向溢出')
  await page.screenshot({ path: process.env.SHOT })

  await page.locator('.react-flow__node-snowCard').first().dblclick()
  await page.locator('[data-discuss-dock]').waitFor({ timeout: 5000 })
  await page.locator('.discuss-popover textarea').first().fill('他会留下来吗')
  await page.waitForTimeout(400)
  const sheet = await page.evaluate(() => {
    const dock = document.querySelector('[data-discuss-dock]')
    const rect = dock.getBoundingClientRect()
    const send = [...dock.querySelectorAll('.discuss-compose-bar button')].find((b) => b.textContent.trim() === '发送')
    const s = send.getBoundingClientRect()
    const hit = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2)
    return {
      dockClass: dock.className,
      inNode: Boolean(dock.closest('.react-flow__node')),
      parentIsBody: dock.parentElement === document.body,
      dock: { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width) },
      send: { left: Math.round(s.left), right: Math.round(s.right), top: Math.round(s.top), bottom: Math.round(s.bottom) },
      sendHit: Boolean(hit && (hit === send || send.contains(hit))),
      sendDisabled: send.disabled,
    }
  })
  result.narrowDiscuss = sheet
  if (sheet.inNode || !sheet.parentIsBody) fail('讨论浮窗还在卡片节点里')
  if (!sheet.dockClass.includes('discuss-sheet')) fail('窄屏讨论没有改成下半屏面板')
  if (sheet.dock.left < 0 || sheet.dock.right > 320) fail(`窄屏面板伸出屏幕 ${sheet.dock.left}..${sheet.dock.right}`)
  if (sheet.send.left < 0 || sheet.send.right > 320 || sheet.send.top < 0 || sheet.send.bottom > 720) fail('「发送」不在视口内')
  if (!sheet.sendHit) fail('elementFromPoint 点不到「发送」')
  if (sheet.sendDisabled) fail('填了字之后「发送」仍不可点')
  await page.screenshot({ path: process.env.SHOT.replace(/\.png$/, '-discuss.png') })
  await page.close()

  const wide = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await intercept(wide)
  await wide.goto(base, { waitUntil: 'networkidle' })
  await waitCards(wide)
  const measureDock = async () => {
    await wide.locator('.react-flow__node-snowCard').first().dblclick()
    await wide.locator('[data-discuss-dock]').waitFor({ timeout: 5000 })
    await wide.waitForTimeout(400)
    const data = await wide.evaluate(() => {
      const dock = document.querySelector('[data-discuss-dock]')
      const rect = dock.getBoundingClientRect()
      const card = document.querySelector('.react-flow__node-snowCard[data-id="c1"]').getBoundingClientRect()
      const send = [...dock.querySelectorAll('.discuss-compose-bar button')].find((b) => b.textContent.trim() === '发送')
      const s = send.getBoundingClientRect()
      const zoom = Number(/scale\(([\d.]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1)
      return {
        zoom,
        width: Math.round(rect.width),
        fontSize: getComputedStyle(dock.querySelector('.discuss-popover')).fontSize,
        gapBelowCard: Math.round(rect.top - card.bottom),
        sendInView: s.top >= 0 && s.bottom <= window.innerHeight && s.left >= 0 && s.right <= window.innerWidth,
      }
    })
    await wide.keyboard.press('Escape')
    await wide.waitForTimeout(200)
    return data
  }
  const before = await measureDock()
  for (let i = 0; i < 4; i += 1) {
    await wide.locator('.react-flow__controls-zoomout').click()
    await wide.waitForTimeout(150)
  }
  const after = await measureDock()
  result.wide = { before, after }
  if (!(after.zoom < before.zoom)) fail('缩小画布没有生效，量不出浮窗是否跟着缩放')
  if (before.width !== after.width || before.fontSize !== after.fontSize) {
    fail(`浮窗跟着画布缩放：缩放 ${before.zoom}→${after.zoom}，宽 ${before.width}→${after.width}，字号 ${before.fontSize}→${after.fontSize}`)
  }
  if (!before.sendInView || !after.sendInView) fail('宽屏「发送」不在视口内')
} catch (error) {
  fail(String(error && error.stack ? error.stack : error))
} finally {
  await browser.close()
}

result.ok = result.failures.length === 0
writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
if (!result.ok) {
  console.log('BATCH5_NARROW_RED')
  process.exit(1)
}
console.log('BATCH5_NARROW_OK')
JS
