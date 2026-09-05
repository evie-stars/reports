import Link from "next/link";
import { retryFailedRankRun } from "@/actions/reports";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { currentActor } from "@/lib/access";
import { getDataForSeoBudgetSummary } from "@/lib/dataforseo-costs";
import { prisma } from "@/lib/db";
import { readableRunError } from "@/lib/run-errors";
import { formatDate, formatTime, formatUsd, plural, readableDeliveryMethod } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const actor = await currentActor();
  const showCosts = actor.role !== "team";
  const { runs, budget, dbUnavailable } = await getRunsData(showCosts);

  return (
    <div>
      <PageHeader
        title="Rank runs"
        subtitle={showCosts
          ? "Audit trail for every ranking request, including progress, status and API cost."
          : "Report progress and the history of requested ranking checks."}
      />

      {dbUnavailable ? (
        <Notice tone="warn" title="Database not connected yet.">Sandbox and live run logs will appear here once the database is configured.</Notice>
      ) : null}

      {showCosts ? (
        <section className="flex flex-wrap gap-2.5 mb-6" aria-label="Queue and budget summary">
          <StatCard label="Monthly limit" value={formatUsd(budget.limitUsd, 2)} icon="lock" />
          <StatCard label="Spent" value={formatUsd(budget.spentUsd)} icon="refresh" />
          <StatCard label="Reserved" value={formatUsd(budget.reservedUsd)} icon="clock" tone={budget.reservedUsd > 0 ? "warn" : "default"} />
          <StatCard label="Available" value={formatUsd(budget.availableUsd)} icon="tick-circle" tone="accent" />
        </section>
      ) : null}

      <SectionCard
        title="Report history"
        subtitle="The most recent ranking requests and their progress."
        icon="refresh"
        aside={runs.length > 0 ? <span className="text-xs text-slate">{plural(runs.length, "run")}</span> : null}
      >
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Client / project</th>
                <th>Status</th>
                <th>Method</th>
                <th>Progress</th>
                {showCosts ? <th>Cost</th> : null}
                <th>Requested by</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const canRetry = actor.role === "admin" && (run.status === "failed" || run.status === "blocked") && Boolean(run.selection);
                return (
                  <tr key={run.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/runs/${run.id}`} className="font-medium hover:text-accent hover:underline">{formatDate(run.createdAt)}</Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link
                        href={actor.role === "team" ? `/clients/${run.project.client.id}` : `/projects/${run.project.id}`}
                        className="font-medium hover:text-accent hover:underline"
                      >
                        {run.project.client.name}
                      </Link>
                      <span className="table-sub">{run.project.name}</span>
                    </td>
                    <td>
                      <StatusPill status={run.status} />
                      {run.nextPollAt ? <span className="table-sub">Next check {formatTime(run.nextPollAt)}</span> : null}
                      {run.lastError ? (
                        <span className="table-sub text-blocked max-w-xs truncate" title={actor.role === "team" ? undefined : run.lastError}>
                          {actor.role === "team" ? "Manager review required." : readableRunError(run.lastError)}
                        </span>
                      ) : null}
                    </td>
                    <td className="text-slate whitespace-nowrap">{readableDeliveryMethod(run.deliveryMethod)}</td>
                    <td className="whitespace-nowrap">
                      <span className="font-medium">{run.completedTasks + run.failedTasks} / {run.requestedTasks}</span>
                      <span className="table-sub">{run.failedTasks ? `${run.failedTasks} failed` : `${run.results.length} stored`}</span>
                    </td>
                    {showCosts ? (
                      <td className="whitespace-nowrap">
                        <span className="font-mono text-xs">{formatUsd(run.actualCostUsd)}</span>
                        <span className="table-sub">est. {formatUsd(run.estimatedCostUsd)}</span>
                      </td>
                    ) : null}
                    <td className="text-slate">{run.requestedByEmail ?? "System"}</td>
                    <td className="text-right">
                      {canRetry ? (
                        <form action={retryFailedRankRun.bind(null, run.id)}>
                          <SubmitButton
                            className="btn-ghost"
                            confirmMessage={`Retry this report run? Its estimated API cost is $${run.estimatedCostUsd.toString()}.`}
                            pendingLabel="Queuing..."
                          >
                            Retry
                          </SubmitButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {runs.length === 0 ? <EmptyRow colSpan={showCosts ? 8 : 7}>No runs stored yet.</EmptyRow> : null}
            </tbody>
          </table>
        </TableWrap>
      </SectionCard>
    </div>
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

