#!/usr/bin/env bash
# 十层雪花：默认长链、跳层、旧档迁移，以及现有服务上的冲突写必须看到 412。
# 成功时最后一行是 ACCEPT_LAYERS_OK。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "1 十层契约"
npx vitest run tests/layers.test.ts

echo "2 If-Match 冲突写"
python3 - <<'PY'
import http.client
import json
import sys

HOST = "127.0.0.1"
PORT = 8093

def request(method, path, body=None, headers=None):
    conn = http.client.HTTPConnection(HOST, PORT, timeout=20)
    data = None
    hdrs = {}
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode()
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    conn.request(method, path, body=data, headers=hdrs)
    resp = conn.getresponse()
    raw = resp.read()
    status = resp.status
    conn.close()
    return status, raw

status, raw = request("GET", "/api/health")
if status != 200:
    print(f"8093 健康检查返回 {status}", file=sys.stderr)
    sys.exit(1)
status, raw = request("GET", "/api/canvas")
if status != 200:
    print(f"GET /api/canvas 返回 {status}", file=sys.stderr)
    sys.exit(1)
document = json.loads(raw.decode())["document"]
missing, _ = request("PUT", "/api/canvas", document)
stale, _ = request("PUT", "/api/canvas", document, {"If-Match": '"999999"'})
print(f"冲突写状态 {missing} {stale}")
if missing != 412 or stale != 412:
    print(f"第二次冲突写不是 412：缺 If-Match={missing} 错误 If-Match={stale}", file=sys.stderr)
    sys.exit(1)
PY

echo ACCEPT_LAYERS_OK
