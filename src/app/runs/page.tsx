import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/access";
import { Icon } from "@/components/icon";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  await currentActor();
  const { runs, dbUnavailable } = await getRunsData();

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Rank Runs</h2>
          <p>Audit trail for every sandbox and live ranking request, including task count, parsed results, status, and actual API cost.</p>
        </div>
      </header>

      {dbUnavailable ? (
        <div className="notice">
          <strong>Database not connected yet.</strong>
          <span> Sandbox and live run logs will appear here once the database is configured.</span>
        </div>
      ) : null}

      <section className="card">
        <p className="label label-with-icon"><Icon name="graph" />Run History</p>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Client / Project</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Results</th>
              <th>Requests</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td><Link href={`/runs/${run.id}`}>{run.createdAt.toLocaleDateString("en-GB")}</Link></td>
                <td><Link href={`/projects/${run.project.id}`}>{run.project.client.name} / {run.project.name}</Link></td>
                <td><span className="status">{run.status}</span></td>
                <td>{run.sandbox ? "Sandbox" : "Live"}</td>
                <td>{run.results.length}</td>
                <td>{run.apiRequests.length}</td>
                <td>${run.actualCostUsd.toString()}</td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">No runs stored yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}

async function getRunsData() {
  try {
    const runs = await prisma.rankRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        project: { include: { client: true } },
        results: true,
        apiRequests: true
      }
    });

    return { runs, dbUnavailable: false };
  } catch {
    return { runs: [], dbUnavailable: true };
  }
}
