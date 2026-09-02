# Star Reports

Local SEO reporting hub for month-to-month rank tracking, built to run on a Plesk Node.js server.

## Version 1 Scope

- Manage clients, projects, tracked keywords, locations, and competitors.
- Store immutable rank-run snapshots for organic, local finder, Google Maps, and SERP feature data.
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

## Live Reports And Queue

The project page includes a one-task live verification control and a monthly report schedule. Paid checks are stored as queue records and processed sequentially by `npm run rank:worker`. Organic checks can be capped between one and ten result pages; the request uses DataForSEO's stop-on-match option so crawling can finish as soon as the target domain is found. Search operators that can multiply DataForSEO cost are blocked.

`DATAFORSEO_MAX_LIVE_TASKS_PER_RUN` remains the hard task ceiling for verification, scheduled, and ad hoc jobs. Increase it only after checking the report's keyword x area x device x result-type task count. The exact cost returned by DataForSEO is stored on the run and API audit records.

The worker uses a database lock so only one worker processes reports at a time, and `RANK_QUEUE_DELAY_MS` paces individual API tasks. Sales users cannot queue another full report within `RANK_SALES_COOLDOWN_DAYS` of the latest completed scheduled or ad hoc report; administrators can override that cooldown.

## Google Sign-in

Authentication is off until `AUTH_ENABLED=true`. Create a Google OAuth web client with this production redirect URI:

```text
https://reports.starwebsites.co.uk/api/auth/callback/google
```

Set `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and at least one of `AUTH_ALLOWED_EMAILS` or `AUTH_ALLOWED_DOMAINS`. Emails in `AUTH_ADMIN_EMAILS` receive administrator access; other approved accounts receive the sales role. A verified Google email must still match the allowlist. Client share URLs remain read-only bearer links and do not require a Google account.

## Security Backlog

Return to these items before broader client access or adding GA4 and Google Search Console data:

2. Harden read-only client links with expiry dates, token regeneration, revocation, and optional client-email authentication.
3. Set an explicit short session lifetime, initially 8-12 hours, and review session revocation behaviour.
4. Add and verify production security headers, including HSTS, Content Security Policy, frame protection, and a strict referrer policy.
5. Add audit logging for successful and failed sign-ins, report changes, paid API runs, role-sensitive actions, and share-link changes.
6. Add rate limits to sensitive server actions and API endpoints, in addition to the existing report queue and worker pacing.
7. Establish dependency-update checks, Plesk patching, tested database backups, and a documented restore procedure.
10. Complete a focused application and infrastructure security review before connecting GA4 or Google Search Console accounts.

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
4. Add the environment variables from `.env.example` in Plesk.
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

The exact `cd` path must be the application root shown by Plesk. The worker first enqueues due monthly schedules and then processes the queue. Only enable schedules after confirming the task count, `DATAFORSEO_MAX_LIVE_TASKS_PER_RUN`, and available DataForSEO balance.

## DataForSEO Safety

The integration defaults to Sandbox:

- `DATAFORSEO_SANDBOX=true`
- `DATAFORSEO_LIVE_ENABLED=false`
- `DATAFORSEO_MAX_LIVE_TASKS_PER_RUN=1`

Live calls are blocked unless `DATAFORSEO_LIVE_ENABLED=true`; the task ceiling is enforced both when a job is queued and when the worker executes it.

Every DataForSEO task is sent with a `tag` in the format `client:project:job_type`, so costs can be grouped in our own database later.
