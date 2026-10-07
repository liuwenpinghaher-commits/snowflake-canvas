#!/usr/bin/env bash
# 磁盘正本强杀：改名前杀仍是上一份，改名后杀保留新稿。成功时最后一行是 ACCEPT_OK。
set -euo pipefail
cd "$(dirname "$0")/.."
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
node_modules/.bin/vite --host 127.0.0.1 --port "${port}" --strictPort >/tmp/snowflake-accept-kill.log 2>&1 &
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
  cat /tmp/snowflake-accept-kill.log >&2 || true
  exit 1
fi
node scripts/rework2-browser.mjs kill "http://127.0.0.1:${port}/"
echo ACCEPT_OK
