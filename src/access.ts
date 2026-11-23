import type { AppEnv } from "./types";

export interface AccessIdentity {
  email: string;
  sub: string;
  aud: string[];
  iss: string;
  exp: number;
  isServiceToken: boolean;
}

export interface AccessVerifyResult {
  ok: boolean;
  identity?: AccessIdentity;
  error?: string;
  status: 200 | 403 | 500;
}

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
}

interface JwtPayload {
  aud?: unknown;
  iss?: unknown;
  sub?: unknown;
  email?: unknown;
  common_name?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
}

interface AccessJwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface AccessCertsResponse {
  keys?: AccessJwk[];
}

const CLOCK_SKEW_SECONDS = 30;
const JWKS_CACHE_TTL_SECONDS = 300;
const JWKS_REFRESH_COOLDOWN_SECONDS = 60;
const JWKS_FETCH_TIMEOUT_MS = 5000;

function base64UrlToUint8Array(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function decodeJwtObject<T>(segment: string): T | null {
  try {
    const bytes = base64UrlToUint8Array(segment);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Normalizes a Cloudflare Access team domain and enforces HTTPS origin-only format.
 */
function normalizeTeamDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || url.username || url.password) {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}

export function extractAccessJwt(request: Request): string | null {
  const headerToken = request.headers.get("Cf-Access-Jwt-Assertion")?.trim();
  if (headerToken) return headerToken;

  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("CF_Authorization=")) {
      const raw = trimmed.slice("CF_Authorization=".length).trim();
      try {
        return decodeURIComponent(raw).trim();
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function canRefreshJwksNow(certsUrl: string): Promise<boolean> {
  const cooldownKey = new Request(`${certsUrl}?__zrefresh_cooldown=1`, { method: "GET" });
  try {
    const hit = await caches.default.match(cooldownKey);
    if (hit) return false;
    await caches.default.put(
      cooldownKey,
      new Response("1", {
        headers: { "Cache-Control": `public, max-age=${JWKS_REFRESH_COOLDOWN_SECONDS}` }
      })
    );
  } catch {
    // Cache API unavailable in test harness; allow single refresh
  }
  return true;
}

async function fetchAccessJwks(certsUrl: string, bypassCache = false): Promise<AccessJwk[]> {
  const cacheKey = new Request(certsUrl, { method: "GET" });

  if (!bypassCache) {
    try {
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        const data = (await cached.json()) as AccessCertsResponse;
        if (Array.isArray(data.keys) && data.keys.length > 0) {
          return data.keys;
        }
      }
    } catch {
      // Cache API unavailable or miss; fall through to network fetch
    }
  }

  const res = await fetch(certsUrl, {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS)
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Cloudflare Access JWKS (${res.status})`);
  }

  const bodyText = await res.text();
  const data = JSON.parse(bodyText) as AccessCertsResponse;
  const keys = Array.isArray(data.keys) ? data.keys : [];
  if (keys.length === 0) {
    throw new Error("Cloudflare Access JWKS response contained no keys");
  }

  try {
    const cacheResponse = new Response(bodyText, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${JWKS_CACHE_TTL_SECONDS}`
      }
    });
    await caches.default.put(cacheKey, cacheResponse);
  } catch {
    // Ignore cache write errors in local test harnesses
  }

  return keys;
}

async function verifyRs256Signature(
  jwk: AccessJwk,
  signingInput: string,
  signatureB64Url: string
): Promise<boolean> {
  if (jwk.kty && jwk.kty !== "RSA") return false;
  if (jwk.alg && jwk.alg !== "RS256") return false;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sigBytes = base64UrlToUint8Array(signatureB64Url);
  const dataBytes = new TextEncoder().encode(signingInput);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sigBytes, dataBytes);
}

/**
 * Cryptographically verifies the Cloudflare Access JWT on incoming requests.
 * Checks RS256 signature against `<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`,
 * issuer (`iss`), audience (`aud`), expiry (`exp`/`nbf`), and optional email allowlist.
 * Always fails closed when Access config is missing or token verification fails.
 */
