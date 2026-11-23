import { getSetting } from "./db";
import type { AppEnv } from "./types";

export interface CleanupSummary {
  autoDeleteDays: number;
  deletedEmails: number;
  deletedR2Objects: number;
}

/**
 * Deletes stale login_attempts (always) and emails older than `auto_delete_days` (when > 0),
 * keeping user-starred emails safe, and cleans up any associated R2 attachment objects.
 */
export async function runAutoCleanup(
  env: AppEnv,
  overrideDays?: number
): Promise<CleanupSummary> {
  // Always clean stale login attempts older than 1 day, even when email auto-delete is disabled
  await env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at < ?")
    .bind(Date.now() - 24 * 60 * 60 * 1000)
    .run();

  const configuredDays =
    typeof overrideDays === "number"
      ? overrideDays
      : Number.parseInt((await getSetting(env, "auto_delete_days")) || "0", 10);

  if (!Number.isFinite(configuredDays) || configuredDays <= 0) {
    return { autoDeleteDays: 0, deletedEmails: 0, deletedR2Objects: 0 };
  }

  const cutoff = Date.now() - configuredDays * 24 * 60 * 60 * 1000;

  // Find R2 keys belonging to expired, non-starred emails before deleting
  const expiredAttachments = await env.DB.prepare(
    `SELECT a.r2_key FROM attachments a
     INNER JOIN emails e ON e.id = a.email_id
     WHERE e.received_at < ? AND e.is_starred = 0 AND a.storage = 'r2' AND a.r2_key != ''`
  )
    .bind(cutoff)
    .all<{ r2_key: string }>();

  let deletedR2Objects = 0;
  if (env.ATTACHMENTS_BUCKET && expiredAttachments.results.length > 0) {
    const keys = expiredAttachments.results.map((r) => r.r2_key);
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100);
      await env.ATTACHMENTS_BUCKET.delete(batch);
      deletedR2Objects += batch.length;
    }
  }

  await env.DB.prepare(
    `DELETE FROM attachments WHERE email_id IN (SELECT id FROM emails WHERE received_at < ? AND is_starred = 0)`
  )
    .bind(cutoff)
    .run();

  const deleteRes = await env.DB.prepare(
    `DELETE FROM emails WHERE received_at < ? AND is_starred = 0`
  )
    .bind(cutoff)
    .run();

  const deletedEmails = deleteRes.meta?.changes ?? 0;

  console.log(
    JSON.stringify({
      message: "auto_cleanup_completed",
      autoDeleteDays: configuredDays,
      deletedEmails,
      deletedR2Objects
    })
  );

  return {
    autoDeleteDays: configuredDays,
    deletedEmails,
    deletedR2Objects
  };
}
