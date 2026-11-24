# 📬 Gmail 助手 — Cloudflare Workers 实时邮箱聚合与推送系统

基于 **Cloudflare Email Routing + Email Workers + D1（可选 R2）** 的轻量级实时收件箱与推送系统，无需虚拟主机、无需定时拉取 IMAP、无需托管源邮箱密码，邮件到达秒级入库并实时推送。

> 当前版本**仅启用 Gmail** 自动转发接入，支持在网页端自由添加任意**自定义前缀转发地址**（如 `work@example.com`、`main@example.com`、`bank@example.com`，并默认保留 `gmail@example.com`）；QQ / Outlook / 163 / 自定义邮箱已在 `src/providers.ts` 完整预留接口，后续按需开启即可。

---

## ✨ 核心特性与安全架构

- **Cloudflare Access RS256 零信任安全（默认 Fail-Closed）**：
  - 线上默认 `AUTH_MODE="access"`：Worker 内部基于 Web Crypto 严格验证 Cloudflare Access 签发的 RS256 JWT（`Cf-Access-Jwt-Assertion`、`/cdn-cgi/access/certs` 公钥、`aud`、`iss`、`exp` 及 `ACCESS_ALLOWED_EMAILS` 邮箱白名单），**彻底关闭公网密码登录与首次初始化接口**；任何配置缺失、伪造签名或未授权请求均默认 Fail-Closed 返回 `403`；
  - 支持 `AUTH_MODE="access+password"`（Access + 应用密码双重纵深防御），并通过加入 `.gitignore` 的 `.dev.vars`（`AUTH_MODE=password`）保留本地 `wrangler dev` 无缝调试体验；
  - 建议将独立外部邮箱（如 `owner@example.com`）设为 Access 登录白名单，**切勿**将 `gmail@example.com` 设为唯一 OTP 登录邮箱，避免自我锁定。
- **零源邮箱凭据存储**：不读取、不保存源 Gmail 密码、应用专用密码或 OAuth / IMAP Token，完全依赖 Gmail 原生自动转发 + Cloudflare Email Routing 推送入站。
- **多 Gmail 自定义前缀 & 转发确认助手**：
  - 网页端一键新增/停用/删除自定义前缀（`work@example.com`、`bank@example.com` 等），无需改代码、无需额外配 Cloudflare 路由；未登记或已停用的随机前缀自动拒收防垃圾邮件；
  - 自动识别经过 Google DKIM/DMARC 验签的 `forwarding-noreply@google.com` 转发确认邮件，自动豁免关键词拦截，并提取 **确认码** 与 **确认链接** 一键完成验证。
- **桌面端三栏 + 手机端原生 App 适配**：桌面端保持完整三栏收件箱，手机浏览器自动切换为单视图全屏列表 / 详情返回栏 / 底部导航 Tab / 侧滑抽屉，HTML 邮件自适应缩放且默认通过严格 Nonce CSP + `<iframe sandbox="">` 隔离脚本与追踪像素。
- **纯 D1 免绑卡运行 + R2 无缝扩展**：默认纯 D1 模式免费运行（单附件 ≤ 1 MB、单封总计 ≤ 2 MB）；开通 R2 后在本地 `wrangler.jsonc` 取消 `r2_buckets` 注释即可自动升级至单附件 10 MB。
- **实时多渠道推送 & 自动清理**：支持 **企业微信群机器人（WeCom）**、**ntfy（iOS / Android / 桌面）**、**Server酱 (Turbo)**、**自定义 HTTPS Webhook**（带 SSRF 防护与重定向拦截），推送标题自动带来源前缀/备注名；每日 Cron（`0 3 * * *`）自动清理超期非星标邮件。

---

## ⚡ 一键部署（推荐）

> **说明**：本项目为多文件 TypeScript Workers 工程（含 `hono`、`postal-mime` 依赖与 D1 数据库迁移），**不能**直接把单个 `.ts` 文件复制到 Cloudflare 网页端 Quick Edit 编辑器运行，需在本地（安装 Node.js 18+）拉取代码后执行下方一键脚本或交给 AI Agent 自动部署。

### 方式一：本地一键部署脚本（`scripts/deploy.mjs`）

脚本会自动完成：**检查环境 → Wrangler 设备码登录 → 生成本地 `wrangler.jsonc` → 创建/复用 D1 数据库 → 类型检查与单元测试 → 应用远端 D1 迁移 → 部署 Worker → 检查 Email Routing → 探活公网 HTTPS**。

#### A. 交互式向导（最简单，按提示输入即可）

