import { prisma } from "@/lib/db";
import Link from "next/link";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboardData();

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>Track local rankings by keyword, location, device, and result type. Every run is stored as a dated snapshot for monthly comparison.</p>
        </div>
        <Link className="button" href="/clients">Add Tracking Data</Link>
      </header>

      {data.dbUnavailable ? <SetupNotice /> : null}

      <section className="grid metrics">
        <Metric icon="contacts" label="Clients" value={data.clients} hint="Accounts being tracked" />
        <Metric icon="home" label="Projects" value={data.projects} hint="Sites or locations" />
        <Metric icon="tags" label="Active Keywords" value={data.keywords} hint="Included in checks" />
        <Metric icon="location" label="Tracked Locations" value={data.locations} hint="Local SERP markets" />
      </section>

      <section className="grid two" style={{ marginTop: 18 }}>
        <div className="card">
          <p className="label">Recent Rank Runs</p>
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
                  <td>{run.project.client.name} / {run.project.name}</td>
                  <td><span className="status">{run.status}</span></td>
                  <td>{run.sandbox ? "Sandbox" : "Live"}</td>
                  <td>${run.actualCostUsd.toString()}</td>
                </tr>
              ))}
              {data.runs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">No rank runs yet. Seed data, then run the sandbox cron script.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="card">
          <p className="label">DataForSEO Guardrails</p>
          <h3>Sandbox first</h3>
          <p className="muted">
            Live API calls are blocked unless `DATAFORSEO_LIVE_ENABLED=true` is set. Keep the first real test to one task while the trial credit is limited.
          </p>
          <div className="check-list">
            <span>Sandbox mode enabled by default</span>
            <span>Live runs capped to one task</span>
            <span>API requests logged with project tags</span>
          </div>
        </div>
      </section>
    </>
  );
}

async function getDashboardData() {
  try {
    const [clients, projects, keywords, locations, runs] = await Promise.all([
      prisma.client.count(),
      prisma.project.count(),
      prisma.keyword.count({ where: { active: true } }),
      prisma.location.count({ where: { active: true } }),
      prisma.rankRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { project: { include: { client: true } } }
      })
    ]);

    return { clients, projects, keywords, locations, runs, dbUnavailable: false };
  } catch {
    return { clients: 0, projects: 0, keywords: 0, locations: 0, runs: [], dbUnavailable: true };
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

function Metric({ icon, label, value, hint }: { icon: "contacts" | "home" | "location" | "tags"; label: string; value: number; hint: string }) {
  return (
    <div className="card metric-card">
      <div className="metric-topline">
        <p className="label">{label}</p>
        <span className="icon-tile"><Icon name={icon} /></span>
      </div>
      <p className="metric-value">{value}</p>
      <p className="metric-hint">{hint}</p>
    </div>
  );
}
