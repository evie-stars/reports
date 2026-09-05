# Star Reports

Local SEO reporting hub for month-to-month rank tracking, built to run on a Plesk Node.js server.

## Version 1 Scope

- Manage clients, projects, tracked keywords, locations, and competitors.
- Store immutable rank-run snapshots for organic, Google Maps, and SERP feature data.
- Default to DataForSEO Sandbox so setup and parser work does not spend trial credit.
- Queue guarded live checks, ad hoc reports, and monthly schedules.
- Restrict the reporting workspace with approved Google accounts and admin, manager, and team roles.
- Import mapped Google Search Console and Google Analytics 4 data for each report.

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

The worker uses a database lock so only one worker processes reports at a time, and `RANK_QUEUE_DELAY_MS` paces individual API tasks.

Each Standard task carries a unique `tag`, and DataForSEO's `task_post` response is matched back to our tasks by that tag rather than by array position, so a reordered or partially rejected batch cannot file one keyword's rankings against another. Every outbound request has a timeout (`HTTP_TIMEOUT_MS`, and `DATAFORSEO_TIMEOUT_MS` for the slower SERP endpoints); reads are retried with backoff, but nothing that creates a paid task is ever retried automatically. On each run the worker also reaps tasks left in `submitting` for longer than `RANK_TASK_STALE_MINUTES` (a crash between posting and recording the answer) and resumes runs whose tasks were created but never posted. Retrying a failed Standard report re-queues only its failed tasks on the same run, reserving budget for just that remainder, so tasks DataForSEO already accepted are never paid for twice. Team users cannot queue another full report within `RANK_TEAM_COOLDOWN_DAYS` of the latest completed scheduled or ad hoc report; managers and administrators can override that cooldown.

The Scheduled workspace lists every enabled monthly report, its next run date, coverage, search depth, devices, enabled data, and latest execution outcome. SEO, Maps, Search Console, and Analytics can be toggled independently. The client report keeps them under one project but separates Overview, SEO, and Maps into focused views; the Search Console and Analytics cards appear on the Overview and SEO views.

A schedule day later than the current month's last day runs on that last day instead of being skipped. Each due schedule creates one coordinated execution record. The worker queues the selected SEO and Maps checks, refreshes the mapped Search Console and Google Analytics properties, and records each source separately. An imported source that is left `running` by a worker that died is retried once its import lock expires, and a scheduled import that collides with a manual one is put back to `queued` for the next run rather than failed. A report can therefore finish as partially successful without hiding the data that completed. In-app dashboard alerts surface failed, blocked, and partial executions to administrators. Existing scheduled rank runs from the current month are attached rather than submitted again.

## Keyword Demand

Search volume, CPC, competition, and monthly demand trends are optional because they use a separate Google Ads Standard task. One task can contain up to 1,000 active keywords for a report and uses its first active DataForSEO area. The default estimate is `$0.06` for the whole bulk task.

Keep `DATAFORSEO_KEYWORD_METRICS_ENABLED=false` until you intentionally want to spend that amount. Set it to `true` to enable the **Queue Metrics** button. The same monthly budget ceiling applies, and results are stored both on each keyword and as timestamped metric snapshots.

## Google Sign-in

Authentication is off until `AUTH_ENABLED=true`. Create a Google OAuth web client with this production redirect URI:

```text
https://reports.starwebsites.co.uk/api/auth/callback/google
```