export async function verifyCloudflareAccessRequest(
  request: Request,
  env: AppEnv
): Promise<AccessVerifyResult> {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN || "");
  const policyAud = (env.ACCESS_POLICY_AUD || "").trim();

  if (!teamDomain || !policyAud) {
    console.error(
      JSON.stringify({
        message: "access_config_missing",
        hasTeamDomain: Boolean(teamDomain),
        hasPolicyAud: Boolean(policyAud)
      })
    );
    return {
      ok: false,
      status: 403,
      error: "Cloudflare Access 未配置完整（缺少有效的 HTTPS ACCESS_TEAM_DOMAIN 或 ACCESS_POLICY_AUD），已按安全策略拒绝访问"
    };
  }

  const token = extractAccessJwt(request);
  if (!token) {
    return {
      ok: false,
      status: 403,
      error: "缺少 Cloudflare Access 身份令牌（Cf-Access-Jwt-Assertion），请通过 Cloudflare Access 保护的域名访问"
    };
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    return { ok: false, status: 403, error: "Cloudflare Access JWT 格式无效" };
  }

  const [headerSeg, payloadSeg, sigSeg] = segments;
  const header = decodeJwtObject<JwtHeader>(headerSeg);
  const payload = decodeJwtObject<JwtPayload>(payloadSeg);
  if (!header || !payload) {
    return { ok: false, status: 403, error: "Cloudflare Access JWT 解析失败" };
  }

  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid.trim()) {
    return { ok: false, status: 403, error: "不支持的 JWT 签名算法或缺少 kid" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp + CLOCK_SKEW_SECONDS < now) {
    return { ok: false, status: 403, error: "Cloudflare Access 会话已过期，请重新登录" };
  }
  if (typeof payload.nbf === "number" && Number.isFinite(payload.nbf) && payload.nbf - CLOCK_SKEW_SECONDS > now) {
    return { ok: false, status: 403, error: "Cloudflare Access JWT 尚未生效" };
  }

  if (typeof payload.iss !== "string") {
    return { ok: false, status: 403, error: "Cloudflare Access JWT 签发者（iss）缺失或格式无效" };
  }
  const issuer = normalizeTeamDomain(payload.iss);
  if (issuer !== teamDomain) {
    return { ok: false, status: 403, error: "Cloudflare Access JWT 签发者（iss）不匹配" };
  }

  const audList = Array.isArray(payload.aud)
    ? payload.aud.filter((item): item is string => typeof item === "string")
    : typeof payload.aud === "string"
      ? [payload.aud]
      : [];
  if (!audList.includes(policyAud)) {
    return { ok: false, status: 403, error: "Cloudflare Access JWT 受众（aud）不匹配" };
  }

  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  let keys: AccessJwk[];
  try {
    keys = await fetchAccessJwks(certsUrl, false);
  } catch (err) {
    console.error(
      JSON.stringify({
        message: "access_jwks_fetch_failed",
        error: err instanceof Error ? err.message : String(err)
      })
    );
    return { ok: false, status: 500, error: "无法获取 Cloudflare Access 公钥证书" };
  }

  let matchedKey = keys.find((k) => k.kid === header.kid);
  if (!matchedKey && (await canRefreshJwksNow(certsUrl))) {
    // Rate-limited cache bypass to support key rotation while blocking JWKS amplification DoS
    try {
      keys = await fetchAccessJwks(certsUrl, true);
      matchedKey = keys.find((k) => k.kid === header.kid);
    } catch {
      matchedKey = undefined;
    }
  }

  if (!matchedKey) {
    return { ok: false, status: 403, error: "未找到匹配的 Cloudflare Access 公钥（kid）" };
  }

  let signatureValid = false;
  try {
    signatureValid = await verifyRs256Signature(matchedKey, `${headerSeg}.${payloadSeg}`, sigSeg);
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return { ok: false, status: 403, error: "Cloudflare Access JWT 签名校验失败" };
  }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const commonName = typeof payload.common_name === "string" ? payload.common_name.trim() : "";
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const isServiceToken = !email && Boolean(commonName);

  // Optional secondary email allowlist inside the Worker (fail closed if non-empty raw string has no valid entries)
  const allowlistRaw = (env.ACCESS_ALLOWED_EMAILS || "").trim();
  if (allowlistRaw.length > 0) {
    const allowed = allowlistRaw
      .split(/[,;\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.includes("@"));
    if (allowed.length === 0 || !email || !allowed.includes(email)) {
      return { ok: false, status: 403, error: "当前 Access 身份不在允许的邮箱白名单中" };
    }
  }

  return {
    ok: true,
    status: 200,
    identity: {
      email: email || commonName || "service-token",
      sub,
      aud: audList,
      iss: issuer,
      exp: payload.exp,
      isServiceToken
    }
  };
}
