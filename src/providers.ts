import type { AppEnv, ProviderDefinition, ProviderId } from "./types";

/**
 * Provider Registry
 *
 * 当前仅启用 Gmail；QQ / Outlook / 163 / 自定义邮箱已按统一接口预留。
 * 未来需要启用其他邮箱时，只需将对应项的 `enabled` 改为 `true`、`reserved` 改为 `false`，
 * 并在对应邮箱后台配置自动转发到 `<prefix>@<MAIL_DOMAIN>` 即可。
 */
export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: "gmail",
    name: "Gmail",
    enabled: true,
    reserved: false,
    defaultPrefix: "gmail",
    color: "#ea4335",
    description: "已启用 · 通过 Gmail 自动转发到 Cloudflare Email Routing 实时收信",
    setupSteps: [
      "在 Cloudflare Dashboard 开启域名 Email Routing，并将 Catch-all 或 gmail@你的域名 指向本 Worker。",
      "打开 Gmail 网页版 → 设置 → 查看所有设置 → 转发和 POP/IMAP → 添加转发地址：输入下方生成的 Gmail 专属收信地址。",
      "Gmail 会发送一封转发确认邮件，本系统会自动识别并置顶高亮验证码与确认链接（且不会被拦截规则误拦）。",
      "回到 Gmail 完成验证后，选中「将收到的邮件的副本转发给 …」，保存更改即可实现秒级聚合。"
    ]
  },
  // ==================== 以下邮箱已预留，暂未启用 ====================
  {
    id: "qq",
    name: "QQ 邮箱",
    enabled: false,
    reserved: true,
    defaultPrefix: "qq",
    color: "#12b7f5",
    description: "预留接口（未启用）· 后续可开启接收 qq@你的域名 自动转发",
    setupSteps: [
      "预留：在 src/providers.ts 将 qq.enabled 设为 true 即可开启。"
    ]
  },
  {
    id: "outlook",
    name: "Outlook / Hotmail",
    enabled: false,
    reserved: true,
    defaultPrefix: "outlook",
    color: "#0078d4",
    description: "预留接口（未启用）· 后续可开启接收 outlook@你的域名 自动转发",
    setupSteps: [
      "预留：在 src/providers.ts 将 outlook.enabled 设为 true 即可开启。"
    ]
  },
  {
    id: "netease163",
    name: "163 / 126 邮箱",
    enabled: false,
    reserved: true,
    defaultPrefix: "163",
    color: "#d93025",
    description: "预留接口（未启用）· 后续可开启接收 163@你的域名 自动转发",
    setupSteps: [
      "预留：在 src/providers.ts 将 netease163.enabled 设为 true 即可开启。"
    ]
  },
  {
    id: "custom",
    name: "其他 / 自定义邮箱",
    enabled: false,
    reserved: true,
    defaultPrefix: "other",
    color: "#8b5cf6",
    description: "预留接口（未启用）· 后续可用于企业邮箱或自定义前缀转发",
    setupSteps: [
      "预留：在 src/providers.ts 将 custom.enabled 设为 true 即可开启。"
    ]
  }
] as const;

export function getProviderPrefix(provider: ProviderDefinition, env: AppEnv): string {
  if (provider.id === "gmail" && env.GMAIL_ALIAS_PREFIX?.trim()) {
    return env.GMAIL_ALIAS_PREFIX.trim().toLowerCase();
  }
  return provider.defaultPrefix;
}

export function getProviderForwardAddress(provider: ProviderDefinition, env: AppEnv): string {
  const domain = (env.MAIL_DOMAIN || "example.com").trim().toLowerCase();
  return `${getProviderPrefix(provider, env)}@${domain}`;
}

export function listProvidersWithAddress(env: AppEnv) {
  return PROVIDERS.map((p) => ({
    ...p,
    prefix: getProviderPrefix(p, env),
    forwardAddress: getProviderForwardAddress(p, env)
  }));
}

