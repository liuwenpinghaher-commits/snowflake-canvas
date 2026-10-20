import { expect } from 'e2e'
import { test } from '@e2e-dev/web'

const baseURL = process.env.SNOWFLAKE_E2E_URL || 'http://127.0.0.1:18093'
const E2E_BOOK_NAME = '冰与火之歌·雪花E2E全链路'

async function getActiveBookId(): Promise<string> {
  const res = await fetch(`${baseURL}/api/books`)
  expect(res.ok).toBe(true)
  const data = (await res.json()) as {
    books: Array<{ id: string; name: string }>
    activeBookId: string
  }
  const found = data.books.find((item) => item.name === E2E_BOOK_NAME)
  const targetId = found ? found.id : data.activeBookId
  if (data.activeBookId !== targetId) {
    await fetch(`${baseURL}/api/books/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: targetId }),
    })
  }
  return targetId
}

test('阶段1：新建小说项目（四步向导与初始设定卡落盘）', async ({ browser, screen }) => {
  await browser.goto('/xuehua/')
  await expect(screen.getByRole('button', { name: '更多' })).toBeVisible()

  // 打开顶栏「更多」->「书籍」->「新建书」
  await screen.getByRole('button', { name: '更多' }).click()
  await screen.getByRole('button', { name: '书籍' }).click()
  await screen.getByRole('button', { name: '新建书' }).click()

  // 步骤 1：设定导入
  const wizard = browser.locator('section.wizard[aria-label="新建书"]')
  await expect(wizard).toBeVisible()
  await wizard.getByText('贴一段设定文字，建书后放成第一张卡片').click()
  await wizard.getByLabel('设定文字').fill('凛冬将至：守夜人在北境密林目睹异鬼复苏，奈德必须在王命与家族之间抉择。')
  await wizard.getByRole('button', { name: '下一步' }).click()

  // 步骤 2：默认值
  await wizard.getByPlaceholder('例如 300000，可空').fill('150000')
  await wizard.getByPlaceholder('例如 悲剧').fill('群像史诗')
  await wizard.getByRole('button', { name: '下一步' }).click()

  // 步骤 3：名称和题材
  await wizard.getByLabel('书名').fill(E2E_BOOK_NAME)
  await wizard.getByLabel('一句话简介').fill('七大王国在凛冬降临前的权谋与守夜人誓言')
  await wizard.getByRole('button', { name: '下一步' }).click()

  // 步骤 4：建书预览并提交
  await expect(wizard.getByText(E2E_BOOK_NAME)).toBeVisible()
  await expect(wizard.getByText('15 万字')).toBeVisible()
  await wizard.getByRole('button', { name: '建书' }).click()

  // 验证自动切换到新书画布，且初始设定卡片已生成在画布上
  const bookSelect = browser.locator('select[aria-label="当前书"]')
  await expect(bookSelect).toBeVisible()
  await expect(browser.locator('.snow-card').first()).toContainText('凛冬将至')
})

test('阶段2：十层雪花法推演、跨层派生与上游变更待复核闭环', async ({ browser }) => {
  const bookId = await getActiveBookId()
  const headRes = await fetch(`${baseURL}/api/books/${bookId}/canvas`)
  expect(headRes.ok).toBe(true)
  const etag = headRes.headers.get('ETag') || '"1"'
  const current = (await headRes.json()) as { document: Record<string, unknown> }

  // 构造十层雪花推演链：一句话(c-s1) -> 一段(c-s2) -> 人物表(c-s3) -> 场景表(c-s4)，并模拟上游一句话变更触发下游 needsReview
  const docWithSnowflake = {
    ...current.document,
    canvas: {
      nodes: [
        { id: 'c-s1', x: 60, y: 80, width: 280, height: 160, type: 'text' },
        { id: 'c-s2', x: 360, y: 80, width: 280, height: 160, type: 'text' },
        { id: 'c-s3', x: 660, y: 80, width: 280, height: 160, type: 'text' },
        { id: 'c-s4', x: 960, y: 80, width: 280, height: 160, type: 'text' },
      ],
      edges: [
        { id: 'e-s1-s2', fromNode: 'c-s1', toNode: 'c-s2', kind: 'grows-from' },
        { id: 'e-s2-s3', fromNode: 'c-s2', toNode: 'c-s3', kind: 'grows-from' },
        { id: 'e-s2-s4', fromNode: 'c-s2', toNode: 'c-s4', kind: 'grows-from' },
        { id: 'e-ned-cat', fromNode: 'ent-ned', toNode: 'ent-cat', kind: 'relates-entity' },
        { id: 'e-ned-jon', fromNode: 'ent-ned', toNode: 'ent-jon', kind: 'relates-entity' },
        { id: 'e-s4-ned', fromNode: 'c-s4', toNode: 'ent-ned', kind: 'appears-in' },
        { id: 'e-s1-s4-conflict', fromNode: 'c-s1', toNode: 'c-s4', kind: 'relates', relation: '冲突' },
      ],
    },
    snowflake: {
      fileId: bookId,
      cards: {
        'c-s1': {
          layer: '一句话',
          body: '北境守护奈德奉命南下君临担任国王之手，揭开王室血脉真相。',
          fields: { sentence: '北境守护奈德奉命南下君临担任国王之手，揭开王室血脉真相。' },
        },
        'c-s2': {
          layer: '一段',
          body: '琼恩·艾林暴毙引发连环危机，奈德在君临孤立无援。',
          fields: {
            background: '琼恩·艾林暴毙，劳勃北上临冬城授印',
            disaster1: '布兰坠塔昏迷，刺客携瓦雷利亚钢匕首行刺',
            disaster2: '奈德查出乔佛里并非劳勃亲生，打草惊蛇',
            disaster3: '劳勃遇刺驾崩，金袍子倒戈背叛',
            resolution: '圣堂前被迫认罪，战火全面点燃',
          },
          derivedFrom: 'c-s1',
          needsReview: true,
        },
        'c-s3': {
          layer: 'renwubiao',
          body: '奈德·史塔克',
          fields: {
            name: '奈德·史塔克',
            grade: '主要',
            role: '临冬城公爵 / 国王之手',
            sentence: '恪守荣誉却深陷君临权谋旋涡的北境守护。',
            motivation: '守护家族血脉与古老荣誉',
            goal: '查明前任首相死因并护送子女安全返北',
          },
          derivedFrom: 'c-s2',
        },
        'c-s4': {
          layer: 'changci',
          body: '临冬城神木林议事',
          fields: {
            title: '神木林擦剑',
            chapter: '第1章',
            pov: '奈德·史塔克',
            structureKind: 'active',
            task: '在心树下听凯特琳宣读鹰巢城密信并决定是否南下',
            goal: '拒绝南下以保全北境安宁',
            conflict: '凯特琳指出暗杀嫌疑直指兰尼斯特家族',
            setback: '不得不答应接任国王之手深入虎穴',
          },
          derivedFrom: 'c-s2',
        },
      },
    },
    entities: [
      {
        id: 'ent-ned',
        entityType: 'person',
        name: '奈德·史塔克',
        views: { renwubiao: 'c-s3' },
        fields: {
          name: { value: '奈德·史塔克', events: [] },
          grade: { value: '主要', events: [] },
          role: { value: '临冬城公爵 / 国王之手', events: [] },
          sentence: { value: '恪守荣誉却深陷君临权谋旋涡的北境守护。', events: [] },
          motivation: { value: '守护家族血脉与古老荣誉', events: [] },
          goal: { value: '查明前任首相死因并护送子女安全返北', events: [] },
        },
        arc: {
          start: '镇守北境心如止水',
          door: '接过国王之手徽章南下',
          impact: '发现王室乱伦血脉铁证',
          deepen: '不忍孩童受戮提前摊牌',
          turn: '王座厅遭金袍子背刺入狱',
          consequence: '贝勒大圣堂殒命点燃五王之战',
        },
        premise: true,
      },
      {
        id: 'ent-cat',
        entityType: 'person',
        name: '凯特琳·史塔克',
        views: {},
        fields: {
          name: { value: '凯特琳·史塔克', events: [] },
          grade: { value: '主要', events: [] },
          role: { value: '临冬城夫人', events: [] },
          sentence: { value: '为护子女不惜孤身南下追查匕首真凶。', events: [] },
        },
        arc: { start: '忧心南下', door: '刺客闯入', impact: '秘赴君临', deepen: '客栈拿人', turn: '孪河城谈判', consequence: '随军北征' },
        premise: false,
      },
      {
        id: 'ent-jon',
        entityType: 'person',
        name: '琼恩·雪诺',
        views: {},
        fields: {
          name: { value: '琼恩·雪诺', events: [] },
          grade: { value: '次要', events: [] },
          role: { value: '守夜人新兵', events: [] },
          sentence: { value: '披上黑衣前往绝境长城寻找自身归属。', events: [] },
        },
        arc: { start: '私生子之痛', door: '北上长城', impact: '直面残酷现实', deepen: '团结新兵', turn: '尸鬼夜袭救总司令', consequence: '立誓远征塞外' },
        premise: false,
      },
      {
        id: 'ent-areo',
        entityType: 'person',
        name: '阿利奥·何塔',
        views: {},
        fields: {
          name: { value: '阿利奥·何塔', events: [] },
          grade: { value: 'NPC', events: [] },
          role: { value: '阳戟城侍卫队长', events: [] },
          sentence: { value: '观察、倾听、服从。', events: [] },
        },
        arc: { start: '', door: '', impact: '', deepen: '', turn: '', consequence: '' },
        premise: false,
      },
    ],
    chapters: [
      {
        id: 'ch-e2e-1',
        title: '北境来客',
        scenes: [
          {
            id: 'sc-e2e-1-1',
            title: '神木林擦剑',
            ideaIds: ['c-s4'],
            prose: '寒风掠过临冬城的鱼梁木，奈德·史塔克正在池畔擦拭寒冰巨剑。',
            beatIds: ['c-s4'],
            step: '起因',
            rev: 1,
          },
        ],
      },
    ],
  }

  const putRes = await fetch(`${baseURL}/api/books/${bookId}/canvas`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify(docWithSnowflake),
  })
  expect(putRes.ok).toBe(true)

  await browser.goto('/xuehua/')
  await expect(browser.locator('.snow-card')).toHaveCount(4)

  // 点击处于 needsReview 状态的「一段」卡片，验证出现「待复核：上游卡片已变更」并点击「标为已复核」
  const paraCard = browser.locator('.react-flow__node[data-id="c-s2"]')
  await paraCard.click()
  const sideEditor = browser.locator('aside.control-pane')
  await expect(sideEditor).toBeVisible()
  await expect(browser.locator('aside.control-pane .review-badge')).toHaveText('待复核：上游卡片已变更')
  await sideEditor.getByRole('button', { name: '标为已复核' }).click()
  await expect(browser.locator('aside.control-pane .review-badge')).toHaveCount(0)
})

test('阶段3：画布念头讨论抽屉与设定沉淀入库（百科同步）', async ({ browser }) => {
  const bookId = await getActiveBookId()
  await browser.goto('/xuehua/')

  // 点击第一张雪花卡片打开右侧讨论抽屉
  await browser.locator('.react-flow__node[data-id="c-s1"]').click()
  await expect(browser.locator('aside.session-pane')).toBeVisible()
  await expect(browser.locator('aside.session-pane .discuss-dock')).toBeVisible()

  // 调用沉淀入库接口将讨论得出的地点/概念设定沉淀至当前书，并在百科页核对展示
  const sedRes = await fetch(`${baseURL}/api/books/${bookId}/book-sediment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '瓦雷利亚钢匕首',
      text: '柄嵌龙骨、刃铸瓦雷利亚钢的刺客凶器，成为史塔克与兰尼斯特决裂的导火索。',
      kind: '设定',
    }),
  })
  expect(sedRes.ok).toBe(true)
  const sedBody = (await sedRes.json()) as { entityId: string }
  expect(Boolean(sedBody.entityId)).toBe(true)

  // 核对正本已将沉淀实体与正文入库
  const verifyRes = await fetch(`${baseURL}/api/books/${bookId}/canvas`)
  expect(verifyRes.ok).toBe(true)
  const verifyJson = JSON.stringify(await verifyRes.json())
  expect(verifyJson).toContain('瓦雷利亚钢匕首')
  expect(verifyJson).toContain('柄嵌龙骨、刃铸瓦雷利亚钢的刺客凶器')

  // 刷新并进入「百科」页核对沉淀条目与展开面板
  await browser.goto('/xuehua/')
  await browser.locator('nav[aria-label="页面"]').getByRole('button', { name: '百科', exact: true }).click()
  const row = browser.locator('.encyclopedia-row').filter({ hasText: '瓦雷利亚钢匕首' })
  await expect(row).toBeVisible()
  await row.click()
  await expect(browser.locator('section.encyclopedia-page').getByLabel('页名')).toBeVisible()
  await expect(browser.locator('section.encyclopedia-page').getByRole('button', { name: '从相册或本地选择封面' })).toBeVisible()
})

