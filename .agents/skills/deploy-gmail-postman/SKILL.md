---
name: deploy-gmail-postman
description: Deploys or updates the gmail-postman Cloudflare Email Routing, Email Workers, D1, and Cloudflare Access Zero Trust Gmail aggregator from scratch or across redeploys. Activates when provisioning Cloudflare resources, configuring Access reusable policies, enabling Email Routing catch-all rules, running scripts/deploy.mjs, verifying live mail delivery, or migrating/renaming an existing gmail-postman deployment.
---

# Deploy `gmail-postman`

End-to-end deployment skill for `gmail-postman` on Cloudflare Workers + D1 + Email Routing + Cloudflare Access (Zero Trust). For exact REST payloads, GraphQL troubleshooting queries, and zero-downtime rename/migration steps, read [references/cloudflare-api-runbook.md](./references/cloudflare-api-runbook.md).

## Pre-Flight Checklist

Ask the user **only** for parameters that are still unknown:

| Parameter | Default / Notes |
| --- | --- |
| Target Cloudflare domain (`<DOMAIN>`) | Required; active Cloudflare zone with DNS managed by Cloudflare |
| Web subdomain (`<WEB_SUBDOMAIN>`) | Default `mail.<DOMAIN>` |
| Allowed Access email(s) (`<OWNER_EMAIL>`) | Required; comma-separated list for Cloudflare Access & Worker allowlist |
| R2 enabled on account? | Default `no` (pure D1 stores attachments `<= 1 MB`; R2 enables up to `10 MB`) |
| Providers to enable | Default Gmail-only (`gmail@<DOMAIN>`); reserved (`qq`, `outlook`, `netease163`, `custom`) stay disabled unless user asks to edit [src/providers.ts](../../../src/providers.ts) |
| Worker name (`<WORKER_NAME>`) / alias prefix | Default `gmail-postman` / `gmail` |

> **Anti-Lockout Rule:** NEVER configure `<prefix>@<DOMAIN>` (e.g., `gmail@<DOMAIN>`) as the Cloudflare Access One-Time PIN login email. OTP codes would route into the same inbox you are trying to unlock. Always use an independent external email address (`<OWNER_EMAIL>`).

Choose the execution path based on available tools:
- **Path A** when Cloudflare MCP (API access) + Wrangler CLI are available (full zero-touch automation).
- **Path B** when only a terminal / Wrangler CLI is available (uses [scripts/deploy.mjs](../../../scripts/deploy.mjs)).

---

## Path A: Fully Automated Deployment (Cloudflare MCP + Wrangler CLI)

Execute steps in strict order. Use exact endpoints and JSON bodies from [references/cloudflare-api-runbook.md](./references/cloudflare-api-runbook.md).

1. **Inspect Cloudflare account & zone** via Cloudflare MCP:
   - Resolve `<ACCOUNT_ID>` and `<ZONE_ID>` for `<DOMAIN>`.
   - List DNS records on `<ZONE_ID>`: confirm no conflicting `MX` records on `<DOMAIN>` and no conflicting `A`/`AAAA`/`CNAME` on `<WEB_SUBDOMAIN>`.
   - Check existing D1 databases, R2 availability (`GET .../r2/buckets`), Workers subdomain (`workers.dev`), and Zero Trust Access organization (`auth_domain` -> `<TEAM_DOMAIN>`) + IdPs (confirm One-Time PIN or desired IdP exists).

2. **Provision D1 database & apply schema**:
   - Create D1 database `<WORKER_NAME>-db` (default `gmail-postman-db`) if absent; capture `<DATABASE_ID>`.
   - Execute [migrations/0001_init.sql](../../../migrations/0001_init.sql) via D1 query API (or `wrangler d1 migrations apply`), and ensure the `d1_migrations` tracking table exists with `'0001_init.sql'` recorded so future Wrangler migrations stay in sync.
   - If R2 is enabled and requested, create bucket `<WORKER_NAME>-attachments`.

3. **Provision Cloudflare Access (Zero Trust)**:
   - Create an account-level **reusable policy** (`POST /accounts/<ACCOUNT_ID>/access/policies`) allowing `<OWNER_EMAIL>`. **NEVER create legacy inline app-scoped policies** (`reusable: false`). Capture `<POLICY_ID>`.
   - Create a `self_hosted` Access Application for `<WEB_SUBDOMAIN>` referencing `policies: [{ "id": "<POLICY_ID>", "precedence": 1 }]`. Capture `result.aud` (`<ACCESS_POLICY_AUD>`).

4. **Generate local gitignored `wrangler.jsonc`**:
   - Copy from [wrangler.example.jsonc](../../../wrangler.example.jsonc) into local `wrangler.jsonc` (verify `wrangler.jsonc` is gitignored before committing anything).
   - Populate: `name: "<WORKER_NAME>"`, `workers_dev: false`, `AUTH_MODE: "access"`, `MAIL_DOMAIN: "<DOMAIN>"`, `GMAIL_ALIAS_PREFIX`, `APP_TITLE`, `ACCESS_TEAM_DOMAIN: "https://<TEAM_DOMAIN>.cloudflareaccess.com"`, `ACCESS_POLICY_AUD`, `ACCESS_ALLOWED_EMAILS`, `routes: [{ "pattern": "<WEB_SUBDOMAIN>", "custom_domain": true }]`, `d1_databases` with `<DATABASE_ID>`, `observability` (logs + traces), `triggers.crons: ["0 3 * * *"]`, and optional `r2_buckets` (`ATTACHMENTS_BUCKET`) if R2 is enabled.

5. **Run local validation** (on Windows PowerShell, use `npm.cmd` and `npx.cmd` instead of `.ps1` shims):
   ```bash
   npm run types && npm run typecheck && npm test
   ```

