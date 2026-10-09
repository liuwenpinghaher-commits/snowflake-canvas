#!/usr/bin/env python3
"""删掉验收脚本自己建的卡片讨论会话。

用法：python3 scripts/drop_accept_sessions.py [--backup 路径] 卡片id ...

只删同时满足这三条的卡片会话：在命令行名单里；id 以验收前缀开头；正本里已经没有这张卡。
作者自己的讨论（不带验收前缀的卡片）一律不动。改写走同目录临时文件再改名，权限保持 0600。
"""
import json
import os
import shutil
import sys
from pathlib import Path

DATA = Path(os.environ.get("SNOWFLAKE_DATA_DIR") or "/home/chris/.local/share/snowflake-canvas")
ACCEPT_PREFIXES = ("n-discuss-accept-", "n-mem-accept-")


def canon_card_ids(data_dir):
    raw = json.loads((data_dir / "snowflake.json").read_text(encoding="utf-8"))
    document = raw.get("document", raw) if isinstance(raw, dict) else {}
    cards = set((document.get("snowflake") or {}).get("cards") or {})
    nodes = {node.get("id") for node in (document.get("canvas") or {}).get("nodes") or [] if isinstance(node, dict)}
    return cards | nodes


def drop(card_ids, data_dir=DATA, backup=None):
    session_file = data_dir / "session.json"
    if not session_file.is_file():
        return [], []
    original = session_file.read_bytes()
    store = json.loads(original.decode("utf-8"))
    buckets = store.get("cards") if isinstance(store, dict) else None
    if not isinstance(buckets, dict):
        return [], []
    in_canon = canon_card_ids(data_dir)
    dropped, kept = [], []
    for card_id in card_ids:
        if card_id not in buckets:
            continue
        if not card_id.startswith(ACCEPT_PREFIXES) or card_id in in_canon:
            kept.append(card_id)
            continue
        dropped.append(card_id)
    if not dropped:
        return dropped, kept
    if backup:
        shutil.copy2(session_file, backup)
        if Path(backup).read_bytes() != original:
            raise RuntimeError(f"备份 {backup} 校验失败，没有改会话文件")
    for card_id in dropped:
        buckets.pop(card_id)
    text = json.dumps(store, ensure_ascii=False)
    temp = data_dir / ".session.json.accept-clean.tmp"
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, text.encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)
    back = json.loads(temp.read_text(encoding="utf-8"))
    if any(card_id in back.get("cards", {}) for card_id in dropped):
        temp.unlink(missing_ok=True)
        raise RuntimeError("临时文件里验收会话还在，没有改会话文件")
    os.replace(temp, session_file)
    return dropped, kept


def main(argv):
    backup = None
    ids = []
    rest = list(argv)
    while rest:
        item = rest.pop(0)
        if item == "--backup":
            backup = rest.pop(0)
        else:
            ids.append(item)
    dropped, kept = drop(ids, backup=backup)
    print("已删验收会话：" + (", ".join(dropped) if dropped else "无"))
    if kept:
        print("没删（不是验收卡，或正本里还有这张卡）：" + ", ".join(kept))
    remaining = json.loads((DATA / "session.json").read_text(encoding="utf-8")).get("cards", {}) if (DATA / "session.json").is_file() else {}
    left = [card_id for card_id in dropped if card_id in remaining]
    if left:
        print("会话文件里还有：" + ", ".join(left))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
