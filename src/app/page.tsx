import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/access";
import { Icon } from "@/components/icon";
import { workerHealth } from "@/lib/worker-health";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const actor = await currentActor();
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
      {!data.dbUnavailable && (data.failedRuns > 0 || !worker.healthy) ? (
        <div className="notice danger-notice operations-alert">
          <strong>Operations need attention.</strong>
          <span>
            {data.failedRuns > 0 ? ` ${data.failedRuns} report job${data.failedRuns === 1 ? " has" : "s have"} failed or been blocked in the last 7 days.` : ""}
            {!worker.healthy ? ` The rank worker is ${worker.label.toLowerCase()}.` : ""}
          </span>
          <Link href="/runs">Review rank runs</Link>
        </div>
      ) : null}

      <div className="dashboard-command-grid">
        <section className="dashboard-actions" aria-labelledby="quick-actions-title">
          <div className="dashboard-section-heading">
            <p className="label" id="quick-actions-title">Quick Actions</p>
          </div>
          <div className="quick-action-grid">
            {actor.role === "admin" ? (
              <Link className="quick-action quick-action-client" href="/clients?new=1">
                <span className="quick-action-icon"><Icon name="contacts" /></span>
                <span><strong>Add Client</strong><small>Create a new client record</small></span>
              </Link>
            ) : null}
            <Link className="quick-action quick-action-report" href="/clients">
              <span className="quick-action-icon"><Icon name="edit" /></span>
              <span><strong>Add Report</strong><small>Choose a client to continue</small></span>
            </Link>
          </div>
        </section>

        <section className="card configuration-feed" aria-labelledby="configuration-title">
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
          </div>
        </section>
      </div>

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
    const [clients, projects, keywords, locations, schedules, queuedRuns, failedRuns, heartbeat, runs] = await Promise.all([
      prisma.client.count(),
      prisma.project.count(),
      prisma.keyword.count({ where: { active: true } }),
      prisma.location.count({ where: { active: true } }),
      prisma.project.count({ where: { scheduleEnabled: true } }),
      prisma.rankRun.count({ where: { status: { in: ["queued", "running"] } } }),
      prisma.rankRun.count({ where: { status: { in: ["failed", "blocked"] }, createdAt: { gte: weekAgo } } }),
      prisma.workerHeartbeat.findUnique({ where: { key: "rank-worker" } }),
      prisma.rankRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { project: { include: { client: true } } }
      })
    ]);

    return { clients, projects, keywords, locations, schedules, queuedRuns, failedRuns, heartbeat, runs, dbUnavailable: false };
  } catch {
    return {
      clients: 0,
      projects: 0,
      keywords: 0,
      locations: 0,
      schedules: 0,
      queuedRuns: 0,
      failedRuns: 0,
      heartbeat: null,
      runs: [],
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
