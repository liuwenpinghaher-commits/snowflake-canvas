export function canonicalStem(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"))
  const base = slash >= 0 ? fileName.slice(slash + 1) : fileName
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return base
  return base.slice(0, dot)
}

export function formatSnapshotStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function snapshotFileName(canonicalName: string, date: Date, existing: ReadonlySet<string>): string {
  const stem = canonicalStem(canonicalName)
  const stamp = formatSnapshotStamp(date)
  const plain = `${stem}.${stamp}.snapshot.json`
  if (!existing.has(plain)) return plain
  const millis = date.getMilliseconds()
  for (let step = 0; step <= 1000; step += 1) {
    const suffix = String((millis + step) % 1000).padStart(3, "0")
    const withMillis = `${stem}.${stamp}${suffix}.snapshot.json`
    if (!existing.has(withMillis)) return withMillis
  }
  for (let extra = 1; extra < 10000; extra += 1) {
    const suffix = String(millis).padStart(3, "0")
    const name = `${stem}.${stamp}${suffix}-${extra}.snapshot.json`
    if (!existing.has(name)) return name
  }
  throw new Error("快照文件名都已占用")
}

export function isSnapshotFileName(fileName: string, canonicalName: string): boolean {
  const stem = canonicalStem(canonicalName)
  if (!fileName.startsWith(`${stem}.`) || !fileName.endsWith(".snapshot.json")) return false
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) return false
  return true
}
