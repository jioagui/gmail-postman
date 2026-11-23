#!/usr/bin/env node
/**
 * gmail-postman 一键部署脚本 (Cross-Platform: Windows / macOS / Linux)
 *
 * 特性：
 * - 纯 Node.js ESM，零第三方依赖
 * - 自动兼容 Windows (npm.cmd / npx.cmd，无 EINVAL / DEP0190 警告) 与 POSIX
 * - 自动为所有 Wrangler / 网络命令注入 NODE_OPTIONS=--dns-result-order=ipv4first
 * - 双模式：交互式中文/双语向导 + 非交互式 CLI 参数（支持人类与 AI Agent / CI）
 * - 支持 --dry-run 本地全量校验与构建预览（默认不覆盖现有 wrangler.jsonc，不修改远端资源）
 */

import { spawn } from "node:child_process";
import dns from "node:dns";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

// 优先 IPv4 DNS 解析，避免部分网络环境下连接 Cloudflare API / 自定义域名时 IPv6 超时
try {
  dns.setDefaultResultOrder?.("ipv4first");
} catch {
  // Ignore on older runtimes
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const WRANGLER_CONFIG_PATH = path.join(ROOT_DIR, "wrangler.jsonc");
const WRANGLER_BACKUP_PATH = path.join(ROOT_DIR, "wrangler.jsonc.bak");
const WORKER_TYPES_PATH = path.join(ROOT_DIR, "worker-configuration.d.ts");
const MIGRATIONS_DIR = path.join(ROOT_DIR, "migrations");

const DEFAULT_COMPATIBILITY_DATE = "2026-11-22";
const PLACEHOLDER_DB_UUID = "00000000-0000-0000-0000-000000000000";
const TOTAL_STEPS = 9;

const WORKER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const DB_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX_RE = /^[a-z0-9][a-z0-9._+-]{0,63}$/;
const VALID_AUTH_MODES = new Set(["access", "access+password", "password"]);

// ---------------------------------------------------------------------------
// 终端样式与日志输出
// ---------------------------------------------------------------------------

const USE_COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};

function style(text, ...codes) {
  if (!USE_COLOR || codes.length === 0) return text;
  return `${codes.join("")}${text}${ANSI.reset}`;
}

function logBanner(isDryRun) {
  const line = "========================================================================";
  console.log("");
  console.log(style(line, ANSI.cyan));
  console.log(
    style(
      `  gmail-postman Cloudflare Worker 一键部署向导${isDryRun ? " [DRY-RUN 预览模式]" : ""}`,
      ANSI.bold,
      ANSI.cyan
    )
  );
  console.log(style(line, ANSI.cyan));
  if (isDryRun) {
    console.log(
      style(
        "  提示：当前处于 --dry-run 模式，仅执行本地校验与打包检查，不会修改任何远端 Cloudflare 资源。",
        ANSI.yellow
      )
    );
  }
}

function logStep(stepNum, title) {
  console.log("");
  console.log(
    `${style(`[${stepNum}/${TOTAL_STEPS}]`, ANSI.bold, ANSI.blue)} ${style(title, ANSI.bold)}`
  );
}

function logInfo(msg) {
  console.log(`  ${style("i", ANSI.cyan)} ${msg}`);
}

function logOk(msg) {
  console.log(`  ${style("✓", ANSI.green)} ${msg}`);
}

function logWarn(msg) {
  console.log(`  ${style("!", ANSI.yellow)} ${style(msg, ANSI.yellow)}`);
}

function logErr(msg) {
  console.error(`  ${style("✗", ANSI.red)} ${style(msg, ANSI.red)}`);
}

function logDim(msg) {
  console.log(style(`    ${msg}`, ANSI.dim));
}

// ---------------------------------------------------------------------------
// 帮助文档
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
gmail-postman 一键部署脚本 (Cloudflare Workers + D1 + Access + Email Routing)

用法 / Usage:
  node scripts/deploy.mjs [options]

模式选项 / Mode Options:
  -h, --help                       显示此帮助信息并退出
  --non-interactive                非交互模式：仅使用 CLI 参数 / 环境变量 / 默认值（不弹交互提问）
  --dry-run                        预演模式：本地校验配置并运行 wrangler deploy --dry-run，
                                   不访问/修改远端 Cloudflare 资源，默认不覆盖现有 wrangler.jsonc
  --write-config                   配合 --dry-run 使用时允许写入本地 wrangler.jsonc（仍不触碰远端）
  --force-overwrite-config         若已存在 wrangler.jsonc，自动备份为 wrangler.jsonc.bak 后直接覆盖

部署配置选项 / Configuration Options:
  --worker-name <name>             Worker 名称（默认: gmail-postman，规则: ^[a-z0-9][a-z0-9-]{0,62}$）
  --domain <domain>                托管在 Cloudflare 的主域名（必填，例如: example.com）
  --web-host <host>                Web 控制台自定义域名（默认: mail.<domain>）
  --gmail-prefix <prefix>          Gmail 转发接收邮箱前缀（默认: gmail -> gmail@<domain>）
  --app-title <title>              Web 页面标题（默认: Gmail 助手）
  --auth-mode <mode>               认证模式: access | access+password | password（默认: access）
  --access-team-domain <url>       Cloudflare Access Team Domain（例如: https://your-team.cloudflareaccess.com）
  --access-aud <aud>               Cloudflare Access Application AUD Tag
  --allowed-emails <csv>           允许访问的邮箱白名单，逗号分隔（例如: owner@example.com）
  --db-name <name>                 D1 数据库名称（默认: <worker-name>-db）
  --db-id <uuid>                   复用已存在的 D1 Database UUID（留空则自动查找或创建）

流程控制选项 / Workflow Options:
  --skip-tests                     跳过 vitest 单元测试（仍执行 types 与 typecheck）
  --skip-email-routing             跳过自动启用 Cloudflare Email Routing 步骤

环境变量回退 / Environment Fallbacks (优先级低于 CLI 参数):
  GMAIL_POSTMAN_WORKER_NAME, GMAIL_POSTMAN_DOMAIN (或 MAIL_DOMAIN),
  GMAIL_POSTMAN_WEB_HOST, GMAIL_POSTMAN_PREFIX (或 GMAIL_ALIAS_PREFIX),
  GMAIL_POSTMAN_APP_TITLE (或 APP_TITLE), GMAIL_POSTMAN_AUTH_MODE (或 AUTH_MODE),
  ACCESS_TEAM_DOMAIN, ACCESS_POLICY_AUD, ACCESS_ALLOWED_EMAILS,
  GMAIL_POSTMAN_DB_NAME, GMAIL_POSTMAN_DB_ID

示例 / Examples:
  # 1. 交互式向导（推荐首次部署的个人用户）
  node scripts/deploy.mjs

  # 2. 本地预演（不修改现有 wrangler.jsonc，不触碰远端 Cloudflare）
  node scripts/deploy.mjs --dry-run --non-interactive \\
    --domain example.com \\
    --access-team-domain https://your-team.cloudflareaccess.com \\
    --access-aud demo-aud-tag \\
    --allowed-emails owner@example.com

  # 3. CI / AI Agent 全自动一键部署
  node scripts/deploy.mjs --non-interactive --force-overwrite-config \\
    --domain example.com \\
    --web-host mail.example.com \\
    --access-team-domain https://your-team.cloudflareaccess.com \\
    --access-aud your-application-aud-tag \\
    --allowed-emails owner@example.com
