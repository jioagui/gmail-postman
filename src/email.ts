import PostalMime from "postal-mime";
import { listActiveBlockRules, listActiveForwardRules } from "./db";
import { dispatchForwardRules } from "./forwarder";
import {
  detectGmailForwardingVerification,
  resolveInboundProvider
} from "./providers";
import { sanitizeFilename } from "./security";
import type { AppEnv } from "./types";

const MAX_RAW_EMAIL_BYTES_D1 = 5 * 1024 * 1024; // 5 MB raw MIME cap in pure-D1 mode
const MAX_RAW_EMAIL_BYTES_R2 = 15 * 1024 * 1024; // 15 MB raw MIME cap when R2 is bound
const MAX_BODY_UTF8_BYTES = 180 * 1024; // 180 KB UTF-8 per body field (safe under D1 2 MB row cap)
const MAX_SNIPPET_CHARS = 220;
const MAX_HTML_SNIPPET_SCAN_CHARS = 16_000;
const MAX_D1_ATTACH_BYTES = 1 * 1024 * 1024; // 1 MB per attachment in pure-D1 mode
const MAX_D1_TOTAL_ATTACH_BYTES = 2 * 1024 * 1024; // 2 MB total D1 attachment budget per email
const MAX_R2_ATTACH_BYTES = 10 * 1024 * 1024; // 10 MB per attachment when R2 is bound
const MAX_ATTACHMENTS_PER_EMAIL = 10;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8");

/**
 * Truncates a string to at most `maxBytes` UTF-8 bytes without splitting surrogate pairs.
 */
function truncateUtf8(str: string, maxBytes: number): string {
  if (!str) return "";
  const encoded = textEncoder.encode(str);
  if (encoded.byteLength <= maxBytes) return str;
  return textDecoder.decode(encoded.subarray(0, maxBytes)).replace(/\uFFFD$/, "");
}

/**
 * Linear-time HTML tag stripper capped to MAX_HTML_SNIPPET_SCAN_CHARS (immune to quadratic ReDoS).
 */
function stripHtmlToText(html: string): string {
  const sample = html.slice(0, MAX_HTML_SNIPPET_SCAN_CHARS);
  let out = "";
  let inTag = false;
  let skipBlockTag = "";
  const lower = sample.toLowerCase();

  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (skipBlockTag) {
      const closeSeq = `</${skipBlockTag}`;
      if (ch === "<" && lower.startsWith(closeSeq, i)) {
        const endGt = sample.indexOf(">", i + closeSeq.length);
        i = endGt >= 0 ? endGt : sample.length;
        skipBlockTag = "";
      }
      continue;
    }
    if (ch === "<") {
      if (lower.startsWith("<style", i)) {
        const endGt = sample.indexOf(">", i + 6);
        i = endGt >= 0 ? endGt : sample.length;
        skipBlockTag = "style";
        continue;
      }
      if (lower.startsWith("<script", i)) {
        const endGt = sample.indexOf(">", i + 7);
        i = endGt >= 0 ? endGt : sample.length;
        skipBlockTag = "script";
        continue;
      }
      inTag = true;
      out += " ";
      continue;
    }
    if (inTag) {
      if (ch === ">") inTag = false;
      continue;
    }
    out += ch;
  }

  return out
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSnippet(text: string, html: string): string {
  const base = text.trim() || stripHtmlToText(html);
  return base.replace(/\s+/g, " ").trim().slice(0, MAX_SNIPPET_CHARS);
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...slice));
  }
  return btoa(parts.join(""));
}

function toUint8Array(content: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return textEncoder.encode(content);
}

async function readStreamBounded(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<{ exceeded: boolean; buffer: Uint8Array; totalBytes: number }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("Email exceeded maximum size limit");
        return { exceeded: true, buffer: new Uint8Array(0), totalBytes };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { exceeded: false, buffer: combined, totalBytes };
}