Set `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and keep at least one recovery administrator in `AUTH_ADMIN_EMAILS`. Routine users and roles are managed from the admin dashboard and stored in PostgreSQL. A dashboard-managed email is allowed to sign in even when it is outside `AUTH_ALLOWED_DOMAINS`; an explicitly revoked database user remains blocked even if their domain is otherwise allowed. When the user table is unavailable, sign-ins fail closed rather than falling back to the domain allowlist. `AUTH_ALLOWED_EMAILS`, `AUTH_ALLOWED_DOMAINS`, and `AUTH_MANAGER_EMAILS` remain available as bootstrap or broad company-access fallbacks. Sessions expire after `AUTH_SESSION_MAX_AGE_HOURS` (10 hours by default).

- **Admin:** dashboard, global settings, connections, access links, API diagnostics, costs, and all report controls.
- **Manager:** client and report setup, report content, keywords, areas, schedules, and Search Console and Analytics property mapping.
- **Team:** read-only reports, guarded report reruns, schedules, and report requests. Cost and monetary data is not rendered for this role.

The dashboard access panel records successful users automatically, supports direct invitations by verified Google email, applies role changes on the next authenticated request, and keeps environment administrators protected as emergency recovery accounts.

## Security Controls

- A per-request nonce-based Content Security Policy is set in `src/proxy.ts`. Scripts run only when they carry the request nonce, so injected inline scripts cannot execute. HSTS, frame, MIME-sniffing, referrer, and browser-permission headers are applied by Next.js.
- A production server (`NODE_ENV=production`) refuses to start unless `AUTH_ENABLED=true` and `AUTH_SECRET` are set, so the local "everyone is an administrator" mode can never reach a live deployment.
- If the managed user table cannot be read during sign-in or session refresh, access is denied until the database recovers. Only `AUTH_ADMIN_EMAILS` remain reachable, as the emergency recovery path.
- Sign-ins, sign-outs, report changes, paid queue activity, worker outcomes, and share-link changes are stored in the admin audit trail.
- Database-backed limits protect authenticated mutations, paid reports, share-link changes, Google sign-ins, and the locations API. Limits are configurable with the `RATE_LIMIT_*` environment variables.
- The rank worker records a heartbeat on every run. The dashboard and Settings page flag stale workers and failed or blocked jobs from the last seven days.
- Read-only client links expire, can be regenerated with a new token, and are immediately invalidated when revoked. They remain bearer links and do not require a Google account.

## Remaining Security Work

Complete these infrastructure-level items as the reporting integrations expand:

1. Establish dependency-update checks, Plesk patching, tested database backups, and a documented restore procedure.
2. Complete a focused application and infrastructure security review before importing broader analytics datasets, such as landing-page or event-level GA4 data.
3. Rate limit and audit the read-only `/share/*` pages, which are reachable without a Google account.

## Google Search Console

Search Console and Google Analytics 4 share one read-only Google OAuth client, separate from the sign-in client. An administrator connects a Google account from Settings, granting each product's scope separately (Google's incremental authorisation folds an earlier grant into the new token), and a manager maps one verified property to each report. Access tokens are generated only when needed; the long-lived refresh token is encrypted at rest with AES-256-GCM. The stored scope list always mirrors the latest token response, so if a grant is revoked at Google and the account is reconnected, Settings warns that the missing product needs to be granted again.

Create a Google OAuth web client with this production redirect URI, and enable the Search Console API, the Google Analytics Data API, and the Google Analytics Admin API in its Google Cloud project:

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

After deployment, open **Settings**, connect the Google account for Search Console, then open a report's settings and select its Search Console property. The Search Console grant requests only `webmasters.readonly` access. Disconnecting an account in Report Hub removes the locally stored token together with its Search Console and Analytics report mappings; Google account access can also be removed separately from the Google account's connected-app settings.

Mapped reports can manually import the previous 90 complete days of final Web search totals. Enabled monthly schedules refresh the same data automatically. One daily aggregate is stored per report with clicks, impressions, CTR, and average position. Re-running the import replaces that same date range, so refreshes are idempotent rather than additive. The client report displays the totals and a clicks/impressions trend using the same period and project filters as the ranking report. Each Google request is also recorded in the API audit with a zero cost. Manual imports are limited by `RATE_LIMIT_GSC_IMPORTS_PER_HOUR`; scheduled worker invocations process at most `SCHEDULED_REPORT_MAX_GSC_IMPORTS` imports at once.

## Google Analytics 4

Analytics uses the same Google OAuth client as Search Console. From **Settings**, grant Analytics access to a connected Google account (or connect a new one); this requests only `analytics.readonly`. A manager then opens a report's settings and selects one GA4 property from the accounts that hold Analytics access. Property names are read from the Analytics Admin API and every stored property reference is validated against the `properties/<id>` resource format before it is used in a request.

Each import replaces the previous 90 complete days, ending yesterday to match Search Console. Two Data API reports are stored per property: whole-property daily totals and the same metrics split by default channel group. The metrics are sessions, active users, new users, engaged sessions, and key events (GA4's name for conversions). Because active users is a distinct count for each day, it is only ever shown per day; period totals and the channel table use the additive metrics. GA4 can still be finalising the most recent day at import time, and the next refresh replaces the whole range, so trailing days self-correct. Manual imports are limited by `RATE_LIMIT_GA4_IMPORTS_PER_HOUR`; scheduled worker invocations process at most `SCHEDULED_REPORT_MAX_GA4_IMPORTS` imports at once. Each Data API report request is recorded in the API audit with a zero cost; property listings and token refreshes are not.

The client report shows sessions (with the organic-search share), new users, engagement rate, and key events, a sessions and daily-active-users trend, and a channel breakdown. Analytics can be included in one-off snapshots once a mapped report has imported data.

## Design System

The workspace shares its design language with Team Hub: Tailwind CSS v3 with the same tokens (`tailwind.config.js`), Poppins loaded through `next/font`, the Interface line icon set in `src/components/icon.tsx`, and a dark gradient backdrop with the light content panel inset beside a fixed sidebar. Reusable pieces live in `src/components/ui/` (page header, stat card, status pill, notice, section card, empty state, table wrapper, tabs, copy link) and the shell in `src/components/shell/`. Formatting helpers for dates, money and status colours are in `src/lib/format.ts`. Pages live in the `(app)` route group, which renders the shell, while `/login` and the read-only `/share/*` pages live in `(public)`.

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

## Upgrading An Existing Database

The schema enforces one keyword phrase per report and one ranking result per run, keyword, area, result type and device. The Analytics release also reshapes the previously unused `Ga4Snapshot` table (its `source`, `medium`, `landingPage`, `users`, and `conversions` columns are replaced), so `npm run db:push` may ask for `--accept-data-loss` on that table; nothing had ever written to it. Before pushing the schema to a database that already holds data, run:

```bash
npm run db:check
```

It lists any rows that would violate those constraints and exits non-zero until they are resolved.

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
   cd /var/www/vhosts/starwebsites.co.uk/reports.starwebsites.co.uk && npm run rank:worker
   ```

The exact `cd` path must be the application root shown by Plesk. The npm worker command explicitly loads the application `.env`, matching the command that was verified on the Plesk server. The worker creates due report executions, submits or collects Standard ranking tasks, refreshes scheduled Search Console and Google Analytics data, processes optional keyword metrics, and records a health heartbeat. Keep the scheduled interval below `RANK_WORKER_STALE_MINUTES` so a missed worker run raises an alert. Only enable schedules after confirming the task count, the Standard task cap, the cost preview, and available DataForSEO balance.

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

The tests use fixed response fixtures and never contact DataForSEO or a database. The same suite, together with linting, a type check, and a production build, runs in GitHub Actions on every push and pull request (`.github/workflows/ci.yml`).

`npm run rank:sandbox` runs one immediate sandbox check for the first active keyword. `npm run rank:live` queues one paid verification through the normal budget reservation and worker path rather than calling DataForSEO directly, so no spend can happen outside the ledger.