export function getProviderById(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export interface ProviderMatchResult {
  status: "matched" | "reserved" | "unknown";
  provider?: ProviderDefinition;
  alias: string;
}

/**
 * Resolves the target provider from the inbound envelope `message.to` address.
 * Supports subaddressing: `gmail+work@domain.com` -> base prefix `gmail`, alias `gmail+work`.
 */
export function resolveInboundProvider(
  toAddress: string,
  env: AppEnv
): ProviderMatchResult {
  const normalized = toAddress.trim().toLowerCase();
  const atIdx = normalized.indexOf("@");
  const localPart = atIdx >= 0 ? normalized.slice(0, atIdx) : normalized;
  const plusIdx = localPart.indexOf("+");
  const basePrefix = plusIdx >= 0 ? localPart.slice(0, plusIdx) : localPart;

  for (const provider of PROVIDERS) {
    const expectedPrefix = getProviderPrefix(provider, env);
    if (basePrefix === expectedPrefix) {
      return {
        status: provider.enabled ? "matched" : "reserved",
        provider,
        alias: localPart || expectedPrefix
      };
    }
  }

  return {
    status: "unknown",
    alias: localPart || "unknown"
  };
}

export interface GmailVerificationInfo {
  isVerification: boolean;
  code: string;
  url: string;
}

const ALLOWED_GMAIL_VERIFY_HOSTS = new Set([
  "mail-settings.google.com",
  "isolated.mail.google.com",
  "mail.google.com"
]);

const ALLOWED_GMAIL_VERIFY_SENDERS = new Set([
  "forwarding-noreply@google.com",
  "mail-noreply@google.com"
]);

function hasVerifiedGoogleAuth(authResultsHeader: string): boolean {
  const lower = authResultsHeader.toLowerCase();
  if (!lower) return false;
  if (lower.includes("dmarc=fail") || lower.includes("dkim=fail")) {
    return false;
  }
  const dkimPassGoogle =
    /dkim=pass\b[^;]*\bheader\.d=(?:[a-z0-9-]+\.)*google\.com\b/i.test(authResultsHeader) ||
    /dkim=pass\b[^;]*\bheader\.i=[^;\s]*@google\.com\b/i.test(authResultsHeader);
  const dmarcPassGoogle =
    /dmarc=pass\b[^;]*\bheader\.from=google\.com\b/i.test(authResultsHeader) ||
    (/dmarc=pass\b/i.test(authResultsHeader) && /dkim=pass\b/i.test(authResultsHeader));
  return dkimPassGoogle || dmarcPassGoogle;
}

/**
 * Detects Gmail's official forwarding confirmation email and extracts
 * the confirmation code and verification link.
 * Requires BOTH exact official Google sender AND forwarding subject AND verified
 * Authentication-Results (DKIM/DMARC pass for google.com) to prevent spoofing.
 */
export function detectGmailForwardingVerification(params: {
  fromAddress: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  authenticationResults?: string;
}): GmailVerificationInfo {
  const from = params.fromAddress.trim().toLowerCase();
  const subject = params.subject.toLowerCase();

  const isExactGoogleSender = ALLOWED_GMAIL_VERIFY_SENDERS.has(from);
  const isForwardingSubject =
    subject.includes("gmail forwarding confirmation") ||
    subject.includes("gmail 转发确认") ||
    subject.includes("转发确认");

  if (!isExactGoogleSender || !isForwardingSubject) {
    return { isVerification: false, code: "", url: "" };
  }

  if (!hasVerifiedGoogleAuth(params.authenticationResults || "")) {
    return { isVerification: false, code: "", url: "" };
  }

  const combined = `${params.textBody}\n${params.htmlBody}`;

  // Extract confirmation link excluding Markdown/HTML delimiters and verify exact Google host
  const urlMatch = combined.match(
    /https:\/\/(?:mail-settings\.google\.com|isolated\.mail\.google\.com|mail\.google\.com)\/mail\/[^\s"'<>()[\]]+/i
  );
  let safeUrl = "";
  if (urlMatch) {
    const candidate = urlMatch[0].replace(/&amp;/g, "&");
    try {
      const parsed = new URL(candidate);
      if (
        parsed.protocol === "https:" &&
        ALLOWED_GMAIL_VERIFY_HOSTS.has(parsed.hostname.toLowerCase()) &&
        !parsed.username &&
        !parsed.password
      ) {
        safeUrl = parsed.toString();
      }
    } catch {
      safeUrl = "";
    }
  }

  // Extract confirmation code (usually 9 digits)
  const codeMatch =
    combined.match(/(?:confirmation code|确认码|验证码)\s*[:：]\s*(\d{6,12})/i) ||
    combined.match(/\b(\d{9})\b/);

  return {
    isVerification: true,
    code: codeMatch ? codeMatch[1] : "",
    url: safeUrl
  };
}

export function isValidProviderFilter(value: string): value is ProviderId | "all" {
  return value === "all" || PROVIDERS.some((p) => p.id === value);
}
