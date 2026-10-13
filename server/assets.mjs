import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"

export const ASSET_LIMIT = 10 * 1024 * 1024
export const ASSET_EXTENSIONS = ["jpg", "png", "webp", "gif", "pdf", "epub", "m4a"]

const ALLOWED = new Set(ASSET_EXTENSIONS)
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
}

const CONTENT_TYPE = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  epub: "application/epub+zip",
  m4a: "audio/mp4",
}

const RELATIVE_RE = /^assets\/[0-9a-f]{2}\/[0-9a-f]{16}\.(jpg|png|webp|gif|pdf|epub|m4a)$/

export function assetExtension(filename, mime) {
  const clean = String(filename || "").toLowerCase()
  const dot = clean.lastIndexOf(".")
  let ext = dot >= 0 ? clean.slice(dot + 1) : ""
  if (ext === "jpeg") ext = "jpg"
  const fromMime = MIME_EXT[String(mime || "").split(";")[0].trim().toLowerCase()] || ""
  if (ext && ALLOWED.has(ext)) {
    if (fromMime && fromMime !== ext) return ""
    return ext
  }
  return fromMime && ALLOWED.has(fromMime) ? fromMime : ""
}

export function relativeAssetPath(sha256hex, ext) {
  const sha16 = String(sha256hex).slice(0, 16)
  return `assets/${sha16.slice(0, 2)}/${sha16}.${ext}`
}

export function isAssetRelativePath(value) {
  return typeof value === "string" && RELATIVE_RE.test(value)
}

export function readMultipartFile(buffer, contentType) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  const found = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ""))
  if (!found) return { ok: false, error: "没有分界，文件没有收下" }
  const boundary = found[1] || found[2]
  const marker = Buffer.from(`--${boundary}`)
  let at = raw.indexOf(marker)
  if (at < 0) return { ok: false, error: "没有分界，文件没有收下" }
  let cursor = at + marker.length
  if (raw.subarray(cursor, cursor + 2).equals(Buffer.from("\r\n"))) cursor += 2
  else if (raw.subarray(cursor, cursor + 1).equals(Buffer.from("\n"))) cursor += 1
  const headerEnd = raw.indexOf(Buffer.from("\r\n\r\n"), cursor)
  const headerEndLf = headerEnd < 0 ? raw.indexOf(Buffer.from("\n\n"), cursor) : -1
  const splitAt = headerEnd >= 0 ? headerEnd : headerEndLf
  const splitLen = headerEnd >= 0 ? 4 : 2
  if (splitAt < 0) return { ok: false, error: "文件头不完整" }
  const headers = raw.subarray(cursor, splitAt).toString("utf8")
  const dataStart = splitAt + splitLen
  const next = Buffer.from(`\r\n--${boundary}`)
  let dataEnd = raw.indexOf(next, dataStart)
  if (dataEnd < 0) dataEnd = raw.indexOf(Buffer.from(`\n--${boundary}`), dataStart)
  if (dataEnd < 0) return { ok: false, error: "文件内容不完整" }
  const bytes = raw.subarray(dataStart, dataEnd)
  const named = /filename="([^"]*)"/i.exec(headers) || /filename\*=UTF-8''([^;\r\n]+)/i.exec(headers)
  let filename = named ? named[1] : "file"
  try {
    filename = decodeURIComponent(filename)
  } catch {
    // 文件名不是百分号编码就用原文。
  }
  const typed = /content-type:\s*([^\r\n]+)/i.exec(headers)
  const mime = typed ? typed[1].trim() : ""
  const disposition = /content-disposition:[^\r\n]*/i.exec(headers)
  const field = disposition ? /name="([^"]*)"/i.exec(disposition[0]) : null
  return { ok: true, bytes, filename, mime, field: field ? field[1] : "" }
}

function inside(root, target) {
  const base = resolve(root)
  const file = resolve(target)
  return file === base || file.startsWith(base + sep)
}

export async function storeAsset(bookDir, input) {
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes || [])
  if (bytes.length === 0) return { ok: false, statusCode: 400, error: "文件是空的，没有收下" }
  if (bytes.length > ASSET_LIMIT) return { ok: false, statusCode: 413, error: "文件超过 10MB，没有收下" }
  const ext = assetExtension(input.filename, input.mime)
  if (!ext) return { ok: false, statusCode: 415, error: "这种文件不能放进这本书" }
  const hash = createHash("sha256").update(bytes).digest("hex")
  const relativePath = relativeAssetPath(hash, ext)
  if (!isAssetRelativePath(relativePath)) return { ok: false, statusCode: 400, error: "路径不合规" }
  const target = join(bookDir, ...relativePath.split("/"))
  if (!inside(bookDir, target)) return { ok: false, statusCode: 400, error: "路径不合规" }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  try {
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 })
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error
    const existing = await readFile(target)
    if (!existing.equals(bytes)) {
      return { ok: false, statusCode: 409, error: "同样的短地址已经有另一份文件" }
    }
  }
  return {
    ok: true,
    statusCode: 200,
    relativePath,
    size: bytes.length,
    name: String(input.filename || "").trim() || `file.${ext}`,
  }
}