`.trim());
}

// ---------------------------------------------------------------------------
// CLI 参数解析
// ---------------------------------------------------------------------------

const VALUE_FLAGS = new Map([
  ["--worker-name", "workerName"],
  ["--domain", "domain"],
  ["--web-host", "webHost"],
  ["--gmail-prefix", "gmailPrefix"],
  ["--app-title", "appTitle"],
  ["--auth-mode", "authMode"],
  ["--access-team-domain", "accessTeamDomain"],
  ["--access-aud", "accessAud"],
  ["--allowed-emails", "allowedEmails"],
  ["--db-name", "dbName"],
  ["--db-id", "dbId"]
]);

const BOOLEAN_FLAGS = new Map([
  ["--help", "help"],
  ["-h", "help"],
  ["--non-interactive", "nonInteractive"],
  ["--dry-run", "dryRun"],
  ["--write-config", "writeConfig"],
  ["--skip-tests", "skipTests"],
  ["--skip-email-routing", "skipEmailRouting"],
  ["--force-overwrite-config", "forceOverwriteConfig"]
]);

function parseCliArgs(argv) {
  const parsed = {
    help: false,
    nonInteractive: false,
    dryRun: false,
    writeConfig: false,
    skipTests: false,
    skipEmailRouting: false,
    forceOverwriteConfig: false,
    explicit: new Set()
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (BOOLEAN_FLAGS.has(token)) {
      const key = BOOLEAN_FLAGS.get(token);
      parsed[key] = true;
      parsed.explicit.add(key);
      continue;
    }

    let flagName = token;
    let inlineValue;
    const eqIndex = token.indexOf("=");
    if (eqIndex !== -1 && token.startsWith("--")) {
      flagName = token.slice(0, eqIndex);
      inlineValue = token.slice(eqIndex + 1);
    }

    if (VALUE_FLAGS.has(flagName)) {
      const key = VALUE_FLAGS.get(flagName);
      if (inlineValue !== undefined) {
        parsed[key] = inlineValue;
        parsed.explicit.add(key);
        continue;
      }

      const next = argv[i + 1];
      if (
        next === undefined ||
        BOOLEAN_FLAGS.has(next) ||
        VALUE_FLAGS.has(next.split("=")[0])
      ) {
        throw new Error(`参数 ${flagName} 缺少对应的值。运行 node scripts/deploy.mjs --help 查看用法。`);
      }
      parsed[key] = next;
      parsed.explicit.add(key);
      i += 1;
      continue;
    }

    throw new Error(`无法识别的参数: ${token}。运行 node scripts/deploy.mjs --help 查看所有支持的参数。`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// JSONC 解析（安全剥离注释与尾逗号，不破坏字符串内的 https:// 等内容）
// ---------------------------------------------------------------------------

function stripJsonc(raw) {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    out += ch;
  }

  // 清除对象或数组闭合前的尾逗号
  return out.replace(/,\s*([}\]])/g, "$1");
}

function readExistingWranglerDefaults() {
  if (!existsSync(WRANGLER_CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(WRANGLER_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(stripJsonc(raw));
    const vars = parsed?.vars ?? {};
    const firstRoute = Array.isArray(parsed?.routes) ? parsed.routes[0] : null;
    const firstDb = Array.isArray(parsed?.d1_databases) ? parsed.d1_databases[0] : null;
    return {
      workerName: typeof parsed?.name === "string" ? parsed.name : "",
      domain: typeof vars.MAIL_DOMAIN === "string" ? vars.MAIL_DOMAIN : "",
      webHost:
        typeof firstRoute === "string"
          ? firstRoute
          : typeof firstRoute?.pattern === "string"
            ? firstRoute.pattern
            : "",
      gmailPrefix: typeof vars.GMAIL_ALIAS_PREFIX === "string" ? vars.GMAIL_ALIAS_PREFIX : "",
      appTitle: typeof vars.APP_TITLE === "string" ? vars.APP_TITLE : "",
      authMode: typeof vars.AUTH_MODE === "string" ? vars.AUTH_MODE : "",
      accessTeamDomain: typeof vars.ACCESS_TEAM_DOMAIN === "string" ? vars.ACCESS_TEAM_DOMAIN : "",
      accessAud: typeof vars.ACCESS_POLICY_AUD === "string" ? vars.ACCESS_POLICY_AUD : "",
      allowedEmails: typeof vars.ACCESS_ALLOWED_EMAILS === "string" ? vars.ACCESS_ALLOWED_EMAILS : "",
      dbName: typeof firstDb?.database_name === "string" ? firstDb.database_name : "",
      dbId: typeof firstDb?.database_id === "string" ? firstDb.database_id : ""
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 配置归一化与校验
// ---------------------------------------------------------------------------

function normalizeHostname(raw) {
  let value = String(raw || "").trim().toLowerCase();
  value = value.replace(/^https?:\/\//i, "");
  value = value.replace(/\/.*$/, "");
  value = value.replace(/\.$/, "");
  return value;
}

function isValidHostname(host) {
  if (!host || host.length > 253 || !host.includes(".")) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
      return false;
    }
  }
  const tld = labels[labels.length - 1];
  return tld.length >= 2 && (/^[a-z]+$/.test(tld) || /^xn--[a-z0-9-]+$/.test(tld));
}

function normalizeTeamDomain(raw) {
  const trimmed = String(raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function validateTeamDomain(raw) {
  if (!raw) return { ok: true, value: "" };
  const normalized = normalizeTeamDomain(raw);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:") {
      return {
        ok: false,
        error: `ACCESS_TEAM_DOMAIN 必须使用 https:// 协议（当前: ${normalized}）`
      };
    }
    if (!isValidHostname(parsed.hostname)) {
      return {
        ok: false,
        error: `ACCESS_TEAM_DOMAIN 域名格式无效（当前: ${normalized}）`
      };
    }
    return { ok: true, value: `${parsed.protocol}//${parsed.host}` };
  } catch {
    return {
      ok: false,
      error: `ACCESS_TEAM_DOMAIN 不是有效的 URL（当前: ${raw}），示例: https://your-team.cloudflareaccess.com`
    };
  }
}

function normalizeAndValidateEmails(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { ok: true, value: "" };

  const items = trimmed
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const unique = [];
  for (const email of items) {
    const parts = email.split("@");
    if (parts.length !== 2 || !parts[0] || !isValidHostname(parts[1])) {
      return {
        ok: false,
        error: `邮箱白名单包含无效邮箱地址: ${email}`
      };
    }
    if (!unique.includes(email)) unique.push(email);
  }
  return { ok: true, value: unique.join(",") };
}

