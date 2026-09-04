import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/access";
import { Icon } from "@/components/icon";
import { workerHealth } from "@/lib/worker-health";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createUserAccess, reviewReportRequest, toggleUserAccess, updateUserAccessRole } from "@/app/actions";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await currentActor();
  if (actor.role !== "admin") redirect("/clients");

  const data = await getDashboardData();
  const dataForSeoConfigured = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const liveApiEnabled = process.env.DATAFORSEO_LIVE_ENABLED === "true";
  const googleSignInEnabled = process.env.AUTH_ENABLED === "true";
  const worker = workerHealth(data.heartbeat);

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>Reporting activity, system health and recent work.</p>
        </div>
      </header>

      {data.dbUnavailable ? <SetupNotice /> : null}
      {!data.dbUnavailable && (data.failedRuns > 0 || data.failedScheduledReports > 0 || !worker.healthy) ? (
        <div className="notice danger-notice operations-alert">
          <strong>Operations need attention.</strong>
          <span>
            {data.failedRuns > 0 ? ` ${data.failedRuns} report job${data.failedRuns === 1 ? " has" : "s have"} failed or been blocked in the last 7 days.` : ""}
            {data.failedScheduledReports > 0 ? ` ${data.failedScheduledReports} automated report${data.failedScheduledReports === 1 ? " needs" : "s need"} attention.` : ""}
            {!worker.healthy ? ` The rank worker is ${worker.label.toLowerCase()}.` : ""}
          </span>
          <Link href={data.failedScheduledReports > 0 ? "/scheduled" : "/runs"}>Review activity</Link>
        </div>
      ) : null}

      <section className="card configuration-feed dashboard-configuration" aria-labelledby="configuration-title">
        <div className="dashboard-section-heading">
          <p className="label label-with-icon" id="configuration-title"><Icon name="settings" />Configuration Status</p>
          <Link href="/settings">View settings</Link>
        </div>
        <div className="configuration-grid">
          <ConfigurationItem label="DataForSEO" value={dataForSeoConfigured ? "Connected" : "Credentials missing"} good={dataForSeoConfigured} />
          <ConfigurationItem label="Paid API" value={liveApiEnabled ? "Enabled" : "Protected mode"} good={liveApiEnabled} />
          <ConfigurationItem label="Google sign-in" value={googleSignInEnabled ? "Enabled" : "Disabled"} good={googleSignInEnabled} />
          <ConfigurationItem label="Rank worker" value={worker.label} good={worker.healthy} />
          <ConfigurationItem label="Report queue" value={data.queuedRuns ? `${data.queuedRuns} waiting` : "Clear"} good={data.queuedRuns === 0} />
          <ConfigurationItem label="Failed jobs" value={data.failedRuns ? `${data.failedRuns} in 7 days` : "None"} good={data.failedRuns === 0} />
          <ConfigurationItem label="Monthly schedules" value={`${data.schedules} active`} good={data.schedules > 0} neutral={data.schedules === 0} />
          <ConfigurationItem label="Scheduled reports" value={data.failedScheduledReports ? `${data.failedScheduledReports} need attention` : "Healthy"} good={data.failedScheduledReports === 0} />
        </div>
      </section>

      <section className="card spaced-section user-access-panel" aria-labelledby="user-access-title">
        <div className="section-heading compact-heading">
          <div>
            <p className="label label-with-icon"><Icon name="contacts" />Access Control</p>
            <h3 id="user-access-title">Users and roles</h3>
          </div>
          <span className="muted user-count">{data.users.filter((user) => user.enabled || isBootstrapAdmin(user.email)).length} active</span>
        </div>

        <form action={createUserAccess} className="user-access-create-form">
          <label>
            Email address
            <input name="email" type="email" placeholder="name@starwebsites.co.uk" required />
          </label>
          <label>
            Name <span className="optional-label">Optional</span>
            <input name="name" type="text" placeholder="Full name" />
          </label>
          <label>
            Role
            <select name="role" defaultValue="team">
              <option value="team">Team</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <SubmitButton pendingLabel="Adding user...">Add User</SubmitButton>
        </form>

        <div className="table-scroll user-access-table-wrap">
          <table className="table user-access-table">
            <thead><tr><th>User</th><th>Role</th><th>Access</th><th>Last Sign-in</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {data.users.map((user) => {
                const protectedAdmin = isBootstrapAdmin(user.email);
                const currentUser = user.email === actor.email;
                const enabled = protectedAdmin || user.enabled;
                return (
                  <tr key={user.id}>
                    <td><strong>{user.name ?? user.email}</strong>{user.name ? <small className="row-context">{user.email}</small> : null}</td>
                    <td>
                      {protectedAdmin || currentUser ? (
                        <span className="protected-role"><strong>{roleLabel(protectedAdmin ? "admin" : user.role)}</strong><small>{protectedAdmin ? "Protected by Plesk" : "Current user"}</small></span>
                      ) : (
                        <form action={updateUserAccessRole.bind(null, user.id)} className="user-role-form">
                          <select name="role" defaultValue={user.role} aria-label={`Role for ${user.email}`}>
                            <option value="team">Team</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                          <SubmitButton className="button button-secondary" pendingLabel="Saving...">Save</SubmitButton>
                        </form>
                      )}
                    </td>
                    <td><span className={`status ${enabled ? "good" : "danger"}`}>{enabled ? "Active" : "Revoked"}</span></td>
                    <td>{user.lastSignInAt ? user.lastSignInAt.toLocaleDateString("en-GB") : <span className="muted">Not yet</span>}</td>
                    <td className="table-action-cell">
                      {protectedAdmin || currentUser ? null : (
                        <form action={toggleUserAccess.bind(null, user.id)}>
                          <SubmitButton
                            className="button button-secondary"
                            confirmMessage={enabled ? `Revoke access for ${user.email}?` : undefined}
                            pendingLabel={enabled ? "Revoking..." : "Enabling..."}
                          >
                            {enabled ? "Revoke" : "Enable"}
                          </SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data.users.length === 0 ? <tr><td colSpan={5} className="muted">Users will appear here after they sign in or are added above.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <p className="user-access-help">Role changes apply on the user&apos;s next page load. Keep at least one email in `AUTH_ADMIN_EMAILS` as emergency access.</p>
      </section>

      {data.reportRequests.length > 0 ? (
        <section className="card spaced-section report-request-feed">
          <div className="section-heading compact-heading">
            <div><p className="label label-with-icon"><Icon name="edit" />Report Requests</p><h3>Requests from the team</h3></div>
            <span className="status warn">{data.reportRequests.length} waiting</span>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Client / Prospect</th><th>Requested By</th><th>Details</th><th>Date</th><th><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {data.reportRequests.map((request) => (
                  <tr key={request.id}>
                    <td><strong>{request.clientName}</strong>{request.websiteUrl ? <small className="row-context">{request.websiteUrl}</small> : null}</td>
                    <td>{request.requestedByName ?? request.requestedByEmail}<small className="row-context">{request.requestedByEmail}</small></td>
                    <td className="request-notes">{request.notes}</td>
                    <td>{request.createdAt.toLocaleDateString("en-GB")}</td>
                    <td className="table-action-cell"><form action={reviewReportRequest.bind(null, request.id)}><SubmitButton className="button button-secondary" pendingLabel="Updating...">Mark Reviewed</SubmitButton></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="summary-strip spaced-section" aria-label="Reporting summary">
        <SummaryItem label="Clients" value={data.clients} />
        <SummaryItem label="Reports" value={data.projects} />
        <SummaryItem label="Active Keywords" value={data.keywords} />
        <SummaryItem label="Areas" value={data.locations} />
      </section>

      <section className="card spaced-section">
          <p className="label">Recent Checks</p>
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.id}>
                  <td><Link href={`/runs/${run.id}`}>{run.project.client.name} / {run.project.name}</Link></td>
                  <td><span className={`status ${dashboardStatusTone(run.status)}`}>{run.status}</span></td>
                  <td>{run.sandbox ? "Sandbox" : "Live"}</td>
                  <td>${run.actualCostUsd.toString()}</td>
                </tr>
              ))}
              {data.runs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">No rank checks have been stored yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
      </section>
    </>
  );
}

async function getDashboardData() {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [clients, projects, keywords, locations, schedules, queuedRuns, failedRuns, failedScheduledReports, heartbeat, runs, reportRequests, users] = await Promise.all([
      prisma.client.count(),
      prisma.project.count(),
      prisma.keyword.count({ where: { active: true } }),
      prisma.location.count({ where: { active: true } }),
      prisma.project.count({ where: { scheduleEnabled: true } }),
      prisma.rankRun.count({ where: { status: { in: ["queued", "running"] } } }),
      prisma.rankRun.count({ where: { status: { in: ["failed", "blocked"] }, createdAt: { gte: weekAgo } } }),
      prisma.reportExecution.count({ where: { status: { in: ["partial", "failed", "blocked"] }, createdAt: { gte: weekAgo } } }),
      prisma.workerHeartbeat.findUnique({ where: { key: "rank-worker" } }),
      prisma.rankRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { project: { include: { client: true } } }
      }),
      prisma.reportRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 10 }),
      prisma.userAccess.findMany({ orderBy: [{ enabled: "desc" }, { name: "asc" }, { email: "asc" }] })
    ]);

    return { clients, projects, keywords, locations, schedules, queuedRuns, failedRuns, failedScheduledReports, heartbeat, runs, reportRequests, users, dbUnavailable: false };
  } catch {
    return {
      clients: 0,
      projects: 0,
      keywords: 0,
      locations: 0,
      schedules: 0,
      queuedRuns: 0,
      failedRuns: 0,
      failedScheduledReports: 0,
      heartbeat: null,
      runs: [],
      reportRequests: [],
      users: [],
      dbUnavailable: true
    };
  }
}

function SetupNotice() {
  return (
    <div className="notice">
      <strong>Database not connected yet.</strong>
      <span> Add `DATABASE_URL`, then run `npm run db:push` and `npm run db:seed` to populate this dashboard.</span>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function ConfigurationItem({
  label,
  value,
  good,
  neutral = false
}: {
  label: string;
  value: string;
  good: boolean;
  neutral?: boolean;
}) {
  return (
    <div className="configuration-item">
      <span className={`configuration-dot ${neutral ? "neutral" : good ? "good" : "warning"}`} aria-hidden="true" />
      <span><strong>{label}</strong><small>{value}</small></span>
    </div>
  );
}

function dashboardStatusTone(status: string) {
  if (status === "completed") return "good";
  if (status === "failed" || status === "blocked") return "danger";
  return "warn";
}

function isBootstrapAdmin(email: string) {
  return (process.env.AUTH_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

function roleLabel(role: string) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
