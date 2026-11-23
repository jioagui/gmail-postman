# 📬 Gmail 助手 — Cloudflare Workers 实时邮箱聚合与推送系统

基于 **Cloudflare Email Routing + Email Workers + D1（可选 R2）** 的轻量级实时收件箱与推送系统，无需虚拟主机、无需定时拉取 IMAP、无需托管源邮箱密码，邮件到达秒级入库并实时推送。

> 当前版本**仅启用 Gmail** 自动转发接入（`gmail@example.com`，支持 `+` 子地址如 `gmail+work@example.com`）；QQ / Outlook / 163 / 自定义邮箱已在 `src/providers.ts` 完整预留接口，后续按需开启即可。

---

## ✨ 核心特性与安全架构

- **Cloudflare Access RS256 零信任安全（默认 Fail-Closed）**：
  - 线上默认 `AUTH_MODE="access"`：Worker 内部基于 Web Crypto 严格验证 Cloudflare Access 签发的 RS256 JWT（`Cf-Access-Jwt-Assertion`、`/cdn-cgi/access/certs` 公钥、`aud`、`iss`、`exp` 及 `ACCESS_ALLOWED_EMAILS` 邮箱白名单），**彻底关闭公网密码登录与首次初始化接口**；任何配置缺失、伪造签名或未授权请求均默认 Fail-Closed 返回 `403`；
  - 支持 `AUTH_MODE="access+password"`（Access + 应用密码双重纵深防御），并通过加入 `.gitignore` 的 `.dev.vars`（`AUTH_MODE=password`）保留本地 `wrangler dev` 无缝调试体验；
  - 建议将独立外部邮箱（如 `owner@example.com`）设为 Access 登录白名单，**切勿**将 `gmail@example.com` 设为唯一 OTP 登录邮箱，避免自我锁定。
- **零源邮箱凭据存储**：不读取、不保存源 Gmail 密码、应用专用密码或 OAuth / IMAP Token，完全依赖 Gmail 原生自动转发 + Cloudflare Email Routing 推送入站。
- **Gmail 实时收信与转发确认助手**：通过 Cloudflare Email Routing 触发 Worker `email()` 处理器，`postal-mime` 实时解析正文、HTML 与附件；自动识别 `forwarding-noreply@google.com` 转发确认邮件，自动豁免关键词拦截、自动置顶/星标，并提取 **确认码** 与 **确认链接** 一键操作。
- **纯 D1 免绑卡运行 + R2 无缝扩展**：
  - 默认纯 D1 模式即可免费运行（单附件 ≤ 1 MB 直存 D1）；
  - 开通 Cloudflare R2 后，在 `wrangler.jsonc` 取消 `r2_buckets` 注释并创建对应存储桶即可自动切换至 R2 存储（单附件 ≤ 10 MB）。
- **实时多渠道推送**：支持 **企业微信群机器人（WeCom）**、**ntfy（iOS / Android / 桌面）**、**Server酱 (Turbo)**、**自定义 Webhook**，支持关键词过滤、敏感凭据脱敏展示与网页一键「测试推送」。
- **关键词拦截 & 安全 Web 收件箱 & 自动清理**：命中规则静默丢弃不入库不推送；响应式暗色/亮色界面、HTML 邮件 `<iframe sandbox="">` 沙箱隔离防 XSS、搜索/星标/重要/未读标记与附件下载；每日 Cron（`0 3 * * *`）自动清理超期非星标邮件。

---

## ⚙️ 开源配置模板说明（请勿提交 `wrangler.jsonc`）

为防止个人域名、个人邮箱、D1 `database_id` 及 Cloudflare Access `ACCESS_POLICY_AUD` 泄露到公开仓库，本仓库将 **`wrangler.jsonc`**、**`worker-configuration.d.ts`** 和 **`.dev.vars`** 均加入了 `.gitignore`，仅跟踪安全的公开模板：

- `wrangler.example.jsonc` — Worker、D1、自定义域名与 Cloudflare Access 配置模板
- `.dev.vars.example` — 仅用于本地 `wrangler dev` 调试的环境变量模板

