export type AuthMode = "access" | "access+password" | "password";

/**
 * Runtime environment combining Wrangler-generated `Env` with optional bindings/secrets
 * and runtime-overridable string vars (e.g. `.dev.vars` or test overrides).
 */
export type AppEnv = Omit<
  Env,
  "AUTH_MODE" | "ACCESS_TEAM_DOMAIN" | "ACCESS_POLICY_AUD" | "ACCESS_ALLOWED_EMAILS"
> & {
  AUTH_MODE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
  ACCESS_ALLOWED_EMAILS?: string;
  /** Optional R2 bucket when R2 is enabled on the Cloudflare account */
  ATTACHMENTS_BUCKET?: R2Bucket;
  /** Optional signing secret set via `wrangler secret put SESSION_SECRET` */
  SESSION_SECRET?: string;
};

export function resolveAuthMode(env: AppEnv): AuthMode {
  const raw = (env.AUTH_MODE || "access").trim().toLowerCase();
  if (raw === "password") return "password";
  if (raw === "access+password") return "access+password";
  // Fail closed: default to Cloudflare Access enforcement
  return "access";
}

export type ProviderId = "gmail" | "qq" | "outlook" | "netease163" | "custom";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  /** Whether this provider is active now. Non-Gmail providers are reserved (false). */
  enabled: boolean;
  /** True for future-reserved providers not yet enabled */
  reserved: boolean;
  /** Default email local-part prefix, e.g. "gmail" -> gmail@<MAIL_DOMAIN> */
  defaultPrefix: string;
  /** Badge accent color in UI */
  color: string;
  /** Short description shown in UI */
  description: string;
  /** Optional setup hints */
  setupSteps: string[];
}

export interface EmailRow {
  id: string;
  provider: string;
  account_alias: string;
  message_id: string;
  in_reply_to: string;
  from_address: string;
  from_name: string;
  to_address: string;
  subject: string;
  snippet: string;
  text_body: string;
  html_body: string;
  is_read: number;
  is_starred: number;
  is_important: number;
  is_verification: number;
  verification_code: string;
  verification_url: string;
  raw_size: number;
  received_at: number;
}

export interface AttachmentRow {
  id: string;
  email_id: string;
  filename: string;
  content_type: string;
  size: number;
  storage: "d1" | "r2" | "skipped_too_large";
  r2_key: string;
  data_base64?: string;
  created_at: number;
}

export interface BlockRuleRow {
  id: string;
  keyword: string;
  provider: string;
  enabled: number;
  created_at: number;
}

export type ForwardRuleType = "wecom" | "ntfy" | "serverchan" | "webhook";

export interface ForwardRuleRow {
  id: string;
  name: string;
  type: ForwardRuleType;
  provider: string;
  config_json: string;
  keyword_filter: string;
  enabled: number;
  created_at: number;
}

export interface GmailAliasRow {
  id: string;
  prefix: string;
  label: string;
  source_email: string;
  enabled: number;
  created_at: number;
}
