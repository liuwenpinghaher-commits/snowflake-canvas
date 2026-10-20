import { execFile, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export function readDsn() {
  if (process.env.SNOWFLAKE_DATABASE_URL) return process.env.SNOWFLAKE_DATABASE_URL
  const text = readFileSync(join(here, 'dsn.local'), 'utf8')
  const line = text.split('\n').find((item) => item.startsWith('SNOWFLAKE_DATABASE_URL='))
  if (!line) throw new Error('缺少 snowflake 库连接串')
  return line.slice('SNOWFLAKE_DATABASE_URL='.length).trim()
}

function passwordFrom(url) {
  const rest = url.split('://')[1] || ''
  const creds = rest.split('@')[0] || ''
  return decodeURIComponent(creds.split(':').slice(1).join(':'))
}

export function psql(database, sql) {
  const url = readDsn()
  const pass = passwordFrom(url)
  return execFileSync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${pass}`, 'gbrain-postgres', 'psql', '-h', '127.0.0.1', '-U', 'snowflake_app', '-d', database, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim()
}

export function psqlFile(database, file) {
  const url = readDsn()
  const pass = passwordFrom(url)
  const sql = readFileSync(file, 'utf8')
  return execFileSync(
    'docker',
    ['exec', '-e', `PGPASSWORD=${pass}`, '-i', 'gbrain-postgres', 'psql', '-h', '127.0.0.1', '-U', 'snowflake_app', '-d', database, '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql },
  )
}

export function applySchema() {
  return psqlFile('snowflake', join(here, 'schema.sql'))
}

export function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

export function mirrorDocument(bookId, document) {
  const text = JSON.stringify(document)
  psql(
    'snowflake',
    `INSERT INTO book (id, title, document_text) VALUES (${quoteLiteral(bookId)}, ${quoteLiteral('')}, ${quoteLiteral(text)}) ON CONFLICT (id) DO UPDATE SET document_text = EXCLUDED.document_text, updated_at = now()`,
  )
}

export function readMirroredDocument(bookId) {
  const text = psql('snowflake', `SELECT document_text FROM book WHERE id = ${quoteLiteral(bookId)}`)
  return JSON.parse(text)
}

export function chapterKeyCountSql() {
  const text = psql('snowflake', `SELECT count(*) FROM card WHERE fields ? 'chapter'`)
  return Number(text)
}

export function mirrorDocumentAsync(bookId, document) {
  let url
  try {
    url = readDsn()
  } catch {
    return Promise.resolve(false)
  }
  const pass = passwordFrom(url)
  const text = JSON.stringify(document)
  const sql = `INSERT INTO book (id, title, document_text) VALUES (${quoteLiteral(bookId)}, ${quoteLiteral('')}, ${quoteLiteral(text)}) ON CONFLICT (id) DO UPDATE SET document_text = EXCLUDED.document_text, updated_at = now()`
  return new Promise((resolve) => {
    execFile(
      'docker',
      ['exec', '-e', `PGPASSWORD=${pass}`, 'gbrain-postgres', 'psql', '-h', '127.0.0.1', '-U', 'snowflake_app', '-d', 'snowflake', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
      { timeout: 5000 },
      (err) => resolve(!err),
    )
  })
}
