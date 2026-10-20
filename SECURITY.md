# 安全策略 (Security Policy)

## 支持的版本 (Supported Versions)

目前维护并提供安全更新的版本如下：

| 版本分支 | 支持状态 |
| :--- | :--- |
| `v3` / `main` | :white_check_mark: 持续支持 |
| `< 3.0` | :x: 已停止维护 |

---

## 核心安全设计边界

1. **密钥零落盘（Zero Secret Persistence）**
   - `CPA_API_KEY`、`API_SERVER_KEY`、`SNOWFLAKE_PG_DSN` 等敏感凭据仅从进程环境变量或受 `.gitignore` 保护的本地文件读取，绝不写入 `snowflake.json`、`session.json`、快照文件或前端打包产物。
2. **本地回环推理保护（Loopback-Only AI Proxy）**
   - 扩写网关 `/__snowflake/expand` 严格校验请求来源与上游目标地址，仅转发至本机回环推理端口（`127.0.0.1:18100`），拒绝外部非授权调用，防止推理端口暴露至公网。
3. **路径遍历与跨站防护**
   - 所有 `bookId`、`cardId` 与快照文件名均经过严格的字符白名单与路径归属校验，拒绝任何包含 `..` 或路径分隔符的输入。
4. **双时态决策防篡改台账**
   - `plan1.decision_ledger` 采用 `prev_hash` + `SHA-256` 链式签名校验，任何未授权篡改均会在 `/api/bitemporal/conflicts` 的 `ledger_verification` 中触发 `LEDGER_BROKEN` 告警。

---

## 报告安全漏洞 (Reporting a Vulnerability)

如果你在本项目中发现了潜在的安全漏洞或敏感信息泄露风险：

1. **请勿直接公开提交包含漏洞利用细节的 GitHub Issue**。
2. 请通过 GitHub 仓库的 **Private Vulnerability Reporting（私密漏洞报告）** 功能或直接联系仓库维护者（`liuwenpinghaher-commits`）提交报告。
3. 报告中请尽量包含：
   - 漏洞影响模块与复现步骤（PoC）
   - 潜在影响范围评估
   - 建议的修复方案（如有）

我们会在收到报告后的 **72 小时内** 确认收到，并在修复完成后发布安全补丁。