**Windows PowerShell：**
```powershell
# 1. 拉取代码并进入目录（无需修改）
git clone https://github.com/jioagui/gmail-postman.git
cd gmail-postman

# 2. 安装依赖（无需修改）
npm.cmd install

# 3. 启动一键部署交互向导（无需修改，运行后按中文提示填入你的域名和邮箱即可）
node scripts/deploy.mjs
```

**macOS / Linux / Git Bash：**
```bash
# 1. 拉取代码并进入目录（无需修改）
git clone https://github.com/jioagui/gmail-postman.git
cd gmail-postman

# 2. 安装依赖（无需修改）
npm install

# 3. 启动一键部署交互向导（无需修改，运行后按中文提示填入你的域名和邮箱即可）
node scripts/deploy.mjs
```

#### B. 一条命令无交互部署（明确标出需要修改的变量）

把下面第 2 步标有 **`⬅️ 【需要修改】`** 的 5 个变量换成你自己的信息，整段复制进终端即可直接执行：

**Windows PowerShell：**
```powershell
# 1. 拉取代码并安装依赖（无需修改）
git clone https://github.com/jioagui/gmail-postman.git
cd gmail-postman
npm.cmd install

# 2. 修改以下 5 处个人配置
$DOMAIN      = "example.com"                                    # ⬅️ 【需要修改】你托管在 Cloudflare 的主域名
$WEB_HOST    = "mail.example.com"                               # ⬅️ 【需要修改】Web 收件箱自定义域名
$ACCESS_TEAM = "https://your-team.cloudflareaccess.com"         # ⬅️ 【需要修改】你的 Zero Trust 团队域名
$ACCESS_AUD  = "replace-with-your-access-application-aud"       # ⬅️ 【需要修改】Zero Trust 应用 AUD Tag（暂未建可先填 ""）
$ALLOW_EMAIL = "owner@example.com"                              # ⬅️ 【需要修改】允许登录的外部邮箱（切勿填域名转发邮箱自身）

# 3. 执行一键部署（想先预演不改动线上可在末尾追加 --dry-run）
node scripts/deploy.mjs --non-interactive --worker-name gmail-postman --domain $DOMAIN --web-host $WEB_HOST --gmail-prefix gmail --app-title "Gmail 助手" --auth-mode access --access-team-domain $ACCESS_TEAM --access-aud $ACCESS_AUD --allowed-emails $ALLOW_EMAIL
```

**macOS / Linux / Git Bash：**
```bash
# 1. 拉取代码并安装依赖（无需修改）
git clone https://github.com/jioagui/gmail-postman.git
cd gmail-postman
npm install

# 2. 修改以下 5 处个人配置
DOMAIN="example.com"                                            # ⬅️ 【需要修改】你托管在 Cloudflare 的主域名
WEB_HOST="mail.example.com"                                     # ⬅️ 【需要修改】Web 收件箱自定义域名
ACCESS_TEAM="https://your-team.cloudflareaccess.com"            # ⬅️ 【需要修改】你的 Zero Trust 团队域名
ACCESS_AUD="replace-with-your-access-application-aud"           # ⬅️ 【需要修改】Zero Trust 应用 AUD Tag（暂未建可先填 ""）
ALLOW_EMAIL="owner@example.com"                                 # ⬅️ 【需要修改】允许登录的外部邮箱（切勿填域名转发邮箱自身）

# 3. 执行一键部署（想先预演不改动线上可在末尾追加 --dry-run）
node scripts/deploy.mjs --non-interactive --worker-name gmail-postman --domain "$DOMAIN" --web-host "$WEB_HOST" --gmail-prefix gmail --app-title "Gmail 助手" --auth-mode access --access-team-domain "$ACCESS_TEAM" --access-aud "$ACCESS_AUD" --allowed-emails "$ALLOW_EMAIL"
```