test('阶段4：人物三区表单编辑与 Cytoscape 双图层关系图交互', async ({ browser }) => {
  await getActiveBookId()
  await browser.goto('/xuehua/')
  const pageNav = browser.locator('nav[aria-label="页面"]')

  // 1. 进入人物页，核对表格视图、筛选与三区表单展开编辑
  await pageNav.getByRole('button', { name: '人物', exact: true }).click()
  const castPage = browser.locator('section.cast-page')
  await expect(castPage).toBeVisible()
  await expect(browser.locator('tr.cast-summary').filter({ hasText: '奈德·史塔克' })).toBeVisible()
  await expect(browser.locator('tr.cast-summary').filter({ hasText: '凯特琳·史塔克' })).toBeVisible()
  await expect(browser.locator('tr.cast-summary').filter({ hasText: '琼恩·雪诺' })).toBeVisible()

  // 展开奈德·史塔克的三区表单（身份 / 叙事功能+弧线 / 档案+沉淀账本）
  await browser.locator('tr.cast-summary').filter({ hasText: '奈德·史塔克' }).click()
  await expect(browser.locator('.person-zones').first()).toBeVisible()
  await expect(browser.locator('section.person-zone[aria-label="身份"]')).toBeVisible()
  await expect(browser.locator('section.person-zone[aria-label="叙事功能"]')).toBeVisible()
  await expect(browser.locator('section.person-zone[aria-label="档案"]')).toBeVisible()
  await expect(browser.locator('section.person-zone[aria-label="沉淀账本"]')).toBeVisible()

  // 切换到人物看板视图核对主要/次要/NPC 分列
  await castPage.getByRole('tab', { name: '看板' }).click()
  await expect(browser.locator('.cast-board')).toBeVisible()
  await expect(browser.locator('.board-col[aria-label="主要"]')).toContainText('奈德·史塔克')
  await expect(browser.locator('.board-col[aria-label="次要"]')).toContainText('琼恩·雪诺')
  await expect(browser.locator('.board-col[aria-label="NPC"]')).toContainText('阿利奥·何塔')
  await castPage.getByRole('tab', { name: '表' }).click()

  // 2. 进入关系页，验证 Cytoscape 双图层渲染、卡片层开关、度过滤与关系表视图
  await pageNav.getByRole('button', { name: '关系', exact: true }).click()
  const relationPage = browser.locator('section.relation-page')
  await expect(relationPage).toBeVisible()
  await expect(browser.locator('.relation-cyto canvas').first()).toBeVisible()

  // 切换「卡片层」复选框与「隐藏孤点」复选框
  const ideaLayerCheckbox = browser.locator('aside.relation-filter input[type="checkbox"]').first()
  await ideaLayerCheckbox.click()
  await ideaLayerCheckbox.click()
  await relationPage.getByLabel('隐藏孤点').check()
  await relationPage.getByLabel('隐藏孤点').uncheck()

  // 切换到关系「表」视图核对实体边与卡片边
  await relationPage.getByRole('tab', { name: '表' }).click()
  const relationTable = browser.locator('table.relation-table')
  await expect(relationTable).toBeVisible()
  await expect(relationTable).toContainText('奈德·史塔克')
  await expect(relationTable).toContainText('凯特琳·史塔克')
  await relationPage.getByRole('tab', { name: '图' }).click()
})

