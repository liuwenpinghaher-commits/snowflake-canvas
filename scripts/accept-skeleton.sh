#!/usr/bin/env bash
# 雪花画布骨架验收。最后一行必须是 ACCEPT_OK。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "1 build"
npm run build

echo "2 vitest"
node_modules/.bin/vitest run

port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
dev_pid=""
cleanup() {
  if [ -n "${dev_pid}" ]; then
    kill "${dev_pid}" 2>/dev/null || true
    wait "${dev_pid}" 2>/dev/null || true
    dev_pid=""
  fi
}
trap cleanup EXIT

echo "3 dev ${port}"
node_modules/.bin/vite --host 127.0.0.1 --port "${port}" --strictPort >/tmp/snowflake-canvas-dev.log 2>&1 &
dev_pid=$!

ready=0
for _ in $(seq 1 50); do
  if node --input-type=module -e 'try { const r = await fetch(process.argv[1]); process.exit(r.ok ? 0 : 1) } catch { process.exit(1) }' "http://127.0.0.1:${port}/"; then
    ready=1
    break
  fi
  sleep 0.2
done
if [ "${ready}" -ne 1 ]; then
  echo "dev server did not start" >&2
  cat /tmp/snowflake-canvas-dev.log >&2 || true
  exit 1
fi

echo "4 screenshot"
node scripts/shot.mjs "http://127.0.0.1:${port}/"
if [ ! -s test-results/canvas.png ]; then
  echo "missing screenshot" >&2
  exit 1
fi

cleanup
trap - EXIT

echo "5 forbidden paths"
if grep -R -n -E -e '/api/commit' -e '/api/paste' -e '/api/suggest' -e '/api/drafts/patch' \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=test-results .; then
  echo "forbidden api path found" >&2
  exit 1
fi

echo "6 git status"
dirty="$(git status --porcelain)"
if [ -n "${dirty}" ]; then
  echo "${dirty}" >&2
  exit 1
fi

echo ACCEPT_OK
