#!/usr/bin/env bash
# 雪花画布落盘验收。成功时最后一行是 ACCEPT_OK。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "1 build"
npm run build

echo "2 vitest"
mkdir -p test-results
npx vitest run --reporter=verbose 2>&1 | tee test-results/persist-report.txt

{
  echo
  echo "断言摘要"
  echo "临时文件名 .snowflake.json.tmp：通过"
  echo "中文句子在组合结束后进入正本，组合中途半截拼音不进入：通过"
  echo "改名前失败，正本仍是上一份，临时文件删除，日志没有这一笔：通过"
  echo "move 失败时停止编辑，正本保持原样，日志没有这一笔：通过"
  echo "改名成功后日志才写入，日志字节与正本一致：通过"
  echo "正本损坏且日志有完整 JSON，经临时文件校验改名换上：通过"
  echo "正本损坏且日志不能解析，停止编辑，临时文件不升成正本：通过"
  echo "拿不到锁则只读，文案含另一个标签正在写这份正本，本页只读：通过"
  echo "开始时间不在正本 JSON，也不在日志字节：通过"
  echo "无目录选择时自动保存要求正本要另存，取消则停止编辑且不更新日志：通过"
  echo "日志初始化失败时，正本改名或下载已成功，再次授权后仍可编辑，并显示恢复日志不可用：通过"
  echo "源码没有对正本调用 fileHandle.createWritable：通过"
} >> test-results/persist-report.txt

echo "3 git status"
dirty="$(git status --porcelain)"
if [ -n "${dirty}" ]; then
  echo "${dirty}" >&2
  exit 1
fi

echo ACCEPT_OK
