# Cloudflare API Runbook for `gmail-postman`

Exact Cloudflare REST API v4 (`https://api.cloudflare.com/client/v4`) and GraphQL Analytics payloads for executing **Path A** in [SKILL.md](../SKILL.md) via Cloudflare MCP or HTTP requests.

## Placeholders Reference

Replace every placeholder before calling any endpoint:

| Placeholder | Example / Default |
| --- | --- |
| `<ACCOUNT_ID>` | Cloudflare account identifier |
| `<ZONE_ID>` | Cloudflare zone identifier for `<DOMAIN>` |
| `<DOMAIN>` | `example.com` |
| `<WEB_SUBDOMAIN>` | `mail.example.com` (default `mail.<DOMAIN>`) |
| `<WORKER_NAME>` | `gmail-postman` |
| `<DB_NAME>` | `gmail-postman-db` (default `<WORKER_NAME>-db`) |
| `<DATABASE_ID>` | D1 database UUID returned on creation |
| `<TEAM_DOMAIN>` | Team slug from `auth_domain` (`https://<TEAM_DOMAIN>.cloudflareaccess.com`) |
| `<OWNER_EMAIL>` | External login email, e.g. `owner@example.org` (never `<prefix>@<DOMAIN>`) |
| `<POLICY_ID>` | Reusable Access policy UUID returned on creation |
| `<ACCESS_APP_ID>` | Self-hosted Access application UUID |
| `<ACCESS_POLICY_AUD>` | Access application `aud` tag returned on creation |
| `<R2_BUCKET_NAME>` | `gmail-postman-attachments` (only if R2 is enabled) |

---

## 1. Pre-Flight Inspection

Run these read-only calls first to discover IDs and detect conflicts before mutating anything:

| Check | Method & Path | What to Verify |
| --- | --- | --- |
| List accounts | `GET /accounts` | Capture `<ACCOUNT_ID>` |
| Lookup zone | `GET /zones?name=<DOMAIN>` | Capture `<ZONE_ID>`; confirm `status: "active"` |
| Check DNS conflicts | `GET /zones/<ZONE_ID>/dns_records` | No conflicting third-party `MX` on `<DOMAIN>`; no conflicting `A`/`AAAA`/`CNAME` on `<WEB_SUBDOMAIN>` |
| Check D1 databases | `GET /accounts/<ACCOUNT_ID>/d1/database` | Check if `<DB_NAME>` already exists |
| Check R2 availability | `GET /accounts/<ACCOUNT_ID>/r2/buckets` | `200` = R2 enabled; `403` / code `10042` = R2 not enabled (use pure-D1 mode) |
| Check `workers.dev` subdomain | `GET /accounts/<ACCOUNT_ID>/workers/subdomain` | If missing (`404`), fresh account will hit error `10063` until claimed in Dashboard -> Workers & Pages |
| Check Zero Trust org | `GET /accounts/<ACCOUNT_ID>/access/organizations` | Capture `result.auth_domain` (strip `.cloudflareaccess.com` for `<TEAM_DOMAIN>`) |
| Check Access IdPs | `GET /accounts/<ACCOUNT_ID>/access/identity_providers` | Confirm `onetimepin` (One-Time PIN) or preferred IdP is configured |

---

## 2. D1 Provisioning & Schema Migration

### 2.1 Create D1 Database

```http
POST /accounts/<ACCOUNT_ID>/d1/database
Content-Type: application/json

{
  "name": "<DB_NAME>"
}
```

Capture `result.uuid` as `<DATABASE_ID>`.

### 2.2 Apply `migrations/0001_init.sql` & `d1_migrations` Tracking Table

Execute the full SQL statements from `migrations/0001_init.sql` against:

```http
POST /accounts/<ACCOUNT_ID>/d1/database/<DATABASE_ID>/query
Content-Type: application/json

{
  "sql": "<SQL_FROM_migrations/0001_init.sql>"
}
```

Then create and seed Wrangler's migration tracking table so future `wrangler d1 migrations apply <DB_NAME> --remote` commands do not attempt to re-apply `0001_init.sql`:

```http
POST /accounts/<ACCOUNT_ID>/d1/database/<DATABASE_ID>/query
Content-Type: application/json

{
  "sql": "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL); INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_init.sql');"
}
```

### 2.3 Verify D1 Tables

