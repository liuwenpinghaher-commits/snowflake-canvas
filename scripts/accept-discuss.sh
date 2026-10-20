#!/usr/bin/env bash
# 雪花画布：卡片下方讨论验收。打正在听的 8093。
# 成功时最后一行是 ACCEPT_DISCUSS_OK。
#
# 页面检查：读 8093 上 /xuehua/ 以及它引用的脚本，确认讨论挂在卡片正下方。
#   不启动无头浏览器，也不模拟双击。
# 接口等价（对应双击建会话、继续讨论、采纳、错 If-Match、三标签、kill -9）：
#   GET /api/discuss/session?cardId=  等价于双击一张还没有会话的卡，服务端为它建会话。
#   POST /api/discuss/stream          等价于在该会话里继续发消息。
#   PUT /api/canvas + If-Match        等价于点「采纳进本念头」后只改这张卡的 body。
# 空白处双击仍走 onPaneClick → onCreateAt，这里只核对源码还是这条路径，不改成打开讨论。
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
export ROOT
export PYTHONUNBUFFERED=1

python3 - << 'PY'
import hashlib, http.client, json, os, re, threading, time
from pathlib import Path
from urllib.parse import quote

ROOT = Path(os.environ["ROOT"])
HOST = "127.0.0.1"
PORT = 8093
DATA = Path(os.environ.get("SNOWFLAKE_DATA_DIR") or (Path.home() / ".local/share/snowflake-canvas"))
CANON = DATA / "snowflake.json"
SESSION_FILE = DATA / "session.json"
BACKUP_FILE = DATA / "session.json.bak"
TEST_IDS = ["n-discuss-accept-a", "n-discuss-accept-b", "n-discuss-accept-c"]
CARDS_ADDED = False

class Fail(Exception):
    def __init__(self, detail):
        super().__init__(detail)
        self.detail = detail

def fail(detail):
    raise Fail(str(detail))

def request(method, path, body=None, headers=None, timeout=60):
    conn = http.client.HTTPConnection(HOST, PORT, timeout=timeout)
    data = None
    hdrs = {}
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    conn.request(method, path, body=data, headers=hdrs)
    resp = conn.getresponse()
    raw = resp.read()
    status = resp.status
    header_map = {k.lower(): v for k, v in resp.getheaders()}
    conn.close()
    return status, header_map, raw

def json_body(raw):
    return json.loads(raw.decode())

def file_hash():
    return hashlib.sha256(CANON.read_bytes()).hexdigest()

def situation_target(document):
    cards = document.get("snowflake", {}).get("cards", {})
    nodes = document.get("canvas", {}).get("nodes", [])
    edges = document.get("canvas", {}).get("edges", [])
    incoming = {edge.get("toNode") for edge in edges if isinstance(edge, dict) and edge.get("toNode")}
    ordered = []
    seen = set()
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id or node_id in seen:
            continue
        seen.add(node_id)
        ordered.append(node_id)
    for card_id in cards:
        if card_id not in seen:
            ordered.append(card_id)
    situations = [
        card_id
        for card_id in ordered
        if isinstance(cards.get(card_id), dict) and cards[card_id].get("layer") == "situation"
    ]
    roots = [card_id for card_id in situations if card_id not in incoming]
    if roots:
        return roots[0]
    return situations[0] if situations else ""

def session_ids(store):
    if not isinstance(store, dict):
        return []
    if isinstance(store.get("sessionId"), str) and "cards" not in store:
        return [store["sessionId"]]
    ids = []
    for bucket in (store.get("cards") or {}).values():
        if not isinstance(bucket, dict):
            continue
        for item in bucket.get("sessions") or []:
            if isinstance(item, dict) and isinstance(item.get("sessionId"), str):
                ids.append(item["sessionId"])
    return ids

def load_canvas():
    status, headers, raw = request("GET", "/api/canvas")
    if status != 200:
        fail(f"GET 画布返回 {status}")
    return headers.get("etag", ""), json_body(raw)

def put_document(document, etag):
    return request("PUT", "/api/canvas", document, {"If-Match": etag})

def mutate_document(recipe):
    last = None
    for _ in range(8):
        etag, payload = load_canvas()
        document = payload["document"]
        recipe(document)
        status, headers, raw = put_document(document, etag)
        last = (status, raw)
        if status == 200:
            return headers.get("etag", ""), json_body(raw)["document"]
        if status != 412:
            fail(f"写画布返回 {status} {raw[:180]!r}")
    fail(f"写画布多次 412 仍没写上 {last[1][:180]!r}")

