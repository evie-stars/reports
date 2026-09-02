import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getDashboardData();
  return (
    <>
      <header className="page-header">
        <div>
          <h2>Dashboard</h2>
          <p>A quick view of reporting activity across all clients.</p>
        </div>
        <Link className="button" href="/clients">View Clients</Link>
      </header>

      {data.dbUnavailable ? <SetupNotice /> : null}

      <section className="summary-strip" aria-label="Reporting summary">
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
                  <td><span className="status">{run.status}</span></td>
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

function SummaryItem({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
