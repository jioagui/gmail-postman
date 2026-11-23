import type { AppEnv, ForwardRuleRow, ForwardRuleType } from "./types";

export interface ForwardNotificationPayload {
  emailId: string;
  provider: string;
  providerName: string;
  fromAddress: string;
  fromName: string;
  toAddress: string;
  subject: string;
  snippet: string;
  receivedAt: number;
  attachmentCount: number;
  isVerification: boolean;
  verificationCode: string;
  verificationUrl: string;
  inboxUrl?: string;
}

interface WeComConfig {
  webhook_url: string;
}

interface NtfyConfig {
  server_url: string;
  topic: string;
  token?: string;
  priority: string;
}

interface ServerChanConfig {
  send_key: string;
}

interface WebhookConfig {
  url: string;
  secret?: string;
}

const OUTBOUND_FETCH_TIMEOUT_MS = 8000;
const WECOM_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SERVERCHAN_KEY_RE = /^[A-Za-z0-9_-]{6,128}$/;
const NTFY_TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = nums;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
  if (a >= 224) return true; // multicast & reserved
  return false;
}

function isPrivateOrReservedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1" || h === "0:0:0:0:0:0:0:0" || h === "0:0:0:0:0:0:0:1") {
    return true;
  }
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or normalized ::ffff:7f00:1)
  if (h.startsWith("::ffff:") || h.startsWith("0:0:0:0:0:ffff:")) {
    return true;
  }
  // Unique Local Addresses (fc00::/7), Link-local (fe80::/10), Multicast (ff00::/8)
  const firstGroup = h.split(":")[0] || "";
  if (/^f[cd][0-9a-f]{2}$/.test(firstGroup)) return true;
  if (/^fe[89ab][0-9a-f]$/.test(firstGroup)) return true;
  if (/^ff[0-9a-f]{2}$/.test(firstGroup)) return true;
  return false;
}

/**
 * Validates outbound webhook URLs against SSRF:
 * - Requires HTTPS (no plaintext HTTP) and forbids URL userinfo.
 * - Normalizes IPv6 brackets and trailing dots.
 * - Rejects loopback, RFC1918, CGNAT, link-local/metadata, IPv4-mapped IPv6, ULA, and local domains.
 */
export function validateExternalUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== "https:") {
    throw new Error("仅允许使用 HTTPS 协议的外部推送地址");
  }
  if (parsed.username || parsed.password) {
    throw new Error("推送地址不允许包含用户名或密码凭据");
  }
  const normalizedHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    !normalizedHost ||
    normalizedHost === "localhost" ||
    normalizedHost.endsWith(".localhost") ||
    normalizedHost.endsWith(".local") ||
    normalizedHost.endsWith(".internal") ||
    isPrivateOrReservedIpv4(normalizedHost) ||
    isPrivateOrReservedIpv6(normalizedHost)
  ) {
    throw new Error("不允许推送到本机、内网或保留地址");
  }
  return parsed;
}

/**
 * Restricts WeCom webhooks strictly to official qyapi.weixin.qq.com endpoint.
 */
export function resolveWeComWebhookUrl(rawInput: string): URL {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error("企业微信需要填写机器人 Webhook 地址或 Key");
  }
  if (!trimmed.includes("://")) {
    if (!WECOM_KEY_RE.test(trimmed)) {
      throw new Error("企业微信 Key 格式无效");
    }
    return new URL(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(trimmed)}`);
  }

  const parsed = validateExternalUrl(trimmed);
  const key = (parsed.searchParams.get("key") || "").trim();
  if (
    parsed.hostname.toLowerCase() !== "qyapi.weixin.qq.com" ||
    parsed.pathname !== "/cgi-bin/webhook/send" ||
    !WECOM_KEY_RE.test(key)
  ) {
    throw new Error("企业微信地址必须为 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...");
  }
  return new URL(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(key)}`);
}