function validateConfig(cfg) {
  const errors = [];
  const warnings = [];

  cfg.workerName = String(cfg.workerName || "gmail-postman").trim();
  if (!WORKER_NAME_RE.test(cfg.workerName)) {
    errors.push(
      `Worker 名称 "${cfg.workerName}" 无效，必须匹配 ^[a-z0-9][a-z0-9-]{0,62}$ （小写字母、数字、连字符，1-63 位）。`
    );
  }

  cfg.domain = normalizeHostname(cfg.domain);
  if (!cfg.domain) {
    errors.push("主域名 (--domain) 不能为空，例如: example.com");
  } else if (!isValidHostname(cfg.domain)) {
    errors.push(`主域名 "${cfg.domain}" 格式无效，请填写合法域名（例如: example.com）。`);
  }

  cfg.webHost = normalizeHostname(cfg.webHost || (cfg.domain ? `mail.${cfg.domain}` : ""));
  if (!cfg.webHost || !isValidHostname(cfg.webHost)) {
    errors.push(`Web 访问域名 (--web-host) "${cfg.webHost}" 格式无效，例如: mail.example.com`);
  }

  cfg.gmailPrefix = String(cfg.gmailPrefix || "gmail").trim().toLowerCase();
  if (!PREFIX_RE.test(cfg.gmailPrefix)) {
    errors.push(
      `Gmail 接收前缀 (--gmail-prefix) "${cfg.gmailPrefix}" 无效，仅支持小写字母、数字及 . _ + -（不含 @）。`
    );
  }

  cfg.appTitle = String(cfg.appTitle || "Gmail 助手").trim() || "Gmail 助手";

  cfg.authMode = String(cfg.authMode || "access").trim().toLowerCase();
  if (!VALID_AUTH_MODES.has(cfg.authMode)) {
    errors.push(
      `认证模式 (--auth-mode) "${cfg.authMode}" 无效，仅支持: access | access+password | password`
    );
  }

  const teamCheck = validateTeamDomain(cfg.accessTeamDomain);
  if (!teamCheck.ok) {
    errors.push(teamCheck.error);
  } else {
    cfg.accessTeamDomain = teamCheck.value;
    if (
      cfg.accessTeamDomain &&
      !cfg.accessTeamDomain.toLowerCase().endsWith(".cloudflareaccess.com")
    ) {
      warnings.push(
        `ACCESS_TEAM_DOMAIN (${cfg.accessTeamDomain}) 不是常见的 *.cloudflareaccess.com 域名，请确认是否为自定义 Access 登录域。`
      );
    }
  }

  cfg.accessAud = String(cfg.accessAud || "").trim();

  const emailsCheck = normalizeAndValidateEmails(cfg.allowedEmails);
  if (!emailsCheck.ok) {
    errors.push(emailsCheck.error);
  } else {
    cfg.allowedEmails = emailsCheck.value;
  }

  cfg.dbName = String(cfg.dbName || `${cfg.workerName}-db`).trim();
  if (!DB_NAME_RE.test(cfg.dbName)) {
    errors.push(
      `D1 数据库名称 (--db-name) "${cfg.dbName}" 无效，仅支持字母、数字、下划线和连字符（1-63 位）。`
    );
  }

  cfg.dbId = String(cfg.dbId || "").trim();
  if (cfg.dbId && !UUID_RE.test(cfg.dbId)) {
    errors.push(
      `D1 Database UUID (--db-id) "${cfg.dbId}" 格式无效，必须是标准 UUID（例如: 00000000-0000-0000-0000-000000000000）。`
    );
  }

  if (cfg.authMode === "access" || cfg.authMode === "access+password") {
    if (!cfg.accessTeamDomain || !cfg.accessAud) {
      warnings.push(
        `当前 AUTH_MODE="${cfg.authMode}" 但 ${!cfg.accessTeamDomain && !cfg.accessAud ? "ACCESS_TEAM_DOMAIN 与 ACCESS_POLICY_AUD 均为空" : !cfg.accessTeamDomain ? "ACCESS_TEAM_DOMAIN 为空" : "ACCESS_POLICY_AUD 为空"}。` +
          ` Worker 默认采用 Fail-Closed 零信任策略，在补齐配置并重新部署前公网请求将返回 HTTP 403。`
      );
    }
    if (!cfg.allowedEmails) {
      warnings.push(
        "ACCESS_ALLOWED_EMAILS 为空：Worker 将仅依赖 Cloudflare Access 策略放行；建议填入个人邮箱作为纵深防御白名单。"
      );
    }
  } else if (cfg.authMode === "password") {
    warnings.push(
      'AUTH_MODE="password" 仅推荐用于本地开发或无 Cloudflare Access 的场景；线上强烈建议改用 "access"，或至少执行 npx wrangler secret put SESSION_SECRET。'
    );
  }

  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// 跨平台子进程执行（Windows npm.cmd / npx.cmd + 自动 IPv4 优先 NODE_OPTIONS）
// ---------------------------------------------------------------------------

function buildChildEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  const existing = (env.NODE_OPTIONS || "").trim();
  if (!/--dns-result-order=/.test(existing)) {
    env.NODE_OPTIONS = existing
      ? `${existing} --dns-result-order=ipv4first`
      : "--dns-result-order=ipv4first";
  }
  return env;
}

