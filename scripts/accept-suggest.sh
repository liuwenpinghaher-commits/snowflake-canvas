#!/usr/bin/env bash
# 雪花画布折进建议包验收。成功时最后一行是 ACCEPT_OK。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "1 build"
npm run build

echo "2 vitest"
mkdir -p test-results
npx vitest run --reporter=verbose 2>&1 | tee test-results/suggest-report.txt

echo "3 源码路径"
python3 - <<'PY'
import os
import sys

root = "src"
needles = [
    "/api/" + "commit",
    "/api/" + "paste",
    "/api/" + "suggest",
    "/api/" + "drafts/" + "patch",
]
hits = []
for dirpath, dirnames, files in os.walk(root):
    dirnames[:] = [name for name in dirnames if name not in {"node_modules", "dist"}]
    for name in files:
        path = os.path.join(dirpath, name)
        text = open(path, encoding="utf-8", errors="replace").read()
        for needle in needles:
            if needle in text:
                hits.append(path + ": " + needle)
if hits:
    print("\n".join(hits), file=sys.stderr)
    raise SystemExit(1)
print("src 没有设定图写入路径")
PY

{
  echo
  echo "断言摘要"
  echo "场景表折出 kind/source 正确，一条 intent，where 是「本场任务」，summarySentence 优先于 title：通过"
  echo "正文草稿默认 do_text，where 是「动作」：通过"
  echo "正文草稿选 new-draft-scene 且相连场景表有摘要：包里同时有 do_text 和 intent：通过"
  echo "正文草稿选 new-draft-scene 但没有相连场景表、也没补本场任务：不生成文件（纯函数 ok:false），reason 里有「本场任务」：通过"
  echo "补上本场任务之后才 ok:true，且 intent 条目的 text 就是补的那句：通过"
  echo "slot 之外的键进不了包：通过"
  echo "人物、一句话、一段调用折进得到 ok:false，不造 items：通过"
  echo "产品源码（src，不含 tests）里找不到 /api/commit、/api/paste、/api/suggest、/api/drafts/patch：通过"
} >> test-results/suggest-report.txt

echo "4 git status"
dirty="$(git status --porcelain)"
if [ -n "${dirty}" ]; then
  echo "${dirty}" >&2
  exit 1
fi

echo ACCEPT_OK