test('阶段5：章节/场次树状写作、节拍表与 Notion 块编辑器交互', async ({ browser }) => {
  await getActiveBookId()
  await browser.goto('/xuehua/')
  const pageNav = browser.locator('nav[aria-label="页面"]')

  // 1. 进入章节页写作并生成修订版本
  await pageNav.getByRole('button', { name: '章节', exact: true }).click()
  const chapterPage = browser.locator('section.chapter-page')
  await expect(chapterPage).toBeVisible()
  await expect(chapterPage).toContainText('北境来客')

  const proseInput = chapterPage.getByLabel('神木林擦剑正文')
  await expect(proseInput).toBeVisible()
  const updatedProse = '寒风掠过临冬城的鱼梁木，奈德·史塔克在心树下读完密信，决定亲赴君临查明真相。'
  await proseInput.fill(updatedProse)
  await browser.evaluate(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
  })

  // 切换到「节拍表」标签核对节拍槽位与结构尺，再切回「章场」
  await chapterPage.getByRole('tab', { name: '节拍表' }).click()
  await expect(chapterPage.getByRole('tab', { name: '节拍表' })).toHaveAttribute('aria-selected', 'true')
  await chapterPage.getByRole('tab', { name: '章场' }).click()

  // 2. 进入场次页，验证表格与看板双视图
  await pageNav.getByRole('button', { name: '场次', exact: true }).click()
  const scenePage = browser.locator('section.scene-page')
  await expect(scenePage).toBeVisible()
  await expect(browser.locator('table.scene-table')).toContainText('神木林擦剑')
  await scenePage.getByRole('tab', { name: '看板' }).click()
  await expect(browser.locator('.scene-board')).toBeVisible()
  await scenePage.getByRole('tab', { name: '表' }).click()

  // 3. 回到画布，选中非人物卡片验证 Notion 块级编辑器（BlockField）渲染与编辑
  await pageNav.getByRole('button', { name: '画布', exact: true }).click()
  await browser.locator('.react-flow__node[data-id="c-s1"]').click()
  await expect(browser.locator('aside.control-pane .cm-host')).toBeVisible()
  await expect(browser.locator('aside.control-pane .cm-host .cm-content').first()).toContainText('北境守护奈德奉命南下君临')
})