首次拉取代码后，请从模板复制生成本地私有配置（**切勿取消 `.gitignore` 或强制提交 `wrangler.jsonc`**）：

```bash
# macOS / Linux / Git Bash
cp wrangler.example.jsonc wrangler.jsonc
cp .dev.vars.example .dev.vars
```

```powershell
# Windows PowerShell
Copy-Item wrangler.example.jsonc wrangler.jsonc
Copy-Item .dev.vars.example .dev.vars
```

---

## ⚡ 一键部署（推荐）

### 方式一：一键部署脚本 (`scripts/deploy.mjs`)

仓库内置跨平台 Node.js 一键部署脚本，自动引导生成本地 `wrangler.jsonc`、创建/复用 D1 数据库、执行远程数据库迁移、配置 Cloudflare Access / Email Routing 并部署 Worker：

```bash
# 1. 交互式向导（推荐首次使用）
node scripts/deploy.mjs

# 2. 演练模式（预览配置与执行步骤，不修改线上 Cloudflare 资源）
node scripts/deploy.mjs --dry-run

# 3. 非交互式模式（适合 CI/CD 或脚本自动化，先通过 --help 查看支持的参数与环境变量）
node scripts/deploy.mjs --help
node scripts/deploy.mjs --non-interactive ...
```

> 提示：若在网络环境中遇到 IPv6 超时，部署前可设置 `NODE_OPTIONS=--dns-result-order=ipv4first`；Wrangler 首次登录建议使用 `npx wrangler login --no-use-keyring --device`（Windows PowerShell 请使用 `npx.cmd`）。

### 方式二：AI Agent 一键部署 Skill

本仓库在 **`.agents/skills/deploy-gmail-postman/SKILL.md`** 内置了标准化的 AI Agent 端到端部署技能（兼容支持 `.agents/skills/` 规范的 AI 编程助手）。

你可以直接向 AI Agent 发送类似指令：

> 请读取 `.agents/skills/deploy-gmail-postman/SKILL.md` 帮我把本项目部署到我的 Cloudflare 账户：主域名 `example.com`，Web 域名 `mail.example.com`，允许访问的邮箱 `owner@example.com`。

Agent 将按技能清单自动完成账户/DNS 预检、D1 建库与迁移、Cloudflare Access 可复用策略（Reusable Policy）创建、生成本地 `wrangler.jsonc`、类型检查与测试验证、Worker 部署、Email Routing Catch-all 绑定以及线上冒烟验证与 Gmail 转发指引。

---

## 🚀 手动部署到 Cloudflare（5 步完整指南）

如果你希望手动掌控每一步，按以下 5 步即可完成部署：

1. **复制模板并填写基础配置**：
   - 将 `wrangler.example.jsonc` 复制为本地 `wrangler.jsonc`；
   - 将 `MAIL_DOMAIN` 改为你的域名（例如 `example.com`），`routes[0].pattern` 改为你的 Web 域名（例如 `mail.example.com`），`ACCESS_TEAM_DOMAIN` 改为你的 Zero Trust 团队域名（例如 `https://your-team.cloudflareaccess.com`），`ACCESS_ALLOWED_EMAILS` 改为允许访问的外部邮箱（例如 `owner@example.com`）。
2. **创建线上 D1 数据库并执行迁移**：
   ```powershell
   npx.cmd wrangler d1 create gmail-postman-db
   # 将输出的 database_id 填入本地 wrangler.jsonc 的 d1_databases[0].database_id
   npm.cmd run db:migrate:remote
   ```
   *(macOS / Linux 将 `npx.cmd` / `npm.cmd` 替换为 `npx` / `npm`。)*