```http
POST /accounts/<ACCOUNT_ID>/d1/database/<DATABASE_ID>/query
Content-Type: application/json

{
  "sql": "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;"
}
```

Expected tables: `attachments`, `block_rules`, `d1_migrations`, `emails`, `forward_rules`, `login_attempts`, `settings`.

---

## 3. Cloudflare Access (Reusable Policy + Self-Hosted App)

> **Guardrail:** Always create an account-level **reusable** policy under `/access/policies` and reference it by `id` + `precedence`. Do NOT send inline policy rules inside `POST /access/apps` (that creates deprecated legacy `reusable: false` app-scoped policies).

### 3.1 Create Reusable Allow Policy

```http
POST /accounts/<ACCOUNT_ID>/access/policies
Content-Type: application/json

{
  "name": "<WORKER_NAME>-owner-allow",
  "decision": "allow",
  "include": [
    {
      "email": {
        "email": "<OWNER_EMAIL>"
      }
    }
  ],
  "exclude": [],
  "require": []
}
```

For multiple allowed emails, add one `{ "email": { "email": "<EXTRA_EMAIL>" } }` object per address inside `include`. Capture `result.id` as `<POLICY_ID>`.

*(If an existing deployment has a legacy `reusable: false` app-scoped policy, migrate it with `POST /accounts/<ACCOUNT_ID>/access/apps/<ACCESS_APP_ID>/policies/<LEGACY_POLICY_ID>/make_reusable` instead of creating another inline policy.)*

### 3.2 Create Self-Hosted Access Application

```http
POST /accounts/<ACCOUNT_ID>/access/apps
Content-Type: application/json

{
  "name": "Gmail Postman",
  "domain": "<WEB_SUBDOMAIN>",
  "type": "self_hosted",
  "session_duration": "24h",
  "auto_redirect_to_identity": false,
  "app_launcher_visible": true,
  "http_only_cookie_attribute": true,
  "same_site_cookie_attribute": "lax",
  "policies": [
    {
      "id": "<POLICY_ID>",
      "precedence": 1
    }
  ]
}
```

Capture:
- `result.id` -> `<ACCESS_APP_ID>`
- `result.aud` -> `<ACCESS_POLICY_AUD>`

Verify via `GET /accounts/<ACCOUNT_ID>/access/apps/<ACCESS_APP_ID>` that the attached policy reports `"reusable": true`.

---

## 4. Optional R2 Bucket (Only If R2 Enabled)

```http
POST /accounts/<ACCOUNT_ID>/r2/buckets
Content-Type: application/json

{
  "name": "<R2_BUCKET_NAME>"
}
```

---

## 5. Local `wrangler.jsonc` Template & Post-Deploy Checks

Generate local gitignored `wrangler.jsonc` from `wrangler.example.jsonc` using placeholders filled with provisioned values:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "<WORKER_NAME>",
  "main": "src/index.ts",
  "workers_dev": false,
  "compatibility_date": "2026-11-22",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true,
    "logs": { "enabled": true, "head_sampling_rate": 1 },
    "traces": { "enabled": true, "head_sampling_rate": 0.01 }
  },
  "vars": {
    "MAIL_DOMAIN": "<DOMAIN>",
    "GMAIL_ALIAS_PREFIX": "gmail",
    "APP_TITLE": "Gmail 助手",
    "AUTH_MODE": "access",
    "ACCESS_TEAM_DOMAIN": "https://<TEAM_DOMAIN>.cloudflareaccess.com",
    "ACCESS_POLICY_AUD": "<ACCESS_POLICY_AUD>",
    "ACCESS_ALLOWED_EMAILS": "<OWNER_EMAIL>"
  },
  "routes": [
    {
      "pattern": "<WEB_SUBDOMAIN>",
      "custom_domain": true
    }
  ],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "<DB_NAME>",
      "database_id": "<DATABASE_ID>",
      "migrations_dir": "migrations"
    }
  ],
  // Uncomment only when R2 is enabled on the Cloudflare account:
  // "r2_buckets": [
  //   { "binding": "ATTACHMENTS_BUCKET", "bucket_name": "<R2_BUCKET_NAME>" }
  // ],
  "triggers": {
    "crons": ["0 3 * * *"]
  }
}
```

After running `wrangler deploy`, verify Cron registration:

```http
GET /accounts/<ACCOUNT_ID>/workers/scripts/<WORKER_NAME>/schedules
```

Confirm `result.schedules` contains `{ "cron": "0 3 * * *" }`.

---

## 6. Email Routing Enablement & Catch-All -> Worker

### 6.1 Enable Email Routing & Provision MX / SPF / DKIM DNS

```http
POST /zones/<ZONE_ID>/email/routing/dns
Content-Type: application/json