test('阶段6：双时态场次滑块、POV 戏剧反差对照与三态冲突裁决闭环', async ({ browser }) => {
  await browser.goto('/xuehua/')
  await browser.locator('nav[aria-label="页面"]').getByRole('button', { name: '时序/设定演进（Bitemporal）' }).click()

  const btPage = browser.locator('[data-testid="bitemporal-page"]')
  await expect(btPage).toBeVisible()
  await expect(btPage.getByRole('heading', { name: '客观正史 (Canon Truth)' })).toBeVisible()
  await expect(btPage.getByRole('heading', { name: '角色主观认知 (POV Belief)' })).toBeVisible()

  // 1. 切换场次锚点（S12 君临调查 -> S24 血统真相），验证正史与角色主观认知及「戏剧反差」动态演进
  await btPage.getByRole('button', { name: 'S12 君临调查' }).click()
  await expect(browser.locator('.bt-summary')).toContainText('当前第 12 场')
  await expect(btPage.getByText('戏剧反差').first()).toBeVisible()

  await btPage.getByRole('button', { name: 'S24 血统真相' }).click()
  await expect(browser.locator('.bt-summary')).toContainText('当前第 24 场')

  // 2. 新增一条场次断言（不重叠区间）并验证写入成功
  const form = browser.locator('form.bt-form')
  await form.getByLabel('主体').fill('arya-stark')
  await form.getByLabel('说法').fill('水舞者剑术')
  await form.getByLabel('内容').fill('在红堡跟随西利欧·佛瑞尔习剑')
  await form.getByLabel('从第几场').fill('15')
  await form.getByLabel('到第几场之前（可空）').fill('28')
  await form.getByRole('button', { name: '写入这条断言' }).click()
  await expect(browser.locator('.bt-tracks')).toContainText('水舞者剑术')

  // 3. 对待裁决冲突执行三态裁决并验证防篡改台账 LEDGER_OK
  const openConflict = browser.locator('article.bt-card.is-open').first()
  await expect(openConflict).toBeVisible()
  await btPage.getByPlaceholder('为什么这样裁决').fill('E2E 验收裁决：分域共存保留双重视角')
  await openConflict.getByRole('button', { name: '分域共存 (Coexist)' }).click()

  const ledgerBadge = browser.locator('[data-testid="ledger-badge"]')
  await expect(ledgerBadge).toContainText('LEDGER_OK')
})

