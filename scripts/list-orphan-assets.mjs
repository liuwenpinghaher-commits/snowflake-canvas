// 列出一本书里没有任何正文、封面或快照引用的附件。只打印，不删除。
import { listOrphanAssets } from "../server/assets.mjs"

const dir = process.argv[2]
if (!dir) {
  console.error("用法：node scripts/list-orphan-assets.mjs <书目录>")
  process.exit(2)
}

const orphans = await listOrphanAssets(dir)
for (const item of orphans) console.log(item)
