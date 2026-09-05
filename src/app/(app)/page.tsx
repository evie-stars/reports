import Link from "next/link";
import { redirect } from "next/navigation";
import { reviewReportRequest } from "@/actions/reports";
import { createUserAccess, toggleUserAccess, updateUserAccessRole } from "@/actions/users";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { currentActor } from "@/lib/access";
import { secretStatus } from "@/lib/app-secrets";
import { BACKUP_HEARTBEAT_KEY, backupHealth } from "@/lib/backups";
import { prisma } from "@/lib/db";
import { formatDate, formatUsd, plural } from "@/lib/format";
import { roleLabel } from "@/lib/roles";
import { isBootstrapAdmin } from "@/lib/user-access";
import { workerHealth } from "@/lib/worker-health";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await currentActor();
  if (actor.role !== "admin") redirect("/clients");

  const data = await getDashboardData();
  const dataForSeoSecret = await secretStatus("dataforseo");
  const dataForSeoConfigured = dataForSeoSecret.configured;
  const dataForSeoLabel = dataForSeoSecret.unavailable
    ? "Key store unavailable"
    : dataForSeoConfigured
      ? "Connected"
      : dataForSeoSecret.source === "app" ? "Stored key unreadable" : "Credentials missing";
  const liveApiEnabled = process.env.DATAFORSEO_LIVE_ENABLED === "true";
  const googleSignInEnabled = process.env.AUTH_ENABLED === "true";
  const worker = workerHealth(data.heartbeat);
  const backups = backupHealth(data.backupHeartbeat);
  const needsAttention = !data.dbUnavailable && (data.failedRuns > 0 || data.failedScheduledReports > 0 || !worker.healthy || !backups.healthy);
  const activeUsers = data.users.filter((user) => user.enabled || isBootstrapAdmin(user.email)).length;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Reporting activity, system health and recent work."
        actions={<Link href="/settings" className="btn-ghost"><Icon name="cog" className="w-3.5 h-3.5" />Settings</Link>}
      />

      {data.dbUnavailable ? (
        <Notice tone="warn" title="Database not connected yet.">Add DATABASE_URL, then run the database push and seed commands to populate this dashboard.</Notice>
      ) : null}
      {needsAttention ? (
        <Notice
          tone="danger"
          title="Operations need attention."
          action={<Link href={data.failedScheduledReports > 0 ? "/scheduled" : "/runs"} className="link text-sm">Review activity</Link>}
        >
          {data.failedRuns > 0 ? `${plural(data.failedRuns, "report job")} failed or blocked in the last 7 days. ` : ""}
          {data.failedScheduledReports > 0 ? `${plural(data.failedScheduledReports, "automated report")} need attention. ` : ""}
          {!worker.healthy ? `The rank worker is ${worker.label.toLowerCase()}. ` : ""}
          {!backups.healthy ? backups.state === "never" ? "Database backups have never run; add the daily backup task in Plesk." : `The last database backup ${backups.state === "failed" ? "failed" : "is stale"}; see Settings.` : ""}
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2.5 mb-6">
        <StatCard label="Clients" value={data.clients} icon="users" tone="sky" />
        <StatCard label="Reports" value={data.projects} icon="drawer" tone="accent" />
        <StatCard label="Active keywords" value={data.keywords} icon="bookmark" />
        <StatCard label="Areas" value={data.locations} icon="map-pin" />
        <StatCard label="Queued" value={data.queuedRuns} icon="refresh" tone={data.queuedRuns ? "warn" : "default"} />
        <StatCard label="Failed in 7 days" value={data.failedRuns} icon="alert-circle" tone={data.failedRuns ? "blocked" : "default"} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-min">
        <SectionCard title="Configuration" icon="cog" aside={<Link href="/settings" className="text-xs link">All settings →</Link>}>
          <ul className="divide-y divide-line">
            <ConfigurationItem label="DataForSEO" value={dataForSeoLabel} good={dataForSeoConfigured} />
            <ConfigurationItem label="Paid API" value={liveApiEnabled ? "Enabled" : "Protected mode"} good={liveApiEnabled} />
            <ConfigurationItem label="Google sign-in" value={googleSignInEnabled ? "Enabled" : "Disabled"} good={googleSignInEnabled} />
            <ConfigurationItem label="Rank worker" value={worker.label} good={worker.healthy} />
            <ConfigurationItem label="Database backups" value={backups.label} good={backups.healthy} />
            <ConfigurationItem label="Report queue" value={data.queuedRuns ? `${data.queuedRuns} waiting` : "Clear"} good={data.queuedRuns === 0} />
            <ConfigurationItem label="Monthly schedules" value={`${data.schedules} active`} good={data.schedules > 0} neutral={data.schedules === 0} />
            <ConfigurationItem label="Scheduled reports" value={data.failedScheduledReports ? `${data.failedScheduledReports} need attention` : "Healthy"} good={data.failedScheduledReports === 0} />
          </ul>
        </SectionCard>

        <SectionCard title="Recent checks" icon="refresh" className="md:col-span-2" aside={<Link href="/runs" className="text-xs link">All runs →</Link>}>
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Project</th><th>Status</th><th>Mode</th><th className="text-right">Cost</th></tr>
              </thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link href={`/runs/${run.id}`} className="font-medium hover:text-accent hover:underline">{run.project.client.name}</Link>
                      <span className="table-sub">{run.project.name} · {formatDate(run.createdAt)}</span>
                    </td>
                    <td><StatusPill status={run.status} /></td>
                    <td className="text-slate">{run.sandbox ? "Sandbox" : "Live"}</td>
                    <td className="text-right font-mono text-xs">{formatUsd(run.actualCostUsd)}</td>
                  </tr>
                ))}
                {data.runs.length === 0 ? <EmptyRow colSpan={4}>No rank checks have been stored yet.</EmptyRow> : null}
              </tbody>
            </table>
          </TableWrap>
        </SectionCard>

        <SectionCard
          title="Users and roles"
          subtitle="Role changes apply on the user's next page load. Keep at least one email in AUTH_ADMIN_EMAILS as emergency access; those environment administrators are also the only ones who can change API keys."
          icon="users"
          className="md:col-span-3"
          aside={<span className="text-xs text-slate">{activeUsers} active</span>}
        >
          <form action={createUserAccess} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end mb-4">
            <label className="block">
              <span className="field-label">Email address</span>
              <input name="email" type="email" placeholder="name@starwebsites.co.uk" required className="field" />
            </label>
            <label className="block">
              <span className="field-label">Name <span className="text-slate/70">(optional)</span></span>
              <input name="name" type="text" placeholder="Full name" className="field" />
            </label>
            <label className="block">
              <span className="field-label">Role</span>
              <select name="role" defaultValue="team" className="field sm:w-36">
                <option value="team">Team</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <SubmitButton pendingLabel="Adding…"><Icon name="user-add" className="w-3.5 h-3.5" />Add user</SubmitButton>
          </form>

          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>User</th><th>Role</th><th>Access</th><th>Last sign-in</th><th><span className="sr-only">Action</span></th></tr>
              </thead>
              <tbody>
                {data.users.map((user) => {
                  const protectedAdmin = isBootstrapAdmin(user.email);
                  const currentUser = user.email === actor.email;
                  const enabled = protectedAdmin || user.enabled;
                  return (
                    <tr key={user.id}>
                      <td>
                        <span className="font-medium">{user.name ?? user.email}</span>
                        {user.name ? <span className="table-sub">{user.email}</span> : null}
                      </td>
                      <td>
                        {protectedAdmin || currentUser ? (
                          <>
                            <span className="font-medium">{roleLabel(protectedAdmin ? "admin" : user.role)}</span>
                            <span className="table-sub">{protectedAdmin ? "Protected by Plesk" : "Current user"}</span>
                          </>
                        ) : (
                          <form action={updateUserAccessRole.bind(null, user.id)} className="flex items-center gap-2">
                            <select name="role" defaultValue={user.role} aria-label={`Role for ${user.email}`} className="field w-32 py-1">
                              <option value="team">Team</option>
                              <option value="manager">Manager</option>
                              <option value="admin">Admin</option>
                            </select>
                            <SubmitButton className="btn-ghost" pendingLabel="Saving…">Save</SubmitButton>
                          </form>
                        )}
                      </td>
                      <td><StatusPill status={enabled ? "active" : "revoked"}>{enabled ? "Active" : "Revoked"}</StatusPill></td>
                      <td className="text-slate">{user.lastSignInAt ? formatDate(user.lastSignInAt) : "Not yet"}</td>
                      <td className="text-right">
                        {protectedAdmin || currentUser ? null : (
                          <form action={toggleUserAccess.bind(null, user.id)}>
                            <SubmitButton
                              className={enabled ? "btn-danger" : "btn-ghost"}
                              confirmMessage={enabled ? `Revoke access for ${user.email}?` : undefined}
                              pendingLabel={enabled ? "Revoking…" : "Enabling…"}
                            >
                              {enabled ? "Revoke" : "Enable"}
                            </SubmitButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {data.users.length === 0 ? <EmptyRow colSpan={5}>Users will appear here after they sign in or are added above.</EmptyRow> : null}
              </tbody>
            </table>
          </TableWrap>
        </SectionCard>

        {data.reportRequests.length > 0 ? (
          <SectionCard
            title="Report requests"
            subtitle="Requests from the team"
            icon="chat-square"
            className="md:col-span-3"
            aside={<StatusPill tone="warn">{data.reportRequests.length} waiting</StatusPill>}
          >
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Client / prospect</th><th>Requested by</th><th>Details</th><th>Date</th><th><span className="sr-only">Action</span></th></tr>
                </thead>
                <tbody>
                  {data.reportRequests.map((request) => (
                    <tr key={request.id}>
                      <td>
                        <span className="font-medium">{request.clientName}</span>
                        {request.websiteUrl ? <span className="table-sub">{request.websiteUrl}</span> : null}
                      </td>
                      <td>
                        {request.requestedByName ?? request.requestedByEmail}
                        <span className="table-sub">{request.requestedByEmail}</span>
                      </td>
                      <td className="text-slate max-w-md whitespace-pre-wrap">{request.notes}</td>
                      <td className="text-slate whitespace-nowrap">{formatDate(request.createdAt)}</td>
                      <td className="text-right">
                        <form action={reviewReportRequest.bind(null, request.id)}>
                          <SubmitButton className="btn-ghost" pendingLabel="Updating…"><Icon name="tick" className="w-3.5 h-3.5" />Mark reviewed</SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}

async function getDashboardData() {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [clients, projects, keywords, locations, schedules, queuedRuns, failedRuns, failedScheduledReports, heartbeat, backupHeartbeat, runs, reportRequests, users] = await Promise.all([
      prisma.client.count(),
      prisma.project.count(),
      prisma.keyword.count({ where: { active: true } }),
      prisma.location.count({ where: { active: true } }),
      prisma.project.count({ where: { scheduleEnabled: true } }),
      prisma.rankRun.count({ where: { status: { in: ["queued", "running"] } } }),
      prisma.rankRun.count({ where: { status: { in: ["failed", "blocked"] }, createdAt: { gte: weekAgo } } }),
      prisma.reportExecution.count({ where: { status: { in: ["partial", "failed", "blocked"] }, createdAt: { gte: weekAgo } } }),
      prisma.workerHeartbeat.findUnique({ where: { key: "rank-worker" } }),
      prisma.workerHeartbeat.findUnique({ where: { key: BACKUP_HEARTBEAT_KEY } }),
      prisma.rankRun.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { project: { include: { client: true } } } }),
      prisma.reportRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 10 }),
      prisma.userAccess.findMany({ orderBy: [{ enabled: "desc" }, { name: "asc" }, { email: "asc" }] })
    ]);

    return { clients, projects, keywords, locations, schedules, queuedRuns, failedRuns, failedScheduledReports, heartbeat, backupHeartbeat, runs, reportRequests, users, dbUnavailable: false };
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
      backupHeartbeat: null,
      runs: [],
      reportRequests: [],
      users: [],
      dbUnavailable: true
    };
  }
}

function ConfigurationItem({ label, value, good, neutral = false }: { label: string; value: string; good: boolean; neutral?: boolean }) {
  const dot = neutral ? "bg-slate/50" : good ? "bg-accent" : "bg-warn";
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex items-center gap-2 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
        <span className="font-medium truncate">{label}</span>
      </span>
      <span className="text-xs text-slate text-right shrink-0">{value}</span>
    </li>
  );
}