test('阶段7：整书四格式导出（Markdown / TXT / DOCX / EPUB）完整度校验', async ({ browser }) => {
  const bookId = await getActiveBookId()
  await browser.goto('/xuehua/')
  await browser.locator('nav[aria-label="页面"]').getByRole('button', { name: '章节', exact: true }).click()

  // 1. 校验章节页导出栏四个下载入口存在
  const exportBar = browser.locator('.export-bar[aria-label="导出全书"]')
  await expect(exportBar).toBeVisible()
  await expect(exportBar.getByRole('link', { name: '导出 Markdown' })).toBeVisible()
  await expect(exportBar.getByRole('link', { name: '导出 TXT' })).toBeVisible()
  await expect(exportBar.getByRole('link', { name: '导出 DOCX' })).toBeVisible()
  await expect(exportBar.getByRole('link', { name: '导出 EPUB' })).toBeVisible()

  // 2. 实测四种导出格式的 HTTP 响应头与正文字节合法性
  const mdRes = await fetch(`${baseURL}/api/books/${bookId}/export?format=md`)
  expect(mdRes.ok).toBe(true)
  expect(mdRes.headers.get('content-type') || '').toContain('text/markdown')
  const mdText = await mdRes.text()
  expect(mdText).toContain('北境来客')
  expect(mdText).toContain('奈德·史塔克')

  const txtRes = await fetch(`${baseURL}/api/books/${bookId}/export?format=txt`)
  expect(txtRes.ok).toBe(true)
  expect(txtRes.headers.get('content-type') || '').toContain('text/plain')
  const txtText = await txtRes.text()
  expect(txtText).toContain('奈德·史塔克')

  const docxRes = await fetch(`${baseURL}/api/books/${bookId}/export?format=docx`)
  expect(docxRes.ok).toBe(true)
  expect(docxRes.headers.get('content-type') || '').toContain('officedocument.wordprocessingml.document')
  const docxBytes = new Uint8Array(await docxRes.arrayBuffer())
  expect(String.fromCharCode(docxBytes[0]!, docxBytes[1]!)).toBe('PK')

  const epubRes = await fetch(`${baseURL}/api/books/${bookId}/export?format=epub`)
  expect(epubRes.ok).toBe(true)
  expect(epubRes.headers.get('content-type') || '').toContain('application/epub+zip')
  const epubBytes = new Uint8Array(await epubRes.arrayBuffer())
  expect(String.fromCharCode(epubBytes[0]!, epubBytes[1]!)).toBe('PK')
})
