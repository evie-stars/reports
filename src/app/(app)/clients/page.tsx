import Link from "next/link";
import { createClient, importRankHistory } from "@/actions/clients";
import { requestReport } from "@/actions/reports";
import { ClientTable } from "@/components/client-table";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { canManageReports, currentActor } from "@/lib/access";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams
}: {
  searchParams: Promise<{ new?: string; import?: string; importError?: string; request?: string; requestSent?: string }>;
}) {
  const { new: showNewClient, import: showImport, importError, request: showRequest, requestSent } = await searchParams;
  const actor = await currentActor();
  const canEdit = canManageReports(actor.role);
  const canImport = actor.role === "admin";
  const { clients, dbUnavailable } = await getClientsData();

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="Open a client to view their latest report."
        actions={canEdit ? (
          <>
            {canImport ? (
              <Link className="btn-ghost" href={showImport ? "/clients" : "/clients?import=1"}>
                <Icon name="arrow-upload" className="w-3.5 h-3.5" />{showImport ? "Close import" : "Import history"}
              </Link>
            ) : null}
            <Link className="btn-primary" href={showNewClient ? "/clients" : "/clients?new=1"}>
              <Icon name={showNewClient ? "x" : "add"} className="w-3.5 h-3.5" />{showNewClient ? "Close" : "Add client"}
            </Link>
          </>
        ) : (
          <Link className="btn-primary" href={showRequest ? "/clients" : "/clients?request=1"}>
            <Icon name={showRequest ? "x" : "chat-square"} className="w-3.5 h-3.5" />{showRequest ? "Close" : "Request report"}
          </Link>
        )}
      />

      {requestSent ? <Notice tone="success" title="Report requested.">An administrator can now review it from the dashboard.</Notice> : null}
      {dbUnavailable ? <Notice tone="warn" title="Database not connected yet.">Client records will appear here after DATABASE_URL is configured and seed data is loaded.</Notice> : null}

      {canEdit && showNewClient ? (
        <SectionCard title="New client" icon="user-add" className="mb-4">
          <form action={createClient} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <label className="block">
              <span className="field-label">Client name</span>
              <input name="name" required placeholder="Star Websites" className="field" autoFocus />
            </label>
            <label className="block">
              <span className="field-label">Notes</span>
              <input name="notes" placeholder="Optional internal notes" className="field" />
            </label>
            <SubmitButton pendingLabel="Creating…">Create client</SubmitButton>
          </form>
        </SectionCard>
      ) : null}

      {canImport && showImport ? (
        <SectionCard
          title="Import ranking history"
          subtitle="Legacy rank checker CSV"
          icon="arrow-upload"
          className="mb-4"
          aside={<StatusPill tone="accent">No API requests</StatusPill>}
        >
          {importError ? <Notice tone="danger" title="Import failed.">{importError}</Notice> : null}
          <form action={importRankHistory} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
            <label className="block">
              <span className="field-label">CSV file</span>
              <input name="historyFile" type="file" accept=".csv,text/csv" required className="field file:mr-3 file:rounded-md file:border-0 file:bg-line/60 file:px-2 file:py-1 file:text-xs file:text-ink" />
            </label>
            <label className="block">
              <span className="field-label">Client name</span>
              <input name="clientName" placeholder="Use name from CSV" className="field" />
            </label>
            <label className="block">
              <span className="field-label">Report name</span>
              <input name="projectName" placeholder="Organic Rankings" className="field" />
            </label>
            <div className="sm:col-span-3 flex justify-end">
              <SubmitButton pendingLabel="Importing…">Import client history</SubmitButton>
            </div>
          </form>
        </SectionCard>
      ) : null}

      {!canEdit && showRequest ? (
        <SectionCard title="Request a report" subtitle="Send the client details to the reporting team for setup." icon="chat-square" className="mb-4">
          <form action={requestReport} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="field-label">Client or prospect</span>
                <input name="clientName" required placeholder="Company name" className="field" />
              </label>
              <label className="block">
                <span className="field-label">Website</span>
                <input name="websiteUrl" type="url" placeholder="https://example.co.uk" className="field" />
              </label>
            </div>
            <label className="block">
              <span className="field-label">What is needed?</span>
              <textarea name="notes" required rows={3} placeholder="Which services, locations or reporting data should be included?" className="field" />
            </label>
            <div className="flex justify-end">
              <SubmitButton pendingLabel="Sending…">Send request</SubmitButton>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <ClientTable clients={clients} />
    </div>
  );
}

async function getClientsData() {
  try {
    const records = await prisma.client.findMany({
      orderBy: { name: "asc" },
      include: {
        projects: {
          include: {
            keywords: { where: { active: true }, select: { id: true } },
            locations: { where: { active: true }, select: { id: true } },
            rankRuns: {
              where: { sandbox: false, status: "completed" },
              orderBy: { completedAt: "desc" },
              take: 1,
              select: { completedAt: true, createdAt: true }
            }
          }
        }
      }
    });

    const clients = records.map((client) => {
      const latestRun = client.projects
        .flatMap((project) => project.rankRuns)
        .sort((a, b) => (b.completedAt ?? b.createdAt).getTime() - (a.completedAt ?? a.createdAt).getTime())[0];

      return {
        id: client.id,
        name: client.name,
        projectCount: client.projects.length,
        keywordCount: client.projects.reduce((total, project) => total + project.keywords.length, 0),
        areaCount: client.projects.reduce((total, project) => total + project.locations.length, 0),
        lastReport: latestRun ? formatDate(latestRun.completedAt ?? latestRun.createdAt) : null
      };
    });

    return { clients, dbUnavailable: false };
  } catch {
    return { clients: [], dbUnavailable: true };
  }
}
