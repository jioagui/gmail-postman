import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { AppEnv } from "../src/types";

function toBase64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createRsaTestKeyPair(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;

  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return {
    privateKey: pair.privateKey,
    publicJwk: { ...publicJwk, kid, alg: "RS256", use: "sig" }
  };
}

async function signTestJwt(
  privateKey: CryptoKey,
  kid: string,
  payload: Record<string, unknown>
): Promise<string> {
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = toBase64Url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`;
}

function makeRawEmail(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  authenticationResults?: string;
  attachment?: { filename: string; contentType: string; content: string };
}): { raw: ReadableStream<Uint8Array>; size: number; headers: Headers } {
  const boundary = "----GmailPostmanTestBoundary12345";
  const parts: string[] = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Message-ID: <${crypto.randomUUID()}@mail.gmail.com>`,
    "MIME-Version: 1.0"
  ];

  if (opts.attachment || opts.html) {
    parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "");
    parts.push(`--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', "", opts.text);
    if (opts.html) {
      parts.push(`--${boundary}`, 'Content-Type: text/html; charset="utf-8"', "", opts.html);
    }
    if (opts.attachment) {
      const b64 = btoa(opts.attachment.content);
      parts.push(
        `--${boundary}`,
        `Content-Type: ${opts.attachment.contentType}; name="${opts.attachment.filename}"`,
        `Content-Disposition: attachment; filename="${opts.attachment.filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        b64
      );
    }
    parts.push(`--${boundary}--`, "");
  } else {
    parts.push('Content-Type: text/plain; charset="utf-8"', "", opts.text);
  }

  const rawString = parts.join("\r\n");
  const bytes = new TextEncoder().encode(rawString);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });

  const headers = new Headers({
    from: opts.from,
    to: opts.to,
    subject: opts.subject
  });
  if (opts.authenticationResults) {
    headers.set("authentication-results", opts.authenticationResults);
  }

  return { raw: stream, size: bytes.byteLength, headers };
}

function makeEmailMessage(opts: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  authenticationResults?: string;
  attachment?: { filename: string; contentType: string; content: string };
}) {
  const built = makeRawEmail(opts);
  const rejected: string[] = [];
  const forwarded: string[] = [];

  const msg: ForwardableEmailMessage = {
    from: opts.from,
    to: opts.to,
    headers: built.headers,
    raw: built.raw,
    rawSize: built.size,
    canBeForwarded: true,
    setReject(reason: string) {
      rejected.push(reason);
    },
    async forward(rcptTo: string) {
      forwarded.push(rcptTo);
      return { messageId: "<mock-forward@local>" };
    },
    async reply() {
      return { messageId: "<mock-reply@local>" };
    }
  };

  return { msg, rejected, forwarded };
}

type TestEnvOverrides = Omit<Partial<AppEnv>, "MAIL_DOMAIN" | "GMAIL_ALIAS_PREFIX" | "APP_TITLE"> & {
  MAIL_DOMAIN?: string;
  GMAIL_ALIAS_PREFIX?: string;
  APP_TITLE?: string;
};

function withEnvOverrides(overrides: TestEnvOverrides = {}): Env {
  return {
    ...env,
    MAIL_DOMAIN: "example.com",
    GMAIL_ALIAS_PREFIX: "gmail",
    ACCESS_TEAM_DOMAIN: "https://demo.cloudflareaccess.com",
    ACCESS_POLICY_AUD: "",
    ACCESS_ALLOWED_EMAILS: "",
    ...overrides
  } as unknown as Env;
}

async function callFetch(
  path: string,
  init: RequestInit = {},
  cookie?: string,
  customEnv: Env = withEnvOverrides(),
  opts: { skipCsrfHeader?: boolean } = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method || "GET").toUpperCase();
  if (!opts.skipCsrfHeader && method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    if (!headers.has("X-Requested-With")) {
      headers.set("X-Requested-With", "GmailAssistant");
    }
  }
  if (cookie) headers.set("Cookie", cookie);
  const req = new Request(`https://mail.example.com${path}`, { ...init, headers });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, customEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function extractCookie(res: Response): string {
  const setCookie = res.headers.get("Set-Cookie") || "";
  return setCookie.split(";")[0] || "";
}

