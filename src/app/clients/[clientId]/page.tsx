import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createProject,
  disableClientShare,
  enableClientShare,
  updateClient
} from "@/app/actions";
import { ClientReportDashboard } from "@/components/client-report-dashboard";
import { CopyShareLink } from "@/components/copy-share-link";
import { Icon } from "@/components/icon";
import { getClientReportData, type ReportSearchParams } from "@/lib/client-report";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type ClientPageSearchParams = ReportSearchParams & { view?: string };

export default async function ClientDetailPage({ params, searchParams }: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<ClientPageSearchParams>;
}) {
  const { clientId } = await params;
  const resolvedSearchParams = await searchParams;
  const settingsOpen = resolvedSearchParams.view === "settings";
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
        <ClientHeader clientId={client.id} clientName={client.name} settingsOpen />
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
      <ClientHeader clientId={client.id} clientName={client.name} />
      <ClientReportDashboard data={reportData} basePath={`/clients/${client.id}`} />
    </>
  );
}

function ClientHeader({ clientId, clientName, settingsOpen = false }: { clientId: string; clientName: string; settingsOpen?: boolean }) {
  return (
    <header className="page-header client-report-header">
      <div>
        <p className="breadcrumb"><Link href="/clients">Clients</Link> / {clientName}</p>
        <h2>{clientName}</h2>
        <p>{settingsOpen ? "Client and report settings" : "Local search performance report"}</p>
      </div>
      <Link
        className={settingsOpen ? "button button-secondary" : "icon-text-button"}
        href={settingsOpen ? `/clients/${clientId}` : `/clients/${clientId}?view=settings`}
        title={settingsOpen ? "Return to report" : "Edit report settings"}
      >
        {!settingsOpen ? <Icon name="edit" /> : null}
        {settingsOpen ? "View Report" : "Edit Report"}
      </Link>
    </header>
  );
}
