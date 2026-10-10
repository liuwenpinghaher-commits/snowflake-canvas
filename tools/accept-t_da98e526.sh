#!/bin/bash
# 抽屉拆分验收：在仓库根执行。测试或构建失败则非 0，且不打印 ACCEPT_OK。
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f package.json ] || [ ! -f src/App.tsx ]; then
  echo "必须在雪花画布仓库根执行" >&2
  exit 1
fi

npm test
npm run build

python3 - << 'PY'
from pathlib import Path
import re
import sys

def die(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(1)

app = Path('src/App.tsx').read_text()
discuss = Path('src/CardDiscuss.tsx').read_text()
css = Path('src/index.css').read_text()

def aside_with(marker: str) -> str:
    at = app.find(marker)
    if at < 0:
        die(f'找不到 {marker}')
    start = app.rfind('<aside', 0, at)
    end = app.find('</aside>', at)
    if start < 0 or end < 0:
        die(f'{marker} 不在 aside 里')
    return app[start:end]

control = aside_with('control-pane')
session = aside_with('session-pane')
if '<SideEditor' not in control or '<CardDiscuss' in control:
    die('左栏控制区应包含字段编辑，且不包含会话')
if '<CardDiscuss' not in session or '<SideEditor' in session:
    die('右侧会话面板应独立，且不包含字段编辑')
if 'className="drawer-head card-head"' not in control:
    die('卡头不在左栏控制区')

shell_at = discuss.find('className="discuss-input-shell"')
if shell_at < 0:
    die('发送区没有包住输入框的外壳')
bar_close = discuss.find('</div>', shell_at)
shell_close = discuss.find('</div>', bar_close + len('</div>'))
shell = discuss[shell_at:shell_close]
if not re.search(r'<textarea[\s\S]*发送', shell):
    die('发送按钮不在输入框外壳内')
bar_at = css.find('.discuss-dock .discuss-compose-bar {')
if bar_at < 0:
    die('找不到输入框内的发送条样式')
bar = css[bar_at:css.find('}', bar_at)]
if 'position: absolute' not in bar:
    die('发送按钮不是贴在输入框内侧')
if 'grid-template-areas' in css:
    die('发送按钮仍在输入框外单独占一格')

header = app[app.find('<header className="topbar">'):app.find('</header>')]
for name in ('版本', '书籍', '设置'):
    if f'label="{name}"' not in header:
        die(f'顶栏缺少有名字的菜单：{name}')
if '>更多<' in header:
    die('顶栏仍是匿名「更多」')

if '<SplitResizer' in app or 'split-resizer' in app or 'split-resizer' in css:
    die('字段和讨论之间的拖高把手还在')
if '调节字段区和讨论区的高度' in app:
    die('字段和讨论之间的拖高把手还在')
PY

echo ACCEPT_OK
