#!/bin/bash
# 展开全文改为按渲染后的正文高度决定。测试或源码断言失败则非 0，且不打印 MEASURE_OK。
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f package.json ] || [ ! -f src/card-layout.ts ]; then
  echo "必须在雪花画布仓库根执行" >&2
  exit 1
fi

npm test

python3 - << 'PY'
from pathlib import Path
import sys

def die(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)

layout = Path('src/card-layout.ts').read_text()
flow = Path('src/FlowCanvas.tsx').read_text()
test = Path('tests/measure-overflow.test.ts').read_text()

start = layout.find('export function snowBodyOverflows')
end = layout.find('export function snowBodyLineCapPx')
if start < 0 or end <= start:
    die('找不到 snowBodyOverflows')
gate = layout[start:end]
for token in ('perLine', 'innerWidth', 'fontPx', 'wrappedLines', 'codePointAt'):
    if token in gate:
        die(f'snowBodyOverflows 仍用 {token} 决定按钮')

measure_at = layout.find('export function measureSnowBodyOverflow')
estimate_at = layout.find('export function estimateSnowCardHeight')
if measure_at < 0 or estimate_at <= measure_at:
    die('找不到正文测量函数')
measure = layout[measure_at:estimate_at]
if 'scrollHeight' not in measure or 'snowBodyOverflows(' not in measure:
    die('没有把 .snow-body 的 scrollHeight 和 12 行限高做比较')
if "maxHeight = 'none'" not in measure:
    die('测量时没有先去掉收起限高')

snow_at = flow.find('function SnowCard(')
group_at = flow.find('function SnowGroup(')
if snow_at < 0 or group_at <= snow_at:
    die('找不到卡片组件')
snow = flow[snow_at:group_at]
if 'snow-body' not in snow or 'measureSnowBodyOverflow(' not in snow:
    die('卡片没有测量渲染后的 .snow-body')
if 'snowExpandLabel(' not in snow or "'展开全文'" not in layout:
    die('测量溢出后没有显示「展开全文」')
for token in ('perLine', 'innerWidth', 'fontPx'):
    if token in snow:
        die(f'卡片仍用 {token} 决定展开按钮')
if 'snowBodyOverflows(body' in flow or 'snowBodyOverflows(body,' in flow:
    die('按钮仍由正文字符串估算决定')

if 'it.skip' in test or 'describe.skip' in test or 'test.skip' in test:
    die('真实测量测试被跳过')
for token in ('scrollHeight', '展开全文', 'bodyTextForCard', 'snowflake-canvas'):
    if token not in test:
        die(f'测量测试缺少 {token}')
if "expect(label, detail).toBe('展开全文')" not in test:
    die('测量测试没有断言主人书里的长正文会出现「展开全文」')
PY

echo MEASURE_OK
