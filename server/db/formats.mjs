// 服务端导出：Markdown、纯文本、docx、epub。zip 只用存储方式，避免再加依赖。

const CRC_TABLE = makeCrcTable()

function makeCrcTable() {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let crc = index
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
    table[index] = crc >>> 0
  }
  return table
}

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

export function zipStore(files, date = new Date('2026-10-16T00:00:00Z')) {
  const { time, day } = dosTime(date)
  const locals = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data)
    const crc = crc32(data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    locals.push(local, data)
    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuf, end])
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function markdownOf(book) {
  const lines = [`# ${book.title || '未命名书'}`, '']
  for (const [chapterIndex, chapter] of orderedChapters(book).entries()) {
    lines.push(`## 第${chapterIndex + 1}章 ${chapter.title || '未命名'}`, '')
    for (const [sceneIndex, scene] of orderedScenes(chapter).entries()) {
      lines.push(`### 第${sceneIndex + 1}场 ${scene.title || '未命名场'}`, '', scene.body || '', '')
    }
  }
  return lines.join('\n')
}

export function plainOf(book) {
  const parts = []
  for (const chapter of orderedChapters(book)) {
    for (const scene of orderedScenes(chapter)) parts.push(scene.body || '')
  }
  return parts.join('\n')
}

export function docxOf(book) {
  const paragraphs = []
  paragraphs.push(paragraph(book.title || '未命名书'))
  for (const chapter of orderedChapters(book)) {
    paragraphs.push(paragraph(chapter.title || '未命名'))
    for (const scene of orderedScenes(chapter)) {
      for (const line of (scene.body || '').split('\n')) paragraphs.push(paragraph(line))
    }
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  return zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: document },
  ])
}

function paragraph(text) {
  return `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
}

export function epubOf(book) {
  const chapters = orderedChapters(book)
  const xhtml = []
  const manifest = []
  const spine = []
  const navItems = []
  chapters.forEach((chapter, chapterIndex) => {
    orderedScenes(chapter).forEach((scene, sceneIndex) => {
      const id = `c${chapterIndex + 1}s${sceneIndex + 1}`
      const href = `${id}.xhtml`
      const title = `第${chapterIndex + 1}章第${sceneIndex + 1}场 ${scene.title || ''}`.trim()
      const body = (scene.body || '')
        .split('\n')
        .map((line) => `<p>${xmlEscape(line)}</p>`)
        .join('')
      xhtml.push({
        name: `OEBPS/${href}`,
        data: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" lang="zh"><head><title>${xmlEscape(title)}</title></head><body><h1>${xmlEscape(title)}</h1>${body}</body></html>`,
      })
      manifest.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`)
      spine.push(`<itemref idref="${id}"/>`)
      navItems.push(`<li><a href="${href}">${xmlEscape(title)}</a></li>`)
    })
  })
  if (xhtml.length === 0) {
    xhtml.push({
      name: 'OEBPS/empty.xhtml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh" lang="zh"><head><title>空</title></head><body><p>没有正文</p></body></html>`,
    })
    manifest.push(`<item id="empty" href="empty.xhtml" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="empty"/>`)
    navItems.push(`<li><a href="empty.xhtml">空</a></li>`)
  }
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0" xml:lang="zh">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:snowflake-${xmlEscape(book.id || 'book')}</dc:identifier>
    <dc:title>${xmlEscape(book.title || '未命名书')}</dc:title>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">2026-10-16T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifest.join('\n    ')}
  </manifest>
  <spine>${spine.join('')}</spine>
</package>`
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh" lang="zh"><head><title>目录</title></head><body><nav epub:type="toc" id="toc"><ol>${navItems.join('')}</ol></nav></body></html>`
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  return zipStore([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: container },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: nav },
    ...xhtml,
  ])
}

function orderedChapters(book) {
  return [...(book.chapters || [])].filter((chapter) => !chapter.deletedAt).sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))
}

function orderedScenes(chapter) {
  return [...(chapter.scenes || [])].filter((scene) => !scene.deletedAt).sort((a, b) => a.ord - b.ord || a.id.localeCompare(b.id))
}

export function stripSpace(text) {
  return [...String(text).replace(/\s/gu, '')].join('')
}
