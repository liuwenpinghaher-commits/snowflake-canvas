import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage']
const fallbackExecutable = '/home/chris/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const ENABLE_WAIT_MS = 12_000

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, args: launchArgs })
  } catch (error) {
    if (!existsSync(fallbackExecutable)) throw error
    return chromium.launch({
      headless: true,
      executablePath: fallbackExecutable,
      args: launchArgs,
    })
  }
}

async function pageStatus(page) {
  const text = await page.locator('body').innerText().catch(() => '')
  const disabled = await page.getByRole('button', { name: '新建念头' }).isDisabled().catch(() => true)
  return `新建念头禁用=${disabled}\n${text}`
}

async function waitCreateEnabled(page, timeoutMs = ENABLE_WAIT_MS) {
  const button = page.getByRole('button', { name: '新建念头' })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await button.isEnabled().catch(() => false)) return true
    await page.waitForTimeout(100)
  }
  return false
}

const url = process.argv[2]
if (!url) {
  console.error('missing url')
  process.exit(1)
}

const canonical = {
  canvas: { nodes: [], edges: [] },
  snowflake: { fileId: 'shot-canvas', cards: {} },
}

await mkdir('test-results', { recursive: true })
const canonicalPath = resolve('test-results/shot-canonical.json')
await writeFile(canonicalPath, JSON.stringify(canonical))

const browser = await launchBrowser()
let exitCode = 0

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(8_000)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      get() {
        return undefined
      },
    })
  })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  const opener = page.locator('label.file-pick', { hasText: '打开正本' })
  try {
    await opener.waitFor({ state: 'visible', timeout: 8_000 })
  } catch {
    console.error('页面没有「打开正本」')
    console.error(await pageStatus(page))
    exitCode = 1
  }
  if (exitCode === 0) {
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5_000 }),
        opener.click(),
      ])
      await chooser.setFiles(canonicalPath)
      if (!(await waitCreateEnabled(page, 4_000))) {
        await opener.locator('input[type="file"]').setInputFiles(canonicalPath)
      }
    } catch (error) {
      console.error('打开正本没有接到文件')
      console.error(error instanceof Error ? error.message : String(error))
      console.error(await pageStatus(page))
      exitCode = 1
    }
  }
  if (exitCode === 0 && !(await waitCreateEnabled(page))) {
    console.error('新建念头在超时内仍不可点')
    console.error(await pageStatus(page))
    exitCode = 1
  }
  if (exitCode === 0) {
    await page.getByRole('button', { name: '新建念头' }).click()
    await page.locator('.snow-card').first().waitFor({ state: 'visible', timeout: 8_000 })
    const dialog = page.getByRole('dialog', { name: '正本要另存' })
    const dialogShown = await dialog.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true).catch(() => false)
    if (dialogShown) {
      const download = page.waitForEvent('download', { timeout: 5_000 }).catch(() => null)
      await dialog.getByRole('button', { name: '下载' }).click()
      await download
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 })
    }
    await page.getByRole('button', { name: '看全稿' }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/canvas.png' })
    const count = await page.locator('.snow-card').count()
    if (count < 1) {
      console.error('screenshot has no card')
      console.error(await pageStatus(page))
      exitCode = 1
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  exitCode = 1
} finally {
  await browser.close()
}

if (exitCode !== 0) process.exit(exitCode)
