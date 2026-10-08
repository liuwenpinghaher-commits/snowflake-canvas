#!/usr/bin/env bash
# 修复 2 验收：输入法选「弟」要落盘，挂起期切卡再敲键不得写进错卡。
# 无头 Chrome 用 CDP 合成组合序列。临时端口只提供页面，接口全部拦截，不碰 8093。
# 成功时最后一行是 ACCEPT_FIX2_OK。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PORT="${FIX2_PORT:-8766}"
export ROOT PORT

node --input-type=module << 'JS'
import { chromium } from 'playwright'

const port = process.env.PORT
const base = `http://127.0.0.1:${port}/xuehua/`
const seed = {
  canvas: {
    nodes: [
      { id: 'c1', type: 'text', x: 40, y: 40, width: 220, height: 120, text: '第一张' },
      { id: 'c2', type: 'text', x: 360, y: 40, width: 220, height: 140, text: '场景表' },
    ],
    edges: [],
  },
  snowflake: {
    fileId: 'fix2-file',
    cards: {
      c1: { id: 'c1', layer: 'situation', fields: {}, body: '第一张' },
      c2: {
        id: 'c2',
        layer: '场景表',
        fields: { pov: '', what: '', words: '', chapter: '', title: '场景表', conflict: '' },
        body: '场景表',
      },
    },
  },
}

function fail(detail) {
  console.error(`ACCEPT_FIX2_RED ${detail}`)
  process.exit(1)
}

const memory = { doc: structuredClone(seed), etag: 'W/"1"', puts: 0 }
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
const debug = await page.evaluate(() => document.body.innerText.slice(0, 400))
const cards = page.locator('.react-flow__node')
if ((await cards.count()) < 2) fail(`卡片数量 ${await cards.count()} 页面=${JSON.stringify(debug)}`)
const firstBox = await cards.nth(0).boundingBox()
if (!firstBox) fail('第一张卡没有位置')
await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + 24)
const editor = page.locator('.cm-content')
await editor.click()
const readyDeadline = Date.now() + 4000
let ready = { editable: null, active: '', status: '' }
while (Date.now() < readyDeadline) {
  ready = await page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    return {
      editable: el ? el.getAttribute('contenteditable') : null,
      active: document.activeElement ? document.activeElement.className : '',
      status: [...document.querySelectorAll('.status-line')].map((item) => item.textContent || '').join(' | '),
      side: document.querySelector('.side')?.textContent?.slice(0, 120) || '',
    }
  })
  if (ready.editable === 'true') break
  await page.waitForTimeout(100)
}
if (ready.editable !== 'true') fail(`编辑器不可写 ${JSON.stringify(ready)}`)
await page.evaluate(() => {
  window.__ime = []
  const el = document.querySelector('.cm-content')
  if (!el) return
  for (const name of ['compositionstart', 'compositionupdate', 'compositionend', 'input', 'beforeinput']) {
    el.addEventListener(name, (event) => {
      const data = 'data' in event ? event.data : ''
      window.__ime.push(`${name}:${data ?? ''}:${el.textContent ?? ''}`)
    })
  }
})

const session = await page.context().newCDPSession(page)
await session.send('Input.imeSetComposition', { text: 'di', selectionStart: 2, selectionEnd: 2 })
await page.waitForTimeout(80)
await session.send('Input.insertText', { text: '弟' })
await session.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
await page.waitForTimeout(2500)

const shown = (await editor.innerText()).replace(/\s+/g, '')
const first = memory.doc.snowflake?.cards?.c1
const stored = `${first?.body || ''}${Object.values(first?.fields || {}).join('')}`
const trace = await page.evaluate(() => window.__ime)
if (!shown.includes('弟') || !stored.includes('弟')) {
  fail(`落盘前 编辑器=${JSON.stringify(shown)} 正文=${JSON.stringify(stored)} 写=${memory.puts} 事件=${JSON.stringify(trace)}`)
}

const secondBox = await cards.nth(1).boundingBox()
if (!secondBox) fail('第二张卡没有位置')
await page.mouse.click(secondBox.x + secondBox.width / 2, secondBox.y + 24)
await page.waitForTimeout(150)
await page.keyboard.type('x', { delay: 20 })
await page.waitForTimeout(700)
const second = memory.doc.snowflake?.cards?.c2
const dirty = `${second?.body || ''}${Object.values(second?.fields || {}).join('')}`
const editorAfter = (await editor.innerText()).replace(/\s+/g, '')
await browser.close()
if (dirty.includes('弟') || editorAfter.includes('弟')) {
  fail(`错卡被污染 编辑器=${JSON.stringify(editorAfter)} 场景表=${JSON.stringify(dirty)}`)
}
console.log('ACCEPT_FIX2_OK')
JS
