import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icon";
import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  await currentActor();
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
          <span> Review the API audit below for the response from DataForSEO.</span>
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
        <RunMetric label="Cost" value={`$${run.actualCostUsd.toString()}`} />
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="section-heading">
          <div>
            <p className="label label-with-icon"><Icon name="graph" />Ranking Results</p>
            <h3>{run.sandbox ? "Sandbox" : "Live"} result snapshot</h3>
          </div>
          <span className="muted">{run.notes}</span>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Location</th>
                <th>Type</th>
                <th>Device</th>
                <th>Rank</th>
                <th>Movement</th>
                <th>Matched URL</th>
                <th>SERP Features</th>
              </tr>
            </thead>
            <tbody>
              {run.results.map((result) => {
                const rank = result.rankAbsolute ?? result.rankGroup;
                const featureTypes = Array.from(new Set(result.serpFeatures.map((feature) => readableType(feature.type))));
                return (
                  <tr key={result.id}>
                    <td><strong>{result.keyword.phrase}</strong></td>
                    <td>{result.location.name}</td>
                    <td>{readableType(result.searchType)}</td>
                    <td>{readableType(result.device)}</td>
                    <td>{rank ?? <span className="muted">Not found</span>}</td>
                    <td><Movement direction={result.direction} previousRank={result.previousRank} /></td>
                    <td>
                      {result.matchedUrl ? (
                        <a className="result-url" href={result.matchedUrl} target="_blank" rel="noreferrer">
                          {result.matchedUrl}
                        </a>
                      ) : <span className="muted">No match</span>}
                    </td>
                    <td>{featureTypes.length > 0 ? featureTypes.join(", ") : <span className="muted">None</span>}</td>
                  </tr>
                );
              })}
              {run.results.length === 0 ? (
                <tr><td colSpan={8} className="muted">No ranking results were stored for this run.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
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
      </section>
    </>
  );
}

function RunMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function Movement({ direction, previousRank }: { direction: string | null; previousRank: number | null }) {
  if (!direction) return <span className="muted">-</span>;
  return (
    <span className={`status ${direction === "up" || direction === "new" ? "good" : direction === "down" || direction === "lost" ? "danger" : ""}`}>
      {readableType(direction)}{previousRank !== null ? ` · was ${previousRank}` : ""}
    </span>
  );
}

function statusClass(status: string) {
  if (status === "completed") return "good";
  if (status === "failed" || status === "blocked") return "danger";
  return "warn";
}

function readableType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