def strip_test_cards(document):
    drop = set(TEST_IDS)
    document["canvas"]["nodes"] = [node for node in document["canvas"]["nodes"] if node.get("id") not in drop]
    document["canvas"]["edges"] = [
        edge
        for edge in document["canvas"]["edges"]
        if edge.get("fromNode") not in drop and edge.get("toNode") not in drop
    ]
    for card_id in TEST_IDS:
        document["snowflake"]["cards"].pop(card_id, None)

def add_test_cards(document):
    strip_test_cards(document)
    for index, card_id in enumerate(TEST_IDS):
        body = f"验收卡{index}"
        document["canvas"]["nodes"].append(
            {
                "id": card_id,
                "type": "text",
                "x": 80 + index * 40,
                "y": 520,
                "width": 280,
                "height": 120,
                "text": body,
                "color": "1",
            }
        )
        document["snowflake"]["cards"][card_id] = {"layer": "situation", "body": body, "fields": {}}

def bodies(document):
    return {card_id: card.get("body") for card_id, card in document["snowflake"]["cards"].items()}

def page_check():
    # 页面检查：不点双击。确认正在对外的 /xuehua/ 脚本里，讨论挂在卡片正下方，历史气泡左 AI、右用户。
    status, _, raw = request("GET", "/xuehua/")
    if status != 200:
        fail(f"/xuehua/ 返回 {status}")
    html = raw.decode("utf-8", "replace")
    srcs = re.findall(r'src="([^"]+\.js)"', html)
    if not srcs:
        fail("/xuehua/ 没有引用脚本")
    blob = ""
    for src in srcs:
        path = src if src.startswith("/") else "/xuehua/" + src.lstrip("./")
        code, _, script = request("GET", path)
        if code != 200:
            fail(f"页面脚本 {path} 返回 {code}")
        blob += script.decode("utf-8", "replace")
    for needle in (
        "data-discuss-dock",
        "bubble-row",
        "历史讨论",
        "采纳进本念头",
        "有新消息",
        "讨论忙，网关同时最多 10 路",
        "版本已更新，请再试",
    ):
        if needle not in blob:
            fail(f"页面脚本里没有「{needle}」")
    if "采纳进本念头正文" in blob or "念头正文" in blob:
        fail("页面还留着旧的念头正文框或旧采纳文案")
    if "aria-label=\"画布讨论\"" in blob or ">画布讨论<" in blob:
        fail("页面上还有固定的画布讨论")
    discuss = (ROOT / "src" / "CardDiscuss.tsx").read_text(encoding="utf-8")
    if "scheduleBody" in discuss or "position:fixed" in discuss or "position: fixed" in discuss:
        fail("讨论窗还在防抖写正文，或用固定定位贴在屏幕上")
    css = (ROOT / "src" / "index.css").read_text(encoding="utf-8")
    popover = css.split(".discuss-popover {", 1)[-1].split("}", 1)[0]
    if "fixed" in popover:
        fail("讨论窗还是贴在屏幕上的固定层")
    if ".discuss-dock {" not in css:
        fail("样式里没有卡片下方的讨论挂载")
    dock = css.split(".discuss-dock {", 1)[-1].split("}", 1)[0]
    if "absolute" not in dock or "fixed" in dock:
        fail("讨论没有挂在卡片正下方")
    if ".bubble-row {" not in css or ".bubble-row.user {" not in css:
        fail("样式里没有左右气泡")
    row = css.split(".bubble-row {", 1)[-1].split("}", 1)[0]
    user = css.split(".bubble-row.user {", 1)[-1].split("}", 1)[0]
    if "row-reverse" in row:
        fail("AI 气泡不在左侧")
    if "row-reverse" not in user:
        fail("用户气泡不在右侧")
    flow = (ROOT / "src" / "FlowCanvas.tsx").read_text(encoding="utf-8")
    if "discuss-dock" not in flow:
        fail("讨论没有挂在卡片节点下方")
    pane = flow.split("onPaneClick", 1)[-1].split("onNodeClick", 1)[0]
    if "onCreateAt" not in pane:
        fail("空白处双击不再调用 onCreateAt")
    if "onOpenDiscuss" not in flow:
        fail("双击卡片没有打开讨论")
    print("页面：讨论挂在卡片节点上；空白处双击仍是新建卡片")