3. **在 Cloudflare Zero Trust 创建 Access 可复用策略与应用**：
   - 登录 Zero Trust 控制台（团队域名：`https://your-team.cloudflareaccess.com`）：
     1. 先在 **Access → Policies** 创建一条**可复用策略（Reusable Policy）**，例如仅放行 `owner@example.com`（One-Time PIN 或 GitHub/Google IdP）；
     2. 在 **Access → Applications → Add an application → Self-hosted** 为 `mail.example.com` 创建应用，并绑定上面的可复用策略；
     3. 复制该应用的 **Application Audience (AUD) Tag**，填入本地 `wrangler.jsonc` 的 `ACCESS_POLICY_AUD`。
4. **（可选）若启用 `access+password` 双重认证模式，设置 Cookie 签名密钥并部署 Worker**：
   ```powershell
   # 仅 access+password 模式需要
   npx.cmd wrangler secret put SESSION_SECRET

   # 部署 Worker 并自动绑定自定义域名 mail.example.com
   npm.cmd run deploy
   ```
   *(注意：`.dev.vars` 仅对本地 `wrangler dev` 生效，不会被部署到线上；线上默认强制执行 `AUTH_MODE="access"`，未通过 Access 的任何请求都会被边缘拦截与 Worker 二次 403 拒绝。)*
5. **配置 Email Routing 与 Gmail 自动转发**：
   - 在 Cloudflare Dashboard 开启 `example.com` 的 **Email Routing**，配置路由规则（自定义地址 `gmail@example.com` 或 Catch-all）发送到 `gmail-postman` Worker；
   - 在 Gmail 网页版「设置 → 查看所有设置 → 转发和 POP/IMAP」添加转发地址 `gmail@example.com`；
   - 访问 `https://mail.example.com` 通过 Cloudflare Access 登录后，在收件箱顶部点开自动高亮的 Gmail 转发确认邮件完成验证，回到 Gmail 勾选「将收到的邮件的副本转发给…」并点击页面底部 **保存更改**。

---

## 🧪 本地开发与测试

先复制 `wrangler.example.jsonc` 为 `wrangler.jsonc`、`.dev.vars.example` 为 `.dev.vars`，然后执行（Windows PowerShell 使用 `npm.cmd`，macOS / Linux 使用 `npm`）：

```powershell
# 1. 安装依赖
npm.cmd install

# 2. 生成 Cloudflare Workers 绑定类型（生成 gitignored 的 worker-configuration.d.ts）
npm.cmd run types

# 3. TypeScript 类型检查
npm.cmd run typecheck

# 4. 运行 Workers 运行时自动化测试（真实 Miniflare + D1 迁移）
npm.cmd test

# 5. 应用本地 D1 迁移并启动本地开发服务器
npm.cmd run db:migrate:local
npm.cmd run dev
```

启动 `npm.cmd run dev` 后：
- 打开浏览器访问 `http://127.0.0.1:8787` 完成本地调试密码初始化（仅 `.dev.vars` 中的 `AUTH_MODE=password` 生效）。
- 可使用下方 PowerShell 命令直接在本地模拟一封发往 `gmail@example.com` 的入站邮件（请将 `example.com` 替换为本地 `wrangler.jsonc` 中的 `MAIL_DOMAIN`）：

```powershell
$raw = @"
From: Gmail Team <forwarding-noreply@google.com>
To: gmail@example.com
Subject: Gmail Forwarding Confirmation
MIME-Version: 1.0
Content-Type: text/plain; charset="utf-8"

Confirmation code: 123456789
https://mail-settings.google.com/mail/vf-demo
"@

Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8787/cdn-cgi/handler/email?from=forwarding-noreply@google.com&to=gmail@example.com" `
  -ContentType "message/rfc822" `
  -Body $raw
```

---

## 🔌 后续如何启用预留的其他邮箱（QQ / Outlook / 163 / 自定义）

所有邮箱来源集中注册在 `src/providers.ts` 的 `PROVIDERS` 数组中：
1. 将对应邮箱项（如 `qq`、`outlook`、`netease163`、`custom`）的 `enabled` 改为 `true`、`reserved` 改为 `false`；
2. 重新部署 Worker；
3. 在对应邮箱后台配置自动转发到 `<前缀>@example.com`（例如 `qq@example.com`、`outlook@example.com`、`163@example.com`）即可。
