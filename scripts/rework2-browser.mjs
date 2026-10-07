import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const mode = process.argv[2]
const url = process.argv[3]
const fallbackExecutable = '/home/chris/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'
const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage']

if (!mode || !url) {
  console.error('用法: node scripts/rework2-browser.mjs <ime|tabs|kill> <url>')
  process.exit(1)
}

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

async function hideDirectoryPicker(page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      get() {
        return undefined
      },
    })
  })
}

async function pageDigest(page) {
  return page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('新建念头'))
    return {
      enabled: Boolean(button && !button.disabled),
      card: document.querySelector('.snow-text')?.textContent ?? '',
      editor: document.querySelector('.cm-content')?.textContent ?? '',
      dialog: document.querySelector('[role="dialog"]')?.getAttribute('aria-label') ?? '',
      status: [...document.querySelectorAll('.status-line')].map((item) => item.textContent ?? ''),
      text: document.body.innerText.slice(0, 800),
    }
  }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
}

async function waitEnabled(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await pageDigest(page)
    if (last.enabled && !last.status?.some((line) => line.includes('正在写入正本'))) return last
    if (last.status?.some((line) => line.includes('文件没写上'))) {
      throw new Error(`文件没写上\n${JSON.stringify(last)}`)
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`新建念头没有变为可点\n${JSON.stringify(last)}`)
}

async function openCanonical(page, filePath) {
  const opener = page.locator('label.file-pick', { hasText: '打开正本' })
  await opener.waitFor({ state: 'visible', timeout: 8000 })
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    opener.click(),
  ])
  await chooser.setFiles(filePath)
}

async function acceptDownload(page, savePath) {
  const dialog = page.getByRole('dialog', { name: '正本要另存' })
  await dialog.waitFor({ state: 'visible', timeout: 8000 })
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    dialog.getByRole('button', { name: '下载' }).click(),
  ])
  await download.saveAs(savePath)
  await dialog.waitFor({ state: 'hidden', timeout: 8000 })
}

async function cdpSession(page) {
  return page.context().newCDPSession(page)
}

async function insertText(page, session, text) {
  await page.locator('.cm-content').click()
  await session.send('Input.insertText', { text })
}

async function killPage(page) {
  const crashed = page.waitForEvent('crash', { timeout: 3000 }).then(() => 'crash').catch(() => 'no-crash')
  let session = null
  try {
    session = await page.context().newCDPSession(page)
  } catch {
    session = null
  }
  if (session) {
    void session.send('Page.crash').catch(() => {})
  }
  const which = await Promise.race([
    crashed,
    new Promise((resolve) => setTimeout(() => resolve('timer'), 2500)),
  ])
  if (which !== 'crash') {
    await page.close({ runBeforeUnload: false }).catch(() => {})
  }
}

async function runIme(browser, pageUrl) {
  await mkdir('test-results', { recursive: true })
  const filePath = resolve('test-results/ime-empty.json')
  await writeFile(
    filePath,
    JSON.stringify({
      canvas: { nodes: [], edges: [] },
      snowflake: { fileId: 'ime-han', cards: {} },
    }),
  )
  const context = await browser.newContext()
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(8000)
  await hideDirectoryPicker(page)
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' })
  await openCanonical(page, filePath)
  await waitEnabled(page)
  await page.getByRole('button', { name: '新建念头' }).click()
  await acceptDownload(page, resolve('test-results/ime-created.json'))
  await page.locator('.cm-content[contenteditable="true"]').waitFor({ state: 'visible', timeout: 8000 })
  const session = await cdpSession(page)
  await page.locator('.cm-content').click()
  await page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    if (!(el instanceof HTMLElement)) throw new Error('没有编辑器')
    el.focus()
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'di' }))
  })
  await session.send('Input.insertText', { text: 'di' })
  await page.waitForTimeout(300)
  const mid = await pageDigest(page)
  if (!String(mid.editor).includes('di')) {
    throw new Error(`组合过程中编辑器没有出现拼音\n${JSON.stringify(mid)}`)
  }
  if (String(mid.card).includes('di') || String(mid.dialog).length > 0) {
    throw new Error(`组合过程中卡片或正本对话框出现了拼音\n${JSON.stringify(mid)}`)
  }
  await page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    if (!(el instanceof HTMLElement)) throw new Error('没有编辑器')
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '弟' }))
  })
  const deadline = Date.now() + 8000
  let after = null
  while (Date.now() < deadline) {
    after = await pageDigest(page)
    if (String(after.card).includes('弟') && !String(after.card).includes('di')) break
    await page.waitForTimeout(100)
  }
  if (!after || !String(after.card).includes('弟') || String(after.card).includes('di')) {
    throw new Error(`终稿卡片不是「弟」\n${JSON.stringify(after)}`)
  }
  if (String(after.editor).includes('di')) {
    throw new Error(`终稿编辑器仍是拼音\n${JSON.stringify(after)}`)
  }
  const savedPath = resolve('test-results/ime-final.json')
  await acceptDownload(page, savedPath)
  const saved = await readFile(savedPath, 'utf8')
  const parsed = JSON.parse(saved)
  const bodies = Object.values(parsed.snowflake.cards).map((card) => card.body)
  if (!bodies.includes('弟')) throw new Error(`正本正文不是「弟」：${saved}`)
  if (saved.includes('di')) throw new Error(`正本字节含拼音 di：${saved}`)
  await browser.close()
}