> **Tips（执行环境 & 额外需手动完成的 3 项网页配置）**：
> - **在哪里运行**：以上命令全部在**你本地电脑的 PowerShell / Terminal** 中执行（不是粘贴到 Cloudflare 网页端 Worker 编辑器）。脚本会自动完成 D1 建库与迁移、Worker 编译部署及自定义域名绑定。
> - **手动配置 1 — Cloudflare Access 零信任应用（必须）**：Wrangler 无法自动创建 Zero Trust 应用。请登录 Zero Trust 后台：先在 **Access → Policies** 创建放行你外部邮箱（如 `owner@example.com`，勿用转发域名邮箱自身）的**可复用策略**，再在 **Access → Applications** 新建 Self-hosted 应用保护 `mail.你的域名` 并复制 **AUD Tag**。*(推荐在跑向导前就先建好并填入 AUD，跑完即可直接登录；若后补，把 AUD 写入本地 `wrangler.jsonc` 后重跑一次 `npm run deploy`。)*
> - **手动配置 2 — Email Routing Catch-all 路由（必须）**：进入 Cloudflare 后台你的域名 → **Email → Email Routing → Routing rules → Catch-all address**，开启 Catch-all 并将 Action 选为 **Send to a Worker → `gmail-postman`**（配置一次后，后续在网页端新增任意自定义前缀都即刻生效）。
> - **手动配置 3 — Gmail 后台开启自动转发（必须）**：打开 Gmail 网页版 → **设置 → 查看所有设置 → 转发和 POP/IMAP → 添加转发地址** → 在你的收件箱点开自动高亮的确认邮件点击确认链接 → 回到 Gmail 勾选「将收到的邮件的副本转发给…」并**滚动到页面最底部点击「保存更改」**。*(测试时请用另一个非 Gmail 外部邮箱给该 Gmail 发信，避免自发自收不触发转发。)*
> - **其他小贴士**：
>   - 新 Cloudflare 账号若从未打开过 Workers 控制台，首次挂载 Cron 时可能遇到错误码 `10063`，在浏览器打开一次 Dashboard 的 **Workers & Pages** 页面自动初始化子域后重跑部署即可；
>   - 脚本已内置 `NODE_OPTIONS=--dns-result-order=ipv4first` 规避 IPv6 超时，未登录时自动引导 `wrangler login --no-use-keyring --device`；查看全部参数：`node scripts/deploy.mjs --help`。

---

### 方式二：AI Agent 一键部署 Skill

本仓库在 `.agents/skills/deploy-gmail-postman/SKILL.md` 内置了标准化的 AI Agent 全自动部署技能（兼容 Antigravity、Claude Code 等支持 `.agents/skills/` 的 AI 助手，配合 Cloudflare MCP 可连同 Zero Trust 与 Email Routing 全自动配完）。

先拉取代码并在项目目录下打开你的 AI Agent：
```bash
git clone https://github.com/jioagui/gmail-postman.git
cd gmail-postman
```

然后把下面提示词中 **`【需要修改】`** 的 3 处替换成你自己的信息发给 Agent：

> 请读取 `.agents/skills/deploy-gmail-postman/SKILL.md` 帮我把本项目部署到我的 Cloudflare 账户：
> - 主域名：`example.com`（⬅️ **【需要修改】**）
> - Web 收件箱域名：`mail.example.com`（⬅️ **【需要修改】**）
> - 允许访问 Cloudflare Access 的外部邮箱：`owner@example.com`（⬅️ **【需要修改】**）

---

## 🚀 手动部署到 Cloudflare（完整 6 步指南）

如果你想每一步都手动掌控，从拉取代码到上线完整步骤如下：

### 第 1 步：拉取代码、安装依赖并复制配置模板

**Windows PowerShell：**
```powershell
git clone https://github.com/jioagui/gmail-postman.git
cd gmail-postman
npm.cmd install
Copy-Item wrangler.example.jsonc wrangler.jsonc
npx.cmd wrangler login --no-use-keyring --device
```

**macOS / Linux / Git Bash：**
```bash
git clone https://github.com/jioagui/gmail-postman.git
cd gmail-postman
npm install
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler login --no-use-keyring --device
```

### 第 2 步：创建线上 D1 数据库并执行迁移

```powershell
# Windows PowerShell（macOS/Linux 把 npx.cmd / npm.cmd 换成 npx / npm）
$env:NODE_OPTIONS="--dns-result-order=ipv4first"
npx.cmd wrangler d1 create gmail-postman-db
```

记下命令输出的 `database_id`（UUID），将在第 4 步填入 `wrangler.jsonc`。

### 第 3 步：在 Cloudflare Zero Trust 创建 Access 应用并获取 `AUD`

1. 登录 Cloudflare Zero Trust 控制台（记住你的团队域名，形如 `https://your-team.cloudflareaccess.com`）；
2. 进入 **Access → Policies**，新建一条**可复用策略（Reusable Policy）**：
   - Action 选择 **Allow**；
   - Include 规则选择 **Emails**，填入你用于登录的外部邮箱（例如 `owner@example.com`）；
3. 进入 **Access → Applications → Add an application → Self-hosted**：
   - Application domain 填入你的 Web 域名（例如 `mail.example.com`）；
   - 绑定上一步创建的**可复用策略**；
4. 保存后复制该应用的 **Application Audience (AUD) Tag**。

### 第 4 步：修改本地 `wrangler.jsonc`（明确标出必须修改的 6 处）

> 注意：`wrangler.jsonc`、`worker-configuration.d.ts` 和 `.dev.vars` 已加入 `.gitignore`，仅保存在你本地，**切勿提交到公开仓库**。