function quoteWinCmdArg(arg) {
  const str = String(arg);
  if (str.length === 0) return '""';
  if (!/[\s"&|<>^%!()]/.test(str)) return str;
  // 转义双引号前的反斜杠以及双引号本身，并包裹在双引号中
  const escaped = str.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}

function resolveToolBinary(tool) {
  if (process.platform === "win32") {
    if (tool === "npm") return "npm.cmd";
    if (tool === "npx") return "npx.cmd";
  }
  return tool;
}

function runTool(tool, args, options = {}) {
  const {
    cwd = ROOT_DIR,
    stdioMode = "capture", // "inherit" | "capture" | "tee"
    env: extraEnv
  } = options;

  const bin = resolveToolBinary(tool);
  const env = buildChildEnv(extraEnv ? { ...process.env, ...extraEnv } : process.env);

  let command = bin;
  let spawnArgs = args;
  const spawnOptions = {
    cwd,
    env,
    stdio: stdioMode === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    windowsHide: true
  };

  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    // 通过 cmd.exe /d /s /c 执行 .cmd，规避 Node 18.20+/22+/26 的 EINVAL 与 DEP0190 警告
    command = process.env.ComSpec || "cmd.exe";
    const innerCmd = [bin, ...args.map(quoteWinCmdArg)].join(" ");
    spawnArgs = ["/d", "/s", "/c", `"${innerCmd}"`];
    spawnOptions.windowsVerbatimArguments = true;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, spawnArgs, spawnOptions);
    let stdout = "";
    let stderr = "";

    if (stdioMode !== "inherit") {
      child.stdout?.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stdout += text;
        if (stdioMode === "tee") process.stdout.write(text);
      });
      child.stderr?.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        stderr += text;
        if (stdioMode === "tee") process.stderr.write(text);
      });
    }

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code, signal) => {
      resolve({
        code: code ?? (signal ? 1 : 0),
        signal,
        stdout,
        stderr
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Wrangler 输出解析辅助（D1 list JSON / D1 create UUID / Error 10063）
// ---------------------------------------------------------------------------

function extractJsonArray(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    const direct = JSON.parse(trimmed);
    if (Array.isArray(direct)) return direct;
  } catch {
    // Fall through to bracket slicing
  }

  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const sliced = JSON.parse(trimmed.slice(start, end + 1));
    return Array.isArray(sliced) ? sliced : null;
  } catch {
    return null;
  }
}

function extractD1UuidFromOutput(output) {
  const text = String(output || "");
  const patterns = [
    /"database_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    /database_id\s*=\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    /"uuid"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return "";
}

function isError10063(output) {
  return /(?:code:\s*10063|\b10063\b|register a workers\.dev subdomain)/i.test(String(output || ""));
}

// ---------------------------------------------------------------------------
// wrangler.jsonc 模板生成
// ---------------------------------------------------------------------------

function renderWranglerJsonc(config, paths = {}) {
  const schemaPath = paths.schemaPath ?? "node_modules/wrangler/config-schema.json";
  const mainPath = paths.mainPath ?? "src/index.ts";
  const migrationsPath = paths.migrationsPath ?? "migrations";
  const databaseId = config.dbId || PLACEHOLDER_DB_UUID;

  const q = (val) => JSON.stringify(val);

  return `{
  "$schema": ${q(schemaPath)},
  "name": ${q(config.workerName)},
  "main": ${q(mainPath)},
  "workers_dev": false,
  "compatibility_date": ${q(DEFAULT_COMPATIBILITY_DATE)},
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true,
    "logs": {
      "enabled": true,
      "head_sampling_rate": 1
    },
    "traces": {
      "enabled": true,
      "head_sampling_rate": 0.01
    }
  },
  "vars": {
    "MAIL_DOMAIN": ${q(config.domain)},
    "GMAIL_ALIAS_PREFIX": ${q(config.gmailPrefix)},
    "APP_TITLE": ${q(config.appTitle)},
    // 认证模式：
    // - "access"（线上推荐，默认 Fail-Closed）：强制校验 Cloudflare Access RS256 JWT，关闭公网密码与初始化入口
    // - "access+password"：Cloudflare Access + 应用密码双重认证
    // - "password"：仅用于本地 wrangler dev 调试（可通过 gitignored 的 .dev.vars 覆盖）
    "AUTH_MODE": ${q(config.authMode)},
    "ACCESS_TEAM_DOMAIN": ${q(config.accessTeamDomain)},
    "ACCESS_POLICY_AUD": ${q(config.accessAud)},
    "ACCESS_ALLOWED_EMAILS": ${q(config.allowedEmails)}
  },
  "routes": [
    {
      "pattern": ${q(config.webHost)},
      "custom_domain": true
    }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": ${q(config.dbName)},
      "database_id": ${q(databaseId)},
      "migrations_dir": ${q(migrationsPath)}
    }
  ],
  // 可选 R2 存储桶：账户未开通 R2 时默认使用纯 D1 存储小附件（<= 1MB）
  // 在 Cloudflare Dashboard 开通 R2 后，取消下面注释并创建同名存储桶即可支持最大 10MB 附件：
  // "r2_buckets": [
  //   {
  //     "binding": "ATTACHMENTS_BUCKET",
  //     "bucket_name": ${q(`${config.workerName}-attachments`)}
  //   }
  // ],
  "triggers": {
    "crons": ["0 3 * * *"]
  }
}
`;
}

// ---------------------------------------------------------------------------
// 交互式提问辅助
// ---------------------------------------------------------------------------

async function askText(rl, label, defaultValue = "", required = false) {
  while (true) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`  ? ${label}${suffix}: `)).trim();
    const finalVal = answer !== "" ? answer : defaultValue;
    if (required && !finalVal) {
      logWarn("此项为必填项，请输入有效值。");
      continue;
    }
    return finalVal;
  }
}

