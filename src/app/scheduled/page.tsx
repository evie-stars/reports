import Link from "next/link";
import { Icon } from "@/components/icon";
import { canManageReports, currentActor } from "@/lib/access";
import { prisma } from "@/lib/db";
import { nextScheduleDate, scheduleDateIsWithin } from "@/lib/schedules";
import { hasRankTracking } from "@/lib/report-modules";

export const dynamic = "force-dynamic";

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
    <>
      <header className="page-header">
        <div>
          <h2>Scheduled</h2>
          <p>Upcoming automated reports and the outcome of each data source.</p>
        </div>
      </header>

      {dbUnavailable ? <div className="notice"><strong>Database not connected yet.</strong> Scheduled reports will appear here once the database is available.</div> : null}

      <section className="summary-strip" aria-label="Schedule summary">
        <Summary label="Scheduled Reports" value={rows.length} />
        <Summary label="Next 7 Days" value={nextSevenDays} />
        <Summary label="With Search Console" value={gscReports} />
        <Summary label="Needs Attention" value={needsAttention} />
      </section>

      <section className="card spaced-section scheduled-table-card">
        <div className="section-heading compact-heading">
          <div>
            <p className="label label-with-icon"><Icon name="calendar" />Report Calendar</p>
            <h3>Monthly reporting plan</h3>
          </div>
          {rows.length > 0 ? <span className="muted">{rows.length} enabled</span> : null}
        </div>
        {rows.length === 0 ? (
          <div className="schedule-empty-state">
            <strong>No reports are scheduled yet.</strong>
            <p className="muted">{canEdit ? "Open a client report and configure its monthly schedule." : "A manager can configure monthly schedules from a client report."}</p>
            <Link className="button button-secondary" href="/clients">View Clients</Link>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table scheduled-table">
              <thead>
                <tr><th>Next Run</th><th>Client / Report</th><th>Data Included</th><th>Coverage</th><th>Search Setup</th><th>Latest</th><th><span className="sr-only">Open</span></th></tr>
              </thead>
              <tbody>
                {rows.map((project) => {
                  const href = canEdit ? `/projects/${project.id}#schedule` : `/clients/${project.clientId}?project=${project.id}`;
                  const searchTypes = project.scheduleSearchTypes.filter((type) => type !== "local_finder");
                  const latest = project.reportExecutions[0];
                  const hasRankings = hasRankTracking(project.reportModules) || project.scheduleSearchTypes.includes("maps");
                  return (
                    <tr key={project.id}>
                      <td><strong>{project.nextRun.toLocaleDateString("en-GB")}</strong><small className="row-context">Day {project.scheduleDay} monthly</small></td>
                      <td><Link href={href}>{project.client.name} / {project.name}</Link><small className="row-context">{project.domain}</small></td>
                      <td><ModuleList modules={project.reportModules} gscMapped={Boolean(project.gscPropertyUrl)} legacyMaps={project.scheduleSearchTypes.includes("maps")} /></td>
                      <td>{hasRankings ? <><strong>{project._count.keywords}</strong> keywords<small className="row-context">{project._count.locations} area{project._count.locations === 1 ? "" : "s"}</small></> : <span className="muted">Search Console only</span>}</td>
                      <td>{hasRankings ? <>{project.scheduleDevices.map(readableValue).join(" + ")}<small className="row-context">{searchTypes.map(readableValue).join(" + ")} · {project.schedulePageLimit} result page{project.schedulePageLimit === 1 ? "" : "s"}</small></> : <span className="muted">Not applicable</span>}</td>
                      <td>{latest ? <ExecutionStatus status={latest.status} /> : <span className="muted">Not run yet</span>}</td>
                      <td className="table-action-cell"><Link className="icon-button" href={href} title={canEdit ? `Edit ${project.name}` : `View ${project.name}`}><Icon name={canEdit ? "edit" : "graph"} label={canEdit ? `Edit ${project.name}` : `View ${project.name}`} /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card spaced-section scheduled-history-card">
        <div className="section-heading compact-heading">
          <div>
            <p className="label label-with-icon"><Icon name="graph" />Automated Activity</p>
            <h3>Recent scheduled reports</h3>
          </div>
          {executions.length > 0 ? <span className="muted">Latest {executions.length}</span> : null}
        </div>
        {executions.length === 0 ? (
          <div className="schedule-empty-state compact-empty-section">
            <strong>No automated reports have run yet.</strong>
            <p className="muted">The worker will record each selected data source here on the next scheduled date.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="table execution-table">
              <thead><tr><th>Scheduled</th><th>Client / Report</th><th>Overall</th><th>Data Results</th><th>Finished</th></tr></thead>
              <tbody>
                {executions.map((execution) => (
                  <tr key={execution.id}>
                    <td><strong>{execution.scheduledFor.toLocaleDateString("en-GB")}</strong><small className="row-context">{execution.scheduledFor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</small></td>
                    <td><Link href={`/clients/${execution.project.clientId}?project=${execution.projectId}`}>{execution.project.client.name} / {execution.project.name}</Link></td>
                    <td><ExecutionStatus status={execution.status} /></td>
                    <td><div className="execution-modules"><ModuleOutcome label={rankingModuleLabel(execution.modules)} status={execution.rankingsStatus} detail={canEdit ? execution.rankingsError : null} /><ModuleOutcome label="Search Console" status={execution.gscStatus} detail={canEdit ? execution.gscError : null} suffix={execution.gscStatus === "completed" ? `${execution.gscRowsImported} days` : undefined} /><ModuleOutcome label="Analytics" status={execution.ga4Status} detail={canEdit ? execution.ga4Error : null} /></div></td>
                    <td>{execution.completedAt ? execution.completedAt.toLocaleDateString("en-GB") : <span className="muted">In progress</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
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

function Summary({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function ModuleList({ modules, gscMapped, legacyMaps }: { modules: string[]; gscMapped: boolean; legacyMaps: boolean }) {
  return <div className="module-list">{modules.includes("rankings") ? <span>SEO</span> : null}{modules.includes("maps") || legacyMaps ? <span>Maps</span> : null}{modules.includes("gsc") ? <span className={gscMapped ? undefined : "warning"}>Search Console{gscMapped ? "" : " · needs mapping"}</span> : null}{modules.includes("ga4") ? <span>Analytics</span> : null}</div>;
}

function ExecutionStatus({ status }: { status: string }) {
  return <span className={`status ${executionStatusTone(status)}`}>{readableValue(status)}</span>;
}

function ModuleOutcome({ label, status, detail, suffix }: { label: string; status: string; detail?: string | null; suffix?: string }) {
  if (status === "not_selected") return null;
  return <span className={`execution-module ${executionStatusTone(status)}`} title={detail ?? undefined}><strong>{label}</strong> {readableValue(status)}{suffix ? ` · ${suffix}` : ""}</span>;
}

function executionStatusTone(status: string) {
  if (status === "completed") return "good";
  if (status === "failed" || status === "blocked") return "danger";
  return "warn";
}

function rankingModuleLabel(modules: string[]) {
  const seo = modules.includes("rankings");
  const maps = modules.includes("maps");
  if (seo && maps) return "SEO + Maps";
  if (maps) return "Maps";
  return "SEO";
}

function readableValue(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
