# Star Reports

Local SEO reporting hub for month-to-month rank tracking, built to run on a Plesk Node.js server.

## Version 1 Scope

- Manage clients, projects, tracked keywords, locations, and competitors.
- Store immutable rank-run snapshots for organic, local finder, Google Maps, and SERP feature data.
- Default to DataForSEO Sandbox so setup and parser work does not spend trial credit.
- Allow one guarded live check only when explicitly enabled.
- Provide the foundation for later GA4 and Google Search Console imports.

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
2. Set the application startup file to Next's standalone server after build:
   `server.js` inside `.next/standalone`.
3. Add the environment variables from `.env.example` in Plesk.
4. Create the database in Plesk and use the connection string as `DATABASE_URL`.
5. Run:

   ```bash
   npm install
   npm run db:generate
   npm run db:push
   npm run build
   ```

6. Add a Plesk Scheduled Task for rank checks, initially sandbox only:

   ```bash
   npm run rank:sandbox
   ```

Only switch to `npm run rank:live` after confirming sandbox parsing, checking your keyword/location volume, and setting `DATAFORSEO_LIVE_ENABLED=true`.

## DataForSEO Safety

The integration defaults to Sandbox:

- `DATAFORSEO_SANDBOX=true`
- `DATAFORSEO_LIVE_ENABLED=false`
- `DATAFORSEO_MAX_LIVE_TASKS_PER_RUN=1`

Live calls are blocked unless `DATAFORSEO_LIVE_ENABLED=true` and the command uses `--live`.

Every DataForSEO task is sent with a `tag` in the format `client:project:job_type`, so costs can be grouped in our own database later.