export function assetContentType(relativePath) {
  const ext = String(relativePath || "").split(".").pop()
  return CONTENT_TYPE[ext] || "application/octet-stream"
}

export function assetFilePath(bookDir, urlPath) {
  const raw = String(urlPath || "").replace(/^\/+/, "")
  const relativePath = raw.startsWith("assets/") ? raw : `assets/${raw}`
  if (!isAssetRelativePath(relativePath)) return null
  const target = join(bookDir, ...relativePath.split("/"))
  if (!inside(join(bookDir, "assets"), target)) return null
  return { relativePath, target }
}

export function openAssetStream(target) {
  return createReadStream(target)
}

async function walkFiles(dir, out) {
  let names
  try {
    names = await readdir(dir)
  } catch (error) {
    if (error && error.code === "ENOENT") return
    throw error
  }
  for (const name of names) {
    const full = join(dir, name)
    const info = await stat(full)
    if (info.isDirectory()) await walkFiles(full, out)
    else if (info.isFile()) out.push(full)
  }
}

async function referenceText(bookDir) {
  const chunks = []
  async function walk(dir) {
    const names = await readdir(dir)
    for (const name of names) {
      if (dir === bookDir && name === "assets") continue
      const full = join(dir, name)
      const info = await stat(full)
      if (info.isDirectory()) {
        await walk(full)
        continue
      }
      if (!info.isFile()) continue
      if (!name.endsWith(".json") && !name.endsWith(".bak")) continue
      chunks.push(await readFile(full, "utf8"))
    }
  }
  await walk(bookDir)
  return chunks.join("\n")
}

// 只列出正本和快照都没写到的文件。不删除。
export async function listOrphanAssets(bookDir) {
  const text = await referenceText(bookDir)
  const files = []
  await walkFiles(join(bookDir, "assets"), files)
  const orphans = []
  for (const file of files) {
    const rel = relative(bookDir, file).split(sep).join("/")
    if (!text.includes(rel)) orphans.push(rel)
  }
  orphans.sort()
  return orphans
}

export function registerAssetRoutes(app, options) {
  const prefix = options.prefix || ""
  const bookFor = options.bookFor
  const sendNoBook = options.sendNoBook

  const receive = async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const raw = request.body
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || [])
    const parsed = readMultipartFile(buffer, request.headers["content-type"])
    if (!parsed.ok) {
      reply.code(400)
      return reply.send({ error: parsed.error })
    }
    if (parsed.field && parsed.field !== "file") {
      reply.code(400)
      return reply.send({ error: "请用 file 字段上传" })
    }
    try {
      const stored = await storeAsset(book.dir, parsed)
      reply.code(stored.ok ? 200 : stored.statusCode)
      reply.header("Cache-Control", "no-store")
      if (!stored.ok) return reply.send({ error: stored.error })
      return reply.send({ relativePath: stored.relativePath, size: stored.size, name: stored.name })
    } catch (error) {
      reply.code(500)
      return reply.send({ error: error instanceof Error ? error.message : "文件没有写下" })
    }
  }

  const send = async (request, reply) => {
    const book = await bookFor(request)
    if (!book) return sendNoBook(reply)
    const wild = request.params ? request.params["*"] : ""
    const located = assetFilePath(book.dir, wild)
    if (!located) {
      reply.code(404)
      return reply.send({ error: "没有这个文件" })
    }
    try {
      await stat(located.target)
    } catch {
      reply.code(404)
      return reply.send({ error: "没有这个文件" })
    }
    reply.header("Cache-Control", "public, max-age=31536000, immutable")
    reply.type(assetContentType(located.relativePath))
    return reply.send(openAssetStream(located.target))
  }

  app.post(`${prefix}/api/assets`, receive)
  app.post(`${prefix}/api/books/:bookId/assets`, receive)
  app.get(`${prefix}/api/assets/*`, send)
  app.get(`${prefix}/api/books/:bookId/assets/*`, send)
}