def read_stream(card_id, session_id, message, deadline_s):
    # 接口等价：在已打开的会话里继续发一条，不经过页面双击。
    conn = http.client.HTTPConnection(HOST, PORT, timeout=deadline_s + 30)
    body = json.dumps(
        {"message": message, "cardId": card_id, "sessionId": session_id},
        ensure_ascii=False,
    ).encode()
    conn.request(
        "POST",
        "/api/discuss/stream",
        body=body,
        headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    )
    resp = conn.getresponse()
    if resp.status != 200:
        err = resp.read(4000)
        conn.close()
        return {"status": resp.status, "body": err.decode("utf-8", "replace"), "session": ""}
    session_header = resp.getheader("X-Hermes-Session-Id") or ""
    blob = b""
    started = time.time()
    while time.time() - started < deadline_s:
        line = resp.readline()
        if not line:
            break
        blob += line
        if line.decode("utf-8", "replace").strip() == "event: done":
            break
    conn.close()
    return {"status": resp.status, "body": blob.decode("utf-8", "replace"), "session": session_header}

def stream_ok(card_id, session_id, message):
    last = None
    for attempt in range(4):
        result = read_stream(card_id, session_id, message, 120)
        last = result
        if result["status"] == 429:
            time.sleep(2 * (attempt + 1))
            continue
        return result
    return last

def open_session(card_id):
    # 接口等价于双击这张卡：没有会话就建一个，有则回到最近一次。
    status, _, raw = request("GET", "/api/discuss/session?cardId=" + quote(card_id), timeout=60)
    if status != 200:
        fail(f"双击等价建会话返回 {status} {raw[:180]!r}")
    payload = json_body(raw)
    if payload.get("cardId") != card_id or not payload.get("sessionId"):
        fail(f"会话没有挂在 {card_id}")
    return payload

def disk_store():
    return json.loads(SESSION_FILE.read_text(encoding="utf-8"))

def owned(store, card_id, session_id):
    bucket = (store.get("cards") or {}).get(card_id) or {}
    for item in bucket.get("sessions") or []:
        if item.get("sessionId") == session_id and item.get("cardId") == card_id:
            return True
    return False

