import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { describe, expect, it } from 'vitest'
import { snowBodyLineCapPx, snowBodyOverflows, snowExpandLabel } from '../src/card-layout.ts'
import { bodyTextForCard, cardFace, layerLabel, type Card, type Layer } from '../src/document.ts'

const dataDir = process.env.SNOWFLAKE_DATA_DIR || '/home/chris/.local/share/snowflake-canvas'
const booksRoot = join(dataDir, 'books')
const chromePath = '/home/chris/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'

type Loaded = {
  bookId: string
  bookName: string
  id: string
  width: number
  card: Card
  text: string
  where: 'body' | 'fields'
  fieldKey: string | null
}

function chars(text: string): number {
  return [...text].length
}

function loadLongestProse(): Loaded {
  if (!existsSync(booksRoot)) throw new Error(`找不到主人的书：${booksRoot}`)
  let best: Loaded | null = null
  for (const bookId of readdirSync(booksRoot)) {
    const file = join(booksRoot, bookId, 'snowflake.json')
    if (!existsSync(file)) continue
    const metaPath = join(booksRoot, bookId, 'meta.json')
    const meta = existsSync(metaPath) ? (JSON.parse(readFileSync(metaPath, 'utf8')) as { name?: string }) : {}
    const envelope = JSON.parse(readFileSync(file, 'utf8')) as {
      document: {
        canvas: { nodes: { id: string; width?: number }[] }
        snowflake: { cards: Record<string, Card> }
      }
    }
    const widths = new Map(envelope.document.canvas.nodes.map((node) => [node.id, node.width]))
    for (const [id, card] of Object.entries(envelope.document.snowflake.cards)) {
      const prose = bodyTextForCard(card)
      if (!prose.text.trim()) continue
      const width = widths.get(id)
      const loaded: Loaded = {
        bookId,
        bookName: meta.name || bookId,
        id,
        width: typeof width === 'number' && width > 40 ? width : 280,
        card,
        text: prose.text,
        where: prose.where,
        fieldKey: prose.fieldKey,
      }
      if (!best || chars(loaded.text) > chars(best.text)) best = loaded
    }
  }
  if (!best) throw new Error('主人的书里没有能画到卡片正文上的文字')
  return best
}

async function launchBrowser(): Promise<Browser> {
  const args = ['--no-sandbox', '--disable-dev-shm-usage']
  if (existsSync(chromePath)) return chromium.launch({ headless: true, executablePath: chromePath, args })
  return chromium.launch({ headless: true, args })
}

async function measureBody(text: string, width: number): Promise<{ scrollHeight: number; cap: number; overflows: boolean }> {
  const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div style="width:${width}px"><div class="snow-card"><div class="snow-copy"><div class="snow-title">标题</div><div class="snow-body"></div></div></div></div></body></html>`,
    )
    await page.locator('.snow-body').evaluate((el, value) => {
      el.textContent = value
    }, text)
    await page.evaluate(() => document.fonts.ready)
    const raw = await page.locator('.snow-body').evaluate((el) => {
      const node = el as HTMLElement
      const style = getComputedStyle(node)
      const previous = node.style.maxHeight
      node.style.maxHeight = 'none'
      const scrollHeight = node.scrollHeight
      node.style.maxHeight = previous
      return { scrollHeight, fontSize: style.fontSize, lineHeight: style.lineHeight }
    })
    const cap = snowBodyLineCapPx(raw.fontSize, raw.lineHeight)
    return { scrollHeight: raw.scrollHeight, cap, overflows: snowBodyOverflows(raw.scrollHeight, cap) }
  } finally {
    await browser.close()
  }
}

describe('展开全文按渲染后的正文高度决定', () => {
  it('卡面正文为空时，改量字段里比标题更长的那段', () => {
    const card: Card = {
      layer: 'renwubiao',
      body: '',
      fields: { name: '甲', sentence: '', paragraph: '段'.repeat(80) },
    }
    expect(cardFace(card).body).toBe('')
    const prose = bodyTextForCard(card)
    expect(prose.where).toBe('fields')
    expect(prose.fieldKey).toBe('paragraph')
    expect(prose.text).toBe('段'.repeat(80))
    const sentence: Card = { layer: 'situation', body: '一个人在门口站着。', fields: {} }
    expect(cardFace(sentence).body).toBe('')
    expect(bodyTextForCard(sentence).text).toBe('')
  })

  it('主人书里最长的一段正文，真实换行后必须出现展开全文', async () => {
    const card = loadLongestProse()
    const faceBody = cardFace(card.card).body.trim()
    expect(chars(card.text), `${card.bookName} ${card.id} 的正文太短，不能拿来充当溢出例子`).toBeGreaterThan(80)
    if (!faceBody) {
      expect(card.where).toBe('fields')
      expect(card.text.trim().length).toBeGreaterThan(0)
    }
    const measured = await measureBody(card.text, card.width)
    const label = snowExpandLabel(measured.overflows, false)
    const detail = [
      `book=${card.bookName}`,
      `id=${card.id}`,
      `layer=${layerLabel(card.card.layer as Layer)}`,
      `where=${card.where}`,
      `field=${card.fieldKey ?? ''}`,
      `chars=${chars(card.text)}`,
      `scrollHeight=${measured.scrollHeight}`,
      `cap=${measured.cap}`,
      `label=${label ?? ''}`,
    ].join(' ')
    console.log(detail)
    expect(measured.overflows, detail).toBe(true)
    expect(measured.scrollHeight, detail).toBeGreaterThan(measured.cap + 1)
    expect(label, detail).toBe('展开全文')
  }, 60_000)
})
