import Link from "next/link";
import { createClient, importRankHistory } from "@/app/actions";
import { ClientTable } from "@/components/client-table";
import { Icon } from "@/components/icon";
import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/access";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams
}: {
  searchParams: Promise<{ new?: string; import?: string; importError?: string }>;
}) {
  const { new: showNewClient, import: showImport, importError } = await searchParams;
  const actor = await currentActor();
  const canEdit = actor.role === "admin";
  const { clients, dbUnavailable } = await getClientsData();

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Clients</h2>
          <p>Open a client to view their latest report.</p>
        </div>
        {canEdit ? <div className="page-header-actions">
          <Link className="button button-secondary" href={showImport ? "/clients" : "/clients?import=1"}>
            {showImport ? "Close Import" : "Import History"}
          </Link>
          <Link className="button" href={showNewClient ? "/clients" : "/clients?new=1"}>
            {showNewClient ? "Close" : "Add Client"}
          </Link>
        </div> : null}
      </header>

      {dbUnavailable ? (
        <div className="notice">
          <strong>Database not connected yet.</strong>
          <span> Client records will appear here after `DATABASE_URL` is configured and seed data is loaded.</span>
        </div>
      ) : null}

      {canEdit && showNewClient ? (
        <form className="card form compact-create-form" action={createClient}>
          <p className="label label-with-icon"><Icon name="contacts" />New Client</p>
          <div className="form-row client-create-fields">
            <label>
              Client name
              <input name="name" required placeholder="Star Websites" />
            </label>
            <label>
              Notes
              <input name="notes" placeholder="Optional internal notes" />
            </label>
          </div>
          <SubmitButton pendingLabel="Creating client...">Create Client</SubmitButton>
        </form>
      ) : null}

      {canEdit && showImport ? (
        <form className="card form history-import-form" action={importRankHistory}>
          <div className="history-import-heading">
            <div>
              <p className="label label-with-icon"><Icon name="graph" />Import Ranking History</p>
              <h3>Legacy rank checker CSV</h3>
            </div>
            <span className="status good">No API requests</span>
          </div>
          {importError ? <div className="notice danger"><strong>Import failed.</strong><span> {importError}</span></div> : null}
          <div className="history-import-fields">
            <label className="history-file-field">
              CSV file
              <input name="historyFile" type="file" accept=".csv,text/csv" required />
            </label>
            <label>
              Client name
              <input name="clientName" placeholder="Use name from CSV" />
            </label>
            <label>
              Report name
              <input name="projectName" placeholder="Organic Rankings" />
            </label>
          </div>
          <SubmitButton pendingLabel="Importing history...">Import Client History</SubmitButton>
        </form>
      ) : null}

      <section className={`card client-table-card${showNewClient || showImport ? " spaced-section" : ""}`}>
        <ClientTable clients={clients} />
      </section>
    </>
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
        lastReport: latestRun ? (latestRun.completedAt ?? latestRun.createdAt).toLocaleDateString("en-GB") : null
      };
    });

    return { clients, dbUnavailable: false };
  } catch {
    return { clients: [], dbUnavailable: true };
  }
}