打开你本地复制出来的 `wrangler.jsonc`，修改带 **`⬅️ 【需要修改】`** 的 6 处：

```jsonc
{
  "name": "gmail-postman",                                // 可选：Worker 英文名
  "vars": {
    "MAIL_DOMAIN": "example.com",                         // ⬅️ 【需要修改 1】你的 Cloudflare 主域名
    "GMAIL_ALIAS_PREFIX": "gmail",                        // 可选：默认收信前缀
    "APP_TITLE": "Gmail 助手",                            // 可选：网页标题
    "AUTH_MODE": "access",                                // 推荐保持 access（零信任模式）
    "ACCESS_TEAM_DOMAIN": "https://your-team.cloudflareaccess.com", // ⬅️ 【需要修改 2】第 3 步的团队域名
    "ACCESS_POLICY_AUD": "replace-with-your-access-application-aud",// ⬅️ 【需要修改 3】第 3 步复制的 AUD Tag
    "ACCESS_ALLOWED_EMAILS": "owner@example.com"          // ⬅️ 【需要修改 4】允许访问的外部邮箱（逗号可分隔多个）
  },
  "routes": [
    {
      "pattern": "mail.example.com",                      // ⬅️ 【需要修改 5】Web 收件箱自定义域名
      "custom_domain": true
    }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "gmail-postman-db",
      "database_id": "00000000-0000-0000-0000-000000000000", // ⬅️ 【需要修改 6】第 2 步生成的真实 database_id
      "migrations_dir": "migrations"
    }
  ]
}
```

### 第 5 步：执行远端 D1 迁移并部署 Worker

```powershell
# Windows PowerShell（macOS/Linux 把 npm.cmd / npx.cmd 换成 npm / npx）
$env:NODE_OPTIONS="--dns-result-order=ipv4first"

# 应用远端 D1 数据库建表迁移（0001_init.sql + 0002_gmail_aliases.sql）
npm.cmd run db:migrate:remote

# （仅当 AUTH_MODE="access+password" 时需要设置 Cookie 签名密钥）
# npx.cmd wrangler secret put SESSION_SECRET

# 正式部署 Worker（自动绑定自定义域名与每日 Cron 清理任务）
npm.cmd run deploy
```

### 第 6 步：开启 Email Routing 并配置 Gmail 自动转发

1. 在 Cloudflare Dashboard 进入你的域名 → **Email → Email Routing**，开启 Email Routing（自动添加 MX / SPF 记录）；
2. 进入 **Routing rules → Catch-all address**，启用 Catch-all，Action 选择 **Send to a Worker** → 选择 `gmail-postman`；
3. 访问你的 Web 收件箱（`https://mail.你的域名`），通过 Cloudflare Access 登录后：
   - 可在「**📮 转发**」页面直接新增任意自定义前缀（如 `work@你的域名`、`main@你的域名`），或使用默认的 `gmail@你的域名`；
   - 可在「**🔀 规则**」页面配置企业微信机器人 / ntfy / Server酱 / Webhook 并一键测试推送；
4. 打开 Gmail 网页版 → **设置 → 查看所有设置 → 转发和 POP/IMAP → 添加转发地址**，填入你的转发地址；
5. 在你的收件箱里点开自动高亮的 **Gmail 转发确认邮件** 点击确认链接，然后回到 Gmail 勾选「将收到的邮件的副本转发给…」并**滚到页面最底部点击「保存更改」**即可生效。

---

## 🧪 本地开发与测试

```powershell
# 1. 复制本地配置模板（Windows 用 Copy-Item，macOS/Linux 用 cp）
Copy-Item wrangler.example.jsonc wrangler.jsonc
Copy-Item .dev.vars.example .dev.vars

# 2. 生成类型、类型检查、运行全部 Workers 运行时单元测试
npm.cmd run types
npm.cmd run typecheck
npm.cmd test

# 3. 应用本地 D1 迁移并启动本地开发服务器（http://127.0.0.1:8787）
npm.cmd run db:migrate:local
npm.cmd run dev
```

*(本地 `.dev.vars` 默认 `AUTH_MODE=password`，仅本地 `wrangler dev` 生效，不会被部署到线上。)*

---

## 🔌 后续如何启用预留的其他邮箱（QQ / Outlook / 163 / 自定义）

所有邮箱渠道集中注册在 `src/providers.ts` 的 `PROVIDERS` 数组中：
1. 将对应邮箱项（如 `qq`、`outlook`、`netease163`、`custom`）的 `enabled` 改为 `true`、`reserved` 改为 `false`；
2. 重新执行部署命令；
3. 在对应邮箱后台配置自动转发到 `<前缀>@你的域名`（例如 `qq@example.com`、`outlook@example.com`、`163@example.com`）即可。
