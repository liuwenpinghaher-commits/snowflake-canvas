import { readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { expect } from 'e2e'
import { test } from '@e2e-dev/web'

const baseURL = process.env.SNOWFLAKE_E2E_URL || 'http://127.0.0.1:18093'
const bookName = '权力的游戏·第三季验收'
const titles = ['北上', '黑城堡', '孪河城', '熊与少女', '火吻', '攀爬', '熊坑', '次子', '卡斯特梅的雨季', '弥莎']
const novelPath = process.env.GOT_S3_NOVEL_PATH || join(userInfo().homedir, 'notes/snowflake-e2e-got-s3-novel.md')

test('传统断言核对章数场正文和导出', async () => {
  const listed = await fetch(`${baseURL}/api/books`)
  expect(listed.ok).toBe(true)
  const books = (await listed.json()) as { books: Array<{ id: string; name: string }> }
  const book = books.books.find((item) => item.name === bookName)
  expect(book).toBeTruthy()
  const canvasResponse = await fetch(`${baseURL}/api/books/${book!.id}/canvas`)
  expect(canvasResponse.ok).toBe(true)
  const canvas = (await canvasResponse.json()) as {
    document: { chapters?: Array<{ title?: string; scenes?: Array<{ prose?: string }> }> }
  }
  const chapters = canvas.document.chapters ?? []
  expect(chapters.length).toBe(10)
  expect(chapters.map((chapter) => chapter.title)).toEqual(titles)
  for (const chapter of chapters) {
    const scenes = chapter.scenes ?? []
    expect(scenes.length).toBeGreaterThan(0)
    for (const scene of scenes) {
      expect((scene.prose ?? '').trim().length).toBeGreaterThan(0)
    }
  }
  const novel = readFileSync(novelPath, 'utf8')
  for (const title of titles) expect(novel.includes(title)).toBe(true)
  expect(novel.includes('3b7c83ea')).toBe(false)
  expect(novel.includes('f63f5409')).toBe(false)
})

test('打开这本书看到十章并打开一场', async ({ browser, screen }) => {
  const listed = await fetch(`${baseURL}/api/books`)
  const books = (await listed.json()) as { books: Array<{ id: string; name: string }> }
  const book = books.books.find((item) => item.name === bookName)
  expect(book).toBeTruthy()
  await fetch(`${baseURL}/api/books/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: book!.id }),
  })
  await browser.goto('/xuehua/')
  await browser.locator('nav[aria-label="页面"]').getByRole('button', { name: '章节', exact: true }).click()
  for (const title of titles) {
    await expect(screen.getByText(title).first()).toBeVisible()
  }
  const firstProse = screen.getByLabel('第1场正文').first()
  await expect(firstProse).toBeVisible()
  const value = await firstProse.inputValue()
  expect(value).toContain('罗柏把北境剩下的步兵收拢到河岸')
})