async function askConfirm(rl, label, defaultYes = true) {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await rl.question(`  ? ${label} ${hint}: `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

// ---------------------------------------------------------------------------
// 步骤 1：环境、依赖与 Cloudflare 登录态检查
// ---------------------------------------------------------------------------

async function step1CheckEnvironment(opts, rl) {
  logStep(1, "检查 Node.js 环境、项目依赖与 Cloudflare 登录状态");

  const [major] = process.versions.node.split(".").map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(major) || major < 18) {
    throw new Error(`需要 Node.js >= 18.0.0，当前版本为 v${process.versions.node}。`);
  }
  logOk(`Node.js v${process.versions.node}（已启用 IPv4 优先 DNS 解析）`);

  const hasNodeModules =
    existsSync(path.join(ROOT_DIR, "node_modules")) &&
    existsSync(path.join(ROOT_DIR, "node_modules", "wrangler"));

  if (!hasNodeModules) {
    if (opts.dryRun) {
      throw new Error(
        "未检测到 node_modules/wrangler。请先运行 npm install（Windows 下为 npm.cmd install）后再执行 --dry-run。"
      );
    }
    logWarn("未检测到 node_modules，正在执行 npm install ...");
    const installRes = await runTool("npm", ["install"], { stdioMode: "inherit" });
    if (installRes.code !== 0) {
      throw new Error(`npm install 失败（退出码 ${installRes.code}）。`);
    }
    logOk("项目依赖安装完成");
  } else {
    logOk("项目依赖已就绪 (node_modules)");
  }

  if (opts.dryRun) {
    logInfo("[dry-run] 跳过远端 wrangler whoami 登录校验（不访问 Cloudflare API）");
    return;
  }

  const checkWhoami = async () => {
    const res = await runTool("npx", ["wrangler", "whoami"], { stdioMode: "capture" });
    const combined = `${res.stdout}\n${res.stderr}`;
    const notAuthed =
      res.code !== 0 ||
      /not authenticated|please run [`'"]?wrangler login/i.test(combined);
    return { ok: !notAuthed, combined };
  };

  let whoami = await checkWhoami();
  if (whoami.ok) {
    logOk("Cloudflare Wrangler 已登录");
    return;
  }

  logWarn("尚未登录 Cloudflare（wrangler whoami 未通过）");
  if (opts.nonInteractive) {
    throw new Error(
      "非交互模式下未检测到有效 Cloudflare 凭据。请先设置 CLOUDFLARE_API_TOKEN 环境变量，或手动运行: npx wrangler login --no-use-keyring --device"
    );
  }

  logInfo("将使用设备码模式登录（--no-use-keyring --device），可避免浏览器 localhost 回调 CSRF Cookie 报错。");
  const shouldLogin = await askConfirm(
    rl,
    "是否立即执行 npx wrangler login --no-use-keyring --device ?",
    true
  );
  if (!shouldLogin) {
    throw new Error("已取消登录，无法继续部署。");
  }

  const loginRes = await runTool(
    "npx",
    ["wrangler", "login", "--no-use-keyring", "--device"],
    { stdioMode: "inherit" }
  );
  if (loginRes.code !== 0) {
    throw new Error(`Cloudflare 登录失败（退出码 ${loginRes.code}）。`);
  }

  whoami = await checkWhoami();
  if (!whoami.ok) {
    throw new Error("登录完成后仍无法通过 wrangler whoami 校验，请检查网络或手动重试。");
  }
  logOk("Cloudflare 登录校验通过");
}

// ---------------------------------------------------------------------------
// 步骤 2：收集并校验部署配置
// ---------------------------------------------------------------------------

async function step2GatherConfig(opts, rl) {
  logStep(2, "收集并校验部署配置");

  const env = process.env;
  // 非交互模式严格隔离本地已有 wrangler.jsonc；交互模式可读取已有配置作为提示默认值
  const localDefaults = opts.nonInteractive ? null : readExistingWranglerDefaults();

  const pick = (cliVal, envKeys, localVal, fallback) => {
    if (cliVal !== undefined) return cliVal;
    for (const key of envKeys) {
      if (env[key] !== undefined && env[key] !== "") return env[key];
    }
    if (localVal) return localVal;
    return fallback;
  };

  const config = {
    workerName: pick(
      opts.workerName,
      ["GMAIL_POSTMAN_WORKER_NAME"],
      localDefaults?.workerName,
      "gmail-postman"
    ),
    domain: pick(
      opts.domain,
      ["GMAIL_POSTMAN_DOMAIN", "MAIL_DOMAIN"],
      localDefaults?.domain,
      ""
    ),
    webHost: pick(opts.webHost, ["GMAIL_POSTMAN_WEB_HOST"], localDefaults?.webHost, ""),
    gmailPrefix: pick(
      opts.gmailPrefix,
      ["GMAIL_POSTMAN_PREFIX", "GMAIL_ALIAS_PREFIX"],
      localDefaults?.gmailPrefix,
      "gmail"
    ),
    appTitle: pick(
      opts.appTitle,
      ["GMAIL_POSTMAN_APP_TITLE", "APP_TITLE"],
      localDefaults?.appTitle,
      "Gmail 助手"
    ),
    authMode: pick(
      opts.authMode,
      ["GMAIL_POSTMAN_AUTH_MODE", "AUTH_MODE"],
      localDefaults?.authMode,
      "access"
    ),
    accessTeamDomain: pick(
      opts.accessTeamDomain,
      ["ACCESS_TEAM_DOMAIN"],
      localDefaults?.accessTeamDomain,
      ""
    ),
    accessAud: pick(opts.accessAud, ["ACCESS_POLICY_AUD"], localDefaults?.accessAud, ""),
    allowedEmails: pick(
      opts.allowedEmails,
      ["ACCESS_ALLOWED_EMAILS"],
      localDefaults?.allowedEmails,
      ""
    ),
    dbName: pick(opts.dbName, ["GMAIL_POSTMAN_DB_NAME"], localDefaults?.dbName, ""),
    dbId: pick(opts.dbId, ["GMAIL_POSTMAN_DB_ID"], localDefaults?.dbId, ""),
    skipTests: Boolean(opts.skipTests),
    skipEmailRouting: Boolean(opts.skipEmailRouting)
  };

  if (!opts.nonInteractive) {
    if (!opts.explicit.has("workerName")) {
      config.workerName = await askText(
        rl,
        "Worker 名称 (小写字母/数字/连字符)",
        config.workerName,
        true
      );
    }
    if (!opts.explicit.has("domain")) {
      config.domain = await askText(
        rl,
        "托管在 Cloudflare 的主域名 (例如 example.com)",
        config.domain,
        true
      );
    }

    const defaultWebHost = config.webHost || `mail.${normalizeHostname(config.domain)}`;
    if (!opts.explicit.has("webHost")) {
      config.webHost = await askText(rl, "Web 控制台自定义域名", defaultWebHost, true);
    }
    if (!opts.explicit.has("gmailPrefix")) {
      config.gmailPrefix = await askText(
        rl,
        `Gmail 接收邮箱前缀 (将生成 <前缀>@${normalizeHostname(config.domain)})`,
        config.gmailPrefix,
        true
      );
    }
    if (!opts.explicit.has("appTitle")) {
      config.appTitle = await askText(rl, "应用显示标题", config.appTitle, true);
    }
    if (!opts.explicit.has("authMode")) {
      config.authMode = await askText(
        rl,
        "认证模式 (access / access+password / password)",
        config.authMode,
        true
      );
    }

    const resolvedMode = String(config.authMode || "access").trim().toLowerCase();
    if (resolvedMode === "access" || resolvedMode === "access+password") {
      if (!opts.explicit.has("accessTeamDomain")) {
        config.accessTeamDomain = await askText(
          rl,
          "Cloudflare Access Team Domain (如 https://your-team.cloudflareaccess.com，可先留空)",
          config.accessTeamDomain,
          false
        );
      }
      if (!opts.explicit.has("accessAud")) {
        config.accessAud = await askText(
          rl,
          "Cloudflare Access Application AUD Tag (可先留空，稍后补齐并重新部署)",
          config.accessAud,
          false
        );
      }
      if (!opts.explicit.has("allowedEmails")) {
        config.allowedEmails = await askText(
          rl,
          "允许登录的邮箱白名单，逗号分隔 (可选，例如 owner@example.com)",
          config.allowedEmails,
          false
        );
      }
    }

    const defaultDbName = config.dbName || `${config.workerName}-db`;
    if (!opts.explicit.has("dbName")) {
      config.dbName = await askText(rl, "D1 数据库名称", defaultDbName, true);
    }
    if (!opts.explicit.has("dbId")) {
      config.dbId = await askText(
        rl,
        "已有 D1 Database UUID (留空则自动查找或创建)",
        config.dbId,
        false
      );
    }
    if (!opts.explicit.has("skipTests")) {
      config.skipTests = !(await askConfirm(rl, "部署前是否运行 Vitest 单元测试?", true));
    }
    if (!opts.explicit.has("skipEmailRouting")) {
      config.skipEmailRouting = !(await askConfirm(
        rl,
        "部署后是否尝试自动启用 Cloudflare Email Routing?",
        true
      ));
    }
  } else {
    if (!config.webHost && config.domain) {
      config.webHost = `mail.${normalizeHostname(config.domain)}`;
    }
    if (!config.dbName) {
      config.dbName = `${config.workerName || "gmail-postman"}-db`;
    }
  }

  const { errors, warnings } = validateConfig(config);
  for (const warn of warnings) {
    logWarn(warn);
  }
  if (errors.length > 0) {
    for (const err of errors) {
      logErr(err);
    }
    throw new Error("配置校验未通过，请修正上述参数后重试。");
  }

  console.log("");
  logInfo("部署配置摘要 / Configuration Summary:");
  logDim(`Worker Name      : ${config.workerName}`);
  logDim(`Mail Domain      : ${config.domain}`);
  logDim(`Web Console URL  : https://${config.webHost}`);
  logDim(`Gmail Receiver   : ${config.gmailPrefix}@${config.domain}`);
  logDim(`App Title        : ${config.appTitle}`);
  logDim(`Auth Mode        : ${config.authMode}`);
  if (config.authMode !== "password") {
    logDim(`Access Team      : ${config.accessTeamDomain || "(未配置 — Fail-Closed 返回 403)"}`);
    logDim(`Access AUD       : ${config.accessAud || "(未配置 — Fail-Closed 返回 403)"}`);
    logDim(`Allowed Emails   : ${config.allowedEmails || "(未限制 — 由 Access 策略控制)"}`);
  }
  logDim(`D1 Database      : ${config.dbName}${config.dbId ? ` (${config.dbId})` : " (自动查找或创建)"}`);
  logDim(`Skip Tests       : ${config.skipTests ? "Yes" : "No"}`);
  logDim(`Skip EmailRoute  : ${config.skipEmailRouting ? "Yes" : "No"}`);

  if (!opts.nonInteractive) {
    const proceed = await askConfirm(rl, "确认以上配置并继续?", true);
    if (!proceed) {
      throw new Error("用户已取消部署。");
    }
  }

  logOk("配置校验通过");
  return config;
}

// ---------------------------------------------------------------------------
// 步骤 3：查找或创建远端 D1 数据库
// ---------------------------------------------------------------------------

async function findExistingD1Uuid(dbName) {
  const listRes = await runTool("npx", ["wrangler", "d1", "list", "--json"], {
    stdioMode: "capture"
  });
  if (listRes.code !== 0) {
    return { uuid: "", error: listRes.stderr || listRes.stdout };
  }
  const items = extractJsonArray(listRes.stdout) || extractJsonArray(`${listRes.stdout}\n${listRes.stderr}`);
  if (!items) return { uuid: "", error: "无法解析 wrangler d1 list --json 输出" };

  const matched = items.find((item) => item && item.name === dbName);
  const uuid = matched?.uuid || matched?.database_id || matched?.id || "";
  return { uuid: UUID_RE.test(String(uuid)) ? String(uuid).toLowerCase() : "", error: "" };
}

async function step3EnsureD1(config, opts) {
  logStep(3, "准备 Cloudflare D1 数据库");

  if (opts.dryRun) {
    if (config.dbId) {
      logInfo(`[dry-run] 跳过远端 D1 检查，预览配置将使用传入的 UUID: ${config.dbId}`);
    } else {
      logInfo(
        `[dry-run] 跳过远端 D1 查询与创建，预览配置将使用占位 UUID: ${PLACEHOLDER_DB_UUID}`
      );
    }
    return;
  }

  if (config.dbId) {
    logOk(`复用指定的 D1 Database UUID: ${config.dbId}`);
    return;
  }

  logInfo(`正在查询已有 D1 数据库 (${config.dbName}) ...`);
  const existing = await findExistingD1Uuid(config.dbName);
  if (existing.uuid) {
    config.dbId = existing.uuid;
    logOk(`检测到同名 D1 数据库，自动复用 UUID: ${config.dbId}`);
    return;
  }

  logInfo(`未找到 "${config.dbName}"，正在创建新的 D1 数据库 ...`);
  const createRes = await runTool("npx", ["wrangler", "d1", "create", config.dbName], {
    stdioMode: "tee"
  });
  const combined = `${createRes.stdout}\n${createRes.stderr}`;

  if (createRes.code === 0) {
    const createdUuid = extractD1UuidFromOutput(combined);
    if (createdUuid) {
      config.dbId = createdUuid;
      logOk(`D1 数据库创建成功，UUID: ${config.dbId}`);
      return;
    }
  }

  // 处理并发/已存在情况或输出格式差异：再查一次列表兜底
  const retry = await findExistingD1Uuid(config.dbName);
  if (retry.uuid) {
    config.dbId = retry.uuid;
    logOk(`已从远端列表获取 D1 Database UUID: ${config.dbId}`);
    return;
  }

  throw new Error(
    `无法创建或解析 D1 数据库 "${config.dbName}" 的 UUID。` +
      `请手动在 Cloudflare Dashboard 或通过 "npx wrangler d1 create ${config.dbName}" 创建后，使用 --db-id <uuid> 参数重跑。`
  );
}

// ---------------------------------------------------------------------------
// 步骤 4：生成或写入本地 wrangler.jsonc
// ---------------------------------------------------------------------------

async function step4WriteConfig(config, opts, rl) {
  logStep(4, "生成本地 wrangler.jsonc 配置");

  const rendered = renderWranglerJsonc(config);

  // 本地解析自检，确保生成的 JSONC 语法 100% 合法
  try {
    JSON.parse(stripJsonc(rendered));
  } catch (err) {
    throw new Error(`内部错误：生成的 wrangler.jsonc 无法解析: ${err.message}`);
  }

  const shouldWrite = !opts.dryRun || opts.writeConfig;

  if (!shouldWrite) {
    logInfo("[dry-run] 未传入 --write-config，不会写入或覆盖本地 wrangler.jsonc。");
    if (existsSync(WRANGLER_CONFIG_PATH)) {
      logOk("现有 wrangler.jsonc 已保持原样未被修改");
    }
    console.log("");
    console.log(style("  --- 预览 wrangler.jsonc (Preview Only) ---", ANSI.dim));
    for (const line of rendered.trimEnd().split("\n")) {
      console.log(`  ${line}`);
    }
    console.log(style("  --- 预览结束 ---", ANSI.dim));
    return { wroteConfig: false, rendered };
  }

  if (existsSync(WRANGLER_CONFIG_PATH)) {
    let allowOverwrite = opts.forceOverwriteConfig;

    if (!allowOverwrite) {
      if (opts.nonInteractive) {
        throw new Error(
          "当前目录已存在 wrangler.jsonc。非交互模式下请添加 --force-overwrite-config 参数以自动备份并覆盖。"
        );
      }
      allowOverwrite = await askConfirm(
        rl,
        "检测到已存在 wrangler.jsonc，是否备份为 wrangler.jsonc.bak 并覆盖?",
        true
      );
      if (!allowOverwrite) {
        throw new Error("已取消覆盖现有 wrangler.jsonc，部署终止。");
      }
    }

    copyFileSync(WRANGLER_CONFIG_PATH, WRANGLER_BACKUP_PATH);
    logOk("已备份旧配置至 wrangler.jsonc.bak");
  }

  writeFileSync(WRANGLER_CONFIG_PATH, rendered, "utf8");
  logOk("已写入本地 wrangler.jsonc");
  return { wroteConfig: true, rendered };
}

// ---------------------------------------------------------------------------
// 步骤 5：类型生成、TypeScript 校验与单元测试
// ---------------------------------------------------------------------------

async function step5VerifyCode(config, opts, wroteConfig) {
  logStep(5, "执行类型检查与本地测试 (types / typecheck / test)");

  // 纯 --dry-run 且未写配置时，避免覆盖工作区已有的 worker-configuration.d.ts
  if (wroteConfig) {
    logInfo("正在执行 npm run types ...");
    const typesRes = await runTool("npm", ["run", "types"], { stdioMode: "tee" });
    if (typesRes.code !== 0) {
      throw new Error(`npm run types 失败（退出码 ${typesRes.code}）。`);
    }
    logOk("Wrangler 类型定义已更新");
  } else {
    logInfo("[dry-run] 跳过 npm run types（保持现有 worker-configuration.d.ts 不被修改）");
  }

  if (existsSync(WORKER_TYPES_PATH)) {
    logInfo("正在执行 npm run typecheck ...");
    const tcRes = await runTool("npm", ["run", "typecheck"], { stdioMode: "tee" });
    if (tcRes.code !== 0) {
      throw new Error(`TypeScript 类型检查失败（退出码 ${tcRes.code}）。`);
    }
    logOk("TypeScript 类型检查通过");
  } else {
    logWarn("未检测到 worker-configuration.d.ts，跳过 typecheck（正式部署时会自动先执行 npm run types）。");
  }

  if (config.skipTests) {
    logInfo("已按 --skip-tests 参数跳过单元测试");
    return;
  }

  if (opts.dryRun && !existsSync(WRANGLER_CONFIG_PATH)) {
    logWarn("[dry-run] 当前工作区无 wrangler.jsonc，跳过 vitest 单元测试（传入 --write-config 后可执行）。");
    return;
  }

  logInfo("正在执行 npm test ...");
  const testRes = await runTool("npm", ["test"], { stdioMode: "tee" });
  if (testRes.code !== 0) {
    throw new Error(`单元测试失败（退出码 ${testRes.code}）。修复问题后再部署，或临时添加 --skip-tests。`);
  }
  logOk("单元测试全部通过");
}

// ---------------------------------------------------------------------------
// 步骤 6：应用远端 D1 数据库迁移
// ---------------------------------------------------------------------------

async function step6ApplyMigrations(config, opts) {
  logStep(6, "应用远端 D1 数据库迁移");

  if (opts.dryRun) {
    logInfo(
      `[dry-run] 跳过远端 D1 迁移（正式部署将执行: npx wrangler d1 migrations apply ${config.dbName} --remote --force）`
    );
    return;
  }

  const sqlFiles = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR).filter((name) => name.toLowerCase().endsWith(".sql"))
    : [];

  if (sqlFiles.length === 0) {
    logWarn("migrations/ 目录下未发现 .sql 迁移文件，跳过数据库迁移。");
    return;
  }

  logInfo(`发现 ${sqlFiles.length} 个迁移文件，正在应用至远端 D1 (${config.dbName}) ...`);
  const migRes = await runTool(
    "npx",
    ["wrangler", "d1", "migrations", "apply", config.dbName, "--remote", "--force"],
    { stdioMode: "tee" }
  );
  if (migRes.code !== 0) {
    throw new Error(
      `远端 D1 迁移失败（退出码 ${migRes.code}）。请检查 D1 权限或手动运行: npx wrangler d1 migrations apply ${config.dbName} --remote`
    );
  }
  logOk("远端 D1 数据库迁移已完成");
}

// ---------------------------------------------------------------------------
// 步骤 7：部署 Worker（含 --dry-run 本地打包校验 & Error 10063 诊断）
// ---------------------------------------------------------------------------

async function step7DeployWorker(config, opts, wroteConfig, tempCleanupSet) {
  logStep(7, opts.dryRun ? "执行 Worker 本地构建预演 (wrangler deploy --dry-run)" : "部署 Worker 到 Cloudflare");

  if (opts.dryRun) {
    let args = ["wrangler", "deploy", "--dry-run"];
    let tempConfigPath = "";

    if (!wroteConfig) {
      const tmpDir = path.join(ROOT_DIR, ".wrangler");
      mkdirSync(tmpDir, { recursive: true });
      tempConfigPath = path.join(tmpDir, `deploy-dry-run-${process.pid}.jsonc`);
      const previewConfig = renderWranglerJsonc(config, {
        schemaPath: "../node_modules/wrangler/config-schema.json",
        mainPath: "../src/index.ts",
        migrationsPath: "../migrations"
      });
      writeFileSync(tempConfigPath, previewConfig, "utf8");
      tempCleanupSet.add(tempConfigPath);
      args = ["wrangler", "deploy", "--dry-run", "--config", tempConfigPath];
    }

    try {
      const dryRes = await runTool("npx", args, { stdioMode: "tee" });
      if (dryRes.code !== 0) {
        throw new Error(`wrangler deploy --dry-run 预演失败（退出码 ${dryRes.code}）。`);
      }
      logOk("Worker 本地构建与配置预演通过（未上传至远端）");
    } finally {
      if (tempConfigPath && existsSync(tempConfigPath)) {
        try {
          rmSync(tempConfigPath, { force: true });
        } catch {
          // Ignore cleanup errors
        }
        tempCleanupSet.delete(tempConfigPath);
      }
    }
    return;
  }

  const deployRes = await runTool("npx", ["wrangler", "deploy"], { stdioMode: "tee" });
  const combined = `${deployRes.stdout}\n${deployRes.stderr}`;

  if (deployRes.code !== 0) {
    if (isError10063(combined)) {
      console.log("");
      logErr("检测到 Cloudflare 错误 10063：账户尚未注册 workers.dev 子域名，导致 Cron Triggers 无法绑定。");
      logWarn(
        '一行修复提示：请先在 Cloudflare Dashboard -> Workers & Pages 开通一次 workers.dev 子域名后再执行 npx wrangler deploy（或临时注释 wrangler.jsonc 的 triggers.crons 后部署）。'
      );
    } else if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|fetch failed/i.test(combined)) {
      logWarn(
        "检测到网络连接超时：请确认本地网络可访问 api.cloudflare.com（如需代理，请设置 HTTPS_PROXY 环境变量后重试）。"
      );
    }
    throw new Error(`Worker 部署失败（退出码 ${deployRes.code}）。`);
  }

  logOk(`Worker "${config.workerName}" 已成功部署至 https://${config.webHost}`);
}

// ---------------------------------------------------------------------------
// 步骤 8：检查 / 启用 Cloudflare Email Routing（失败时优雅降级提示）
// ---------------------------------------------------------------------------

async function step8EnableEmailRouting(config, opts) {
  logStep(8, "检查并启用 Cloudflare Email Routing");

  if (opts.dryRun) {
    logInfo(
      `[dry-run] 跳过远端 Email Routing 启用（正式部署将尝试: npx wrangler email routing enable ${config.domain}）`
    );
    return;
  }

  if (config.skipEmailRouting) {
    logInfo("已按 --skip-email-routing 参数跳过 Email Routing 自动配置");
    return;
  }

  logInfo(`正在查询域名 ${config.domain} 的 Email Routing 状态 ...`);
  const settingsRes = await runTool(
    "npx",
    ["wrangler", "email", "routing", "settings", config.domain],
    { stdioMode: "capture" }
  );
  const settingsOut = `${settingsRes.stdout}\n${settingsRes.stderr}`;

  if (settingsRes.code === 0 && /enabled\s*[:=]\s*true|\bstatus\b.*ready/i.test(settingsOut)) {
    logOk(`域名 ${config.domain} 的 Email Routing 已处于启用状态`);
    return;
  }

  logInfo(`正在尝试通过 CLI 启用 ${config.domain} 的 Email Routing ...`);
  const enableRes = await runTool(
    "npx",
    ["wrangler", "email", "routing", "enable", config.domain],
    { stdioMode: "tee" }
  );

  if (enableRes.code === 0) {
    logOk(`已为 ${config.domain} 启用 Email Routing`);
    return;
  }

  logWarn("Wrangler CLI 未能自动启用 Email Routing（可能是令牌缺少 Email Routing 权限、该命令尚处 Open Beta 或需在控制台确认 MX/TXT 记录）。");
  logInfo(
    `优雅降级指引：请登录 Cloudflare Dashboard -> 选择域名 ${config.domain} -> Email -> Email Routing -> 点击启用，并配置 Catch-all 规则转发到 Worker "${config.workerName}"。`
  );
}

// ---------------------------------------------------------------------------
// 步骤 9：公网 HTTPS 连通性验证 + 中文/双语部署后配置清单
// ---------------------------------------------------------------------------

async function probeHttpsOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "gmail-postman-deploy-check/1.0"
      }
    });
    return {
      ok: true,
      status: res.status,
      location: res.headers.get("location") || ""
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printPostDeployChecklist(config, opts) {
  const receiverEmail = `${config.gmailPrefix}@${config.domain}`;
  const consoleUrl = `https://${config.webHost}`;
  const allowedHint = config.allowedEmails || "owner@example.com";

  console.log("");
  console.log(
    style(
      `======================== 部署后必做检查清单 / Post-Deploy Checklist${opts.dryRun ? " (Preview)" : ""} ========================`,
      ANSI.bold,
      ANSI.cyan
    )
  );
  console.log(`
1. Cloudflare Access 零信任保护 (Zero Trust Self-hosted App + Reusable Policy)
   - 打开 Cloudflare Zero Trust Dashboard -> Access -> Applications -> Add an application -> Self-hosted
   - 保护域名填写: ${config.webHost}
   - 绑定可复用策略 (Reusable Policy): Action 选 Allow，规则添加 Emails = ${allowedHint}
   - 创建后复制 Application Audience (AUD) Tag 与 Team Domain (https://<your-team>.cloudflareaccess.com)
   - 若尚未写入 wrangler.jsonc，请补齐 ACCESS_TEAM_DOMAIN 与 ACCESS_POLICY_AUD 后重跑: npx wrangler deploy${
     config.authMode === "password" || config.authMode === "access+password"
       ? "\n   - [安全建议] 当前启用了密码认证，建议执行: npx wrangler secret put SESSION_SECRET"
       : ""
   }

2. Cloudflare Email Routing 邮件路由 (Catch-all -> Worker)
   - 打开 Cloudflare Dashboard -> ${config.domain} -> Email -> Email Routing
   - 确认 Email Routing 已启用且 MX / SPF TXT 记录状态为正常
   - 进入 Routing rules -> Catch-all address -> 开启 Catch-all，Action 选择 "Send to a Worker" -> ${config.workerName}
   - (也可按需为 ${receiverEmail} 单独创建 Custom address 规则指向 ${config.workerName})

3. Gmail 自动转发验证与开启 (Forwarding Confirmation + Save Changes)
   - 登录 Gmail 网页版 -> 设置 (Settings) -> 查看所有设置 -> 转发和 POP/IMAP -> 添加转发地址: ${receiverEmail}
   - 打开你的控制台 ${consoleUrl}，Gmail 助手会自动收信并置顶提取确认链接与验证码，点击链接或填入验证码完成确认
   - [极其重要 / CRITICAL] 确认完成后，务必回到 Gmail「转发和 POP/IMAP」页面：
     (a) 勾选「将收到的邮件的副本转发给 ${receiverEmail}」
     (b) 滚动到页面最底部点击「保存更改 / Save Changes」，否则转发不会生效！

4. 常用日常运维命令 / Useful Commands
   - 查看实时日志: npx wrangler tail
   - 重新部署    : npx wrangler deploy
   - 本地调试    : npm run dev
`);
  console.log(
    style(
      "==================================================================================================",
      ANSI.cyan
    )
  );
}

async function step9VerifyAndChecklist(config, opts) {
  logStep(9, "公网 HTTPS 验证与部署后配置清单");

  const targetUrl = `https://${config.webHost}`;

  if (opts.dryRun) {
    logInfo(`[dry-run] 跳过公网 HTTPS 探测（正式部署将请求 ${targetUrl} 并校验状态码）`);
    printPostDeployChecklist(config, opts);
    return;
  }

  logInfo(`正在探测 ${targetUrl} (redirect: manual) ...`);
  let probe = await probeHttpsOnce(targetUrl);
  if (!probe.ok) {
    logDim(`首次探测暂未连通 (${probe.error})，等待 3 秒后重试（自定义域名证书可能正在签发）...`);
    await sleep(3000);
    probe = await probeHttpsOnce(targetUrl);
  }

  if (!probe.ok) {
    logWarn(
      `暂未完成公网 HTTPS 连通性验证（${probe.error}）。新绑定的 Custom Domain TLS 证书通常需 30-120 秒生效，请稍后执行: curl -I ${targetUrl}`
    );
  } else if (probe.status >= 300 && probe.status < 400) {
    const isAccessRedirect = /cloudflareaccess\.com|\/cdn-cgi\/access\/login/i.test(probe.location);
    if (isAccessRedirect) {
      logOk(`HTTPS 验证通过：返回 HTTP ${probe.status}，已正常重定向至 Cloudflare Access 登录页`);
    } else {
      logOk(`HTTPS 验证通过：返回 HTTP ${probe.status}${probe.location ? ` -> ${probe.location}` : ""}`);
    }
  } else if (probe.status === 200) {
    logOk("HTTPS 验证通过：返回 HTTP 200");
    if (config.authMode === "access" || config.authMode === "access+password") {
      logWarn(
        `注意：${targetUrl} 直接返回了 HTTP 200，请确认 Cloudflare Access Self-hosted Application 已正确绑定到该域名。`
      );
    }
  } else if (probe.status === 403) {
    logOk("Worker 已在线响应（返回 HTTP 403 — Fail-Closed 安全拦截）");
    logInfo(
      "说明：若尚未在 Cloudflare Zero Trust 中绑定 Access 应用，或尚未填写 ACCESS_POLICY_AUD，返回 403 属于预期的安全默认行为。"
    );
  } else {
    logWarn(`公网探测返回 HTTP ${probe.status}，请通过 npx wrangler tail 或浏览器检查详情。`);
  }

  printPostDeployChecklist(config, opts);
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  // 非 TTY 终端且未传 --non-interactive 时避免在 readline 上永久阻塞
  if (!opts.nonInteractive && !process.stdin.isTTY) {
    throw new Error(
      "检测到标准输入不是交互式终端（TTY）。请在非交互/CI/自动化环境中添加 --non-interactive 并提供必要参数（如 --domain example.com）。"
    );
  }

  logBanner(opts.dryRun);

  const tempCleanupSet = new Set();
  const rl = opts.nonInteractive
    ? null
    : createInterface({ input: process.stdin, output: process.stdout });

  const cleanup = () => {
    for (const filePath of tempCleanupSet) {
      try {
        if (existsSync(filePath)) rmSync(filePath, { force: true });
      } catch {
        // Ignore cleanup failures
      }
    }
    tempCleanupSet.clear();
    rl?.close();
  };

  const onSignal = (sig) => {
    console.log("");
    logWarn(`收到中断信号 (${sig})，正在清理临时文件并退出...`);
    cleanup();
    process.exit(130);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await step1CheckEnvironment(opts, rl);
    const config = await step2GatherConfig(opts, rl);
    await step3EnsureD1(config, opts);
    const { wroteConfig } = await step4WriteConfig(config, opts, rl);
    await step5VerifyCode(config, opts, wroteConfig);
    await step6ApplyMigrations(config, opts);
    await step7DeployWorker(config, opts, wroteConfig, tempCleanupSet);
    await step8EnableEmailRouting(config, opts);
    await step9VerifyAndChecklist(config, opts);

    console.log("");
    logOk(
      opts.dryRun
        ? "全部预演检查通过！移除 --dry-run 即可执行正式部署。"
        : `全部部署步骤完成！控制台地址: https://${config.webHost}`
    );
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    cleanup();
  }
}

main().catch((err) => {
  console.log("");
  logErr(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