export function resolveNtfyRootUrl(rawServerUrl?: string): URL {
  const base = (rawServerUrl || "https://ntfy.sh").trim().replace(/\/+$/, "");
  const parsed = validateExternalUrl(base);
  parsed.pathname = "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

/**
 * Validates and allowlists rule config keys at creation time before persisting into D1.
 */
export function normalizeAndValidateForwardConfig(
  type: ForwardRuleType,
  rawConfig: Record<string, unknown>
): Record<string, string> {
  const str = (key: string) => (typeof rawConfig[key] === "string" ? (rawConfig[key] as string).trim() : "");

  if (type === "wecom") {
    const resolved = resolveWeComWebhookUrl(str("webhook_url"));
    return { webhook_url: resolved.toString() };
  }

  if (type === "ntfy") {
    const topic = str("topic");
    if (!NTFY_TOPIC_RE.test(topic)) {
      throw new Error("ntfy Topic 仅支持 1-64 位字母、数字、下划线或短横线");
    }
    const serverUrl = resolveNtfyRootUrl(str("server_url") || "https://ntfy.sh").origin;
    const token = str("token");
    if (token.length > 256 || /[\r\n]/.test(token)) {
      throw new Error("ntfy Token 格式无效");
    }
    const rawPriority = str("priority") || "3";
    const parsedPriority = Number.parseInt(rawPriority, 10);
    const priority =
      Number.isInteger(parsedPriority) && parsedPriority >= 1 && parsedPriority <= 5
        ? String(parsedPriority)
        : "3";
    const out: Record<string, string> = { server_url: serverUrl, topic, priority };
    if (token) out.token = token;
    return out;
  }

  if (type === "serverchan") {
    const sendKey = str("send_key");
    if (!SERVERCHAN_KEY_RE.test(sendKey)) {
      throw new Error("Server酱 SendKey 格式无效");
    }
    return { send_key: sendKey };
  }

  if (type === "webhook") {
    const url = validateExternalUrl(str("url")).toString();
    const secret = str("secret");
    if (secret.length > 256 || /[\r\n]/.test(secret)) {
      throw new Error("Webhook Secret 格式无效");
    }
    const out: Record<string, string> = { url };
    if (secret) out.secret = secret;
    return out;
  }

  throw new Error("不支持的推送类型");
}

function escapeWeComMarkdown(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]()*`<>])/g, "\\$1")
    .replace(/\r?\n/g, " ");
}

function buildPlainMessage(payload: ForwardNotificationPayload): string {
  const lines = [
    payload.isVerification ? "🔐 [Gmail 转发确认邮件]" : `📬 [${payload.providerName}] 新邮件`,
    `发件人: ${payload.fromName ? `${payload.fromName} <${payload.fromAddress}>` : payload.fromAddress}`,
    `收件人: ${payload.toAddress}`,
    `主题: ${payload.subject}`
  ];
  if (payload.isVerification) {
    if (payload.verificationCode) lines.push(`确认码: ${payload.verificationCode}`);
    if (payload.verificationUrl) lines.push(`确认链接: ${payload.verificationUrl}`);
  }
  if (payload.attachmentCount > 0) {
    lines.push(`附件数: ${payload.attachmentCount}`);
  }
  if (payload.snippet) {
    lines.push("", payload.snippet.slice(0, 320));
  }
  return lines.join("\n");
}

function buildWeComMarkdown(payload: ForwardNotificationPayload): string {
  const title = payload.isVerification
    ? "🔐 **Gmail 转发确认邮件**"
    : `📬 **[${escapeWeComMarkdown(payload.providerName)}] 新邮件**`;
  const senderRaw = payload.fromName
    ? `${payload.fromName} <${payload.fromAddress}>`
    : payload.fromAddress;

  const lines = [
    title,
    `> **发件人**：${escapeWeComMarkdown(senderRaw)}`,
    `> **主题**：${escapeWeComMarkdown(payload.subject)}`
  ];
  if (payload.isVerification) {
    if (payload.verificationCode) {
      lines.push(`> **确认码**：<font color="info">${escapeWeComMarkdown(payload.verificationCode)}</font>`);
    }
    if (payload.verificationUrl) {
      lines.push(`> **确认链接**：[点击打开 Gmail 确认页面](${payload.verificationUrl})`);
    }
  }
  if (payload.attachmentCount > 0) {
    lines.push(`> **附件**：${payload.attachmentCount} 个`);
  }
  if (payload.snippet) {
    lines.push("", escapeWeComMarkdown(payload.snippet.slice(0, 360)));
  }
  if (payload.inboxUrl) {
    lines.push("", `[打开收件箱](${payload.inboxUrl})`);
  }
  return lines.join("\n");
}

export async function dispatchSingleForwardRule(
  rule: ForwardRuleRow,
  payload: ForwardNotificationPayload
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    // Keyword filter (bypassed for verified Gmail confirmation emails so confirmation is never missed)
    if (!payload.isVerification && rule.keyword_filter.trim() !== "") {
      const keywords = rule.keyword_filter
        .split(/[,，\n]/)
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (keywords.length > 0) {
        const haystack = `${payload.subject}\n${payload.fromAddress}\n${payload.fromName}\n${payload.snippet}`.toLowerCase();
        const matched = keywords.some((k) => haystack.includes(k));
        if (!matched) {
          return { ok: true };
        }
      }
    }

    if (rule.type === "wecom") {
      const cfg = JSON.parse(rule.config_json) as WeComConfig;
      const target = resolveWeComWebhookUrl(cfg.webhook_url || "");
      const res = await fetch(target.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: {
            content: buildWeComMarkdown(payload)
          }
        })
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: `WeCom HTTP ${res.status}` };
      }
      const respJson = (await res.json().catch(() => ({}))) as { errcode?: number };
      if (typeof respJson.errcode === "number" && respJson.errcode !== 0) {
        return {
          ok: false,
          status: res.status,
          error: `WeCom errcode=${respJson.errcode}`
        };
      }
      return { ok: true, status: res.status };
    }

    if (rule.type === "ntfy") {
      const cfg = JSON.parse(rule.config_json) as NtfyConfig;
      const topic = (cfg.topic || "").trim();
      if (!NTFY_TOPIC_RE.test(topic)) {
        return { ok: false, error: "Invalid ntfy topic" };
      }
      const target = resolveNtfyRootUrl(cfg.server_url);
      const configuredPriority = Number.parseInt(String(cfg.priority ?? "3"), 10);
      const priority = payload.isVerification
        ? 5
        : Number.isFinite(configuredPriority) && configuredPriority >= 1 && configuredPriority <= 5
          ? configuredPriority
          : 3;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "gmail-postman/1.0"
      };
      if (cfg.token?.trim()) {
        headers["Authorization"] = `Bearer ${cfg.token.trim()}`;
      }

      const title = (
        payload.isVerification
          ? `[Gmail 转发确认] ${payload.verificationCode || payload.subject}`
          : `[${payload.providerName}] ${payload.subject}`
      ).slice(0, 120);

      const clickUrl = (payload.isVerification && payload.verificationUrl) || payload.inboxUrl;
      const bodyObj: Record<string, unknown> = {
        topic,
        title,
        message: buildPlainMessage(payload),
        priority,
        tags: payload.isVerification ? ["key", "email"] : ["email"]
      };
      if (clickUrl) {
        bodyObj.click = clickUrl;
      }

      const res = await fetch(target.toString(), {
        method: "POST",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
        body: JSON.stringify(bodyObj)
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: `ntfy HTTP ${res.status}` };
      }
      return { ok: true, status: res.status };
    }

    if (rule.type === "serverchan") {
      const cfg = JSON.parse(rule.config_json) as ServerChanConfig;
      const sendKey = (cfg.send_key || "").trim();
      if (!SERVERCHAN_KEY_RE.test(sendKey)) {
        return { ok: false, error: "Invalid Server酱 send_key" };
      }
      const title = `${payload.isVerification ? "[Gmail转发确认] " : `[${payload.providerName}] `}${payload.subject}`.slice(
        0,
        100
      );
      const res = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          title,
          desp: buildPlainMessage(payload)
        })
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: `Server酱 HTTP ${res.status}` };
      }
      return { ok: true, status: res.status };
    }

    if (rule.type === "webhook") {
      const cfg = JSON.parse(rule.config_json) as WebhookConfig;
      if (!cfg.url) {
        return { ok: false, error: "Missing Webhook URL" };
      }
      const target = validateExternalUrl(cfg.url);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "gmail-postman/1.0"
      };
      if (cfg.secret) {
        headers["X-Webhook-Secret"] = cfg.secret;
      }
      const res = await fetch(target.toString(), {
        method: "POST",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(OUTBOUND_FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          event: payload.isVerification ? "gmail_forwarding_verification" : "email_received",
          text: buildPlainMessage(payload),
          email: payload
        })
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: `Webhook HTTP ${res.status}` };
      }
      return { ok: true, status: res.status };
    }

    return { ok: false, error: "Unsupported forward rule type" };
  } catch (err) {
    // Never leak secret-bearing URLs from fetch error messages into logs or API responses
    const safeReason =
      err instanceof Error
        ? err.name === "TimeoutError" || err.name === "AbortError"
          ? "请求超时"
          : err.message.replace(/https?:\/\/\S+/gi, "[redacted-url]").slice(0, 120)
        : "推送请求异常";
    return { ok: false, error: safeReason };
  }
}

export async function dispatchForwardRules(
  _env: AppEnv,
  rules: ForwardRuleRow[],
  payload: ForwardNotificationPayload
): Promise<void> {
  if (rules.length === 0) return;

  await Promise.all(
    rules.map(async (rule) => {
      const result = await dispatchSingleForwardRule(rule, payload);
      if (!result.ok) {
        console.error(
          JSON.stringify({
            message: "forward_rule_failed",
            ruleId: rule.id,
            ruleType: rule.type,
            emailId: payload.emailId,
            status: result.status,
            error: result.error
          })
        );
      } else {
        console.log(
          JSON.stringify({
            message: "forward_rule_dispatched",
            ruleId: rule.id,
            ruleType: rule.type,
            emailId: payload.emailId
          })
        );
      }
      return result;
    })
  );
}
