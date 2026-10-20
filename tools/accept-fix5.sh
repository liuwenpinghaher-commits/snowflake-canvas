#!/usr/bin/env bash
# 修复 5 验收：另存模式里，浏览器没有锁接口时单标签可写；真双标签仍只读。
# 临时端口只提供页面。不碰 8093。
# 失败打印 ACCEPT_FIX5_RED 并以非 0 退出。成功时最后一行恰好是 ACCEPT_FIX5_OK。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [ -n "${FIX5_PORT:-}" ]; then
  PORT="${FIX5_PORT}"
else
  PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
fi
if [ "${PORT}" = "8093" ]; then
  echo "ACCEPT_FIX5_RED 禁止使用 8093" >&2
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

node_modules/.bin/vite --host 127.0.0.1 --port "${PORT}" --strictPort >/tmp/accept-fix5-vite.log 2>&1 &
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
  echo "ACCEPT_FIX5_RED 临时页面起不来 port=${PORT}" >&2
  tail -n 30 /tmp/accept-fix5-vite.log >&2 || true
  exit 1
fi

node --input-type=module << 'JS'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const port = process.env.PORT
const base = `http://127.0.0.1:${port}/xuehua/`
const file = '/tmp/accept-fix5-snowflake.json'
const seed = {
  canvas: {
    nodes: [{ id: 'c1', type: 'text', x: 40, y: 40, width: 220, height: 120, text: '甲' }],
    edges: [],
  },
  snowflake: {
    fileId: 'fix5-file',
    cards: {
      c1: { id: 'c1', layer: 'situation', fields: {}, body: '甲' },
    },
  },
}
writeFileSync(file, JSON.stringify(seed))

function fail(detail) {
  console.error(`ACCEPT_FIX5_RED ${detail}`)
  process.exit(1)
}

const browser = await chromium.launch({
  headless: true,
  executablePath: `${process.env.HOME || ''}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  args: ['--no-sandbox'],
})

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

async function openPage(hideLocks) {
  const page = await context.newPage()
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        get() {
          return undefined
        },
      })
    } catch {
      // 拿不掉目录选择器时，页面不会进另存模式。
    }
  })
  if (hideLocks) {
    await page.addInitScript(() => {
      try {
        Object.defineProperty(Navigator.prototype, 'locks', {
          configurable: true,
          get() {
            return undefined
          },
        })
      } catch {
        // 定义失败时验收会看到只读，按红处理。
      }
      try {
        Object.defineProperty(window, 'showDirectoryPicker', {
          configurable: true,
          get() {
            return undefined
          },
        })
      } catch {
        // 拿不掉目录选择器时，页面不会进另存模式。
      }
    })
  }
  await page.route('**/*', async (route) => {
    const request = route.request()
    if (request.method() !== 'GET') {
      await route.fulfill({ status: 204, body: '' })
      return
    }
    if (request.url().includes('/api/canvas')) {
      await route.fulfill({ status: 404, body: '' })
      return
    }
    await route.continue()
  })
  await page.goto(base, { waitUntil: 'networkidle' })
  const opener = page.locator('label.file-pick input[type=file]').first()
  await opener.waitFor({ state: 'attached', timeout: 10000 })
  await opener.setInputFiles(file)
  await page.getByRole('button', { name: '新建念头' }).waitFor({ timeout: 10000 })
  await page.waitForFunction(() => !document.body.innerText.includes('选择正本'), { timeout: 10000 })
  return page
}

async function bodyOf(page) {
  return page.evaluate(() => document.body.innerText)
}

const alone = await openPage(true)
const aloneText = await bodyOf(alone)
const locksGone = await alone.evaluate(() => navigator.locks == null)
if (!locksGone) fail('锁接口还在，验收没有去掉 navigator.locks')
if (aloneText.includes('另一个标签正在写这份正本')) {
  fail(`无锁单标签被判只读：${aloneText.slice(0, 240)}`)
}
if (!aloneText.includes('127.0.0.1')) fail(`无锁提示没有改用 127.0.0.1：${aloneText.slice(0, 240)}`)
const newCard = alone.getByRole('button', { name: '新建念头' })
if (await newCard.isDisabled()) fail('无锁单标签新建念头是灰的')
await newCard.click()
await alone.waitForTimeout(500)
const after = await bodyOf(alone)
if ((await alone.locator('.react-flow__node').count()) < 2) {
  fail(`无锁单标签新建没有落到画布：${after.slice(0, 240)}`)
}
const claim = alone.getByRole('button', { name: '改由本页写入' })
if (await claim.count()) {
  await claim.click()
  await alone.waitForTimeout(300)
  if (await newCard.isDisabled()) fail('点「改由本页写入」后仍然不能写')
}

const first = await openPage(false)
const second = await openPage(false)
await second.waitForTimeout(400)
const secondText = await bodyOf(second)
const secondNew = second.getByRole('button', { name: '新建念头' })
if (!secondText.includes('另一个标签正在写这份正本，本页只读')) {
  fail(`真双标签没有只读文案：${secondText.slice(0, 240)}`)
}
if (!(await secondNew.isDisabled())) fail('真双标签第二页仍可新建')
await second.getByRole('button', { name: '改由本页写入' }).click()
await second.waitForTimeout(400)
if (!(await secondNew.isDisabled())) fail('真双标签点「改由本页写入」后不再只读')
if (!(await first.getByRole('button', { name: '新建念头' }).isEnabled())) fail('第一页被第二页挤成只读')

await browser.close()
console.log('ACCEPT_FIX5_OK')
JS