def main():
    status, _, _ = request("GET", "/api/health", timeout=5)
    if status != 200:
        fail(f"8093 健康检查返回 {status}")
    page_check()

    before_store = disk_store()
    before_ids = session_ids(before_store)
    legacy = isinstance(before_store.get("sessionId"), str) and "cards" not in before_store
    legacy_id = before_store.get("sessionId") if legacy else ""

    _, payload = load_canvas()
    user_bodies = {card_id: body for card_id, body in bodies(payload["document"]).items() if card_id not in TEST_IDS}
    root = situation_target(payload["document"])
    # 正本可以没有念头卡。会话已经按卡分组时，旧讨论迁不走，也不改用户现有的卡。
    # 先放验收自己的念头卡，后面的双击、继续讨论、采纳、错误 If-Match 都打这张卡，收尾再删。
    grouped = (not legacy) and isinstance(before_store.get("cards"), dict)
    if not root and grouped:
        global CARDS_ADDED
        mutate_document(add_test_cards)
        CARDS_ADDED = True
        _, payload = load_canvas()
        root = situation_target(payload["document"])
        if root not in TEST_IDS:
            fail("验收用的念头卡没有写上")
        print("正本没有念头卡，已加上验收用的念头卡")
    elif not root:
        fail("文档里没有念头卡，原讨论不能迁走，本项验收停在这里")

    opened = open_session(root)
    print(f"双击等价：念头根卡 {root} 的会话是 {opened['sessionId']}")
    migrated = disk_store()
    if "cards" not in migrated:
        fail("会话文件没有按卡片分组")
    if legacy:
        if not BACKUP_FILE.is_file():
            fail("迁移前没有留下 session.json.bak")
        backup = json.loads(BACKUP_FILE.read_text(encoding="utf-8"))
        if backup.get("sessionId") != legacy_id:
            fail("session.json.bak 里的会话号不是原来那条")
        if not owned(migrated, root, legacy_id):
            fail("原来的画布讨论没有挂到念头根卡，或会话号丢了")
        print(f"迁移：原会话 {legacy_id} 在 {root} 名下，备份还在")
    else:
        missing = [item for item in before_ids if item not in session_ids(migrated)]
        if missing:
            fail(f"分组文件里丢了原有会话 {missing}")
        print("迁移：会话文件已经是按卡分组，原有会话号还在")

    kept_ids = set(session_ids(disk_store()))
    mutate_document(add_test_cards)
    CARDS_ADDED = True
    card_a, card_b, card_c = TEST_IDS
    first = open_session(card_a)
    session_a = first["sessionId"]
    kept_ids.add(session_a)
    print(f"双击等价：卡片 {card_a} 新建会话 {session_a}")

    first_round = stream_ok(card_a, session_a, "只回复一个字：好。不要调用工具。")
    if first_round["status"] != 200 or "run.started" not in first_round["body"]:
        fail(f"第一次讨论失败：{first_round['status']} {first_round['body'][:180]!r}")
    second_round = stream_ok(card_a, session_a, "继续。只回复一个字：在。不要调用工具。")
    if second_round["status"] != 200 or "run.started" not in second_round["body"]:
        fail(f"继续讨论失败：{second_round['status']} {second_round['body'][:180]!r}")
    if second_round["session"] and second_round["session"] != session_a:
        fail("继续讨论串到了别的会话")
    print("继续讨论：同一会话又发了一轮")

    _, current = load_canvas()
    before_adopt = bodies(current["document"])
    marker = "采纳进正文-" + str(int(time.time()))
    def adopt(document):
        document["snowflake"]["cards"][card_a]["body"] = marker
        for node in document["canvas"]["nodes"]:
            if node.get("id") == card_a:
                node["text"] = marker[:40]
    _, adopted = mutate_document(adopt)
    after = bodies(adopted)
    if after.get(card_a) != marker:
        fail("采纳没有写进这张卡的正文")
    for card_id, body in before_adopt.items():
        if card_id == card_a:
            continue
        if after.get(card_id) != body:
            fail(f"采纳改了别的卡 {card_id}")
    print("采纳：只改了这张卡的正文")

    etag, payload = load_canvas()
    disk_before = file_hash()
    body_before = payload["document"]["snowflake"]["cards"][card_a]["body"]
    wrong = json.loads(json.dumps(payload["document"]))
    wrong["snowflake"]["cards"][card_a]["body"] = body_before + "不应写上"
    status, _, _ = put_document(wrong, '"999999"')
    if status != 412:
        fail(f"错误 If-Match 返回 {status}")
    if file_hash() != disk_before:
        fail("错误 If-Match 改了磁盘正文")
    _, again = load_canvas()
    if again["document"]["snowflake"]["cards"][card_a]["body"] != body_before:
        fail("错误 If-Match 之后正文变了")
    print("412：错误 If-Match 没有改正文")

    status, _, raw = request("POST", "/api/discuss/stream", {"message": "不应该发出去"})
    if status != 400:
        fail(f"缺少 cardId 时返回 {status}")
    status, _, raw = request(
        "POST",
        "/api/discuss/stream",
        {"message": "不应该发出去", "cardId": card_a, "sessionId": "not-this-card"},
    )
    if status != 400:
        fail(f"cardId 对不上会话时返回 {status}")
    status, _, _ = request("GET", "/api/discuss/session")
    if status != 400:
        fail(f"取会话缺少 cardId 时返回 {status}")

    tokens = {card_a: "tab-a-" + marker, card_b: "tab-b-" + marker, card_c: "tab-c-" + marker}
    _, baseline = load_canvas()
    untouched = {card_id: body for card_id, body in bodies(baseline["document"]).items() if card_id not in tokens}

    created = {}
    errors = []
    def create_worker(card_id):
        try:
            code, _, raw_body = request("POST", "/api/discuss/session", {"cardId": card_id}, timeout=60)
            if code != 200:
                errors.append(f"{card_id} 建会话 {code} {raw_body[:120]!r}")
                return
            payload_body = json_body(raw_body)
            created[card_id] = payload_body.get("sessionId")
        except Exception as error:
            errors.append(repr(error))
    threads = [threading.Thread(target=create_worker, args=(card_id,)) for card_id in TEST_IDS]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    if errors:
        fail("三标签建会话失败：" + "；".join(errors))
    if len(set(created.values())) != 3:
        fail(f"三张卡的会话号互踩了：{created}")
    store = disk_store()
    for card_id, session_id in created.items():
        if not owned(store, card_id, session_id):
            fail(f"{session_id} 没有记在 {card_id} 名下")
        kept_ids.add(session_id)
    status, _, _ = request(
        "POST",
        "/api/discuss/stream",
        {"message": "串卡", "cardId": card_a, "sessionId": created[card_b]},
    )
    if status != 400:
        fail(f"用别的卡的会话发讨论返回 {status}")

    write_errors = []
    def write_worker(card_id, token):
        try:
            def recipe(document):
                document["snowflake"]["cards"][card_id]["body"] = token
            mutate_document(recipe)
        except Exception as error:
            write_errors.append(f"{card_id}: {error}")
    writers = [threading.Thread(target=write_worker, args=(card_id, token)) for card_id, token in tokens.items()]
    for thread in writers:
        thread.start()
    for thread in writers:
        thread.join()
    if write_errors:
        fail("三标签写正文失败：" + "；".join(write_errors))
    _, final_doc = load_canvas()
    final_bodies = bodies(final_doc["document"])
    for card_id, token in tokens.items():
        if final_bodies.get(card_id) != token:
            fail(f"{card_id} 的正文不是这张标签写的")
    for card_id, body in untouched.items():
        if final_bodies.get(card_id) != body:
            fail(f"三标签改了无关的卡 {card_id}")
    print("三标签：三张卡各自的会话和正文都在，没有互踩")

    import subprocess
    pid = subprocess.check_output(
        ["systemctl", "--user", "show", "-p", "MainPID", "--value", "snowflake-canvas-http.service"],
        text=True,
    ).strip()
    cmdline = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0", b" ").decode()
    if "server/http.mjs" not in cmdline:
        fail("MainPID 不是画布 Fastify，拒绝 kill")
    os.kill(int(pid), 9)
    deadline = time.time() + 25
    up = False
    while time.time() < deadline:
        try:
            code, _, _ = request("GET", "/api/health", timeout=2)
            if code == 200:
                up = True
                break
        except Exception:
            time.sleep(0.4)
    if not up:
        fail("kill -9 之后服务没有自己起来")
    survived = disk_store()
    surviving = set(session_ids(survived))
    missing = sorted(kept_ids - surviving)
    if missing:
        fail(f"kill -9 之后丢了会话 {missing}")
    for card_id in [root, *TEST_IDS]:
        status, _, raw = request("GET", "/api/discuss/session?cardId=" + quote(card_id), timeout=60)
        if status != 200:
            fail(f"拉起后取 {card_id} 的会话返回 {status}")
        payload = json_body(raw)
        for item in payload.get("sessions") or []:
            if item.get("sessionId") not in surviving:
                fail("拉起后接口列出的会话不在磁盘上")
    print(f"kill -9：历史会话还在，共 {len(surviving)} 条")

    mutate_document(strip_test_cards)
    CARDS_ADDED = False
    _, restored = load_canvas()
    restored_doc = restored["document"]
    for card_id in TEST_IDS:
        if card_id in restored_doc["snowflake"]["cards"]:
            fail("验收卡没有从画布上拿走")
    for card_id, body in user_bodies.items():
        if card_id in TEST_IDS:
            continue
        if bodies(restored_doc).get(card_id) != body:
            fail(f"收尾改了原来的卡 {card_id}")
    print("收尾：验收卡已从画布拿走，原来的正文还在")