/**
 * Cloudflare Email Routing `email()` handler.
 *
 * - Only enabled providers (currently Gmail) are accepted; reserved providers (QQ/Outlook/163/Custom)
 *   are rejected cleanly until enabled in `src/providers.ts`.
 * - Enforces raw stream byte limits before MIME parsing to prevent Worker isolate OOM.
 * - Verifies Google Authentication-Results before exempting Gmail forwarding confirmations.
 * - Attachments are stored in R2 when `ATTACHMENTS_BUCKET` is bound, or in D1 (<= 1 MB each, <= 2 MB total/email).
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: AppEnv,
  ctx: ExecutionContext
): Promise<void> {
  const match = resolveInboundProvider(message.to, env);

  if (match.status === "reserved" && match.provider) {
    console.log(
      JSON.stringify({
        message: "email_rejected_reserved_provider",
        provider: match.provider.id
      })
    );
    message.setReject(`Provider "${match.provider.id}" is reserved and currently disabled.`);
    return;
  }

  if (match.status !== "matched" || !match.provider) {
    console.log(JSON.stringify({ message: "email_rejected_unknown_recipient" }));
    message.setReject("Recipient prefix is not configured. Only Gmail forwarding is enabled.");
    return;
  }

  const maxRawBytes = env.ATTACHMENTS_BUCKET ? MAX_RAW_EMAIL_BYTES_R2 : MAX_RAW_EMAIL_BYTES_D1;
  if (message.rawSize > maxRawBytes) {
    console.log(
      JSON.stringify({
        message: "email_rejected_too_large",
        rawSize: message.rawSize,
        maxRawBytes
      })
    );
    message.setReject("Message size exceeds configured limit.");
    return;
  }

  // Buffer raw MIME stream once with strict byte cap (prevents Worker OOM)
  const readResult = await readStreamBounded(message.raw, maxRawBytes);
  if (readResult.exceeded) {
    console.log(
      JSON.stringify({
        message: "email_rejected_stream_too_large",
        maxRawBytes
      })
    );
    message.setReject("Message stream exceeds configured size limit.");
    return;
  }

  const parsed = await PostalMime.parse(readResult.buffer, {
    maxNestingDepth: 10,
    maxHeadersSize: 65_536
  });

  const fromAddress = (parsed.from?.address || message.from || "").slice(0, 320);
  const fromName = (parsed.from?.name || "").slice(0, 200);
  const subject = (parsed.subject || "(无主题)").trim().slice(0, 500);
  const textBody = truncateUtf8(parsed.text || "", MAX_BODY_UTF8_BYTES);
  const htmlBody = truncateUtf8(parsed.html || "", MAX_BODY_UTF8_BYTES);
  const snippet = makeSnippet(textBody, htmlBody);
  const messageId = (parsed.messageId || message.headers.get("message-id") || "").slice(0, 320);
  const inReplyTo = (parsed.inReplyTo || message.headers.get("in-reply-to") || "").slice(0, 320);
  const authResults = message.headers.get("authentication-results") || "";

  const verification =
    match.provider.id === "gmail"
      ? detectGmailForwardingVerification({
          fromAddress,
          subject,
          textBody,
          htmlBody,
          authenticationResults: authResults
        })
      : { isVerification: false, code: "", url: "" };

  // Evaluate local keyword block rules (verified Gmail forwarding confirmations bypass blocking)
  if (!verification.isVerification) {
    const blockRules = await listActiveBlockRules(env, match.provider.id);
    const haystack = `${subject}\n${fromAddress}\n${fromName}\n${textBody}\n${snippet}`.toLowerCase();
    const matchedRule = blockRules.find(
      (r) => r.keyword.trim() !== "" && haystack.includes(r.keyword.trim().toLowerCase())
    );
    if (matchedRule) {
      console.log(
        JSON.stringify({
          message: "email_blocked_by_keyword",
          provider: match.provider.id,
          ruleId: matchedRule.id
        })
      );
      return;
    }
  }

  const emailId = crypto.randomUUID();
  const receivedAt = Date.now();

  await env.DB.prepare(
    `INSERT INTO emails (
      id, provider, account_alias, message_id, in_reply_to,
      from_address, from_name, to_address, subject, snippet,
      text_body, html_body, is_read, is_starred, is_important,
      is_verification, verification_code, verification_url, raw_size, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      emailId,
      match.provider.id,
      match.alias.slice(0, 100),
      messageId,
      inReplyTo,
      fromAddress,
      fromName,
      message.to.slice(0, 320),
      subject,
      snippet,
      textBody,
      htmlBody,
      verification.isVerification ? 1 : 0, // important badge, NOT permanently starred against cleanup
      verification.isVerification ? 1 : 0,
      verification.code,
      verification.url,
      message.rawSize || readResult.totalBytes,
      receivedAt
    )
    .run();

  // Persist attachments (R2 if bound, otherwise D1 up to 1 MB each / 2 MB total per email)
  const parsedAttachments = (parsed.attachments || []).slice(0, MAX_ATTACHMENTS_PER_EMAIL);
  let d1AttachBudgetUsed = 0;

  for (const att of parsedAttachments) {
    const attId = crypto.randomUUID();
    const filename = sanitizeFilename(att.filename || `attachment-${attId.slice(0, 8)}`);
    const contentType = (att.mimeType || "application/octet-stream").slice(0, 128);
    const bytes = toUint8Array(att.content);
    const size = bytes.byteLength;

    if (env.ATTACHMENTS_BUCKET && size <= MAX_R2_ATTACH_BYTES) {
      const r2Key = `att/${emailId}/${attId}/${filename}`;
      await env.ATTACHMENTS_BUCKET.put(r2Key, bytes, {
        httpMetadata: { contentType: "application/octet-stream" }
      });
      await env.DB.prepare(
        `INSERT INTO attachments (id, email_id, filename, content_type, size, storage, r2_key, data_base64, created_at)
         VALUES (?, ?, ?, ?, ?, 'r2', ?, '', ?)`
      )
        .bind(attId, emailId, filename, contentType, size, r2Key, receivedAt)
        .run();
    } else if (
      size <= MAX_D1_ATTACH_BYTES &&
      d1AttachBudgetUsed + size <= MAX_D1_TOTAL_ATTACH_BYTES
    ) {
      d1AttachBudgetUsed += size;
      const b64 = uint8ToBase64(bytes);
      await env.DB.prepare(
        `INSERT INTO attachments (id, email_id, filename, content_type, size, storage, r2_key, data_base64, created_at)
         VALUES (?, ?, ?, ?, ?, 'd1', '', ?, ?)`
      )
        .bind(attId, emailId, filename, contentType, size, b64, receivedAt)
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO attachments (id, email_id, filename, content_type, size, storage, r2_key, data_base64, created_at)
         VALUES (?, ?, ?, ?, ?, 'skipped_too_large', '', '', ?)`
      )
        .bind(attId, emailId, filename, contentType, size, receivedAt)
        .run();
    }
  }

  console.log(
    JSON.stringify({
      message: "email_stored",
      emailId,
      provider: match.provider.id,
      attachments: parsedAttachments.length,
      isVerification: verification.isVerification
    })
  );

  // Dispatch WeCom / ntfy / Server酱 / Webhook notifications asynchronously via waitUntil
  const forwardRules = await listActiveForwardRules(env, match.provider.id);
  if (forwardRules.length > 0) {
    const inboxUrl = env.MAIL_DOMAIN ? `https://mail.${env.MAIL_DOMAIN.trim()}` : undefined;
    ctx.waitUntil(
      dispatchForwardRules(env, forwardRules, {
        emailId,
        provider: match.provider.id,
        providerName: match.provider.name,
        accountAlias: match.alias,
        fromAddress,
        fromName,
        toAddress: message.to,
        subject,
        snippet,
        receivedAt,
        attachmentCount: parsedAttachments.length,
        isVerification: verification.isVerification,
        verificationCode: verification.code,
        verificationUrl: verification.url,
        inboxUrl
      })
    );
  }
}
