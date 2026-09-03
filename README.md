# Star Reports

Local SEO reporting hub for month-to-month rank tracking, built to run on a Plesk Node.js server.

## Version 1 Scope

- Manage clients, projects, tracked keywords, locations, and competitors.
- Store immutable rank-run snapshots for organic, Google Maps, and SERP feature data.
- Default to DataForSEO Sandbox so setup and parser work does not spend trial credit.
- Queue guarded live checks, ad hoc reports, and monthly schedules.
- Restrict the reporting workspace with approved Google accounts and admin/sales roles.
- Provide the foundation for later GA4 and Google Search Console imports.

## Sandbox Rank Checks

Open a project and use **Sandbox Rank Check** to choose active keywords, locations, devices, and result types. The form defaults to one organic desktop task and is capped at 24 sandbox tasks per batch.

Each run stores:

- One ranking snapshot per selected task.
- Matched rank, URL, and movement from the previous stored snapshot.
- Organic SERP features.
- The full DataForSEO request and response audit, including errors and reported cost.

The sandbox action always calls the DataForSEO sandbox host and cannot be promoted to live mode. Paid calls use the separate single live verification control below.

## Paid Reports And Queue

The project page includes a one-task Live verification control and a monthly report schedule. Live is retained only for immediate, one-keyword checks. Ad hoc and scheduled reports use DataForSEO Standard tasks, which are submitted in batches and collected by later worker runs. Paid checks are stored as queue records and processed sequentially by `npm run rank:worker`.

Organic checks can be capped between one and ten result pages, while Google Maps counts as one task unit. The cost preview accounts for each selected result type and device. Search operators that can multiply DataForSEO cost are blocked. `DATAFORSEO_MAX_LIVE_TASKS_PER_RUN` caps immediate checks and `DATAFORSEO_MAX_STANDARD_TASKS_PER_RUN` caps full reports.

`DATAFORSEO_MONTHLY_BUDGET_USD` is a hard application-level monthly ceiling. The queue reserves the maximum estimated cost before accepting a run, then stores the exact DataForSEO-reported charge. Polling requests are excluded from spend totals so task cost is not counted twice. The Rank Runs screen shows current spend, reservations, available budget, task progress, failures, retries, and upcoming schedules.

The worker uses a database lock so only one worker processes reports at a time, and `RANK_QUEUE_DELAY_MS` paces individual API tasks. Sales users cannot queue another full report within `RANK_SALES_COOLDOWN_DAYS` of the latest completed scheduled or ad hoc report; administrators can override that cooldown.

## Keyword Demand

Search volume, CPC, competition, and monthly demand trends are optional because they use a separate Google Ads Standard task. One task can contain up to 1,000 active keywords for a report and uses its first active DataForSEO area. The default estimate is `$0.06` for the whole bulk task.

Keep `DATAFORSEO_KEYWORD_METRICS_ENABLED=false` until you intentionally want to spend that amount. Set it to `true` to enable the **Queue Metrics** button. The same monthly budget ceiling applies, and results are stored both on each keyword and as timestamped metric snapshots.

## Google Sign-in

Authentication is off until `AUTH_ENABLED=true`. Create a Google OAuth web client with this production redirect URI:

```text
https://reports.starwebsites.co.uk/api/auth/callback/google
```

Set `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and at least one of `AUTH_ALLOWED_EMAILS` or `AUTH_ALLOWED_DOMAINS`. Emails in `AUTH_ADMIN_EMAILS` receive administrator access; other approved accounts receive the sales role. A verified Google email must still match the allowlist. Sessions expire after `AUTH_SESSION_MAX_AGE_HOURS` (10 hours by default).

## Security Controls

- Global CSP, HSTS, frame, MIME-sniffing, referrer, and browser-permission headers are applied by Next.js.
- Sign-ins, sign-outs, report changes, paid queue activity, worker outcomes, and share-link changes are stored in the admin audit trail.
- Database-backed limits protect authenticated mutations, paid reports, share-link changes, Google sign-ins, and the locations API. Limits are configurable with the `RATE_LIMIT_*` environment variables.
- The rank worker records a heartbeat on every run. The dashboard and Settings page flag stale workers and failed or blocked jobs from the last seven days.
- Read-only client links expire, can be regenerated with a new token, and are immediately invalidated when revoked. They remain bearer links and do not require a Google account.

## Remaining Security Work

Complete these infrastructure-level items as the reporting integrations expand:

7. Establish dependency-update checks, Plesk patching, tested database backups, and a documented restore procedure.
10. Complete a focused application and infrastructure security review before importing broader GA4 datasets.

## Google Search Console

The first Search Console phase connects an internal Google account and lets an administrator map one verified Search Console property to each report. It does not import performance data yet. Access tokens are generated only when needed; the long-lived refresh token is encrypted at rest with AES-256-GCM.

Create a separate Google OAuth web client with this production redirect URI:

```text
https://reports.starwebsites.co.uk/api/integrations/google/callback
```

Set these server variables:

```text
GOOGLE_SEARCH_CONSOLE_CLIENT_ID
GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET
GOOGLE_SEARCH_CONSOLE_REDIRECT_URI
GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY
```

Generate the encryption key once with `openssl rand -hex 32`, store it with the application secrets, and include it in database-backup recovery documentation. Changing or losing this key makes existing connected-account tokens unreadable.

After deployment, open **Settings**, connect the Google account, then open a report's settings and select its Search Console property. The integration requests only `webmasters.readonly` access. Disconnecting in Report Hub removes the locally stored token and report mappings; Google account access can also be removed separately from the Google account's connected-app settings.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

3. Set `DATABASE_URL` to your PostgreSQL database.

4. Generate the Prisma client and create tables:

   ```bash
   npm run db:generate
   npm run db:push
   npm run db:seed
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

## Plesk Setup Outline

1. Create a Node.js app in Plesk pointing at this project directory.
2. Set the application startup file to `server.js`.
3. Set the document root to the `public` subdirectory.
4. Add the environment variables from `.env.example` in Plesk. Security and rate-limit values have conservative defaults, but should be set explicitly in production.
5. Create the database in Plesk and use the connection string as `DATABASE_URL`.
6. Run:

   ```bash
   npm install
   npm run db:generate
   npm run db:push
   npm run build
   ```

7. Add a Plesk Scheduled Task every five minutes:

   ```bash
   cd /var/www/vhosts/reports.starwebsites.co.uk && npm run rank:worker
   ```

The exact `cd` path must be the application root shown by Plesk. The worker enqueues due monthly schedules, submits or collects Standard ranking tasks, processes optional keyword metrics, and records a health heartbeat. Keep the scheduled interval below `RANK_WORKER_STALE_MINUTES` so a missed worker run raises an alert. Only enable schedules after confirming the task count, the Standard task cap, the cost preview, and available DataForSEO balance.

## DataForSEO Safety

The integration defaults to Sandbox:

- `DATAFORSEO_SANDBOX=true`
- `DATAFORSEO_LIVE_ENABLED=false`
- `DATAFORSEO_MAX_LIVE_TASKS_PER_RUN=1`

All paid calls are blocked unless `DATAFORSEO_LIVE_ENABLED=true`; despite the legacy variable name, this gate now covers both Live and Standard endpoints. Task ceilings and the monthly budget are enforced before a job is accepted. Keyword metrics have the additional `DATAFORSEO_KEYWORD_METRICS_ENABLED` gate.

Every DataForSEO task is sent with a `tag` in the format `client:project:job_type`, so costs can be grouped in our own database later.

Run the no-spend contract suite before deployment:

```bash
npm test
```

The tests use fixed response fixtures and never contact DataForSEO.
