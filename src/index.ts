import { Hono, type Context } from "hono";
import { type AccessIdentity, verifyCloudflareAccessRequest } from "./access";
import { runAutoCleanup } from "./cleanup";
import {
  getSessionEpoch,
  getSessionSecret,
  getSetting,
  isInstalled,
  rotateSessionEpoch,
  setSetting
} from "./db";
import { handleInboundEmail } from "./email";
import {
  dispatchSingleForwardRule,
  normalizeAndValidateForwardConfig
} from "./forwarder";
import {
  getProviderById,
  getProviderForwardAddress,
  isValidProviderFilter,
  listProvidersWithAddress
} from "./providers";
import {
  MAX_PASSWORD_LENGTH,
  buildClearSessionCookie,
  buildSessionCookie,
  checkLoginRateLimit,
  clearLoginFailures,
  createSessionToken,
  encodeRfc5987,
  extractSessionCookie,
  generateRandomHex,
  getClientIp,
  hashPassword,
  recordLoginFailure,
  sanitizeFilename,
  verifyPassword,
  verifySessionToken
} from "./security";
import {
  type AppEnv,
  type AttachmentRow,
  type BlockRuleRow,
  type EmailRow,
  type ForwardRuleRow,
  type ForwardRuleType,
  resolveAuthMode
} from "./types";
import { renderAccessDeniedHtml, renderAppHtml } from "./ui";

const MAX_BLOCK_RULES = 200;
const MAX_FORWARD_RULES = 20;
const MAX_SEARCH_QUERY_LEN = 100;
const MAX_PAGE_NUM = 1000;
const CSRF_HEADER_VALUE = "GmailAssistant";

type AppVariables = {
  accessIdentity?: AccessIdentity;
};

const app = new Hono<{ Bindings: AppEnv; Variables: AppVariables }>();

async function readJsonBody<T>(c: Context): Promise<Partial<T>> {
  try {
    const parsed: unknown = await c.req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Partial<T>;
  } catch {
    return {};
  }
}

function asString(val: unknown): string {
  return typeof val === "string" ? val : "";
}

