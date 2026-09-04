import Link from "next/link";
import { Icon } from "@/components/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusPill } from "@/components/ui/status-pill";
import { TableWrap } from "@/components/ui/table";
import { canManageReports, currentActor } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatDate, plural, readableValue, statusTone } from "@/lib/format";
import { hasRankTracking } from "@/lib/report-modules";
import { nextScheduleDate, scheduleDateIsWithin } from "@/lib/schedules";

export const dynamic = "force-dynamic";

/** Compact pill sizing for module chips inside table cells. */
const SMALL_PILL = "px-2 py-0.5 text-[11px]";

export default async function ScheduledPage() {
  const actor = await currentActor();
  const canEdit = canManageReports(actor.role);
  const { schedules, executions, dbUnavailable } = await getScheduleData();
  const rows = schedules
    .map((project) => ({ ...project, nextRun: nextScheduleDate(project.scheduleDay) }))
    .sort((left, right) => left.nextRun.getTime() - right.nextRun.getTime());
  const nextSevenDays = rows.filter((row) => scheduleDateIsWithin(row.nextRun, 7)).length;
  const gscReports = rows.filter((row) => row.reportModules.includes("gsc")).length;
  const needsAttention = rows.filter((project) => {
    const latest = project.reportExecutions[0];
    return latest && ["partial", "failed", "blocked"].includes(latest.status);
  }).length;

  return (
    <div>
      <PageHeader title="Scheduled" subtitle="Upcoming automated reports and the outcome of each data source." />

      {dbUnavailable ? (
        <Notice tone="warn" title="Database not connected yet.">Scheduled reports will appear here once the database is available.</Notice>
      ) : null}

      <section className="flex flex-wrap gap-2.5 mb-6" aria-label="Schedule summary">
        <StatCard label="Scheduled reports" value={rows.length} icon="calendar" />
        <StatCard label="Next 7 days" value={nextSevenDays} icon="clock" tone={nextSevenDays > 0 ? "sky" : "default"} />
        <StatCard label="With Search Console" value={gscReports} icon="zoom-in" />
        <StatCard label="Needs attention" value={needsAttention} icon="alert-circle" tone={needsAttention > 0 ? "blocked" : "default"} />
      </section>

      <SectionCard
        title="Report calendar"
        subtitle="Monthly reporting plan"
        icon="calendar"
        className="mb-4"
        aside={rows.length > 0 ? <span className="text-xs text-slate">{rows.length} enabled</span> : null}
      >
        {rows.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No reports are scheduled yet."
            action={<Link className="btn-ghost" href="/clients">View clients</Link>}
          >
            {canEdit ? "Open a client report and configure its monthly schedule." : "A manager can configure monthly schedules from a client report."}
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Next run</th>
                  <th>Client / report</th>
                  <th>Data included</th>
                  <th>Coverage</th>
                  <th>Search setup</th>
                  <th>Latest</th>
                  <th><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((project) => {
                  const href = canEdit ? `/projects/${project.id}#schedule` : `/clients/${project.clientId}?project=${project.id}`;
                  const searchTypes = project.scheduleSearchTypes.filter((type) => type !== "local_finder");
                  const latest = project.reportExecutions[0];
                  const hasRankings = hasRankTracking(project.reportModules) || project.scheduleSearchTypes.includes("maps");
                  const openLabel = canEdit ? `Edit ${project.name}` : `View ${project.name}`;
                  return (
                    <tr key={project.id}>
                      <td className="whitespace-nowrap">
                        <span className="font-medium">{formatDate(project.nextRun)}</span>
                        <span className="table-sub">Day {project.scheduleDay} monthly</span>
                      </td>
                      <td>
                        <Link href={href} className="font-medium hover:text-accent hover:underline whitespace-nowrap">{project.client.name} / {project.name}</Link>
                        <span className="table-sub">{project.domain}</span>
                      </td>
                      <td>
                        <ModuleList
                          modules={project.reportModules}
                          gscMapped={Boolean(project.gscPropertyUrl)}
                          legacyMaps={project.scheduleSearchTypes.includes("maps")}
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        {hasRankings ? (
                          <>
                            <span className="font-medium">{project._count.keywords}</span> keywords
                            <span className="table-sub">{plural(project._count.locations, "area")}</span>
                          </>
                        ) : (
                          <span className="text-slate">Search Console only</span>
                        )}
                      </td>
                      <td>
                        {hasRankings ? (
                          <>
                            {project.scheduleDevices.map(readableValue).join(" + ")}
                            <span className="table-sub">{searchTypes.map(readableValue).join(" + ")} · {plural(project.schedulePageLimit, "result page")}</span>
                          </>
                        ) : (
                          <span className="text-slate">Not applicable</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">{latest ? <StatusPill status={latest.status} /> : <span className="text-slate">Not run yet</span>}</td>
                      <td className="text-right">
                        <Link className="btn-icon" href={href} title={openLabel}>
                          <Icon name={canEdit ? "cog" : "eye"} className="w-4 h-4" title={openLabel} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </SectionCard>

      <SectionCard
        title="Automated activity"
        subtitle="Recent scheduled reports"
        icon="refresh"
        aside={executions.length > 0 ? <span className="text-xs text-slate">Latest {executions.length}</span> : null}
      >
        {executions.length === 0 ? (
          <EmptyState compact icon="clock" title="No automated reports have run yet.">
            The worker will record each selected data source here on the next scheduled date.
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Scheduled</th>
                  <th>Client / report</th>
                  <th>Overall</th>
                  <th>Data results</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((execution) => (
                  <tr key={execution.id}>
                    <td className="whitespace-nowrap">
                      <span className="font-medium">{formatDate(execution.scheduledFor)}</span>
                      <span className="table-sub">{formatDate(execution.scheduledFor, { month: "long", year: "numeric" })}</span>
                    </td>
                    <td>
                      <Link
                        href={`/clients/${execution.project.clientId}?project=${execution.projectId}`}
                        className="font-medium hover:text-accent hover:underline whitespace-nowrap"
                      >
                        {execution.project.client.name} / {execution.project.name}
                      </Link>
                    </td>
                    <td><StatusPill status={execution.status} /></td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <ModuleOutcome
                          label={rankingModuleLabel(execution.modules)}
                          status={execution.rankingsStatus}
                          detail={canEdit ? execution.rankingsError : null}
                        />
                        <ModuleOutcome
                          label="Search Console"
                          status={execution.gscStatus}
                          detail={canEdit ? execution.gscError : null}
                          suffix={execution.gscStatus === "completed" ? `${execution.gscRowsImported} days` : undefined}
                        />
                        <ModuleOutcome label="Analytics" status={execution.ga4Status} detail={canEdit ? execution.ga4Error : null} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {execution.completedAt ? formatDate(execution.completedAt) : <span className="text-slate">In progress</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </SectionCard>
    </div>
  );
}

async function getScheduleData() {
  try {
    const [schedules, executions] = await Promise.all([
      prisma.project.findMany({
        where: { scheduleEnabled: true },
        orderBy: [{ scheduleDay: "asc" }, { name: "asc" }],
        include: {
          client: true,
          reportExecutions: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
          _count: { select: { keywords: { where: { active: true } }, locations: { where: { active: true } } } }
        }
      }),
      prisma.reportExecution.findMany({
        orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
        take: 30,
        include: { project: { include: { client: true } } }
      })
    ]);
    return { schedules, executions, dbUnavailable: false };
  } catch {
    return { schedules: [], executions: [], dbUnavailable: true };
  }
}

function ModuleList({ modules, gscMapped, legacyMaps }: { modules: string[]; gscMapped: boolean; legacyMaps: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {modules.includes("rankings") ? <StatusPill dot={false} className={SMALL_PILL}>SEO</StatusPill> : null}
      {modules.includes("maps") || legacyMaps ? <StatusPill dot={false} className={SMALL_PILL}>Maps</StatusPill> : null}
      {modules.includes("gsc") ? (
        <StatusPill dot={false} tone={gscMapped ? "accent" : "warn"} className={SMALL_PILL}>
          {gscMapped ? "Search Console" : "Search Console · needs mapping"}
        </StatusPill>
      ) : null}
      {modules.includes("ga4") ? <StatusPill dot={false} className={SMALL_PILL}>Analytics</StatusPill> : null}
    </div>
  );
}

function ModuleOutcome({ label, status, detail, suffix }: { label: string; status: string; detail?: string | null; suffix?: string }) {
  if (status === "not_selected") return null;
  return (
    <span title={detail ?? undefined}>
      <StatusPill tone={statusTone(status)} className={SMALL_PILL}>
        {label} · {readableValue(status)}{suffix ? ` · ${suffix}` : ""}
      </StatusPill>
    </span>
  );
}

function rankingModuleLabel(modules: string[]) {
  const seo = modules.includes("rankings");
  const maps = modules.includes("maps");
  if (seo && maps) return "SEO + Maps";
  if (maps) return "Maps";
  return "SEO";
}
