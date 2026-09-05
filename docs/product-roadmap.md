# Product Roadmap

## Completed In The Roles And Scheduling Phase

- Admin, manager, and team permission tiers enforced in pages and Server Actions.
- Team users cannot see DataForSEO costs or estimates.
- Team report requests are stored and surfaced on the admin dashboard.
- Dedicated Scheduled workspace with dates, coverage, search depth, and included data.
- Per-report content controls for SEO Rankings and Google Search Console.
- Case-insensitive duplicate keyword filtering for bulk additions.
- Configurable organic page depth is retained per report schedule and ad hoc rerun.
- Ranking chart separates positions 21-30 from a neutral grey 31+ group.
- Search Console property selection retains its searchable picker.
- Scheduled reports coordinate selected SEO, Maps, and Search Console modules with per-source outcomes.
- Client reports separate Overview, SEO, and Maps without duplicating projects or tracking setup.
- Administrators receive in-app attention states for partial, failed, and blocked scheduled reports.
- One-off, immutable report snapshots with a selectable subset of SEO, Maps, and Search Console data.
- Human-readable client slugs on snapshot share URLs, paired with a long unguessable token.
- Snapshot expiry, revocation, view counts, and an access audit trail.
- Nonce-based Content Security Policy, fail-closed sign-in, and a production start-up guard for authentication.
- Tag-based reconciliation of Standard task batches, request timeouts, a stuck-task reaper, and in-place retries.
- Continuous integration running lint, type check, tests, and a production build.
- Workspace restyled to match the Team Hub design system (Tailwind, Poppins, shared icon set).
- Google Analytics 4 connected through the shared read-only Google client, with per-report property mapping, 90-day imports split by channel, and an Analytics card on the client report and in snapshots.
- Scheduled reports refresh mapped Analytics properties alongside Search Console, with stranded imports retried and lock collisions re-queued.
- DataForSEO and Google client credentials managed from Settings: encrypted, write-only, verified with the provider before saving, with rollback, an environment kill-switch, and a master-key rotation script.
- Read-only `/share/*` pages rate limited per caller address in the proxy, with every view counted and audited; Dependabot keeps dependencies and GitHub Actions current.

## Next Integration Phase

1. Add optional email notifications for new team report requests and failed schedules.
2. Extend the Analytics module with landing-page and event-level breakdowns once the security review in the README is complete.


## Cost Presentation

1. Add GBP display for administrators and managers using a dated exchange-rate source.
2. Store the rate used with each displayed or exported cost so historical totals remain auditable.
3. Keep DataForSEO budget enforcement in USD because provider charges are billed in USD.
