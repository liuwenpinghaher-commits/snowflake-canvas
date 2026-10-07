import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage']
const fallbackExecutable = '/home/chris/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'

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

const url = process.argv[2]
if (!url) {
  console.error('missing url')
  process.exit(1)
}

await mkdir('test-results', { recursive: true })
const browser = await launchBrowser()

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '新建念头' }).click()
  await page.locator('.snow-card').first().waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: '看全稿' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/canvas.png' })
  const count = await page.locator('.snow-card').count()
  if (count < 1) {
    console.error('screenshot has no card')
    process.exit(1)
  }
} finally {
  await browser.close()
}
