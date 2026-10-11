// 服务进程是 `node server/http.mjs`。这台机器上的 Node 没有编进 TypeScript，
// 不能直接 import `src/document.ts`。这里把该文件转成脚本再加载，好调用切片 A 的 applySediment，
// 而不是在服务端另写一套折叠。
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), '../src/document.ts')

let pending = null
let pendingHash = ''

export function loadDocumentModule() {
  const source = readFileSync(sourcePath, 'utf8')
  const hash = createHash('sha256').update(source).digest('hex')
  if (pending && pendingHash === hash) return pending
  pendingHash = hash
  pending = load(source, hash).catch((error) => {
    if (pendingHash === hash) {
      pending = null
      pendingHash = ''
    }
    throw error
  })
  return pending
}

async function load(source, hash) {
  const ts = await import('typescript')
  const typescript = ts.default ?? ts
  const javascript = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ES2022,
      target: typescript.ScriptTarget.ES2022,
    },
  }).outputText
  const dir = join(tmpdir(), 'snowflake-document-bridge')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${hash}.mjs`)
  writeFileSync(file, javascript)
  return import(pathToFileURL(file).href)
}