6. **Authenticate Wrangler & deploy Worker**:
   - If not authenticated, log in with device flow to avoid localhost OAuth CSRF cookie errors:
     ```bash
     npx wrangler login --no-use-keyring --device
     ```
   - Deploy with IPv4 preference to prevent IPv6 connect timeouts:
     - Bash: `NODE_OPTIONS=--dns-result-order=ipv4first npx wrangler deploy`
     - PowerShell: `$env:NODE_OPTIONS="--dns-result-order=ipv4first"; npx.cmd wrangler deploy`
   - If deployment fails with error **`10063`** (missing `workers.dev` subdomain on a new account), ask the user to visit Cloudflare Dashboard -> **Workers & Pages** once to claim a `workers.dev` subdomain, then retry deploy (keep `workers_dev: false` in `wrangler.jsonc`).

7. **Enable Email Routing & bind Catch-all -> Worker**:
   - Enable Email Routing and auto-create MX/SPF/DKIM records (`POST /zones/<ZONE_ID>/email/routing/dns`).
   - Update Catch-all rule (`PUT /zones/<ZONE_ID>/email/routing/rules/catch_all`) with `enabled: true` and `actions: [{ "type": "worker", "value": ["<WORKER_NAME>"] }]`.
   - Verify Cron trigger `0 3 * * *` is attached to `<WORKER_NAME>`.

8. **Live verification & Gmail Forwarding handoff**:
   - Verify Access enforcement (must return `HTTP 302` redirecting to `https://<TEAM_DOMAIN>.cloudflareaccess.com/...`, never unauthenticated `200`):
     ```bash
     curl -4 -sSI https://<WEB_SUBDOMAIN>
     ```
   - Verify `GET /zones/<ZONE_ID>/email/routing` reports `status: "ready"`, MX/SPF/DKIM DNS records exist, and D1 contains all 7 tables (`emails`, `attachments`, `block_rules`, `forward_rules`, `settings`, `login_attempts`, `d1_migrations`).
   - Guide the user through **Gmail Forwarding**:
     1. Gmail -> **Settings** -> **See all settings** -> **Forwarding and POP/IMAP** -> **Add a forwarding address**: enter `<prefix>@<DOMAIN>` (default `gmail@<DOMAIN>`).
     2. Open `https://<WEB_SUBDOMAIN>` and sign in via Cloudflare Access. The Google forwarding confirmation email is auto-detected, starred, highlighted at the top with extracted code & link, and bypasses block rules.
     3. Verify in Gmail, select **"Forward a copy of incoming mail to..."**, and **scroll to the bottom and click "Save Changes"**.
     4. Send a live test email from an **external non-Gmail mailbox** (Gmail suppresses forwarding loops for self-sent messages) and confirm arrival in `https://<WEB_SUBDOMAIN>`.

---

## Path B: Pure CLI One-Click Deployment (No Cloudflare MCP)

When Cloudflare MCP is unavailable, use the repository's CLI deployment script [scripts/deploy.mjs](../../../scripts/deploy.mjs):

- **Interactive wizard:** `node scripts/deploy.mjs`
- **Scripted / CI:** `node scripts/deploy.mjs --non-interactive` (pass required flags or env vars; inspect `--help` first)

Ensure Wrangler is authenticated (`npx wrangler login --no-use-keyring --device`) or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are exported, and set `NODE_OPTIONS=--dns-result-order=ipv4first` before deploying. After completion, run Step 8 verification and Gmail Forwarding handoff above.

---

## Known Pitfalls & Rollback / Cleanup

- **Access OTP lockout:** Never put `<prefix>@<DOMAIN>` in Access allowlist as the sole OTP email.
- **Error `10063`:** Fresh Cloudflare accounts must claim a `workers.dev` subdomain once in Dashboard -> Workers & Pages even when `workers_dev: false`.
- **Wrangler OAuth CSRF error:** Always use `npx wrangler login --no-use-keyring --device`.
- **IPv6 timeouts:** Prefix deploy with `NODE_OPTIONS=--dns-result-order=ipv4first` and probe with `curl -4`.
- **Windows PowerShell:** Use `npm.cmd` and `npx.cmd` to avoid `.ps1` execution-policy errors.
- **Legacy Access policies:** Never pass inline rule definitions in `POST /access/apps`; always create reusable policies under `/access/policies` and attach `{ id, precedence }`.
- **Gmail forwarding traps:** Users often verify the address but forget to click **"Save Changes"** at the bottom of Gmail settings, or test by emailing themselves from the same Gmail account (test from an external non-Gmail mailbox instead).
- **Email Routing `syncing` / MX conflict:** Remove conflicting legacy MX records before calling `POST .../email/routing/dns`; inspect deliveries with the GraphQL `emailRoutingAdaptive` query in the runbook.
- **Attachments without R2:** Pure-D1 mode stores attachments `<= 1 MB`; larger files are recorded as `skipped_too_large` until R2 (`ATTACHMENTS_BUCKET`) is enabled (`<= 10 MB`).
- **Local dev vs. production auth:** `.dev.vars` (`AUTH_MODE=password`) applies only to `wrangler dev`; production fails closed to `AUTH_MODE="access"`.

**Rollback / Cleanup order:** (1) Disable Gmail forwarding -> (2) Disable Email Routing catch-all -> (3) Delete Worker (`npx wrangler delete`) -> (4) Delete Access App & unused reusable policy -> (5) Export data if needed, then delete D1 database and optional R2 bucket. For zero-downtime renames or migrations, follow the migration checklist in [references/cloudflare-api-runbook.md](./references/cloudflare-api-runbook.md).
