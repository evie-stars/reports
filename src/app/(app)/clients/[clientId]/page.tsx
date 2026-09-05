import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createReportSnapshot,
  disableClientShare,
  enableClientShare,
  regenerateClientShare,
  regenerateReportSnapshot,
  revokeReportSnapshot,
  updateClient
} from "@/actions/clients";
import { createProject } from "@/actions/projects";
import { queueProjectRerun } from "@/actions/reports";
import { ClientReportDashboard } from "@/components/client-report-dashboard";
import { Icon } from "@/components/icon";
import { SnapshotCreateForm } from "@/components/snapshot-create-form";
import { SubmitButton } from "@/components/submit-button";
import { CopyLink } from "@/components/ui/copy-link";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { getClientReportData, type ReportSearchParams } from "@/lib/client-report";
import { canManageReports, currentActor } from "@/lib/access";
import { prisma } from "@/lib/db";
import { estimateRankRunCost } from "@/lib/dataforseo-costs";
import { formatDate, formatUsd, plural } from "@/lib/format";
import { enabledRankSearchTypes, hasRankTracking } from "@/lib/report-modules";
import { reportSnapshotStatus } from "@/lib/report-snapshot";
import type { AppRole } from "@/lib/roles";

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
      gsc: client.projects.some((project) => project.reportModules.includes("gsc") && Boolean(project.gscPropertyUrl) && project.gscImportedRows > 0),
      ga4: client.projects.some((project) => project.reportModules.includes("ga4") && Boolean(project.ga4PropertyId) && project.ga4ImportedRows > 0)
    };

    return (
      <div>
        <PageHeader
          eyebrow="Client"
          title={client.name}
          subtitle="Client and report settings"
          actions={<ClientActions clientId={client.id} clientName={client.name} settingsOpen role={actor.role} />}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <SectionCard title="Client details" icon="user">
            <form action={updateClientWithId} className="space-y-3">
              <label className="block">
                <span className="field-label">Client name</span>
                <input name="name" required defaultValue={client.name} className="field" />
              </label>
              <label className="block">
                <span className="field-label">Notes</span>
                <textarea name="notes" rows={4} defaultValue={client.notes ?? ""} className="field" />
              </label>
              <div className="flex justify-end">
                <SubmitButton pendingLabel="Saving client..."><Icon name="save" className="w-3.5 h-3.5" />Save client</SubmitButton>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="New report" icon="add-circle">
            <form action={createProject} className="space-y-3">
              <input type="hidden" name="clientId" value={client.id} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="field-label">Report name</span>
                  <input name="name" required placeholder="Main website" className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Domain</span>
                  <input name="domain" required placeholder="example.co.uk" className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Target business name</span>
                  <input name="targetBusinessName" placeholder="Example Local Business" className="field" />
                </label>
                <label className="block">
                  <span className="field-label">Service area</span>
                  <input name="serviceArea" placeholder="North West" className="field" />
                </label>
              </div>
              <div className="flex justify-end">
                <SubmitButton pendingLabel="Creating report..."><Icon name="add" className="w-3.5 h-3.5" />Create report</SubmitButton>
              </div>
            </form>
          </SectionCard>
        </div>

        <SectionCard
          id="report-snapshots"
          title="One-off client reports"
          subtitle="Create a private client-facing report from the data stored right now. It will not change as new checks arrive."
          icon="lock"
          className="mb-4"
          aside={<StatusPill tone="default" dot={false}>{client.reportSnapshots.length} recent</StatusPill>}
        >
          <SnapshotCreateForm action={createSnapshotWithId} availability={snapshotAvailability} />

          {client.reportSnapshots.length > 0 ? (
            <TableWrap className="mt-4">
              <table className="table">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Content</th>
                    <th>Status</th>
                    <th>Activity</th>
                    <th>Private link</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {client.reportSnapshots.map((snapshot) => {
                    const status = reportSnapshotStatus(snapshot);
                    const regenerateSnapshot = regenerateReportSnapshot.bind(null, snapshot.id);
                    const revokeSnapshot = revokeReportSnapshot.bind(null, snapshot.id);
                    const path = `/share/${snapshot.slug}/${snapshot.token}`;
                    return (
                      <tr key={snapshot.id}>
                        <td className="whitespace-nowrap">
                          <span className="font-medium">{formatDate(snapshot.createdAt)}</span>
                          <span className="table-sub">{snapshot.createdByEmail}</span>
                        </td>
                        <td className="whitespace-nowrap">{snapshot.modules.map(snapshotModuleLabel).join(" + ")}</td>
                        <td className="whitespace-nowrap">
                          <StatusPill status={status} />
                          <span className="table-sub">{status === "active" ? `Expires ${formatDate(snapshot.expiresAt)}` : "Link unavailable"}</span>
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="font-medium">{plural(snapshot.accessCount, "view")}</span>
                          <span className="table-sub">{snapshot.lastAccessedAt ? `Last ${formatDate(snapshot.lastAccessedAt)}` : "Not opened yet"}</span>
                        </td>
                        <td className="min-w-[18rem]">
                          {status === "active" ? <CopyLink path={path} variant="field" /> : <span className="text-slate">No active link</span>}
                        </td>
                        <td className="text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {status === "active" ? (
                              <a className="btn-ghost" href={path} target="_blank" rel="noreferrer"><Icon name="eye" className="w-3.5 h-3.5" />View</a>
                            ) : null}
                            <form action={regenerateSnapshot}>
                              <input type="hidden" name="shareExpiryDays" value="30" />
                              <SubmitButton className="btn-ghost" confirmMessage="Refresh this snapshot with today’s stored data and replace its private link?" pendingLabel="Refreshing...">
                                <Icon name="refresh" className="w-3.5 h-3.5" />Refresh
                              </SubmitButton>
                            </form>
                            {status === "active" ? (
                              <form action={revokeSnapshot}>
                                <SubmitButton className="btn-danger" confirmMessage="Revoke this snapshot link? It will stop working immediately." pendingLabel="Revoking...">Revoke</SubmitButton>
                              </form>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState compact icon="lock" title="No snapshots yet">Create one when a client needs a fixed, time-limited report.</EmptyState>
          )}
        </SectionCard>

        {actor.role === "admin" ? (
          <SectionCard
            title="Client access"
            subtitle="This private link always shows the latest stored client data. Viewers cannot edit settings or run checks."
            icon="unlock"
            className="mb-4"
            aside={shareActive ? <StatusPill status="active">Link active</StatusPill> : <StatusPill tone="default">No link</StatusPill>}
          >
            {shareActive && client.shareToken && client.shareExpiresAt ? (
              <div className="space-y-3">
                <CopyLink path={`/share/${client.shareToken}`} variant="field" className="max-w-2xl" />
                <p className="text-xs text-slate">Expires {formatDate(client.shareExpiresAt)}</p>
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <form action={regenerateShareWithId} className="flex flex-col sm:flex-row sm:items-end gap-2">
                    <ShareExpirySelect />
                    <SubmitButton className="btn-ghost" confirmMessage="Replace the current client link? The existing link will stop working." pendingLabel="Regenerating...">
                      <Icon name="refresh" className="w-3.5 h-3.5" />Regenerate
                    </SubmitButton>
                  </form>
                  <form action={disableShareWithId}>
                    <SubmitButton className="btn-danger" confirmMessage="Revoke this client link? Anyone using it will immediately lose access." pendingLabel="Revoking...">Revoke link</SubmitButton>
                  </form>
                </div>
              </div>
            ) : (
              <form action={enableShareWithId} className="flex flex-col sm:flex-row sm:items-end gap-2">
                <ShareExpirySelect />
                <button className="btn-primary" type="submit"><Icon name="unlock" className="w-3.5 h-3.5" />Create read-only link</button>
              </form>
            )}
          </SectionCard>
        ) : null}

        <SectionCard title="Reports" subtitle="Open a report to manage keywords, areas and schedules." icon="drawer">
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Report</th><th>Domain</th><th>Keywords</th><th>Areas</th><th><span className="sr-only">Edit</span></th></tr>
              </thead>
              <tbody>
                {client.projects.map((project) => (
                  <tr key={project.id}>
                    <td><Link className="font-medium hover:text-accent hover:underline" href={`/projects/${project.id}`}>{project.name}</Link></td>
                    <td className="text-slate">{project.domain}</td>
                    <td>{project.keywords.length}</td>
                    <td>{project.locations.length}</td>
                    <td className="text-right">
                      <Link className="btn-icon" href={`/projects/${project.id}`} title={`Edit ${project.name}`}>
                        <Icon name="cog" className="w-4 h-4" title={`Edit ${project.name}`} />
                      </Link>
                    </td>
                  </tr>
                ))}
                {client.projects.length === 0 ? <EmptyRow colSpan={5}>No reports have been created yet.</EmptyRow> : null}
              </tbody>
            </table>
          </TableWrap>
        </SectionCard>
      </div>
    );
  }

  const reportData = await getClientReportData(client.id, resolvedSearchParams);
  if (!reportData) notFound();

  return (
    <div>
      <PageHeader
        eyebrow="Client"
        title={client.name}
        subtitle="Local search performance report"
        actions={
          <ClientActions
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
        }
      />
      {resolvedSearchParams.queueError ? <Notice tone="danger" title="Report not queued.">{resolvedSearchParams.queueError}</Notice> : null}
      <ClientReportDashboard data={reportData} basePath={`/clients/${client.id}`} />
    </div>
  );
}

function ShareExpirySelect({ label = "Link lifetime" }: { label?: string }) {
  return (
    <label className="block sm:w-44">
      <span className="field-label">{label}</span>
      <select name="shareExpiryDays" defaultValue="30" className="field">
        <option value="7">7 days</option>
        <option value="30">30 days</option>
        <option value="90">90 days</option>
        <option value="365">1 year</option>
      </select>
    </label>
  );
}

function ClientActions({
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
    <>
      {!settingsOpen && canManageReports(role) ? (
        <Link className="btn-ghost" href={`/clients/${clientId}?view=settings#report-snapshots`}>
          <Icon name="add" className="w-3.5 h-3.5" />Create snapshot
        </Link>
      ) : null}
      {!settingsOpen && role === "admin" && shareEnabled && shareToken ? <CopyLink path={`/share/${shareToken}`} label="Copy client link" /> : null}
      {!settingsOpen && !shareEnabled && role === "admin" ? (
        <form action={enableShare}>
          <button className="btn-ghost" type="submit"><Icon name="unlock" className="w-3.5 h-3.5" />Create client link</button>
        </form>
      ) : null}
      {!settingsOpen && projects.length > 0 ? (
        <form className="flex flex-wrap items-center gap-2" action={queueRerun}>
          {projects.length === 1 ? (
            <>
              <input type="hidden" name="projectId" value={projects[0].id} />
              {role !== "team" ? <span className="text-xs text-slate whitespace-nowrap">Est. {formatUsd(projects[0].estimatedCostUsd)}</span> : null}
            </>
          ) : (
            <select name="projectId" aria-label="Report to re-run" required className="field w-auto max-w-[16rem]">
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}{role !== "team" ? ` · est. ${formatUsd(project.estimatedCostUsd)}` : ""}
                </option>
              ))}
            </select>
          )}
          <button className="btn-primary" type="submit"><Icon name="refresh" className="w-3.5 h-3.5" />Queue re-run</button>
        </form>
      ) : null}
      {canManageReports(role) ? (
        <Link
          className="btn-ghost"
          href={settingsOpen ? `/clients/${clientId}` : `/clients/${clientId}?view=settings`}
          title={settingsOpen ? `Return to the ${clientName} report` : `Edit ${clientName} report settings`}
        >
          <Icon name={settingsOpen ? "eye" : "cog"} className="w-3.5 h-3.5" />
          {settingsOpen ? "View report" : "Edit report"}
        </Link>
      ) : null}
    </>
  );
}

function snapshotModuleLabel(module: string) {
  if (module === "rankings") return "SEO";
  if (module === "maps") return "Maps";
  if (module === "gsc") return "Search Console";
  return "Analytics";
}
