import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/access";
import { Icon } from "@/components/icon";
import Link from "next/link";
import { retryFailedRankRun } from "@/app/actions";
import { getDataForSeoBudgetSummary } from "@/lib/dataforseo-costs";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const actor = await currentActor();
  const showCosts = actor.role !== "team";
  const { runs, budget, dbUnavailable } = await getRunsData(showCosts);

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Rank Runs</h2>
          <p>{showCosts ? "Audit trail for every ranking request, including progress, status and API cost." : "Report progress and the history of requested ranking checks."}</p>
        </div>
      </header>

      {dbUnavailable ? (
        <div className="notice">
          <strong>Database not connected yet.</strong>
          <span> Sandbox and live run logs will appear here once the database is configured.</span>
        </div>
      ) : null}

      {showCosts ? <section className="summary-strip queue-summary" aria-label="Queue and budget summary">
        <Summary label="Monthly limit" value={`$${budget.limitUsd.toFixed(2)}`} />
        <Summary label="Spent" value={`$${budget.spentUsd.toFixed(4)}`} />
        <Summary label="Reserved" value={`$${budget.reservedUsd.toFixed(4)}`} />
        <Summary label="Available" value={`$${budget.availableUsd.toFixed(4)}`} />
      </section> : null}

      <section className="card spaced-section">
        <div className="section-heading compact-heading"><div><p className="label label-with-icon"><Icon name="graph" />Queue Operations</p><h3>Report history and progress</h3></div></div>
        <div className="table-scroll"><table className={`table queue-table queue-history-table${showCosts ? "" : " team-cost-hidden"}`}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Client / Project</th>
              <th>Status</th>
              <th>Method</th>
              <th>Progress</th>
              {showCosts ? <th>Cost</th> : null}
              <th>Requested by</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td><Link href={`/runs/${run.id}`}>{run.createdAt.toLocaleDateString("en-GB")}</Link></td>
                <td><Link href={actor.role === "team" ? `/clients/${run.project.client.id}` : `/projects/${run.project.id}`}>{run.project.client.name} / {run.project.name}</Link></td>
                <td>
                  <span className={`status ${statusTone(run.status)}`}>{run.status}</span>
                  {run.nextPollAt ? <small className="row-context">Next check {run.nextPollAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</small> : null}
                  {run.lastError ? <small className="queue-error" title={actor.role === "team" ? undefined : run.lastError}>{actor.role === "team" ? "Manager review required." : readableRunError(run.lastError)}</small> : null}
                </td>
                <td>{readableMethod(run.deliveryMethod)}</td>
                <td>
                  <strong>{run.completedTasks + run.failedTasks} / {run.requestedTasks}</strong>
                  <small className="row-context">{run.failedTasks ? `${run.failedTasks} failed` : `${run.results.length} stored`}</small>
                </td>
                {showCosts ? <td><strong>${run.actualCostUsd.toString()}</strong><small className="row-context">est. ${run.estimatedCostUsd.toString()}</small></td> : null}
                <td>{run.requestedByEmail ?? "System"}</td>
                <td className="table-action-cell">
                  {actor.role === "admin" && (run.status === "failed" || run.status === "blocked") && run.selection ? (
                    <form action={retryFailedRankRun.bind(null, run.id)}><SubmitButton className="button button-secondary" confirmMessage={`Retry this report run? Its estimated API cost is $${run.estimatedCostUsd.toString()}.`} pendingLabel="Queuing...">Retry</SubmitButton></form>
                  ) : null}
                </td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={showCosts ? 8 : 7} className="muted">No runs stored yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table></div>
      </section>
    </>
  );
}

async function getRunsData(includeBudget: boolean) {
  try {
    const [runs, budget] = await Promise.all([
      prisma.rankRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { project: { include: { client: true } }, results: true }
      }),
      includeBudget ? getDataForSeoBudgetSummary() : Promise.resolve({ limitUsd: 0, spentUsd: 0, reservedUsd: 0, availableUsd: 0 })
    ]);

    return { runs, budget, dbUnavailable: false };
  } catch {
    return {
      runs: [],
      budget: { limitUsd: 1, spentUsd: 0, reservedUsd: 0, availableUsd: 1 },
      dbUnavailable: true
    };
  }
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function statusTone(status: string) {
  if (status === "completed") return "good";
  if (status === "failed" || status === "blocked") return "danger";
  return "warn";
}

function readableMethod(method: string) {
  if (method === "standard") return "Standard queue";
  if (method === "live") return "Live check";
  return method.charAt(0).toUpperCase() + method.slice(1);
}

function readableRunError(error: string) {
  if (error.includes("DATAFORSEO_LOGIN") || error.includes("DATAFORSEO_PASSWORD")) return "DataForSEO credentials were unavailable to the worker.";
  if (error.includes("DATAFORSEO_LIVE_ENABLED")) return "Paid API requests were disabled when this run started.";
  return error;
}
