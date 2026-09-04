import Link from "next/link";
import { notFound } from "next/navigation";
import { buildRankMatrix, RankMatrix, type RankMatrixResult } from "@/components/rank-matrix";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { currentActor } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatDateTime, formatUsd, plural, readableValue } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const actor = await currentActor();
  const showCosts = actor.role !== "team";
  const { runId } = await params;
  const { run, dbUnavailable } = await getRunData(runId);

  if (dbUnavailable) {
    return (
      <div>
        <PageHeader
          eyebrow={<Link href="/runs" className="hover:text-ink">Rank runs</Link>}
          title="Run details"
          subtitle="This run cannot be loaded right now."
        />
        <Notice tone="warn" title="Database not connected yet.">Run details will appear here once the database is configured.</Notice>
      </div>
    );
  }

  if (!run) notFound();

  const mode = run.sandbox ? "Sandbox" : "Live";
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
    details: Array.from(new Set(result.serpFeatures.map((feature) => readableValue(feature.type))))
  }));
  const matrixRowCount = buildRankMatrix(matrixResults).rows.length;

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Link href="/runs" className="hover:text-ink">Rank runs</Link>
            {" / "}
            <Link href={`/clients/${run.project.client.id}`} className="hover:text-ink">{run.project.client.name}</Link>
            {" / "}
            {run.project.name}
          </>
        }
        title={`${mode} run`}
        subtitle={`${run.project.client.name} / ${run.project.name} · ${formatDateTime(run.createdAt)}`}
        actions={<StatusPill status={run.status} />}
      />

      {failedRequests.length > 0 ? (
        <Notice tone="danger" title={`${plural(failedRequests.length, "request")} failed.`}>
          {showCosts ? "Review the API audit below for the provider response." : "A manager can review the technical details."}
        </Notice>
      ) : null}

      {run.status === "queued" ? (
        <Notice tone="info" title="Report queued.">The Plesk worker will process it in order; refresh this page after the next worker run.</Notice>
      ) : null}

      <section className="flex flex-wrap gap-2.5 mb-6" aria-label="Run summary">
        <StatCard label="Requested" value={run.requestedTasks} icon="search" />
        <StatCard label="Results" value={run.results.length} icon="drawer" tone="sky" />
        <StatCard label="Matches" value={matchedResults} icon="tick-circle" tone={matchedResults > 0 ? "accent" : "default"} />
        {showCosts ? <StatCard label="Cost" value={formatUsd(run.actualCostUsd)} icon="refresh" /> : null}
      </section>

      <SectionCard
        title="Ranking results"
        subtitle={`${mode} result snapshot`}
        icon="bookmark"
        className="mb-4"
        aside={
          <span className="text-xs text-slate">
            {plural(matrixRowCount, "keyword")}
            {run.notes ? ` · ${run.notes}` : ""}
          </span>
        }
      >
        <RankMatrix results={matrixResults} emptyMessage="No ranking results were stored for this run." />
      </SectionCard>

      {showCosts ? (
        <SectionCard
          title="API audit"
          subtitle="Every provider request logged for this run."
          icon="cog"
          aside={run.apiRequests.length > 0 ? <span className="text-xs text-slate">{plural(run.apiRequests.length, "request")}</span> : null}
        >
          <TableWrap>
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
                    <td className="font-mono text-xs break-all">{request.endpoint}</td>
                    <td className="whitespace-nowrap">{request.statusCode ?? "-"}</td>
                    <td className="text-slate whitespace-nowrap">{request.sandbox ? "Sandbox" : "Live"}</td>
                    <td className="font-mono text-xs whitespace-nowrap">{formatUsd(request.costUsd)}</td>
                    <td>
                      {request.errorMessage ? (
                        <span className="block max-w-sm truncate text-blocked" title={request.errorMessage}>{request.errorMessage}</span>
                      ) : (
                        <StatusPill tone="accent">Stored</StatusPill>
                      )}
                    </td>
                  </tr>
                ))}
                {run.apiRequests.length === 0 ? <EmptyRow colSpan={5}>No API requests were logged.</EmptyRow> : null}
              </tbody>
            </table>
          </TableWrap>
        </SectionCard>
      ) : null}
    </div>
  );
}

async function getRunData(runId: string) {
  try {
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
    return { run, dbUnavailable: false };
  } catch {
    return { run: null, dbUnavailable: true };
  }
}