async function runTabs(browser, pageUrl) {
  await mkdir('test-results', { recursive: true })
  const filePath = resolve('test-results/tabs-canon.json')
  await writeFile(
    filePath,
    JSON.stringify({
      canvas: { nodes: [], edges: [] },
      snowflake: { fileId: 'tabs-same-file', cards: {} },
    }),
  )
  const context = await browser.newContext()
  const page1 = await context.newPage({ viewport: { width: 1280, height: 800 } })
  const page2 = await context.newPage({ viewport: { width: 1280, height: 800 } })
  page1.setDefaultTimeout(8000)
  page2.setDefaultTimeout(8000)
  await hideDirectoryPicker(page1)
  await hideDirectoryPicker(page2)
  await page1.goto(pageUrl, { waitUntil: 'domcontentloaded' })
  await page2.goto(pageUrl, { waitUntil: 'domcontentloaded' })
  await openCanonical(page1, filePath)
  await waitEnabled(page1)
  await openCanonical(page2, filePath)
  const deadline = Date.now() + 8000
  let second = null
  while (Date.now() < deadline) {
    second = await pageDigest(page2)
    const message = (second.status || []).join('\n') + (second.text || '')
    if (message.includes('另一个标签正在写')) break
    if (second.enabled) {
      throw new Error(`第二页新建按钮仍可点\n${JSON.stringify(second)}`)
    }
    await page2.waitForTimeout(100)
  }
  const message = `${(second?.status || []).join('\n')}\n${second?.text || ''}`
  if (!message.includes('另一个标签正在写')) {
    throw new Error(`第二页没有「另一个标签正在写」\n${JSON.stringify(second)}`)
  }
  if (second.enabled) throw new Error(`第二页新建按钮仍可点\n${JSON.stringify(second)}`)
  const first = await pageDigest(page1)
  if (!first.enabled) throw new Error(`第一页不能新建\n${JSON.stringify(first)}`)
  await browser.close()
}

async function inspectStore(page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('snowflake-e2e')
    const names = []
    for await (const [name] of dir.entries()) names.push(name)
    const readName = async (name) => {
      try {
        const handle = await dir.getFileHandle(name)
        return await (await handle.getFile()).text()
      } catch {
        return null
      }
    }
    const hook = window.__snowflakeReadLog
    const log = typeof hook === 'function' ? await hook() : null
    return {
      names,
      canonical: await readName('snowflake.json'),
      temp: await readName('.snowflake.json.tmp'),
      log,
    }
  })
}

async function prepareCanonical(page, session, text) {
  await page.getByRole('button', { name: '选择正本' }).click()
  await waitEnabled(page)
  await page.getByRole('button', { name: '新建念头' }).click()
  await waitEnabled(page)
  await page.locator('.cm-content[contenteditable="true"]').waitFor({ state: 'visible' })
  await insertText(page, session, text)
  const deadline = Date.now() + 15000
  let last = null
  while (Date.now() < deadline) {
    last = await pageDigest(page)
    if (String(last.card).includes(text) && last.enabled) return last
    await page.waitForTimeout(100)
  }
  throw new Error(`上一份没有落盘\n${JSON.stringify(last)}`)
}

