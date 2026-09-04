import Link from "next/link";
import { Icon } from "@/components/icon";
import { canManageReports, currentActor } from "@/lib/access";
import { prisma } from "@/lib/db";
import { nextScheduleDate, scheduleDateIsWithin } from "@/lib/schedules";

export const dynamic = "force-dynamic";

export default async function ScheduledPage() {
  const actor = await currentActor();
  const canEdit = canManageReports(actor.role);
  const { schedules, dbUnavailable } = await getSchedules();
  const rows = schedules
    .map((project) => ({ ...project, nextRun: nextScheduleDate(project.scheduleDay) }))
    .sort((left, right) => left.nextRun.getTime() - right.nextRun.getTime());
  const nextSevenDays = rows.filter((row) => scheduleDateIsWithin(row.nextRun, 7)).length;
  const trackedKeywords = rows.reduce((total, row) => total + row._count.keywords, 0);
  const gscReports = rows.filter((row) => row.reportModules.includes("gsc")).length;

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Scheduled</h2>
          <p>Upcoming automated reports and the data each one will include.</p>
        </div>
      </header>

      {dbUnavailable ? <div className="notice"><strong>Database not connected yet.</strong> Scheduled reports will appear here once the database is available.</div> : null}

      <section className="summary-strip" aria-label="Schedule summary">
        <Summary label="Scheduled Reports" value={rows.length} />
        <Summary label="Next 7 Days" value={nextSevenDays} />
        <Summary label="Tracked Keywords" value={trackedKeywords} />
        <Summary label="With Search Console" value={gscReports} />
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
                <tr>
                  <th>Next Run</th>
                  <th>Client / Report</th>
                  <th>Data Included</th>
                  <th>Coverage</th>
                  <th>Search Setup</th>
                  <th><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((project) => {
                  const href = canEdit ? `/projects/${project.id}#schedule` : `/clients/${project.clientId}?project=${project.id}`;
                  const searchTypes = project.scheduleSearchTypes.filter((type) => type !== "local_finder");
                  return (
                    <tr key={project.id}>
                      <td><strong>{project.nextRun.toLocaleDateString("en-GB")}</strong><small className="row-context">Day {project.scheduleDay} monthly</small></td>
                      <td><Link href={href}>{project.client.name} / {project.name}</Link><small className="row-context">{project.domain}</small></td>
                      <td><ModuleList modules={project.reportModules} gscMapped={Boolean(project.gscPropertyUrl)} /></td>
                      <td><strong>{project._count.keywords}</strong> keywords<small className="row-context">{project._count.locations} area{project._count.locations === 1 ? "" : "s"}</small></td>
                      <td>{project.scheduleDevices.map(readableValue).join(" + ")}<small className="row-context">{searchTypes.map(readableValue).join(" + ")} · {project.schedulePageLimit} organic page{project.schedulePageLimit === 1 ? "" : "s"}</small></td>
                      <td className="table-action-cell"><Link className="icon-button" href={href} title={canEdit ? `Edit ${project.name}` : `View ${project.name}`}><Icon name={canEdit ? "edit" : "graph"} label={canEdit ? `Edit ${project.name}` : `View ${project.name}`} /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

async function getSchedules() {
  try {
    const schedules = await prisma.project.findMany({
      where: { scheduleEnabled: true },
      orderBy: [{ scheduleDay: "asc" }, { name: "asc" }],
      include: {
        client: true,
        _count: {
          select: {
            keywords: { where: { active: true } },
            locations: { where: { active: true } }
          }
        }
      }
    });
    return { schedules, dbUnavailable: false };
  } catch {
    return { schedules: [], dbUnavailable: true };
  }
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function ModuleList({ modules, gscMapped }: { modules: string[]; gscMapped: boolean }) {
  return (
    <div className="module-list">
      {modules.includes("rankings") ? <span>SEO Rankings</span> : null}
      {modules.includes("gsc") ? <span className={gscMapped ? undefined : "warning"}>Search Console{gscMapped ? "" : " · needs mapping"}</span> : null}
      {modules.includes("ga4") ? <span>Analytics</span> : null}
    </div>
  );
}

function readableValue(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
