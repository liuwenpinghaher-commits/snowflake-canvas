# 贡献指南 (Contributing to Snowflake Canvas)

感谢你对 **雪花画布（Snowflake Canvas v3）** 的关注与贡献！为保证代码库的质量、数据安全性与可维护性，请在提交 Issue 或 Pull Request 前阅读以下规范。

---

## 1. 开发环境准备

1. 确保本地已安装 **Node.js 20+** 与 **npm**。
2. 克隆仓库并安装依赖：
   ```bash
   git clone git@github.com:liuwenpinghaher-commits/snowflake-canvas.git
   cd snowflake-canvas
   npm install
   cp .env.example .env
   ```
3. 启动前端开发服务器：
   ```bash
   npm run dev
   ```
4. 启动后端服务（默认监听 `127.0.0.1:8093`）：
   ```bash
   npm run build
   node server/http.mjs
   ```

---

## 2. 核心设计准则

- **正本安全第一（Canonical Integrity）**：
  - 任何 AI 扩写候选或讨论回复在用户点击确认/采纳之前，绝不可直接修改 `snowflake.json` 正本字节。
  - 正本写入必须走「同目录临时文件 → 原子重命名（atomic rename）→ 恢复日志更新」流程。
- **增量同步（Incremental PATCH）**：
  - 常规画布与场次保存应使用 `PATCH` 差分（`diffDocuments` / `applyObjectOps`）并携带 `If-Match` / `baseRev`，禁止将常规按键保存退化为整书全量 `PUT`。
- **隐私与网络边界**：
  - 严禁在源码、测试或配置文件中硬编码任何 API Key、Token、内网 IP、公网 IP 或个人主目录绝对路径。
  - 默认推理与嵌入接口仅允许连接本机回环 `127.0.0.1:18100`。

---

## 3. 测试与验收要求

在提交 Pull Request 前，请确保以下检查全部通过（退出码为 `0`）：

1. **前端类型检查与生产构建**：
   ```bash
   npm run build
   ```
2. **全量单元与集成测试（Vitest）**：
   ```bash
   npm test
   ```
3. **隔离环境真实业务 E2E 测试（Playwright）**：
   ```bash
   npx e2e run
   ```
   > **注意**：E2E 测试必须使用独立隔离端口（如 `:18093`）和临时目录（`mkdtemp`），切勿影响本地 `:8093` 生产实例。

---

## 4. 提交流程 (Pull Request Process)

1. 从 `v3`（或 `main`）分支拉出特性分支：`git checkout -b feat/your-feature-name`。
2. 保持提交粒度清晰，遵循语义化提交信息（如 `feat: ...`, `fix: ...`, `test: ...`, `docs: ...`）。
3. 提交前运行敏感信息扫描，确认没有引入 `.env`、`*.db`、`*.sqlite*` 或个人路径。
4. 发起 Pull Request 并附带清晰的改动背景、验证步骤与测试结果摘要。