async function armAndKill(page, session, phrase, point) {
  await page.evaluate((value) => {
    window.__snowflakeE2EKill = value
  }, point)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+A')
  await session.send('Input.insertText', { text: phrase })
  await page.waitForFunction((value) => window.__snowflakeKillReady === value, point, { timeout: 15000 })
  await killPage(page)
}

async function waitCard(page, text, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await pageDigest(page)
    if (String(last.card || '').includes(text)) return last
    if (last.status?.some((line) => line.includes('文件没写上'))) {
      throw new Error(`重新打开时文件没写上\n${JSON.stringify(last)}`)
    }
    await page.waitForTimeout(100)
  }
  throw new Error(`重新打开后看不到「${text}」\n${JSON.stringify(last)}`)
}

async function reopen(context, pageUrl) {
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(8000)
  await page.goto(`${pageUrl}?e2e-bind=directory`, { waitUntil: 'domcontentloaded' })
  return page
}

async function runKill(browser, pageUrl) {
  const context = await browser.newContext()
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(8000)
  const bound = `${pageUrl}?e2e-bind=directory`
  await page.goto(bound, { waitUntil: 'domcontentloaded' })
  const session = await cdpSession(page)
  const previous = '上一份完整稿'
  const beforePhrase = '改名前这一笔'
  const afterPhrase = '改名后这一笔'
  await prepareCanonical(page, session, previous)

  await armAndKill(page, session, beforePhrase, 'before-move')
  const reopened = await reopen(context, pageUrl)
  const beforeCard = await waitCard(reopened, previous)
  if (String(beforeCard.card).includes(beforePhrase)) {
    throw new Error(`改名前强杀后再打开，卡片带上了没改名的一笔\n${JSON.stringify(beforeCard)}`)
  }
  const beforeStore = await inspectStore(reopened)
  if (!beforeStore.canonical || !beforeStore.canonical.includes(previous) || beforeStore.canonical.includes(beforePhrase)) {
    throw new Error(`改名前强杀后磁盘正本不对\n${JSON.stringify(beforeStore)}`)
  }
  if (beforeStore.temp !== null || (beforeStore.names || []).includes('.snowflake.json.tmp')) {
    throw new Error(`改名前强杀后临时文件还在\n${JSON.stringify(beforeStore)}`)
  }
  if (!beforeStore.log || !beforeStore.log.includes(previous) || beforeStore.log.includes(beforePhrase)) {
    throw new Error(`改名前强杀后恢复日志不对\n${JSON.stringify({ log: beforeStore.log })}`)
  }

  await reopened.getByRole('button', { name: '改由本页写入' }).click()
  await waitEnabled(reopened)
  await reopened.locator('.snow-card').first().click()
  await reopened.locator('.cm-content[contenteditable="true"]').waitFor({ state: 'visible' })
  const session2 = await cdpSession(reopened)
  await armAndKill(reopened, session2, afterPhrase, 'after-move')
  const again = await reopen(context, pageUrl)
  await waitCard(again, afterPhrase)
  const afterStore = await inspectStore(again)
  if (!afterStore.canonical || !afterStore.canonical.includes(afterPhrase)) {
    throw new Error(`改名后强杀后磁盘正本没有新稿\n${JSON.stringify(afterStore)}`)
  }
  if (afterStore.temp !== null) {
    throw new Error(`改名后强杀后临时文件还在\n${JSON.stringify(afterStore.names)}`)
  }
  let afterLog = afterStore.log || ''
  if (!afterLog.includes(afterPhrase)) {
    await again.getByRole('button', { name: '改由本页写入' }).click()
    await waitEnabled(again)
    const filled = await inspectStore(again)
    afterLog = filled.log || ''
  }
  if (!afterLog.includes(afterPhrase)) {
    throw new Error(`改名后强杀后再打开，恢复日志没有补上新稿\n${JSON.stringify({ log: afterLog })}`)
  }
  await browser.close()
}

const browser = await launchBrowser()
try {
  if (mode === 'ime') await runIme(browser, url)
  else if (mode === 'tabs') await runTabs(browser, url)
  else if (mode === 'kill') await runKill(browser, url)
  else throw new Error(`未知模式 ${mode}`)
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  await browser.close().catch(() => {})
  process.exit(1)
}
