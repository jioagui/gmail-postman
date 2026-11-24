import { generateRandomHex } from "./security";
import type { AppEnv, BlockRuleRow, ForwardRuleRow, GmailAliasRow } from "./types";

export async function getSetting(env: AppEnv, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(key)
    .first<{ value: string }>();
  return row ? row.value : null;
}

export async function setSetting(env: AppEnv, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(key, value, Date.now())
    .run();
}

export async function isInstalled(env: AppEnv): Promise<boolean> {
  const hash = await getSetting(env, "admin_password_hash");
  return Boolean(hash && hash.length > 0);
}

/**
 * Returns the HMAC session secret: prefers Wrangler secret `SESSION_SECRET`,
 * otherwise auto-generates and persists a random 32-byte hex secret in D1.
 */
export async function getSessionSecret(env: AppEnv): Promise<string> {
  if (env.SESSION_SECRET && env.SESSION_SECRET.trim().length >= 16) {
    return env.SESSION_SECRET.trim();
  }
  const existing = await getSetting(env, "session_secret");
  if (existing && existing.length >= 32) {
    return existing;
  }
  const created = generateRandomHex(32);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('session_secret', ?, ?)`
  )
    .bind(created, Date.now())
    .run();
  return (await getSetting(env, "session_secret")) || created;
}

export async function getSessionEpoch(env: AppEnv): Promise<string> {
  return (await getSetting(env, "session_epoch")) || "1";
}

export async function rotateSessionEpoch(env: AppEnv): Promise<string> {
  const next = generateRandomHex(8);
  await setSetting(env, "session_epoch", next);
  return next;
}

export async function listActiveBlockRules(env: AppEnv, provider: string): Promise<BlockRuleRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM block_rules WHERE enabled = 1 AND (provider = 'all' OR provider = ?) ORDER BY created_at DESC`
  )
    .bind(provider)
    .all<BlockRuleRow>();
  return res.results;
}

export async function listActiveForwardRules(env: AppEnv, provider: string): Promise<ForwardRuleRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM forward_rules WHERE enabled = 1 AND (provider = 'all' OR provider = ?) ORDER BY created_at DESC`
  )
    .bind(provider)
    .all<ForwardRuleRow>();
  return res.results;
}

export async function listGmailAliases(env: AppEnv): Promise<GmailAliasRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM gmail_aliases ORDER BY CASE WHEN id = 'default-gmail' THEN 0 ELSE 1 END, created_at ASC`
  ).all<GmailAliasRow>();
  return res.results;
}

export async function findGmailAliasByPrefix(
  env: AppEnv,
  prefix: string
): Promise<GmailAliasRow | null> {
  const row = await env.DB.prepare("SELECT * FROM gmail_aliases WHERE prefix = ?")
    .bind(prefix.toLowerCase())
    .first<GmailAliasRow>();
  return row ?? null;
}