{
  "name": "<DOMAIN>"
}
```

### 6.2 Configure Catch-All Rule -> Worker

Catch-all is recommended over a single literal address rule because `gmail-postman` supports subaddressing (e.g., `gmail+work@<DOMAIN>`) and rejects unconfigured prefixes cleanly inside `src/email.ts`.

```http
PUT /zones/<ZONE_ID>/email/routing/rules/catch_all
Content-Type: application/json

{
  "enabled": true,
  "name": "Route inbound mail to <WORKER_NAME>",
  "matchers": [
    {
      "type": "all"
    }
  ],
  "actions": [
    {
      "type": "worker",
      "value": ["<WORKER_NAME>"]
    }
  ]
}
```

### 6.3 Verify Email Routing Status & DNS Records

```http
GET /zones/<ZONE_ID>/email/routing
GET /zones/<ZONE_ID>/email/routing/dns
GET /zones/<ZONE_ID>/email/routing/rules/catch_all
```

Confirm:
- `GET /zones/<ZONE_ID>/email/routing` -> `result.enabled === true` and `result.status === "ready"`
- `GET /zones/<ZONE_ID>/email/routing/dns` -> required Cloudflare MX and TXT (SPF/DKIM) records are present without conflict
- `GET /zones/<ZONE_ID>/email/routing/rules/catch_all` -> `result.enabled === true` and `actions[0].value` is `["<WORKER_NAME>"]`

---

## 7. GraphQL Email Routing Troubleshooting (`emailRoutingAdaptive`)

When an expected email does not appear in D1, query Cloudflare's Email Routing activity dataset via GraphQL:

```http
POST https://api.cloudflare.com/client/v4/graphql
Content-Type: application/json

