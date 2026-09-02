import Link from "next/link";
import { createClient } from "@/app/actions";
import { ClientTable } from "@/components/client-table";
import { Icon } from "@/components/icon";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { new: showNewClient } = await searchParams;
  const { clients, dbUnavailable } = await getClientsData();

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Clients</h2>
          <p>Open a client to view their latest report.</p>
        </div>
        <Link className="button" href={showNewClient ? "/clients" : "/clients?new=1"}>
          {showNewClient ? "Close" : "Add Client"}
        </Link>
      </header>

      {dbUnavailable ? (
        <div className="notice">
          <strong>Database not connected yet.</strong>
          <span> Client records will appear here after `DATABASE_URL` is configured and seed data is loaded.</span>
        </div>
      ) : null}

      {showNewClient ? (
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
          <button className="button" type="submit">Create Client</button>
        </form>
      ) : null}

      <section className={`card client-table-card${showNewClient ? " spaced-section" : ""}`}>
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