async function resetTables() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM attachments"),
    env.DB.prepare("DELETE FROM emails"),
    env.DB.prepare("DELETE FROM block_rules"),
    env.DB.prepare("DELETE FROM forward_rules"),
    env.DB.prepare("DELETE FROM login_attempts"),
    env.DB.prepare("DELETE FROM settings WHERE key NOT IN ('auto_delete_days', 'gmail_source_email')"),
    env.DB.prepare("UPDATE settings SET value = '0' WHERE key = 'auto_delete_days'"),
    env.DB.prepare("UPDATE settings SET value = '' WHERE key = 'gmail_source_email'")
  ]);
}

describe("Gmail 助手 Worker (Cloudflare Access Zero Trust + Gmail active)", () => {
  const localPasswordEnv = () =>
    withEnvOverrides({
      AUTH_MODE: "password",
      MAIL_DOMAIN: "example.com",
      GMAIL_ALIAS_PREFIX: "gmail"
    });

  beforeEach(async () => {
    await resetTables();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enforces Cloudflare Access RS256 JWT validation in default production mode (fail-closed)", async () => {
    const teamDomain = "https://demo.cloudflareaccess.com";
    const policyAud = "test-aud-tag-1234567890abcdef";
    const kid = `key-${crypto.randomUUID()}`;
    const validKey = await createRsaTestKeyPair(kid);
    const attackerKey = await createRsaTestKeyPair(kid);

    const accessEnv = withEnvOverrides({
      MAIL_DOMAIN: "example.com",
      GMAIL_ALIAS_PREFIX: "gmail",
      AUTH_MODE: "access",
      ACCESS_TEAM_DOMAIN: teamDomain,
      ACCESS_POLICY_AUD: policyAud,
      ACCESS_ALLOWED_EMAILS: "owner@example.com"
    });

    // 1. Missing/empty Access Policy AUD fails closed with 403
    const misconfigured = await callFetch(
      "/api/status",
      {},
      undefined,
      withEnvOverrides({
        MAIL_DOMAIN: "example.com",
        GMAIL_ALIAS_PREFIX: "gmail",
        AUTH_MODE: "access",
        ACCESS_TEAM_DOMAIN: teamDomain,
        ACCESS_POLICY_AUD: ""
      })
    );
    expect(misconfigured.status).toBe(403);

    // 2. robots.txt remains readable without JWT
    const robots = await callFetch("/robots.txt", {}, undefined, accessEnv);
    expect(robots.status).toBe(200);

    // 3. Missing JWT returns 403 on both HTML and API
    const missingHtml = await callFetch("/", {}, undefined, accessEnv);
    expect(missingHtml.status).toBe(403);
    expect(await missingHtml.text()).toContain("Cloudflare Access");

    const missingApi = await callFetch("/api/emails", {}, undefined, accessEnv);
    expect(missingApi.status).toBe(403);

    // Mock Cloudflare Access JWKS endpoint (also validates real workerd RequestInit options!)
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      // Constructing a real Request inside workerd validates redirect ("manual"/"follow") & headers
      const req = new Request(url, init);
      expect(req.redirect).toBe("manual");
      if (url === `${teamDomain}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify({ keys: [validKey.publicJwk] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    const now = Math.floor(Date.now() / 1000);

    // 4. Forged signature rejected (403)
    const forgedJwt = await signTestJwt(attackerKey.privateKey, kid, {
      iss: teamDomain,
      aud: [policyAud],
      sub: "user-1",
      email: "owner@example.com",
      exp: now + 3600
    });
    expect(
      (await callFetch("/api/emails", { headers: { "Cf-Access-Jwt-Assertion": forgedJwt } }, undefined, accessEnv)).status
    ).toBe(403);

    // 5. Wrong audience rejected (403)
    const wrongAudJwt = await signTestJwt(validKey.privateKey, kid, {
      iss: teamDomain,
      aud: ["wrong-aud"],
      sub: "user-1",
      email: "owner@example.com",
      exp: now + 3600
    });
    expect(
      (await callFetch("/api/emails", { headers: { "Cf-Access-Jwt-Assertion": wrongAudJwt } }, undefined, accessEnv)).status
    ).toBe(403);

    // 6. Expired JWT rejected (403)
    const expiredJwt = await signTestJwt(validKey.privateKey, kid, {
      iss: teamDomain,
      aud: [policyAud],
      sub: "user-1",
      email: "owner@example.com",
      exp: now - 300
    });
    expect(
      (await callFetch("/api/emails", { headers: { "Cf-Access-Jwt-Assertion": expiredJwt } }, undefined, accessEnv)).status
    ).toBe(403);

    // 7. Email not in allowlist rejected (403)
    const otherUserJwt = await signTestJwt(validKey.privateKey, kid, {
      iss: teamDomain,
      aud: [policyAud],
      sub: "user-2",
      email: "intruder@example.com",
      exp: now + 3600
    });
    expect(
      (await callFetch("/api/emails", { headers: { "Cf-Access-Jwt-Assertion": otherUserJwt } }, undefined, accessEnv)).status
    ).toBe(403);

    // 8. Valid RS256 Access JWT passes cleanly and disables password setup/login endpoints
    const validJwt = await signTestJwt(validKey.privateKey, kid, {
      iss: teamDomain,
      aud: [policyAud],
      sub: "user-1",
      email: "owner@example.com",
      exp: now + 3600
    });
    const accessHeaders = { "Cf-Access-Jwt-Assertion": validJwt };

    const statusRes = await callFetch("/api/status", { headers: accessHeaders }, undefined, accessEnv);
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json<{
      authMode: string;
      installed: boolean;
      authenticated: boolean;
      accessUser: string;
    }>();
    expect(statusJson.authMode).toBe("access");
    expect(statusJson.installed).toBe(true);
    expect(statusJson.authenticated).toBe(true);
    expect(statusJson.accessUser).toBe("owner@example.com");

    // Password setup & login are disabled in pure access mode
    expect(
      (await callFetch("/api/setup", {
        method: "POST",
        headers: { ...accessHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "Password12345" })
      }, undefined, accessEnv)).status
    ).toBe(403);

    // Protected API works immediately with valid Access JWT
    const emailsRes = await callFetch("/api/emails?provider=gmail", { headers: accessHeaders }, undefined, accessEnv);
    expect(emailsRes.status).toBe(200);

    // Logout points to Cloudflare Access logout endpoint
    const logoutJson = await (
      await callFetch("/api/logout", { method: "POST", headers: accessHeaders }, undefined, accessEnv)
    ).json<{ ok: boolean; redirectUrl?: string }>();
    expect(logoutJson.redirectUrl).toBe("/cdn-cgi/access/logout");
  });

  it("supports access+password defense-in-depth mode", async () => {
    const teamDomain = "https://demo.cloudflareaccess.com";
    const policyAud = "hybrid-aud-tag";
    const kid = `key-${crypto.randomUUID()}`;
    const validKey = await createRsaTestKeyPair(kid);

    const hybridEnv = withEnvOverrides({
      MAIL_DOMAIN: "example.com",
      GMAIL_ALIAS_PREFIX: "gmail",
      AUTH_MODE: "access+password",
      ACCESS_TEAM_DOMAIN: teamDomain,
      ACCESS_POLICY_AUD: policyAud,
      ACCESS_ALLOWED_EMAILS: "owner@example.com"
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [validKey.publicJwk] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const validJwt = await signTestJwt(validKey.privateKey, kid, {
      iss: teamDomain,
      aud: [policyAud],
      sub: "user-1",
      email: "owner@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600
    });

    // Without Access JWT -> 403
    expect((await callFetch("/api/emails", {}, undefined, hybridEnv)).status).toBe(403);

    // With Access JWT but without app password session -> 401
    expect(
      (await callFetch("/api/emails", { headers: { "Cf-Access-Jwt-Assertion": validJwt } }, undefined, hybridEnv)).status
    ).toBe(401);

    // Setup password behind Access -> issues session cookie -> 200 on /api/emails
    const setupRes = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": validJwt, "Content-Type": "application/json" },
        body: JSON.stringify({ password: "HybridPassword123" })
      },
      undefined,
      hybridEnv
    );
    expect(setupRes.status).toBe(200);
    const cookie = extractCookie(setupRes);

    const okRes = await callFetch(
      "/api/emails",
      { headers: { "Cf-Access-Jwt-Assertion": validJwt } },
      cookie,
      hybridEnv
    );
    expect(okRes.status).toBe(200);
  });

  it("completes local password setup, locks repeat setup, verifies login & providers", async () => {
    const devEnv = localPasswordEnv();
    const s0 = await (await callFetch("/api/status", {}, undefined, devEnv)).json<{
      authMode: string;
      installed: boolean;
      authenticated: boolean;
      gmailForwardAddress?: string;
    }>();
    expect(s0.authMode).toBe("password");
    expect(s0.installed).toBe(false);
    expect(s0.authenticated).toBe(false);
    expect(s0.gmailForwardAddress).toBeUndefined();

    expect((await callFetch("/api/emails", {}, undefined, devEnv)).status).toBe(401);

    const setupRes = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "SuperStrongPassword123", gmailSourceEmail: "me@gmail.com" })
      },
      undefined,
      devEnv
    );
    expect(setupRes.status).toBe(200);
    const cookie = extractCookie(setupRes);
    expect(cookie).toContain("__Host-gmail_postman_session=");

    const s1 = await (await callFetch("/api/status", {}, cookie, devEnv)).json<{
      authenticated: boolean;
      gmailForwardAddress?: string;
    }>();
    expect(s1.authenticated).toBe(true);
    expect(s1.gmailForwardAddress).toBe("gmail@example.com");

    const repeat = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "AnotherPassword123" })
      },
      undefined,
      devEnv
    );
    expect(repeat.status).toBe(403);

    const provRes = await (await callFetch("/api/providers", {}, cookie, devEnv)).json<{
      providers: Array<{ id: string; enabled: boolean; reserved: boolean }>;
      gmailSourceEmail: string;
    }>();
    expect(provRes.gmailSourceEmail).toBe("me@gmail.com");
    expect(provRes.providers.find((p) => p.id === "gmail")?.enabled).toBe(true);
    expect(provRes.providers.find((p) => p.id === "qq")?.reserved).toBe(true);
    expect(provRes.providers.find((p) => p.id === "outlook")?.reserved).toBe(true);
    expect(provRes.providers.find((p) => p.id === "netease163")?.reserved).toBe(true);
  });

  it("ingests Gmail emails with D1 attachment, marks/searches/deletes via API", async () => {
    const devEnv = localPasswordEnv();
    const setupRes = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "SuperStrongPassword123" })
      },
      undefined,
      devEnv
    );
    const cookie = extractCookie(setupRes);

    const { msg, rejected } = makeEmailMessage({
      from: "Alice <alice@example.com>",
      to: "gmail+alerts@example.com",
      subject: "Monthly Invoice Ready",
      text: "Hello, your invoice is attached.",
      html: "<p>Hello, <b>your invoice</b> is attached.</p>",
      attachment: {
        filename: "invoice.txt",
        contentType: "text/plain",
        content: "INVOICE-2026-001"
      }
    });

    const ctx = createExecutionContext();
    await worker.email(msg, devEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(rejected).toHaveLength(0);

    const listData = await (await callFetch("/api/emails?provider=gmail", {}, cookie, devEnv)).json<{
      emails: Array<{ id: string; provider: string; account_alias: string }>;
      total: number;
      unreadCount: number;
    }>();
    expect(listData.total).toBe(1);
    expect(listData.unreadCount).toBe(1);
    expect(listData.emails[0].account_alias).toBe("gmail+alerts");

    const emailId = listData.emails[0].id;
    const detailData = await (await callFetch(`/api/emails/${emailId}`, {}, cookie, devEnv)).json<{
      email: { id: string; is_read: number };
      attachments: Array<{ id: string; filename: string; storage: string }>;
    }>();
    // Safe GET does not mutate is_read; explicit PATCH marks read
    expect(detailData.email.is_read).toBe(0);
    expect(detailData.attachments[0].storage).toBe("d1");

    expect(
      (
        await callFetch(
          `/api/emails/${emailId}/mark`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_read: 1 })
          },
          cookie,
          devEnv
        )
      ).status
    ).toBe(200);

    const attRes = await callFetch(`/api/attachments/${detailData.attachments[0].id}/download`, {}, cookie, devEnv);
    expect(attRes.status).toBe(200);
    expect(attRes.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(attRes.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await attRes.text()).toBe("INVOICE-2026-001");

    expect((await callFetch(`/api/emails/${emailId}`, { method: "DELETE" }, cookie, devEnv)).status).toBe(200);
  });

  it("rejects reserved providers (qq / outlook / 163) until explicitly enabled", async () => {
    const testEnv = withEnvOverrides({
      MAIL_DOMAIN: "example.com",
      GMAIL_ALIAS_PREFIX: "gmail"
    });
    for (const addr of ["qq@example.com", "outlook@example.com", "163@example.com"]) {
      const { msg, rejected } = makeEmailMessage({
        from: "someone@example.com",
        to: addr,
        subject: "Test Reserved",
        text: "Should be rejected"
      });
      const ctx = createExecutionContext();
      await worker.email(msg, testEnv, ctx);
      await waitOnExecutionContext(ctx);
      expect(rejected.length).toBe(1);
      expect(rejected[0]).toContain("reserved");
    }
  });

  it("enforces keyword block rules, exempts Gmail forwarding confirmation, and dispatches Webhook push", async () => {
    const devEnv = localPasswordEnv();
    const setupRes = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "SuperStrongPassword123" })
      },
      undefined,
      devEnv
    );
    const cookie = extractCookie(setupRes);

    await callFetch(
      "/api/rules/block",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: "unsubscribe", provider: "gmail" })
      },
      cookie,
      devEnv
    );

    await callFetch(
      "/api/rules/forward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Webhook",
          type: "webhook",
          provider: "gmail",
          config: { url: "https://hooks.example.org/gmail-postman", secret: "topsecret" }
        })
      },
      cookie,
      devEnv
    );

    const spam = makeEmailMessage({
      from: "promo@shop.com",
      to: "gmail@example.com",
      subject: "Big Sale",
      text: "Click here to unsubscribe from promotions."
    });
    const ctx1 = createExecutionContext();
    await worker.email(spam.msg, devEnv, ctx1);
    await waitOnExecutionContext(ctx1);

    let receivedWebhookBody = "";
    let receivedSecretHeader = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      receivedWebhookBody = String(init?.body || "");
      receivedSecretHeader = new Headers(init?.headers).get("X-Webhook-Secret") || "";
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const verifyMail = makeEmailMessage({
      from: "Gmail Team <forwarding-noreply@google.com>",
      to: "gmail@example.com",
      subject: "Gmail Forwarding Confirmation - Receive Mail from me@gmail.com",
      text: "Confirmation code: 482910374\nPlease click https://mail-settings.google.com/mail/vf-abc123 to confirm.\n(unsubscribe footer)",
      authenticationResults: "mx.cloudflare.net; dkim=pass header.d=google.com; dmarc=pass"
    });
    const ctx2 = createExecutionContext();
    await worker.email(verifyMail.msg, devEnv, ctx2);
    await waitOnExecutionContext(ctx2);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(receivedSecretHeader).toBe("topsecret");
    const parsedWebhook = JSON.parse(receivedWebhookBody) as {
      event: string;
      email: { verificationCode: string; verificationUrl: string };
    };
    expect(parsedWebhook.event).toBe("gmail_forwarding_verification");
    expect(parsedWebhook.email.verificationCode).toBe("482910374");
    expect(parsedWebhook.email.verificationUrl).toBe("https://mail-settings.google.com/mail/vf-abc123");
  });

  it("cleans up old non-starred emails via scheduled Cron while keeping starred emails", async () => {
    const devEnv = localPasswordEnv();
    const setupRes = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "SuperStrongPassword123" })
      },
      undefined,
      devEnv
    );
    const cookie = extractCookie(setupRes);

    await callFetch(
      "/api/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_delete_days: 7 })
      },
      cookie,
      devEnv
    );

    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO emails (id, provider, account_alias, from_address, to_address, subject, is_starred, received_at)
         VALUES ('old-normal', 'gmail', 'gmail', 'a@b.com', 'gmail@example.com', 'Old Normal', 0, ?)`
      ).bind(tenDaysAgo),
      env.DB.prepare(
        `INSERT INTO emails (id, provider, account_alias, from_address, to_address, subject, is_starred, received_at)
         VALUES ('old-starred', 'gmail', 'gmail', 'a@b.com', 'gmail@example.com', 'Old Starred', 1, ?)`
      ).bind(tenDaysAgo),
      env.DB.prepare(
        `INSERT INTO emails (id, provider, account_alias, from_address, to_address, subject, is_starred, received_at)
         VALUES ('recent-normal', 'gmail', 'gmail', 'a@b.com', 'gmail@example.com', 'Recent', 0, ?)`
      ).bind(now)
    ]);

    const controller = createScheduledController({ cron: "0 3 * * *" });
    const ctx = createExecutionContext();
    await worker.scheduled(controller, devEnv, ctx);
    await waitOnExecutionContext(ctx);

    const remaining = await env.DB.prepare("SELECT id FROM emails ORDER BY id").all<{ id: string }>();
    expect(remaining.results.map((r) => r.id)).toEqual(["old-starred", "recent-normal"]);
  });

  it("supports WeCom and ntfy push channels, checks WeCom errcode, and rejects removed telegram type", async () => {
    const devEnv = localPasswordEnv();
    const setupRes = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "SuperStrongPassword123" })
      },
      undefined,
      devEnv
    );
    const cookie = extractCookie(setupRes);

    // 1. Removed telegram type is rejected with 400
    const tgRes = await callFetch(
      "/api/rules/forward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Old TG",
          type: "telegram",
          config: { bot_token: "123:abc", chat_id: "999" }
        })
      },
      cookie,
      devEnv
    );
    expect(tgRes.status).toBe(400);

    // 2. Create WeCom rule (bare key auto-normalized) + ntfy rule (with Bearer token)
    const wecomCreate = await callFetch(
      "/api/rules/forward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "企业微信通知",
          type: "wecom",
          provider: "gmail",
          config: { webhook_url: "my-secret-wecom-key-123456" }
        })
      },
      cookie,
      devEnv
    );
    expect(wecomCreate.status).toBe(201);
    const wecomId = (await wecomCreate.json<{ id: string }>()).id;

    const ntfyCreate = await callFetch(
      "/api/rules/forward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "手机 ntfy",
          type: "ntfy",
          provider: "gmail",
          config: {
            server_url: "https://ntfy.sh",
            topic: "gmail-postman-private-topic-99",
            token: "tk_secret_token_abc",
            priority: "4"
          }
        })
      },
      cookie,
      devEnv
    );
    expect(ntfyCreate.status).toBe(201);

    // Verify secrets are masked in rule listing
    const listRules = await (await callFetch("/api/rules/forward", {}, cookie, devEnv)).json<{
      rules: Array<{ type: string; configSummary: string }>;
    }>();
    const wecomSummary = listRules.rules.find((r) => r.type === "wecom")?.configSummary || "";
    const ntfySummary = listRules.rules.find((r) => r.type === "ntfy")?.configSummary || "";
    expect(wecomSummary).not.toContain("my-secret-wecom-key-123456");
    expect(ntfySummary).toContain("https://ntfy.sh/");
    expect(ntfySummary).not.toContain("gmail-postman-private-topic-99");
    expect(ntfySummary).not.toContain("tk_secret_token_abc");

    // 3. Receive Gmail email and verify both WeCom and ntfy requests (validating real workerd RequestInit!)
    const captured: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const req = new Request(url, init);
      expect(req.redirect).toBe("manual");
      captured.push({
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body || "{}")) as Record<string, unknown>
      });
      if (url.includes("qyapi.weixin.qq.com")) {
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "ntfy-msg-1" }), { status: 200 });
    });

    const mail = makeEmailMessage({
      from: "GitHub <noreply@github.com>",
      to: "gmail@example.com",
      subject: "安全提醒：新设备登录",
      text: "检测到你的账号在新设备登录。"
    });
    const ctx = createExecutionContext();
    await worker.email(mail.msg, devEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(captured).toHaveLength(2);
    const wecomCall = captured.find((c) => c.url.includes("qyapi.weixin.qq.com"));
    const ntfyCall = captured.find((c) => c.url === "https://ntfy.sh/");
    expect(wecomCall?.url).toBe("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=my-secret-wecom-key-123456");
    expect(wecomCall?.body.msgtype).toBe("markdown");
    expect((wecomCall?.body.markdown as { content: string }).content).toContain("安全提醒：新设备登录");
    expect((wecomCall?.body.markdown as { content: string }).content).toContain("https://mail.example.com");

    expect(ntfyCall?.headers.get("Authorization")).toBe("Bearer tk_secret_token_abc");
    expect(ntfyCall?.body.topic).toBe("gmail-postman-private-topic-99");
    expect(ntfyCall?.body.title).toContain("安全提醒：新设备登录");
    expect(ntfyCall?.body.priority).toBe(4);
    expect(ntfyCall?.body.click).toBe("https://mail.example.com");

    // 4. Test WeCom business error detection (HTTP 200 but errcode != 0 -> returns 502 with error)
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ errcode: 93000, errmsg: "invalid webhook url" }), { status: 200 })
    );
    const testErr = await callFetch(`/api/rules/forward/${wecomId}/test`, { method: "POST" }, cookie, devEnv);
    expect(testErr.status).toBe(502);
    const testErrJson = await testErr.json<{ ok: boolean; error: string }>();
    expect(testErrJson.ok).toBe(false);
    expect(testErrJson.error).toContain("93000");
  });

  it("blocks CSRF, SSRF bypasses, spoofed Gmail verifications, malformed cookies, inline JS, and rotates sessions on password change", async () => {
    const devEnv = localPasswordEnv();

    // 1. CSRF: missing X-Requested-With or mismatched Origin is rejected with 403
    const noCsrf = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "SuperStrongPassword123" })
      },
      undefined,
      devEnv,
      { skipCsrfHeader: true }
    );
    expect(noCsrf.status).toBe(403);

    const badOrigin = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example"
        },
        body: JSON.stringify({ password: "SuperStrongPassword123" })
      },
      undefined,
      devEnv
    );
    expect(badOrigin.status).toBe(403);

    // Setup cleanly with valid headers
    const setupRes = await callFetch(
      "/api/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "SuperStrongPassword123" })
      },
      undefined,
      devEnv
    );
    expect(setupRes.status).toBe(200);
    const oldCookie = extractCookie(setupRes);

    // 2. Strict nonce CSP and zero inline onclick attributes in SPA HTML
    const htmlRes = await callFetch("/", {}, oldCookie, devEnv);
    expect(htmlRes.status).toBe(200);
    const csp = htmlRes.headers.get("Content-Security-Policy") || "";
    expect(csp).toMatch(/script-src 'nonce-[0-9a-f]{32}'/);
    expect(csp).toContain("frame-ancestors 'none'");
    const htmlBody = await htmlRes.text();
    expect(htmlBody).not.toMatch(/\sonclick=/i);
    expect(htmlBody).not.toMatch(/\sonchange=/i);
    expect(htmlBody).toContain("viewport-fit=cover");
    expect(htmlBody).toContain("mobile-bottom-nav");
    expect(htmlBody).toContain("mobile-back-bar");
    expect(htmlBody).toContain("mobile-filter-pills");

    // 3. SSRF filters reject IPv6 loopback, IPv4-mapped IPv6, metadata IP, plaintext HTTP, and arbitrary WeCom host
    const badConfigs = [
      { type: "webhook", config: { url: "https://[::1]/hook" } },
      { type: "webhook", config: { url: "https://[::ffff:127.0.0.1]/hook" } },
      { type: "webhook", config: { url: "https://169.254.169.254/latest/meta-data" } },
      { type: "webhook", config: { url: "http://hooks.example.org/plain" } },
      { type: "wecom", config: { webhook_url: "https://evil.example.org/cgi-bin/webhook/send?key=12345678" } }
    ];
    for (const item of badConfigs) {
      const r = await callFetch(
        "/api/rules/forward",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "bad", ...item })
        },
        oldCookie,
        devEnv
      );
      expect(r.status).toBe(400);
    }

    // 4. Spoofed Gmail verification email WITHOUT verified Google DKIM/DMARC is blocked by keyword rule
    await callFetch(
      "/api/rules/block",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: "phish-marker", provider: "gmail" })
      },
      oldCookie,
      devEnv
    );
    const spoofed = makeEmailMessage({
      from: "forwarding-noreply@google.com",
      to: "gmail@example.com",
      subject: "Gmail 转发确认",
      text: "Confirmation code: 999999999 phish-marker",
      authenticationResults: "mx.cloudflare.net; dkim=fail; dmarc=fail"
    });
    const ctx = createExecutionContext();
    await worker.email(spoofed.msg, devEnv, ctx);
    await waitOnExecutionContext(ctx);
    const emailsAfterSpoof = await (await callFetch("/api/emails?provider=gmail", {}, oldCookie, devEnv)).json<{ total: number }>();
    expect(emailsAfterSpoof.total).toBe(0);

    // 5. Malformed percent-encoded cookie does NOT crash with 500
    const badCookieRes = await callFetch(
      "/api/status",
      { headers: { Cookie: "CF_Authorization=%E0%A4%A" } },
      undefined,
      withEnvOverrides({ AUTH_MODE: "access", ACCESS_POLICY_AUD: "aud-123" })
    );
    expect(badCookieRes.status).toBe(403);

    // 6. Changing password rotates session epoch and immediately invalidates old cookie
    const pwChangeRes = await callFetch(
      "/api/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: "SuperStrongPassword123",
          new_password: "NewEvenStrongerPassword456"
        })
      },
      oldCookie,
      devEnv
    );
    expect(pwChangeRes.status).toBe(200);
    const newCookie = extractCookie(pwChangeRes);
    expect(newCookie).toContain("__Host-gmail_postman_session=");

    expect((await callFetch("/api/emails", {}, oldCookie, devEnv)).status).toBe(401);
    expect((await callFetch("/api/emails", {}, newCookie, devEnv)).status).toBe(200);
  });
});
