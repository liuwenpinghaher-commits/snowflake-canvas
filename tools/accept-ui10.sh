#!/usr/bin/env bash
# 修复二验收：键盘打开讨论、焦点、窄屏、长串、浮窗、配色、文案。
# 临时端口只提供页面。不碰 8093。
# 失败打印 ACCEPT_UI10_RED 并以非 0 退出。成功时最后一行恰好是 ACCEPT_UI10_OK。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [ -n "${UI10_PORT:-}" ]; then
  PORT="${UI10_PORT}"
else
  PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
fi
if [ "${PORT}" = "8093" ]; then
  echo "ACCEPT_UI10_RED 禁止使用 8093" >&2
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

node_modules/.bin/vite --host 127.0.0.1 --port "${PORT}" --strictPort >/tmp/accept-ui10-vite.log 2>&1 &
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
  echo "ACCEPT_UI10_RED 临时页面起不来 port=${PORT}" >&2
  tail -n 30 /tmp/accept-ui10-vite.log >&2 || true
  exit 1
fi

# 先打开一次页面，让依赖优化在验收点按钮之前结束。
curl -sf -o /dev/null "http://127.0.0.1:${PORT}/xuehua/" || true
sleep 2
curl -sf -o /dev/null "http://127.0.0.1:${PORT}/xuehua/" || true

node --input-type=module << 'JS'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const port = process.env.PORT
const root = process.env.ROOT
const base = `http://127.0.0.1:${port}/xuehua/`
const file = '/tmp/accept-ui10-snowflake.json'
const token = 'snowflake_canvas_ten_layer_discuss_very_long_token'
const longBody = ['第一张念头', ...Array.from({ length: 40 }, (_, index) => `第${index + 1}行卡面正文，用来把预览撑高，检查编辑器还会不会被挤出首屏。`)].join('\n')
const seed = {
  canvas: {
    nodes: [{ id: 'c1', type: 'text', x: 180, y: 560, width: 280, height: 176, text: '第一张念头' }],
    edges: [],
  },
  snowflake: {
    fileId: 'ui10-file',
    cards: {
      c1: { id: 'c1', layer: 'situation', fields: {}, body: longBody },
    },
  },
}
writeFileSync(file, JSON.stringify(seed))
mkdirSync(`${root}/.kanban-sentinels`, { recursive: true })

function fail(detail) {
  console.error(`ACCEPT_UI10_RED ${detail}`)
  process.exitCode = 1
  throw new Error(detail)
}

