-- Custom Gmail forwarding prefixes (e.g., work@example.com, main@example.com, bank@example.com)
-- Keeps default 'gmail' prefix enabled for seamless backward compatibility.

CREATE TABLE IF NOT EXISTS gmail_aliases (
  id TEXT PRIMARY KEY,
  prefix TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  source_email TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gmail_aliases_prefix ON gmail_aliases(prefix, enabled);

INSERT OR IGNORE INTO gmail_aliases (id, prefix, label, source_email, enabled, created_at)
VALUES ('default-gmail', 'gmail', '默认 Gmail', '', 1, 0);
