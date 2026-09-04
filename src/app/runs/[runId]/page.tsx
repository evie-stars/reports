import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { buildRankMatrix, RankMatrix, type RankMatrixResult } from "@/components/rank-matrix";
import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const actor = await currentActor();
  const showCosts = actor.role !== "team";
  const { runId } = await params;
  const run = await prisma.rankRun.findUnique({
    where: { id: runId },
    include: {
      project: { include: { client: true } },
      results: {
        orderBy: [{ keyword: { phrase: "asc" } }, { location: { name: "asc" } }, { searchType: "asc" }, { device: "asc" }],
        include: { keyword: true, location: true, serpFeatures: true }
      },
      apiRequests: { orderBy: { createdAt: "asc" } }
    }
  });

  if (!run) notFound();

  const failedRequests = run.apiRequests.filter((request) => request.errorMessage);
  const matchedResults = run.results.filter((result) => result.matched).length;
  const matrixResults: RankMatrixResult[] = run.results.map((result) => ({
    id: result.id,
    projectId: run.projectId,
    keywordId: result.keywordId,
    keyword: result.keyword.phrase,
    locationId: result.locationId,
    location: result.location.name,
    searchType: result.searchType,
    device: result.device,
    rank: result.rankAbsolute ?? result.rankGroup,
    previousRank: result.previousRank,
    direction: result.direction,
    matchedUrl: result.matchedUrl,
    details: Array.from(new Set(result.serpFeatures.map((feature) => readableType(feature.type))))
  }));
  const matrixRowCount = buildRankMatrix(matrixResults).rows.length;

  return (
    <>
      <header className="page-header">
        <div>
          <p className="breadcrumb">
            <Link href="/runs">Rank Runs</Link> / <Link href={`/clients/${run.project.client.id}`}>{run.project.name}</Link>
          </p>
          <h2>{run.sandbox ? "Sandbox Run" : "Live Run"}</h2>
          <p>{run.project.client.name} / {run.project.name} · {run.createdAt.toLocaleString("en-GB")}</p>
        </div>
        <span className={`status ${statusClass(run.status)}`}>{run.status}</span>
      </header>

      {failedRequests.length > 0 ? (
        <div className="notice danger-notice">
          <strong>{failedRequests.length} request{failedRequests.length === 1 ? "" : "s"} failed.</strong>
          <span>{showCosts ? " Review the API audit below for the provider response." : " A manager can review the technical details."}</span>
        </div>
      ) : null}

      {run.status === "queued" ? (
        <div className="notice">
          <strong>Report queued.</strong> The Plesk worker will process it in order; refresh this page after the next worker run.
        </div>
      ) : null}

      <section className="summary-strip" aria-label="Run summary">
        <RunMetric label="Requested" value={run.requestedTasks.toString()} />
        <RunMetric label="Results" value={run.results.length.toString()} />
        <RunMetric label="Matches" value={matchedResults.toString()} />
        {showCosts ? <RunMetric label="Cost" value={`$${run.actualCostUsd.toString()}`} /> : null}
      </section>

      <section className="card report-table-card run-results-card" style={{ marginTop: 18 }}>
        <div className="section-heading">
          <div>
            <p className="label label-with-icon"><Icon name="graph" />Ranking Results</p>
            <h3>{run.sandbox ? "Sandbox" : "Live"} result snapshot</h3>
          </div>
          <span className="muted">{matrixRowCount} keyword{matrixRowCount === 1 ? "" : "s"} · {run.notes}</span>
        </div>
        <RankMatrix results={matrixResults} emptyMessage="No ranking results were stored for this run." />
      </section>

      {showCosts ? <section className="card" style={{ marginTop: 18 }}>
        <p className="label label-with-icon"><Icon name="settings" />API Audit</p>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>HTTP</th>
                <th>Mode</th>
                <th>Cost</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {run.apiRequests.map((request) => (
                <tr key={request.id}>
                  <td>{request.endpoint}</td>
                  <td>{request.statusCode ?? "-"}</td>
                  <td>{request.sandbox ? "Sandbox" : "Live"}</td>
                  <td>${request.costUsd.toString()}</td>
                  <td>
                    {request.errorMessage
                      ? <span className="danger-text">{request.errorMessage}</span>
                      : <span className="status good">Stored</span>}
                  </td>
                </tr>
              ))}
              {run.apiRequests.length === 0 ? (
                <tr><td colSpan={5} className="muted">No API requests were logged.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section> : null}
    </>
  );
}

function RunMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function statusClass(status: string) {
  if (status === "completed") return "good";
  if (status === "failed" || status === "blocked") return "danger";
  return "warn";
}

function readableType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
