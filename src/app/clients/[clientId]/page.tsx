import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createProject,
  disableClientShare,
  enableClientShare,
  queueProjectRerun,
  updateClient
} from "@/app/actions";
import { ClientReportDashboard } from "@/components/client-report-dashboard";
import { CopyShareLink } from "@/components/copy-share-link";
import { CopyShareButton } from "@/components/copy-share-button";
import { Icon } from "@/components/icon";
import { getClientReportData, type ReportSearchParams } from "@/lib/client-report";
import { currentActor } from "@/lib/access";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type ClientPageSearchParams = ReportSearchParams & { view?: string; queueError?: string };

export default async function ClientDetailPage({ params, searchParams }: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<ClientPageSearchParams>;
}) {
  const { clientId } = await params;
  const resolvedSearchParams = await searchParams;
  const actor = await currentActor();
  const settingsOpen = resolvedSearchParams.view === "settings";
  if (settingsOpen && actor.role !== "admin") redirect(`/clients/${clientId}`);
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      projects: {
        orderBy: { name: "asc" },
        include: {
          keywords: { where: { active: true }, select: { id: true } },
          locations: { where: { active: true }, select: { id: true } }
        }
      }
    }
  });

  if (!client) notFound();

  if (settingsOpen) {
    const updateClientWithId = updateClient.bind(null, client.id);
    const enableShareWithId = enableClientShare.bind(null, client.id);
    const disableShareWithId = disableClientShare.bind(null, client.id);

    return (
      <>
        <ClientHeader clientId={client.id} clientName={client.name} settingsOpen role={actor.role} />
        <section className="settings-panel">
          <div className="grid two">
            <form className="card form" action={updateClientWithId}>
              <p className="label label-with-icon"><Icon name="contacts" />Client Details</p>
              <label>Client name<input name="name" required defaultValue={client.name} /></label>
              <label>Notes<textarea name="notes" rows={4} defaultValue={client.notes ?? ""} /></label>
              <button className="button" type="submit">Save Client</button>
            </form>

            <form className="card form" action={createProject}>
              <p className="label label-with-icon"><Icon name="home" />New Report</p>
              <input type="hidden" name="clientId" value={client.id} />
              <label>Report name<input name="name" required placeholder="Main website" /></label>
              <label>Domain<input name="domain" required placeholder="example.co.uk" /></label>
              <label>Target business name<input name="targetBusinessName" placeholder="Example Local Business" /></label>
              <label>Service area<input name="serviceArea" placeholder="North West" /></label>
              <button className="button" type="submit">Create Report</button>
            </form>
          </div>

          <section className="card spaced-section share-settings">
            <div>
              <p className="label label-with-icon"><Icon name="tags" />Client Access</p>
              <h3>Read-only report link</h3>
              <p className="muted">Anyone with this private link can view the client report. They cannot edit settings or run checks.</p>
            </div>
            {client.shareEnabled && client.shareToken ? (
              <div className="share-controls">
                <CopyShareLink path={`/share/${client.shareToken}`} />
                <form action={disableShareWithId}>
                  <button className="button button-secondary" type="submit">Revoke Link</button>
                </form>
              </div>
            ) : (
              <form action={enableShareWithId}>
                <button className="button" type="submit">Create Read-only Link</button>
              </form>
            )}
          </section>

          <section className="card spaced-section">
            <p className="label label-with-icon"><Icon name="settings" />Report Settings</p>
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Report</th><th>Domain</th><th>Keywords</th><th>Areas</th><th><span className="sr-only">Edit</span></th></tr></thead>
                <tbody>
                  {client.projects.map((project) => (
                    <tr key={project.id}>
                      <td><Link href={`/projects/${project.id}`}>{project.name}</Link></td>
                      <td>{project.domain}</td>
                      <td>{project.keywords.length}</td>
                      <td>{project.locations.length}</td>
                      <td className="table-action-cell">
                        <Link className="icon-button" href={`/projects/${project.id}`} title={`Edit ${project.name}`}>
                          <Icon name="edit" label={`Edit ${project.name}`} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {client.projects.length === 0 ? <tr><td className="empty-table" colSpan={5}>No reports have been created yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </>
    );
  }

  const reportData = await getClientReportData(client.id, resolvedSearchParams);
  if (!reportData) notFound();

  return (
    <>
      <ClientHeader
        clientId={client.id}
        clientName={client.name}
        projects={client.projects.map(({ id, name }) => ({ id, name }))}
        role={actor.role}
        shareEnabled={client.shareEnabled}
        shareToken={client.shareToken}
      />
      {resolvedSearchParams.queueError ? <div className="notice danger-notice"><strong>Report not queued.</strong> {resolvedSearchParams.queueError}</div> : null}
      <ClientReportDashboard data={reportData} basePath={`/clients/${client.id}`} />
    </>
  );
}

function ClientHeader({
  clientId,
  clientName,
  projects = [],
  role,
  settingsOpen = false,
  shareEnabled = false,
  shareToken = null
}: {
  clientId: string;
  clientName: string;
  projects?: Array<{ id: string; name: string }>;
  role: "admin" | "sales";
  settingsOpen?: boolean;
  shareEnabled?: boolean;
  shareToken?: string | null;
}) {
  const queueRerun = queueProjectRerun.bind(null, clientId);
  const enableShare = enableClientShare.bind(null, clientId);
  return (
    <header className="page-header client-report-header">
      <div>
        <p className="breadcrumb"><Link href="/clients">Clients</Link> / {clientName}</p>
        <h2>{clientName}</h2>
        <p>{settingsOpen ? "Client and report settings" : "Local search performance report"}</p>
      </div>
      <div className="page-header-actions">
        {!settingsOpen && shareEnabled && shareToken ? <CopyShareButton path={`/share/${shareToken}`} /> : null}
        {!settingsOpen && !shareEnabled && role === "admin" ? (
          <form action={enableShare}><button className="button button-secondary" type="submit">Create Client Link</button></form>
        ) : null}
        {!settingsOpen && projects.length > 0 ? (
          <form className="rerun-form" action={queueRerun}>
            {projects.length === 1 ? <input type="hidden" name="projectId" value={projects[0].id} /> : (
              <select name="projectId" aria-label="Report to re-run" required>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            )}
            <button className="button" type="submit">Queue Re-run</button>
          </form>
        ) : null}
        {role === "admin" ? (
          <Link
            className={settingsOpen ? "button button-secondary" : "icon-text-button"}
            href={settingsOpen ? `/clients/${clientId}` : `/clients/${clientId}?view=settings`}
            title={settingsOpen ? "Return to report" : "Edit report settings"}
          >
            {!settingsOpen ? <Icon name="edit" /> : null}
            {settingsOpen ? "View Report" : "Edit Report"}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