function hexColor(color) {
  const match = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return String(color).trim().toLowerCase()
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`
}

const chrome = `${process.env.HOME || ''}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const launch = {
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
}
if (existsSync(chrome)) launch.executablePath = chrome

const browser = await chromium.launch(launch)
let releaseHang = () => {}
let streamMode = 'reply'

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        get() {
          return undefined
        },
      })
    } catch {
      // 拿不掉目录选择器时，页面进不了打开正本。
    }
    try {
      Object.defineProperty(Navigator.prototype, 'locks', {
        configurable: true,
        get() {
          return undefined
        },
      })
    } catch {
      // 定义失败时可能没有普通状态行。
    }
  })
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = request.url()
    const method = request.method()
    if (url.includes('/api/discuss/session') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 's1',
          sessions: [{ sessionId: 's1', title: '念头讨论', createdAt: '2026-10-08T12:00:00.000Z', cardId: 'c1' }],
        }),
      })
      return
    }
    if (url.includes('/api/discuss/messages') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: [] }),
      })
      return
    }
    if (url.includes('/api/discuss/stream') && method === 'POST') {
      if (streamMode === 'hang') {
        await new Promise((resolve) => {
          releaseHang = () => resolve()
        })
      }
      const payload = JSON.stringify({ content: `看这条路径 ${token}` })
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: `event: assistant.completed\ndata: ${payload}\n\n`,
      })
      return
    }
    if (method !== 'GET') {
      await route.fulfill({ status: 204, body: '' })
      return
    }
    if (url.includes('/api/canvas')) {
      await route.fulfill({ status: 404, body: '' })
      return
    }
    await route.continue()
  })

  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '新建念头' }).waitFor({ timeout: 15000 })
  // 依赖优化会整页刷新一次。等过这一下再打开稿，避免刚打开的卡片被刷掉。
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: '新建念头' }).waitFor({ timeout: 15000 })
  const opener = page.locator('label.file-pick input[type=file]').first()
  await opener.waitFor({ state: 'attached', timeout: 10000 })
  const card = page.locator('.react-flow__node-snowCard').first()
  await opener.setInputFiles(file)
  try {
    await card.waitFor({ state: 'visible', timeout: 4000 })
  } catch {
    await page.getByRole('button', { name: '新建念头' }).waitFor({ timeout: 15000 })
    await opener.setInputFiles(file)
    await card.waitFor({ state: 'visible', timeout: 10000 })
  }
  await page.waitForFunction(() => !document.body.innerText.includes('选择正本'), { timeout: 10000 })
  await card.click({ position: { x: 24, y: 24 } })
  await page.locator('.cm-host').waitFor({ state: 'visible', timeout: 5000 })

  const desktop = await page.evaluate(() => {
    const side = document.querySelector('.side')?.getBoundingClientRect()
    const canvas = document.querySelector('.canvas-wrap')?.getBoundingClientRect()
    const editor = document.querySelector('.cm-host')?.getBoundingClientRect()
    return {
      sideWidth: side?.width ?? 0,
      sideTop: side?.top ?? 0,
      canvasTop: canvas?.top ?? 0,
      editorTop: editor?.top ?? 9999,
    }
  })
  if (Math.abs(desktop.sideWidth - 380) > 2) fail(`1440 宽侧栏不是 380px，实际 ${desktop.sideWidth}`)
  if (Math.abs(desktop.sideTop - desktop.canvasTop) > 8) fail('1440 宽画布和侧栏没有并排')
  if (!(desktop.editorTop < 900)) fail(`卡片编辑器顶边 ${desktop.editorTop} 不在 900 高的首屏里`)

  const normal = await page.evaluate(() => {
    return [...document.querySelectorAll('.status-line')]
      .filter((item) => !item.classList.contains('is-error'))
      .map((item) => ({ text: item.textContent || '', color: getComputedStyle(item).color }))
  })
  if (normal.length === 0) fail('页面上没有普通状态行')
  for (const line of normal) {
    if (hexColor(line.color) === '#8c4a32') fail(`普通状态仍是主按钮棕色：${line.text}`)
    if (hexColor(line.color) !== '#5e574e') fail(`普通状态颜色是 ${line.color}：${line.text}`)
  }

  // 「出错：」前缀和 is-error 由 App.tsx 按写入控制器给的状态类型渲染（tests/narrow-batch5.test.ts 覆盖），
  // 这里只核对出错样式的颜色。
  await page.evaluate(() => {
    const line = document.createElement('p')
    line.className = 'status-line is-error'
    line.setAttribute('role', 'alert')
    line.dataset.ui10 = 'err'
    line.textContent = '出错：文件没写上'
    document.querySelector('.topbar')?.appendChild(line)
  })
  const errorColor = await page.evaluate(() => getComputedStyle(document.querySelector('[data-ui10="err"]')).color)
  if (hexColor(errorColor) !== '#9b2c2c') fail(`出错状态颜色是 ${errorColor}`)
  await page.evaluate(() => document.querySelector('[data-ui10="err"]')?.remove())

  const pendingColor = await page.evaluate(() => {
    const line = document.createElement('p')
    line.className = 'pending'
    line.textContent = '正在回复'
    document.body.appendChild(line)
    const color = getComputedStyle(line).color
    line.remove()
    return color
  })
  if (hexColor(pendingColor) !== '#5e574e') fail(`正在回复颜色是 ${pendingColor}`)

  const source = await (await page.request.get(`${base}src/CardDiscuss.tsx`)).text()
  if (!source.includes('讨论的人有点多，正在排队，稍后自动重试。')) fail('页面源码里没有新的排队文案')
  if (source.includes('网关同时最多 10 路')) fail('页面源码里还留着旧文案「网关同时最多 10 路」')

  const placed = await card.boundingBox()
  const canvasBox = await page.locator('.canvas-wrap').boundingBox()
  if (!placed || !canvasBox) fail('找不到画布或卡片')
  const cardMid = placed.y + placed.height / 2
  const lowerStart = canvasBox.y + canvasBox.height * 0.55
  if (cardMid < lowerStart) fail(`卡片不在画布中下部 mid=${cardMid} 下半起点=${lowerStart}`)

  await page.evaluate(() => {
    const heading = document.querySelector('h1')
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1
      heading.focus()
    }
  })
  let focusedCard = false
  for (let step = 0; step < 80; step += 1) {
    focusedCard = await page.evaluate(() => document.activeElement?.classList.contains('react-flow__node-snowCard') === true)
    if (focusedCard) break
    await page.keyboard.press('Tab')
  }
  if (!focusedCard) fail('Tab 没有落到第一张卡片')
  const outline = await page.evaluate(() => {
    const node = document.activeElement
    const snow = node instanceof HTMLElement ? node.querySelector('.snow-card') : null
    const style = snow ? getComputedStyle(snow) : null
    return {
      focusVisible: node instanceof HTMLElement && node.matches(':focus-visible'),
      style: style?.outlineStyle || '',
      color: style?.outlineColor || '',
    }
  })
  if (!outline.focusVisible) fail('键盘聚焦卡片时没有 :focus-visible')
  if (outline.style === 'none') fail('键盘聚焦时卡片没有焦点框')
  if (hexColor(outline.color) !== '#8c4a32') fail(`焦点框颜色是 ${outline.color}`)

  await page.keyboard.press('Space')
  await page.waitForTimeout(150)
  if ((await page.getByRole('dialog', { name: '念头讨论' }).count()) !== 0) fail('空格打开了讨论')
  focusedCard = await page.evaluate(() => document.activeElement?.classList.contains('react-flow__node-snowCard') === true)
  if (!focusedCard) {
    for (let step = 0; step < 80; step += 1) {
      focusedCard = await page.evaluate(() => document.activeElement?.classList.contains('react-flow__node-snowCard') === true)
      if (focusedCard) break
      await page.keyboard.press('Tab')
    }
  }
  if (!focusedCard) fail('空格之后卡片失去焦点，没法再按 Enter')

  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: '念头讨论' }).waitFor({ timeout: 5000 })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '讨论内容', { timeout: 5000 })
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => (item.textContent || '').trim() === '发送')
    if (!(button instanceof HTMLElement)) return false
    const box = button.getBoundingClientRect()
    return box.height > 0 && box.top >= -0.5 && box.bottom <= window.innerHeight + 0.5
  }, { timeout: 3000 }).catch(() => fail('发送按钮没有完整留在视口内'))
  const sendBox = await page.getByRole('button', { name: '发送' }).boundingBox()
  if (!sendBox) fail('没有发送按钮')
  if (sendBox.y < 0 || sendBox.y + sendBox.height > 900 + 0.5) {
    fail(`发送按钮不在视口内 top=${sendBox.y} bottom=${sendBox.y + sendBox.height}`)
  }

  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.classList.contains('react-flow__node-snowCard') === true, { timeout: 3000 }).catch(() => {
    fail('按 Escape 后焦点没有回到卡片')
  })

  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: '念头讨论' }).waitFor({ timeout: 5000 })
  const draft = page.locator('textarea[aria-label="讨论内容"]')
  await draft.waitFor({ timeout: 3000 })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '讨论内容', { timeout: 3000 })
  const cancelSave = page.getByRole('button', { name: '取消' })
  if ((await cancelSave.count()) > 0) await cancelSave.click()
  await page.getByRole('button', { name: '关闭' }).click()
  await page.waitForFunction(() => document.activeElement?.classList.contains('react-flow__node-snowCard') === true, { timeout: 3000 }).catch(() => {
    fail('点关闭后焦点没有回到卡片')
  })

  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '讨论内容', { timeout: 5000 })
  await draft.fill('请把长路径回给我')
  await draft.press('Enter')
  await page.waitForFunction((needle) => document.body.innerText.includes(needle), token, { timeout: 5000 })
  const wrapped = await page.evaluate((needle) => {
    const bubble = [...document.querySelectorAll('.bubble')].find((item) => item.textContent?.includes(needle))
    const chat = document.querySelector('.discuss-chat')
    if (!(bubble instanceof HTMLElement) || !(chat instanceof HTMLElement)) return null
    return {
      scrollWidth: bubble.scrollWidth,
      clientWidth: bubble.clientWidth,
      chatScroll: chat.scrollWidth,
      chatClient: chat.clientWidth,
    }
  }, token)
  if (!wrapped) fail('没有找到含长串的气泡')
  if (wrapped.scrollWidth > wrapped.clientWidth) {
    fail(`气泡横向溢出 scroll=${wrapped.scrollWidth} client=${wrapped.clientWidth}`)
  }
  if (wrapped.chatScroll > wrapped.chatClient + 1) {
    fail(`聊天区横向溢出 scroll=${wrapped.chatScroll} client=${wrapped.chatClient}`)
  }
  const afterReply = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName)
  if (afterReply !== '讨论内容') fail(`回复结束后焦点在 ${afterReply}`)

  streamMode = 'hang'
  await draft.fill('这条先别回来')
  await draft.press('Enter')
  await page.waitForFunction(() => {
    const box = document.querySelector('textarea[aria-label="讨论内容"]')
    return box instanceof HTMLTextAreaElement && box.readOnly && !box.disabled
  }, { timeout: 3000 }).catch(() => fail('忙碌时输入框不是只读，或被禁用了'))
  releaseHang()
  streamMode = 'reply'
  await page.waitForTimeout(200)

  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 320, height: 720 })
  await page.waitForTimeout(200)
  const narrow = await page.evaluate(() => {
    const canvas = document.querySelector('.canvas-wrap')?.getBoundingClientRect()
    const side = document.querySelector('.side')?.getBoundingClientRect()
    return {
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      sideWidth: side?.width ?? 9999,
      canvasTop: canvas?.top ?? 0,
      sideTop: side?.top ?? 0,
    }
  })
  if (!(narrow.canvasWidth > 0)) fail(`320 宽画布宽度是 ${narrow.canvasWidth}`)
  if (!(narrow.canvasHeight >= 160)) fail(`320 宽画布高度是 ${narrow.canvasHeight}`)
  if (!(narrow.sideWidth <= 320)) fail(`320 宽侧栏宽度是 ${narrow.sideWidth}`)
  if (!(narrow.canvasTop < narrow.sideTop)) fail('320 宽不是画布在上、侧栏在下')
  await page.screenshot({ path: `${root}/.kanban-sentinels/t_0fb37670-320.png` })

  await page.setViewportSize({ width: 720, height: 450 })
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${root}/.kanban-sentinels/t_0fb37670-200.png` })

  console.log('ACCEPT_UI10_OK')
} catch (error) {
  if (!process.exitCode) {
    console.error(`ACCEPT_UI10_RED ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
} finally {
  releaseHang()
  await browser.close().catch(() => {})
}
if (process.exitCode) process.exit(process.exitCode)
JS
