#!/usr/bin/env bash
# 验收 R1–R12。不访问外网，不重启 8093，不 docker stop。
# 常规保存必须是 PATCH 差异。下面这些整份写入不算按键保存，检查时排除：
# - src/books.ts 的 seedBookCanvas：空书导入时一次性 PUT 整份 JSON
# - server/http.mjs 的 PUT /canvas：测试、迁移和显式替换仍可用
# - 导出与冷备份只读出文件，不走保存
set -euo pipefail
cd "$(dirname "$0")/.."

fail() {
  echo "ACCEPT_FAIL $*"
  exit 1
}

branch="$(git branch --show-current)"
if [[ "$branch" != "snowflake-v3" && "$branch" != "v3" ]]; then
  fail "当前分支是 ${branch}，要停在 v3 或 snowflake-v3"
fi

checklist="artifacts/r1r12-checklist.md"
[[ -f "$checklist" ]] || fail "缺少核对表 ${checklist}"

for n in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if ! grep -q "| R${n} |" "$checklist"; then
    fail "核对表缺 R${n}"
  fi
done

for phrase in "章节可直接建" "草稿可界面挂接" "场正文可编辑" "写入为增量"; do
  if ! grep -q "${phrase}：已消除" "$checklist"; then
    fail "阻断未标已消除：${phrase}"
  fi
done

if ! command -v epubcheck >/dev/null 2>&1; then
  fail "缺少 epubcheck，不能把 epub 判成通过"
fi

if rg -n "method: 'PUT'" src/remote-canvas.ts >/dev/null 2>&1; then
  fail "src/remote-canvas.ts 仍把常规保存写成 PUT"
fi
if ! rg -n "method: 'PATCH'" src/remote-canvas.ts >/dev/null 2>&1; then
  fail "src/remote-canvas.ts 没有 PATCH"
fi
if ! rg -n "diffDocuments" src/remote-canvas.ts >/dev/null 2>&1; then
  fail "src/remote-canvas.ts 没有按差异组包"
fi
if rg -n "method: 'PUT'" src/persist.ts >/dev/null 2>&1; then
  fail "src/persist.ts 仍有整份 PUT"
fi

if ! npm test; then
  fail "npm test 没过"
fi
if ! npm run build; then
  fail "npm run build 没过"
fi

echo ACCEPT_OK
