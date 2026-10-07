#!/usr/bin/env bash
# 雪花画布：AI 扩写候选和本地快照回退。成功时最后一行是 ACCEPT_OK。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "1 build"
npm run build

echo "2 vitest"
mkdir -p test-results
npx vitest run --reporter=verbose 2>&1 | tee test-results/expand-report.txt

echo "3 git status"
dirty="$(git status --porcelain)"
if [ -n "${dirty}" ]; then
  echo "${dirty}" >&2
  exit 1
fi

echo ACCEPT_OK