def cleanup_cards():
    global CARDS_ADDED
    if not CARDS_ADDED:
        return
    mutate_document(strip_test_cards)
    CARDS_ADDED = False

def drop_accept_sessions():
    # 验收卡拿走之后，把它们在 session.json 里的会话也删掉，不留给作者的历史讨论。
    import subprocess
    done = subprocess.run(
        ["python3", str(ROOT / "scripts" / "drop_accept_sessions.py"), *TEST_IDS],
        capture_output=True,
        text=True,
    )
    print(done.stdout.strip())
    if done.returncode != 0:
        print("FAIL")
        print("验收会话没有删干净：" + (done.stderr.strip() or done.stdout.strip()))
        raise SystemExit(1)

try:
    main()
except Fail as error:
    try:
        cleanup_cards()
    except Exception as cleanup_error:
        print("FAIL")
        print(error.detail)
        print(f"收尾也失败：{cleanup_error}")
        raise SystemExit(1)
    print("FAIL")
    print(error.detail)
    raise SystemExit(1)
except Exception as error:
    try:
        cleanup_cards()
    except Exception as cleanup_error:
        print("FAIL")
        print(repr(error))
        print(f"收尾也失败：{cleanup_error}")
        raise SystemExit(1)
    print("FAIL")
    print(repr(error))
    raise SystemExit(1)
finally:
    drop_accept_sessions()
PY
py_status=$?
if [ "$py_status" -ne 0 ]; then
  exit "$py_status"
fi
echo ACCEPT_DISCUSS_OK
