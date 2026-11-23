-- Zmail CF initial schema (D1 / SQLite)
-- Designed for Gmail-first forwarding with extensible provider columns for QQ / Outlook / 163 / Custom.

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'gmail',
  account_alias TEXT NOT NULL DEFAULT 'gmail',
  message_id TEXT NOT NULL DEFAULT '',
  in_reply_to TEXT NOT NULL DEFAULT '',
  from_address TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '(无主题)',
  snippet TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  is_starred INTEGER NOT NULL DEFAULT 0,
  is_important INTEGER NOT NULL DEFAULT 0,
  is_verification INTEGER NOT NULL DEFAULT 0,
  verification_code TEXT NOT NULL DEFAULT '',
  verification_url TEXT NOT NULL DEFAULT '',
  raw_size INTEGER NOT NULL DEFAULT 0,
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_provider_received ON emails(provider, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_starred ON emails(is_starred, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_unread ON emails(is_read, received_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  storage TEXT NOT NULL DEFAULT 'd1', -- 'd1' | 'r2' | 'skipped_too_large'
  r2_key TEXT NOT NULL DEFAULT '',
  data_base64 TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id);

CREATE TABLE IF NOT EXISTS block_rules (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'all', -- 'all' | 'gmail' | reserved providers
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS forward_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'telegram' | 'serverchan' | 'webhook'
  provider TEXT NOT NULL DEFAULT 'gmail', -- 'all' | 'gmail' | reserved providers
  config_json TEXT NOT NULL,
  keyword_filter TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, attempted_at);

-- Default settings (auto-delete disabled = 0 days by default)
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('auto_delete_days', '0', 0);
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('gmail_source_email', '', 0);