function escapeLikePattern(q: string): string {
  return q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function maskSecret(val: string): string {
  const s = val.trim();
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

function summarizeForwardConfig(type: ForwardRuleType, configJson: string): string {
  try {
    const cfg = JSON.parse(configJson) as Record<string, string>;
    if (type === "wecom") {
      const raw = cfg.webhook_url || "";
      const keyMatch = raw.match(/[?&]key=([^&]+)/);
      const keyPart = keyMatch ? keyMatch[1] : raw;
      return `企业微信 key=${maskSecret(keyPart)}`;
    }
    if (type === "ntfy") {
      const server = (cfg.server_url || "https://ntfy.sh").replace(/\/+$/, "");
      const hasTok = cfg.token ? " · Token已配" : "";
      return `ntfy ${server}/${maskSecret(cfg.topic || "")}${hasTok}`;
    }
    if (type === "serverchan") {
      return `Server酱 key=${maskSecret(cfg.send_key || "")}`;
    }
    if (type === "webhook") {
      try {
        const u = new URL(cfg.url || "");
        const segs = u.pathname.split("/").filter(Boolean);
        const maskedPath = segs.length > 0 ? `/${segs[0]}${segs.length > 1 ? "/***" : ""}` : "/";
        return `Webhook ${u.origin}${maskedPath}`;
      } catch {
        return "Webhook (URL)";
      }
    }
  } catch {
    return "配置解析失败";
  }
  return type;
}

async function isPasswordSessionAuthenticated(request: Request, env: AppEnv): Promise<boolean> {
  const token = extractSessionCookie(request);
  if (!token) return false;
  const [secret, epoch] = await Promise.all([getSessionSecret(env), getSessionEpoch(env)]);
  return verifySessionToken(token, secret, epoch);
}

// Public robots.txt (crawlers blocked without leaking app details)
app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /\n"));

// Global Cloudflare Access Zero Trust middleware (enforced in "access" and "access+password" modes)
app.use("*", async (c, next) => {
  const authMode = resolveAuthMode(c.env);
  if (authMode === "access" || authMode === "access+password") {
    const verification = await verifyCloudflareAccessRequest(c.req.raw, c.env);
    if (!verification.ok || !verification.identity) {
      const pathname = new URL(c.req.url).pathname;
      console.log(
        JSON.stringify({
          message: "access_denied",
          authMode,
          path: pathname,
          error: verification.error
        })
      );
      if (pathname.startsWith("/api/")) {
        return c.json(
          { error: verification.error || "Cloudflare Access 鉴权失败" },
          verification.status,
          { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
        );
      }
      return c.html(
        renderAccessDeniedHtml(
          c.env.APP_TITLE || "Gmail 助手",
          verification.error || "Cloudflare Access 鉴权失败"
        ),
        verification.status,
        {
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
        }
      );
    }
    c.set("accessIdentity", verification.identity);
  }
  await next();
});

// API security headers & server-side CSRF protection on state-changing routes
app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const reqOrigin = c.req.header("Origin");
    const expectedOrigin = new URL(c.req.url).origin;
    if (reqOrigin && reqOrigin !== expectedOrigin) {
      return c.json(
        { error: "跨站请求被拒绝（Origin 不匹配）" },
        403,
        { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
      );
    }

    const fetchSite = c.req.header("Sec-Fetch-Site")?.toLowerCase();
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      return c.json(
        { error: "跨站请求被拒绝（Sec-Fetch-Site 异常）" },
        403,
        { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
      );
    }

    if (c.req.header("X-Requested-With") !== CSRF_HEADER_VALUE) {
      return c.json(
        { error: "缺少必需的安全校验请求头（X-Requested-With）" },
        403,
        { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }
      );
    }
  }

  await next();
  c.header("Cache-Control", "private, no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

app.get("/", (c) => {
  const nonce = generateRandomHex(16);
  const html = renderAppHtml(c.env.APP_TITLE || "Gmail 助手", nonce);
  return c.html(html, 200, {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "connect-src 'self'",
      "img-src data:",
      "frame-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ].join("; ")
  });
});

app.get("/api/status", async (c) => {
  const authMode = resolveAuthMode(c.env);
  const accessIdentity = c.get("accessIdentity");
  const gmailDef = getProviderById("gmail");

  if (authMode === "access") {
    return c.json({
      authMode,
      installed: true,
      authenticated: true,
      accessUser: accessIdentity?.email || "",
      appTitle: c.env.APP_TITLE || "Gmail 助手",
      mailDomain: c.env.MAIL_DOMAIN || "example.com",
      gmailForwardAddress: gmailDef ? getProviderForwardAddress(gmailDef, c.env) : "",
      r2Enabled: Boolean(c.env.ATTACHMENTS_BUCKET)
    });
  }

  const installed = await isInstalled(c.env);
  const authenticated = installed ? await isPasswordSessionAuthenticated(c.req.raw, c.env) : false;

  // Avoid disclosing internal domain/storage details before password authentication
  if (!authenticated) {
    return c.json({
      authMode,
      installed,
      authenticated: false,
      accessUser: accessIdentity?.email || "",
      appTitle: c.env.APP_TITLE || "Gmail 助手"
    });
  }

  return c.json({
    authMode,
    installed,
    authenticated: true,
    accessUser: accessIdentity?.email || "",
    appTitle: c.env.APP_TITLE || "Gmail 助手",
    mailDomain: c.env.MAIL_DOMAIN || "example.com",
    gmailForwardAddress: gmailDef ? getProviderForwardAddress(gmailDef, c.env) : "",
    r2Enabled: Boolean(c.env.ATTACHMENTS_BUCKET)
  });
});

app.post("/api/setup", async (c) => {
  if (resolveAuthMode(c.env) === "access") {
    return c.json({ error: "当前已启用 Cloudflare Access 零信任模式，已禁用密码初始化接口" }, 403);
  }
  const body = await readJsonBody<{ password: string; gmailSourceEmail: string }>(c);
  const password = asString(body.password);
  if (password.length < 8 || password.length > MAX_PASSWORD_LENGTH) {
    return c.json({ error: `管理员密码长度须在 8 到 ${MAX_PASSWORD_LENGTH} 位之间` }, 400);
  }

  const passwordHash = await hashPassword(password);
  // Atomic first-time insert prevents concurrent setup TOCTOU race
  const insertRes = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('admin_password_hash', ?, ?)`
  )
    .bind(passwordHash, Date.now())
    .run();

  if ((insertRes.meta?.changes ?? 0) !== 1) {
    return c.json({ error: "系统已完成初始化，禁止重复设置" }, 403);
  }

  const gmailSource = asString(body.gmailSourceEmail).trim().slice(0, 254);
  if (gmailSource) {
    await setSetting(c.env, "gmail_source_email", gmailSource);
  }

  const [secret, epoch] = await Promise.all([getSessionSecret(c.env), getSessionEpoch(c.env)]);
  const token = await createSessionToken(secret, epoch);

  console.log(JSON.stringify({ message: "admin_setup_completed" }));

  return c.json(
    { ok: true },
    200,
    { "Set-Cookie": buildSessionCookie(token, c.req.url) }
  );
});

app.post("/api/login", async (c) => {
  if (resolveAuthMode(c.env) === "access") {
    return c.json({ error: "当前已启用 Cloudflare Access 零信任模式，无需密码登录" }, 403);
  }
  const installed = await isInstalled(c.env);
  if (!installed) {
    return c.json({ error: "系统尚未初始化" }, 400);
  }

  const ip = getClientIp(c.req.raw);
  const limit = await checkLoginRateLimit(c.env, ip);
  if (!limit.allowed) {
    return c.json(
      { error: `登录尝试过多，请 ${limit.retryAfterSec} 秒后再试` },
      429
    );
  }

  const body = await readJsonBody<{ password: string }>(c);
  const password = asString(body.password);
  const storedHash = await getSetting(c.env, "admin_password_hash");
  const ok = storedHash ? await verifyPassword(password, storedHash) : false;

  if (!ok) {
    await recordLoginFailure(c.env, ip);
    console.log(JSON.stringify({ message: "login_failed", ip }));
    return c.json({ error: "密码错误" }, 401);
  }

  await clearLoginFailures(c.env, ip);
  const [secret, epoch] = await Promise.all([getSessionSecret(c.env), getSessionEpoch(c.env)]);
  const token = await createSessionToken(secret, epoch);

  console.log(JSON.stringify({ message: "login_succeeded", ip }));
  return c.json(
    { ok: true },
    200,
    { "Set-Cookie": buildSessionCookie(token, c.req.url) }
  );
});

app.post("/api/logout", (c) => {
  const authMode = resolveAuthMode(c.env);
  return c.json(
    {
      ok: true,
      redirectUrl: authMode !== "password" ? "/cdn-cgi/access/logout" : undefined
    },
    200,
    { "Set-Cookie": buildClearSessionCookie(c.req.url) }
  );
});

// Session guard middleware for all remaining /api/* routes
app.use("/api/*", async (c, next) => {
  const authMode = resolveAuthMode(c.env);
  if (authMode === "access") {
    // Already cryptographically verified by Cloudflare Access middleware above
    await next();
    return;
  }
  const authed = await isPasswordSessionAuthenticated(c.req.raw, c.env);
  if (!authed) {
    return c.json({ error: "未登录或会话已过期" }, 401);
  }
  await next();
});

app.get("/api/providers", async (c) => {
  const [countsRes, aliasRes] = await Promise.all([
    c.env.DB.prepare("SELECT provider, COUNT(*) as cnt FROM emails GROUP BY provider").all<{
      provider: string;
      cnt: number;
    }>(),
    c.env.DB.prepare(
      `SELECT provider, account_alias, COUNT(*) as total,
              SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
       FROM emails
       GROUP BY provider, account_alias
       ORDER BY account_alias ASC`
    ).all<{ provider: string; account_alias: string; total: number; unread: number }>()
  ]);

  const countMap = new Map<string, number>();
  for (const row of countsRes.results) {
    countMap.set(row.provider, row.cnt);
  }

  const providers = listProvidersWithAddress(c.env).map((p) => ({
    ...p,
    count: countMap.get(p.id) ?? 0
  }));

  const aliases = aliasRes.results.map((row) => {
    const plusIdx = row.account_alias.indexOf("+");
    const tag = plusIdx >= 0 && plusIdx < row.account_alias.length - 1 ? row.account_alias.slice(plusIdx + 1) : "";
    return {
      provider: row.provider,
      alias: row.account_alias,
      tag,
      label: tag ? `+${tag}` : "默认",
      total: Number(row.total) || 0,
      unread: Number(row.unread) || 0
    };
  });

  const gmailSourceEmail = (await getSetting(c.env, "gmail_source_email")) || "";
  return c.json({ providers, aliases, gmailSourceEmail });
});

app.get("/api/emails", async (c) => {
  const rawProvider = c.req.query("provider") || "gmail";
  const provider = isValidProviderFilter(rawProvider) ? rawProvider : "gmail";
  const rawAlias = (c.req.query("alias") || "all").trim().toLowerCase();
  const alias =
    rawAlias !== "all" && /^[a-z0-9][a-z0-9._+-]{0,99}$/.test(rawAlias) ? rawAlias : "all";
  const filter = c.req.query("filter") || "all";
  const q = (c.req.query("q") || "").trim().slice(0, MAX_SEARCH_QUERY_LEN);
  const page = Math.min(MAX_PAGE_NUM, Math.max(1, Number.parseInt(c.req.query("page") || "1", 10) || 1));
  const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query("limit") || "50", 10) || 50));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  if (provider !== "all") {
    where.push("provider = ?");
    params.push(provider);
  }
  if (alias !== "all") {
    where.push("account_alias = ?");
    params.push(alias);
  }
  if (filter === "unread") where.push("is_read = 0");
  else if (filter === "starred") where.push("is_starred = 1");
  else if (filter === "important") where.push("is_important = 1");
  else if (filter === "verification") where.push("is_verification = 1");

  if (q) {
    where.push(
      "(subject LIKE ? ESCAPE '\\' OR from_address LIKE ? ESCAPE '\\' OR from_name LIKE ? ESCAPE '\\' OR snippet LIKE ? ESCAPE '\\')"
    );
    const like = `%${escapeLikePattern(q)}%`;
    params.push(like, like, like, like);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const listRes = await c.env.DB.prepare(
    `SELECT id, provider, account_alias, from_address, from_name, to_address, subject, snippet,
            is_read, is_starred, is_important, is_verification, verification_code, raw_size, received_at
     FROM emails ${whereSql}
     ORDER BY received_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...params, limit, offset)
    .all<Omit<EmailRow, "text_body" | "html_body" | "message_id" | "in_reply_to" | "verification_url">>();

  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM emails ${whereSql}`)
    .bind(...params)
    .first<{ cnt: number }>();

  const unreadWhereParts: string[] = ["is_read = 0"];
  const unreadParams: unknown[] = [];
  if (provider !== "all") {
    unreadWhereParts.push("provider = ?");
    unreadParams.push(provider);
  }
  if (alias !== "all") {
    unreadWhereParts.push("account_alias = ?");
    unreadParams.push(alias);
  }
  const unreadWhereSql = `WHERE ${unreadWhereParts.join(" AND ")}`;
  const unreadRow = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM emails ${unreadWhereSql}`)
    .bind(...unreadParams)
    .first<{ cnt: number }>();

  return c.json({
    emails: listRes.results,
    total: totalRow?.cnt ?? 0,
    unreadCount: unreadRow?.cnt ?? 0,
    page,
    limit
  });
});

app.get("/api/emails/:id", async (c) => {
  const id = c.req.param("id");
  const email = await c.env.DB.prepare("SELECT * FROM emails WHERE id = ?")
    .bind(id)
    .first<EmailRow>();

  if (!email) {
    return c.json({ error: "邮件不存在" }, 404);
  }

  const attachments = await c.env.DB.prepare(
    "SELECT id, email_id, filename, content_type, size, storage, r2_key, created_at FROM attachments WHERE email_id = ? ORDER BY created_at ASC"
  )
    .bind(id)
    .all<Omit<AttachmentRow, "data_base64">>();

  return c.json({ email, attachments: attachments.results });
});

app.patch("/api/emails/:id/mark", async (c) => {
  const id = c.req.param("id");
  const body = await readJsonBody<{ is_read: number; is_starred: number; is_important: number }>(c);

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.is_read !== undefined) {
    updates.push("is_read = ?");
    params.push(body.is_read ? 1 : 0);
  }
  if (body.is_starred !== undefined) {
    updates.push("is_starred = ?");
    params.push(body.is_starred ? 1 : 0);
  }
  if (body.is_important !== undefined) {
    updates.push("is_important = ?");
    params.push(body.is_important ? 1 : 0);
  }

  if (updates.length === 0) {
    return c.json({ error: "未提供需要更新的状态字段" }, 400);
  }

  params.push(id);
  const res = await c.env.DB.prepare(`UPDATE emails SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...params)
    .run();

  if ((res.meta?.changes ?? 0) === 0) {
    return c.json({ error: "邮件不存在" }, 404);
  }
  return c.json({ ok: true });
});

app.delete("/api/emails/:id", async (c) => {
  const id = c.req.param("id");
  const atts = await c.env.DB.prepare(
    "SELECT r2_key FROM attachments WHERE email_id = ? AND storage = 'r2' AND r2_key != ''"
  )
    .bind(id)
    .all<{ r2_key: string }>();

  if (c.env.ATTACHMENTS_BUCKET && atts.results.length > 0) {
    await c.env.ATTACHMENTS_BUCKET.delete(atts.results.map((r) => r.r2_key));
  }

  await c.env.DB.prepare("DELETE FROM attachments WHERE email_id = ?").bind(id).run();
  const res = await c.env.DB.prepare("DELETE FROM emails WHERE id = ?").bind(id).run();
  if ((res.meta?.changes ?? 0) === 0) {
    return c.json({ error: "邮件不存在" }, 404);
  }
  return c.json({ ok: true });
});

app.get("/api/attachments/:id/download", async (c) => {
  const id = c.req.param("id");
  const att = await c.env.DB.prepare("SELECT * FROM attachments WHERE id = ?")
    .bind(id)
    .first<AttachmentRow>();

  if (!att) {
    return c.json({ error: "附件不存在" }, 404);
  }
  if (att.storage === "skipped_too_large") {
    return c.json({ error: "该附件超过纯 D1 限制，请开通 R2 存储桶后再接收大附件" }, 413);
  }

  const safeName = sanitizeFilename(att.filename);
  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeRfc5987(safeName)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Cache-Control": "private, no-store"
  });

  if (att.storage === "r2") {
    if (!c.env.ATTACHMENTS_BUCKET) {
      return c.json({ error: "R2 存储桶未绑定" }, 500);
    }
    const obj = await c.env.ATTACHMENTS_BUCKET.get(att.r2_key);
    if (!obj) {
      return c.json({ error: "R2 附件对象不存在" }, 404);
    }
    return new Response(obj.body, { headers });
  }

  const bytes = base64ToUint8(att.data_base64 || "");
  return new Response(bytes, { headers });
});

// Block rules CRUD
app.get("/api/rules/block", async (c) => {
  const res = await c.env.DB.prepare("SELECT * FROM block_rules ORDER BY created_at DESC").all<BlockRuleRow>();
  return c.json({ rules: res.results });
});

app.post("/api/rules/block", async (c) => {
  const countRow = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM block_rules").first<{ cnt: number }>();
  if ((countRow?.cnt ?? 0) >= MAX_BLOCK_RULES) {
    return c.json({ error: `拦截规则已达上限（最多 ${MAX_BLOCK_RULES} 条）` }, 400);
  }

  const body = await readJsonBody<{ keyword: string; provider: string }>(c);
  const keyword = asString(body.keyword).trim().slice(0, 200);
  if (!keyword) {
    return c.json({ error: "关键词不能为空" }, 400);
  }
  const rawProv = asString(body.provider);
  const provider = rawProv && isValidProviderFilter(rawProv) ? rawProv : "gmail";
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO block_rules (id, keyword, provider, enabled, created_at) VALUES (?, ?, ?, 1, ?)"
  )
    .bind(id, keyword, provider, Date.now())
    .run();
  return c.json({ ok: true, id }, 201);
});

app.patch("/api/rules/block/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJsonBody<{ enabled: number }>(c);
  await c.env.DB.prepare("UPDATE block_rules SET enabled = ? WHERE id = ?")
    .bind(body.enabled ? 1 : 0, id)
    .run();
  return c.json({ ok: true });
});

app.delete("/api/rules/block/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM block_rules WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// Forward rules CRUD + test push
app.get("/api/rules/forward", async (c) => {
  const res = await c.env.DB.prepare("SELECT * FROM forward_rules ORDER BY created_at DESC").all<ForwardRuleRow>();
  const rules = res.results.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    provider: r.provider,
    keyword_filter: r.keyword_filter,
    enabled: r.enabled,
    created_at: r.created_at,
    configSummary: summarizeForwardConfig(r.type, r.config_json)
  }));
  return c.json({ rules });
});

app.post("/api/rules/forward", async (c) => {
  const countRow = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM forward_rules").first<{ cnt: number }>();
  if ((countRow?.cnt ?? 0) >= MAX_FORWARD_RULES) {
    return c.json({ error: `推送规则已达上限（最多 ${MAX_FORWARD_RULES} 条）` }, 400);
  }

  const body = await readJsonBody<{
    name: string;
    type: ForwardRuleType;
    provider: string;
    config: Record<string, unknown>;
    keyword_filter: string;
  }>(c);

  const type = body.type;
  if (type !== "wecom" && type !== "ntfy" && type !== "serverchan" && type !== "webhook") {
    return c.json({ error: "不支持的推送类型（支持：wecom / ntfy / serverchan / webhook）" }, 400);
  }
  const rawCfg =
    body.config && typeof body.config === "object" && !Array.isArray(body.config)
      ? body.config
      : {};

  let normalizedCfg: Record<string, string>;
  try {
    normalizedCfg = normalizeAndValidateForwardConfig(type, rawCfg);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "推送配置校验失败" }, 400);
  }

  const rawProv = asString(body.provider);
  const provider = rawProv && isValidProviderFilter(rawProv) ? rawProv : "gmail";
  const name = (asString(body.name).trim() || type).slice(0, 80);
  const keywordFilter = asString(body.keyword_filter).trim().slice(0, 200);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO forward_rules (id, name, type, provider, config_json, keyword_filter, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  )
    .bind(id, name, type, provider, JSON.stringify(normalizedCfg), keywordFilter, Date.now())
    .run();

  return c.json({ ok: true, id }, 201);
});

app.patch("/api/rules/forward/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJsonBody<{ enabled: number }>(c);
  await c.env.DB.prepare("UPDATE forward_rules SET enabled = ? WHERE id = ?")
    .bind(body.enabled ? 1 : 0, id)
    .run();
  return c.json({ ok: true });
});

app.post("/api/rules/forward/:id/test", async (c) => {
  const id = c.req.param("id");
  const rule = await c.env.DB.prepare("SELECT * FROM forward_rules WHERE id = ?")
    .bind(id)
    .first<ForwardRuleRow>();

  if (!rule) {
    return c.json({ error: "规则不存在" }, 404);
  }

  const gmailDef = getProviderById("gmail");
  const inboxUrl = c.env.MAIL_DOMAIN ? `https://mail.${c.env.MAIL_DOMAIN.trim()}` : undefined;
  const result = await dispatchSingleForwardRule(
    { ...rule, keyword_filter: "" },
    {
      emailId: "test-notification",
      provider: "gmail",
      providerName: "Gmail",
      fromAddress: "test@gmail.com",
      fromName: "Gmail 助手 测试",
      toAddress: gmailDef ? getProviderForwardAddress(gmailDef, c.env) : "gmail@example.com",
      subject: "Gmail 助手 实时推送测试成功",
      snippet: "如果你收到这条消息，说明 Cloudflare Email Worker 推送通道已正常打通。",
      receivedAt: Date.now(),
      attachmentCount: 0,
      isVerification: false,
      verificationCode: "",
      verificationUrl: "",
      inboxUrl
    }
  );

  return c.json(result, result.ok ? 200 : 502);
});

app.delete("/api/rules/forward/:id", async (c) => {
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM forward_rules WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// Settings & Cleanup
app.get("/api/settings", async (c) => {
  const autoDeleteDays = Number.parseInt((await getSetting(c.env, "auto_delete_days")) || "0", 10) || 0;
  const gmailSourceEmail = (await getSetting(c.env, "gmail_source_email")) || "";
  const gmailDef = getProviderById("gmail");
  const authMode = resolveAuthMode(c.env);
  const accessIdentity = c.get("accessIdentity");
  return c.json({
    auth_mode: authMode,
    access_user: accessIdentity?.email || "",
    access_team_domain: c.env.ACCESS_TEAM_DOMAIN || "",
    auto_delete_days: autoDeleteDays,
    gmail_source_email: gmailSourceEmail,
    r2_enabled: Boolean(c.env.ATTACHMENTS_BUCKET),
    mail_domain: c.env.MAIL_DOMAIN || "example.com",
    gmail_forward_address: gmailDef ? getProviderForwardAddress(gmailDef, c.env) : ""
  });
});

app.put("/api/settings", async (c) => {
  const body = await readJsonBody<{
    auto_delete_days: number;
    gmail_source_email: string;
    current_password: string;
    new_password: string;
  }>(c);

  if (body.auto_delete_days !== undefined) {
    const days = Math.max(0, Math.min(3650, Math.floor(Number(body.auto_delete_days) || 0)));
    await setSetting(c.env, "auto_delete_days", String(days));
  }

  if (body.gmail_source_email !== undefined) {
    await setSetting(c.env, "gmail_source_email", asString(body.gmail_source_email).trim().slice(0, 254));
  }

  if (body.new_password !== undefined) {
    if (resolveAuthMode(c.env) === "access") {
      return c.json({ error: "当前为纯 Cloudflare Access 模式，无需设置本地密码" }, 400);
    }
    const newPassword = asString(body.new_password);
    if (newPassword.length < 8 || newPassword.length > MAX_PASSWORD_LENGTH) {
      return c.json({ error: `新密码长度须在 8 到 ${MAX_PASSWORD_LENGTH} 位之间` }, 400);
    }

    const ip = getClientIp(c.req.raw);
    const limit = await checkLoginRateLimit(c.env, ip);
    if (!limit.allowed) {
      return c.json({ error: `尝试过于频繁，请 ${limit.retryAfterSec} 秒后再试` }, 429);
    }

    const storedHash = await getSetting(c.env, "admin_password_hash");
    const valid = storedHash ? await verifyPassword(asString(body.current_password), storedHash) : false;
    if (!valid) {
      await recordLoginFailure(c.env, ip);
      return c.json({ error: "当前密码不正确" }, 401);
    }

    const newHash = await hashPassword(newPassword);
    await setSetting(c.env, "admin_password_hash", newHash);

    // Rotate session epoch to immediately invalidate all prior session cookies
    const [secret, newEpoch] = await Promise.all([getSessionSecret(c.env), rotateSessionEpoch(c.env)]);
    const freshToken = await createSessionToken(secret, newEpoch);
    return c.json(
      { ok: true },
      200,
      { "Set-Cookie": buildSessionCookie(freshToken, c.req.url) }
    );
  }

  return c.json({ ok: true });
});

app.post("/api/cleanup", async (c) => {
  const summary = await runAutoCleanup(c.env);
  return c.json(summary);
});

app.onError((err, c) => {
  console.error(
    JSON.stringify({
      message: "unhandled_http_error",
      path: new URL(c.req.url).pathname,
      error: err.message
    })
  );
  return c.json({ error: "服务器内部错误" }, 500);
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env as AppEnv, ctx);
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleInboundEmail(message, env as AppEnv, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runAutoCleanup(env as AppEnv));
  }
} satisfies ExportedHandler<Env>;
