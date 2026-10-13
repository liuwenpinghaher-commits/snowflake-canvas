# 雪花画布

作者在本机浏览器里写故事的工具：在画布上放卡片，从卡片一层层长出后面的层，卡片之间连线，双击卡片就在这张卡下面和 AI 讨论，讨论里满意的一段可以采纳进卡片。

## 打开方式

**日常写作：用 8093。** 打开 <http://127.0.0.1:8093/xuehua/>。正本放在服务器上，每次改动自动保存，多个标签同时写时会按版本号合并。

8093 由用户级 systemd 服务 `snowflake-canvas-http.service` 运行（`node server/http.mjs`，工作目录就是本仓库，环境变量读 `~/.config/snowflake-canvas/http.env`）。页面用的是 `dist/` 里的构建产物，改完前端要先构建再重启服务：

```bash
npm install
npm run build
systemctl --user restart snowflake-canvas-http.service
```

局域网别的机器用 `http://<本机地址>:8093` 打开也能用，但浏览器不把这种地址当安全上下文。服务器拿不到正本时，这种地址只能靠下载另存，不能自动保存；页面状态行会提示改用 `http://127.0.0.1:8093` 打开。

**改前端：开发页。**

```bash
npm run dev
```

打开 <http://127.0.0.1:5173/xuehua/>。开发页没有转发 `/api`，所以不连 8093 的正本，会让你选一个本地目录当正本（Chrome / Edge），或者下载另存（Firefox / Safari）。扩写请求经开发服务器转发到 `127.0.0.1:18100`，需要环境变量 `CPA_API_KEY`。

## 数据放在哪

8093 的数据目录是 `/home/chris/.local/share/snowflake-canvas/`（可用 `SNOWFLAKE_DATA_DIR` 改）：

| 文件 | 内容 |
| --- | --- |
| `snowflake.json` | 正本：画布上的卡片、连线、分组，以及每张卡的各层内容 |
| `session.json` | 讨论会话：每张卡片对应哪些讨论会话、上次打开的是哪一条、采纳记录 |
| `session.json.bak` | 会话文件从旧格式迁移前留下的备份 |

「留下这一版」会在正本旁边存一份快照，回退时从快照里选。

## 测试和验收

```bash
npx vitest run
```

`tests/` 是单元测试，不碰 8093。`scripts/accept-*.sh` 和 `tools/accept-*.sh` 是验收脚本，其中 `scripts/accept-discuss.sh`、`scripts/accept-mem.sh` 直接打正在运行的 8093，会临时往正本里加验收卡、建讨论会话，并会重启服务；跑完会删掉自己加的卡片和会话。不要在作者正在写的时候跑这两个脚本。