{
  "query": "query EmailRoutingActivity($zoneTag: String!, $filter: EmailRoutingAdaptiveFilter_InputObject!) { viewer { zones(filter: { zoneTag: $zoneTag }) { emailRoutingAdaptive(filter: $filter, limit: 20, orderBy: [datetime_DESC]) { datetime sessionId messageId from to subject status action spf dkim dmarc arc errorDetail isNDR isSpam spamScore spamThreshold } } } }",
  "variables": {
    "zoneTag": "<ZONE_ID>",
    "filter": {
      "datetime_geq": "<ISO8601_START_UTC>",
      "datetime_leq": "<ISO8601_END_UTC>"
    }
  }
}
```

### Interpreting Common Results

| Observation | Likely Cause & Fix |
| --- | --- |
| No event at all for Gmail test | User tested from the same Gmail account (self-send loop suppressed) or forgot **"Save Changes"** at the bottom of Gmail Forwarding settings. Test from an external non-Gmail mailbox. |
| `status: "Rejected"`, `errorDetail` mentions reserved/unknown prefix | `to` prefix does not match `GMAIL_ALIAS_PREFIX` (default `gmail`) or hits a disabled provider in `src/providers.ts`. |
| `status: "Dropped"` or `isSpam: true` | Message failed SPF/DKIM/DMARC or tripped spam filter before reaching the Worker. |
| `action: "worker"` with `status: "Error"` | Worker threw an uncaught exception (e.g., missing D1 tables or binding mismatch). Check Workers Observability logs or run `npx wrangler tail`. |
| `action` points to old worker name | Catch-all rule still targets `<OLD_WORKER>`; re-run Step 6.2. |

---

## 8. Clean Rename / Migration Checklist (Zero-Downtime Cutover)

Use this sequence when renaming a live deployment (`<OLD_WORKER>` / `<OLD_DB>` -> `<NEW_WORKER>` / `<NEW_DB>`) without losing emails or breaking `<WEB_SUBDOMAIN>`:

1. **Provision target D1 database**:
   - Create `<NEW_DB>` (`POST /accounts/<ACCOUNT_ID>/d1/database`), capture `<NEW_DATABASE_ID>`.
   - Apply `migrations/0001_init.sql` + `d1_migrations` tracking SQL (Section 2).
2. **Copy existing D1 rows (foreign-key order)**:
   - Preferred CLI method (handles binary/base64 attachments safely):
     ```bash
     npx wrangler d1 export <OLD_DB> --remote --no-schema --output=backup-data.sql
     npx wrangler d1 execute <NEW_DB> --remote --file=backup-data.sql
     ```
     *(Delete local `backup-data.sql` after verification; never commit it.)*
   - If migrating via D1 REST query API, copy tables in strict order: `settings`, `block_rules`, `forward_rules`, `emails`, `attachments` (skip ephemeral `login_attempts`), using `INSERT OR IGNORE`.
   - Verify row counts match between `<OLD_DATABASE_ID>` and `<NEW_DATABASE_ID>`:
     ```sql
     SELECT 'emails' AS tbl, COUNT(*) AS cnt FROM emails
     UNION ALL SELECT 'attachments', COUNT(*) FROM attachments
     UNION ALL SELECT 'block_rules', COUNT(*) FROM block_rules
     UNION ALL SELECT 'forward_rules', COUNT(*) FROM forward_rules
     UNION ALL SELECT 'settings', COUNT(*) FROM settings;
     ```
3. **Transfer custom domain `<WEB_SUBDOMAIN>`**:
   - Cloudflare forbids binding the same custom domain to two Workers simultaneously.
   - List Worker custom domains: `GET /accounts/<ACCOUNT_ID>/workers/domains?hostname=<WEB_SUBDOMAIN>` and capture `<OLD_DOMAIN_MAPPING_ID>`.
   - Detach custom domain from `<OLD_WORKER>`: `DELETE /accounts/<ACCOUNT_ID>/workers/domains/<OLD_DOMAIN_MAPPING_ID>`.
   - Update local `wrangler.jsonc` (`name: "<NEW_WORKER>"`, `database_name: "<NEW_DB>"`, `database_id: "<NEW_DATABASE_ID>"`, keeping `ACCESS_POLICY_AUD` unchanged because the Access App stays on `<WEB_SUBDOMAIN>`).
   - Deploy `<NEW_WORKER>` (`NODE_OPTIONS=--dns-result-order=ipv4first npx wrangler deploy`).
4. **Cut over Email Routing catch-all**:
   - Call `PUT /zones/<ZONE_ID>/email/routing/rules/catch_all` with `actions: [{ "type": "worker", "value": ["<NEW_WORKER>"] }]`.
5. **Verify live traffic & sync cutover delta**:
   - Run `curl -4 -sSI https://<WEB_SUBDOMAIN>` -> confirm `302` to Cloudflare Access.
   - Send a test email from an external non-Gmail mailbox and verify it lands in `<NEW_DB>`.
   - Re-check `COUNT(*)` on `<OLD_DB>` for any emails that arrived between Steps 2 and 4; copy any missing IDs into `<NEW_DB>` with `INSERT OR IGNORE`.
6. **Clean up legacy resources (only after Step 5 passes)**:
   - Delete old Worker: `DELETE /accounts/<ACCOUNT_ID>/workers/scripts/<OLD_WORKER>`
   - Delete old D1 database: `DELETE /accounts/<ACCOUNT_ID>/d1/database/<OLD_DATABASE_ID>`

---

## 9. Rollback / Full Teardown Endpoints

Execute in this exact order to avoid bounce loops or orphaned bindings:

1. Disable Gmail forwarding inside Gmail Settings (**Save Changes**).
2. Disable Email Routing catch-all: `PUT /zones/<ZONE_ID>/email/routing/rules/catch_all` with `"enabled": false`.
3. Delete Worker script (and its custom domain mapping): `DELETE /accounts/<ACCOUNT_ID>/workers/scripts/<WORKER_NAME>` (or `npx wrangler delete`).
4. Delete Access Application: `DELETE /accounts/<ACCOUNT_ID>/access/apps/<ACCESS_APP_ID>`.
5. Delete Reusable Access Policy (only if no other Access apps reference it): `DELETE /accounts/<ACCOUNT_ID>/access/policies/<POLICY_ID>`.
6. Export D1 backup if needed, then delete D1 database: `DELETE /accounts/<ACCOUNT_ID>/d1/database/<DATABASE_ID>` (and optionally empty & delete `<R2_BUCKET_NAME>`).
