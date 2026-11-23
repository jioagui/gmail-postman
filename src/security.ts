import type { AppEnv } from "./types";

const PBKDF2_ITERATIONS = 100_000;
const SESSION_COOKIE_BASE = "gmail_postman_session";
const SESSION_COOKIE_HOST = "__Host-gmail_postman_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 days
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_IP_FAILURES = 8;
const RATE_LIMIT_MAX_GLOBAL_FAILURES = 30;
export const MAX_PASSWORD_LENGTH = 256;

const textEncoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex length");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function generateRandomHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * Constant-time string comparison via fixed-size SHA-256 hashing + timingSafeEqual.
 */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(a)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(b))
  ]);
  return crypto.subtle.timingSafeEqual(hashA, hashB);
}

/**
 * Hashes a password with PBKDF2-SHA256 + 16-byte random salt.
 * Stored format: `pbkdf2_sha256$<iterations>$<saltHex>$<derivedHex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return false;
  }
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") {
    return false;
  }

  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 500_000) {
    return false;
  }

  let salt: Uint8Array;
  try {
    salt = fromHex(parts[2]);
  } catch {
    return false;
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );

  const derivedHex = toHex(new Uint8Array(bits));
  return timingSafeEqualString(derivedHex, parts[3]);
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return toHex(new Uint8Array(sig));
}

export async function createSessionToken(
  secret: string,
  epoch = "1",
  ttlSeconds = SESSION_TTL_SECONDS
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonce = generateRandomHex(16);
  const payload = `${exp}.${epoch}.${nonce}`;
  const sig = await hmacSign(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  token: string,
  secret: string,
  expectedEpoch = "1"
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [expStr, epoch, nonce, providedSig] = parts;
  if (epoch !== expectedEpoch) return false;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expectedSig = await hmacSign(`${expStr}.${epoch}.${nonce}`, secret);
  return timingSafeEqualString(providedSig, expectedSig);
}

export function getSessionCookieName(requestUrl: string): string {
  const isHttps = new URL(requestUrl).protocol === "https:";
  return isHttps ? SESSION_COOKIE_HOST : SESSION_COOKIE_BASE;
}

export function extractSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const preferredName = getSessionCookieName(request.url);
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${preferredName}=`)) {
      const raw = trimmed.slice(preferredName.length + 1);
      try {
        return decodeURIComponent(raw);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function buildSessionCookie(token: string, requestUrl: string): string {
  const isHttps = new URL(requestUrl).protocol === "https:";
  const name = isHttps ? SESSION_COOKIE_HOST : SESSION_COOKIE_BASE;
  const attrs = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`
  ];
  if (isHttps) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

export function buildClearSessionCookie(requestUrl: string): string {
  const isHttps = new URL(requestUrl).protocol === "https:";
  const name = isHttps ? SESSION_COOKIE_HOST : SESSION_COOKIE_BASE;
  const attrs = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (isHttps) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

/**
 * Only trusts Cloudflare's edge-injected CF-Connecting-IP (never spoofable X-Forwarded-For).
 * Normalizes IPv6 addresses to /64 prefix to prevent subnet rotation brute-force.
 */
export function getClientIp(request: Request): string {
  const raw = request.headers.get("CF-Connecting-IP")?.trim() || "local";
  if (raw.includes(":")) {
    const groups = raw.toLowerCase().split(":");
    return `${groups.slice(0, 4).join(":")}::/64`;
  }
  return raw;
}

/**
 * D1-backed sliding-window login brute-force protection with both per-IP and global caps.
 */
export async function checkLoginRateLimit(
  env: AppEnv,
  ip: string
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  await env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").bind(cutoff).run();

  const [ipRow, globalRow] = await Promise.all([
    env.DB.prepare(
      "SELECT COUNT(*) as cnt, MIN(attempted_at) as oldest FROM login_attempts WHERE ip = ? AND attempted_at >= ?"
    )
      .bind(ip, cutoff)
      .first<{ cnt: number; oldest: number | null }>(),
    env.DB.prepare(
      "SELECT COUNT(*) as cnt, MIN(attempted_at) as oldest FROM login_attempts WHERE attempted_at >= ?"
    )
      .bind(cutoff)
      .first<{ cnt: number; oldest: number | null }>()
  ]);

  if ((ipRow?.cnt ?? 0) >= RATE_LIMIT_MAX_IP_FAILURES) {
    const oldest = ipRow?.oldest ?? Date.now();
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - Date.now()) / 1000));
    return { allowed: false, retryAfterSec };
  }
  if ((globalRow?.cnt ?? 0) >= RATE_LIMIT_MAX_GLOBAL_FAILURES) {
    const oldest = globalRow?.oldest ?? Date.now();
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - Date.now()) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export async function recordLoginFailure(env: AppEnv, ip: string): Promise<void> {
  await env.DB.prepare("INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)")
    .bind(ip, Date.now())
    .run();
}

export async function clearLoginFailures(env: AppEnv, ip: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}

/**
 * Strips control chars, Unicode Bidi overrides, path separators, semicolons, and caps length.
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/["/\\<>:*?|;]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "attachment.bin";
  }
  return cleaned;
}

export function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}
