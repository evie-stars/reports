import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createReportSnapshot,
  createProject,
  disableClientShare,
  enableClientShare,
  regenerateClientShare,
  regenerateReportSnapshot,
  revokeReportSnapshot,
  queueProjectRerun,
  updateClient
} from "@/app/actions";
import { ClientReportDashboard } from "@/components/client-report-dashboard";
import { CopyShareLink } from "@/components/copy-share-link";
import { CopyShareButton } from "@/components/copy-share-button";
import { Icon } from "@/components/icon";
import { SnapshotCreateForm } from "@/components/snapshot-create-form";
import { SubmitButton } from "@/components/submit-button";
import { getClientReportData, type ReportSearchParams } from "@/lib/client-report";
import { canManageReports, currentActor } from "@/lib/access";
import { prisma } from "@/lib/db";
import { estimateRankRunCost } from "@/lib/dataforseo-costs";
import { enabledRankSearchTypes, hasRankTracking } from "@/lib/report-modules";
import { reportSnapshotStatus } from "@/lib/report-snapshot";
import type { AppRole } from "../../../../auth";

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
  if (settingsOpen && !canManageReports(actor.role)) redirect(`/clients/${clientId}`);
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      projects: {
        orderBy: { name: "asc" },
        include: {
          keywords: { where: { active: true }, select: { id: true } },
          locations: { where: { active: true }, select: { id: true } }
        }
      },
      reportSnapshots: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          slug: true,
          token: true,
          modules: true,
          expiresAt: true,
          revokedAt: true,
          createdByEmail: true,
          accessCount: true,
          lastAccessedAt: true,
          createdAt: true
        }
      }
    }
  });

  if (!client) notFound();
  const shareActive = Boolean(
    client.shareEnabled &&
    client.shareToken &&
    client.shareExpiresAt &&
    client.shareExpiresAt > new Date()
  );

  if (settingsOpen) {
    const updateClientWithId = updateClient.bind(null, client.id);
    const enableShareWithId = enableClientShare.bind(null, client.id);
    const disableShareWithId = disableClientShare.bind(null, client.id);
    const regenerateShareWithId = regenerateClientShare.bind(null, client.id);
    const createSnapshotWithId = createReportSnapshot.bind(null, client.id);
    const snapshotAvailability = {
      rankings: client.projects.some((project) => project.reportModules.includes("rankings")),
      maps: client.projects.some((project) => project.reportModules.includes("maps") || project.scheduleSearchTypes.includes("maps")),
      gsc: client.projects.some((project) => project.reportModules.includes("gsc") && Boolean(project.gscPropertyUrl) && project.gscImportedRows > 0)
    };

    return (
      <>
        <ClientHeader clientId={client.id} clientName={client.name} settingsOpen role={actor.role} />
        <section className="settings-panel">
          <div className="grid two">
            <form className="card form" action={updateClientWithId}>
              <p className="label label-with-icon"><Icon name="contacts" />Client Details</p>
              <label>Client name<input name="name" required defaultValue={client.name} /></label>
              <label>Notes<textarea name="notes" rows={4} defaultValue={client.notes ?? ""} /></label>
              <SubmitButton pendingLabel="Saving client...">Save Client</SubmitButton>
            </form>

            <form className="card form" action={createProject}>
              <p className="label label-with-icon"><Icon name="home" />New Report</p>
              <input type="hidden" name="clientId" value={client.id} />
              <label>Report name<input name="name" required placeholder="Main website" /></label>
              <label>Domain<input name="domain" required placeholder="example.co.uk" /></label>
              <label>Target business name<input name="targetBusinessName" placeholder="Example Local Business" /></label>
              <label>Service area<input name="serviceArea" placeholder="North West" /></label>
              <SubmitButton pendingLabel="Creating report...">Create Report</SubmitButton>
            </form>
          </div>

          <section className="card spaced-section snapshot-settings" id="report-snapshots">
            <div className="section-heading snapshot-heading">
              <div>
                <p className="label label-with-icon"><Icon name="graph" />One-off Client Reports</p>
                <h3>Frozen report snapshots</h3>
                <p className="muted">Create a private client-facing report from the data stored right now. It will not change as new checks arrive.</p>
              </div>
              <span className="snapshot-count">{client.reportSnapshots.length} recent</span>
            </div>

            <SnapshotCreateForm action={createSnapshotWithId} availability={snapshotAvailability} />

            {client.reportSnapshots.length > 0 ? (
              <div className="table-scroll snapshot-table-wrap">
                <table className="table snapshot-table">
                  <thead><tr><th>Created</th><th>Content</th><th>Status</th><th>Activity</th><th>Private link</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {client.reportSnapshots.map((snapshot) => {
                      const status = reportSnapshotStatus(snapshot);
                      const regenerateSnapshot = regenerateReportSnapshot.bind(null, snapshot.id);
                      const revokeSnapshot = revokeReportSnapshot.bind(null, snapshot.id);
                      const path = `/share/${snapshot.slug}/${snapshot.token}`;
                      return (
                        <tr key={snapshot.id}>
                          <td><strong>{snapshot.createdAt.toLocaleDateString("en-GB")}</strong><small>{snapshot.createdByEmail}</small></td>
                          <td><span className="snapshot-modules">{snapshot.modules.map(snapshotModuleLabel).join(" + ")}</span></td>
                          <td><span className={`status ${status === "active" ? "good" : status === "expired" ? "warn" : "danger"}`}>{status}</span><small>{status === "active" ? `Expires ${snapshot.expiresAt.toLocaleDateString("en-GB")}` : "Link unavailable"}</small></td>
                          <td><strong>{snapshot.accessCount} view{snapshot.accessCount === 1 ? "" : "s"}</strong><small>{snapshot.lastAccessedAt ? `Last ${snapshot.lastAccessedAt.toLocaleDateString("en-GB")}` : "Not opened yet"}</small></td>
                          <td>{status === "active" ? <CopyShareLink path={path} /> : <span className="muted">No active link</span>}</td>
                          <td><div className="snapshot-actions">
                              {status === "active" ? <a className="button button-secondary" href={path} target="_blank" rel="noreferrer">View</a> : null}
                              <form action={regenerateSnapshot}>
                                <input type="hidden" name="shareExpiryDays" value="30" />
                                <SubmitButton className="button button-secondary" confirmMessage="Refresh this snapshot with today’s stored data and replace its private link?" pendingLabel="Refreshing...">Refresh</SubmitButton>
                              </form>
                              {status === "active" ? <form action={revokeSnapshot}><SubmitButton className="button button-danger" confirmMessage="Revoke this snapshot link? It will stop working immediately." pendingLabel="Revoking...">Revoke</SubmitButton></form> : null}
                            </div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="snapshot-empty"><strong>No snapshots yet</strong><span>Create one when a client needs a fixed, time-limited report.</span></div>}
          </section>

          {actor.role === "admin" ? <section className="card spaced-section share-settings">
            <div>
              <p className="label label-with-icon"><Icon name="tags" />Client Access</p>
              <h3>Always-current report link</h3>
              <p className="muted">This private link always shows the latest stored client data. Viewers cannot edit settings or run checks.</p>
            </div>
            {shareActive && client.shareToken && client.shareExpiresAt ? (
              <div className="share-controls">
                <CopyShareLink path={`/share/${client.shareToken}`} />
                <span className="share-expiry">Expires {client.shareExpiresAt.toLocaleDateString("en-GB")}</span>
                <form className="share-renew-form" action={regenerateShareWithId}>
                  <ShareExpirySelect />
                  <SubmitButton className="button button-secondary" confirmMessage="Replace the current client link? The existing link will stop working." pendingLabel="Regenerating...">Regenerate</SubmitButton>
                </form>
                <form action={disableShareWithId}>
                  <SubmitButton className="button button-danger" confirmMessage="Revoke this client link? Anyone using it will immediately lose access." pendingLabel="Revoking...">Revoke Link</SubmitButton>
                </form>
              </div>
            ) : (
              <form className="share-renew-form" action={enableShareWithId}>
                <ShareExpirySelect />
                <button className="button" type="submit">Create Read-only Link</button>
              </form>
            )}
          </section> : null}

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
        projects={client.projects.filter((project) => hasRankTracking(project.reportModules) || project.scheduleSearchTypes.includes("maps")).map((project) => ({
          id: project.id,
          name: project.name,
          estimatedCostUsd: estimateRankRunCost({
            keywordCount: project.keywords.length,
            locationCount: project.locations.length,
            devices: project.scheduleDevices,
            searchTypes: enabledRankSearchTypes(project.reportModules, project.scheduleSearchTypes),
            pageLimit: project.schedulePageLimit
          }, "standard")
        }))}
        role={actor.role}
        shareEnabled={shareActive}
        shareToken={client.shareToken}
      />
      {resolvedSearchParams.queueError ? <div className="notice danger-notice"><strong>Report not queued.</strong> {resolvedSearchParams.queueError}</div> : null}
      <ClientReportDashboard data={reportData} basePath={`/clients/${client.id}`} />
    </>
  );
}

function ShareExpirySelect({ label = "Link lifetime" }: { label?: string }) {
  return (
    <label className="share-expiry-select">
      {label}
      <select name="shareExpiryDays" defaultValue="30">
        <option value="7">7 days</option>
        <option value="30">30 days</option>
        <option value="90">90 days</option>
        <option value="365">1 year</option>
      </select>
    </label>
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
  projects?: Array<{ id: string; name: string; estimatedCostUsd: number }>;
  role: AppRole;
  settingsOpen?: boolean;
  shareEnabled?: boolean;
  shareToken?: string | null;
}) {
  const queueRerun = queueProjectRerun.bind(null, clientId);
  const enableShare = enableClientShare.bind(null, clientId);
  return (
    <header className="page-header client-report-header">
      <div>
        <h2>{clientName}</h2>
        <p>{settingsOpen ? "Client and report settings" : "Local search performance report"}</p>
      </div>
      <div className="page-header-actions">
        {!settingsOpen && canManageReports(role) ? <Link className="button button-secondary" href={`/clients/${clientId}?view=settings#report-snapshots`}>Create Snapshot</Link> : null}
        {!settingsOpen && role === "admin" && shareEnabled && shareToken ? <CopyShareButton path={`/share/${shareToken}`} /> : null}
        {!settingsOpen && !shareEnabled && role === "admin" ? (
          <form action={enableShare}><button className="button button-secondary" type="submit">Create Client Link</button></form>
        ) : null}
        {!settingsOpen && projects.length > 0 ? (
          <form className="rerun-form" action={queueRerun}>
            {projects.length === 1 ? (
              <>
                <input type="hidden" name="projectId" value={projects[0].id} />
                {role !== "team" ? <span className="rerun-estimate">Est. ${projects[0].estimatedCostUsd.toFixed(4)}</span> : null}
              </>
            ) : (
              <select name="projectId" aria-label="Report to re-run" required>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}{role !== "team" ? ` · est. $${project.estimatedCostUsd.toFixed(4)}` : ""}</option>)}
              </select>
            )}
            <button className="button" type="submit">Queue Re-run</button>
          </form>
        ) : null}
        {canManageReports(role) ? (
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

function snapshotModuleLabel(module: string) {
  if (module === "rankings") return "SEO";
  if (module === "maps") return "Maps";
  if (module === "gsc") return "Search Console";
  return "Analytics";
}
