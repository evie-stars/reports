import { prisma } from "@/lib/db";
import Link from "next/link";
import { createClient } from "@/app/actions";
import { Icon } from "@/components/icon";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const { clients, dbUnavailable } = await getClientsData();

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Clients</h2>
          <p>Client and project setup for local SEO tracking.</p>
        </div>
      </header>

      {dbUnavailable ? (
        <div className="notice">
          <strong>Database not connected yet.</strong>
          <span> Client records will appear here after `DATABASE_URL` is configured and seed data is loaded.</span>
        </div>
      ) : null}

      <section className="grid two">
        <form className="card form" action={createClient}>
          <p className="label label-with-icon"><Icon name="contacts" />New Client</p>
          <label>
            Client name
            <input name="name" required placeholder="Star Websites" />
          </label>
          <label>
            Notes
            <textarea name="notes" rows={4} placeholder="Internal notes, billing context, reporting preferences" />
          </label>
          <button className="button" type="submit">Create Client</button>
        </form>

        <div className="card">
          <p className="label label-with-icon"><Icon name="graph" />Setup Flow</p>
          <h3>Client, project, keywords, locations</h3>
          <p className="muted">Create a client first, then add one or more projects. Each project gets its own tracked keywords and search locations.</p>
        </div>
      </section>

      <section className="grid" style={{ marginTop: 18 }}>
        {clients.map((client) => (
          <article className="card" key={client.id}>
            <p className="label">{client.projects.length} Projects</p>
            <h3><Link href={`/clients/${client.id}`}>{client.name}</Link></h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Domain</th>
                  <th>Keywords</th>
                  <th>Locations</th>
                </tr>
              </thead>
              <tbody>
                {client.projects.map((project) => (
                  <tr key={project.id}>
                    <td><Link href={`/projects/${project.id}`}>{project.name}</Link></td>
                    <td>{project.domain}</td>
                    <td>{project.keywords.length}</td>
                    <td>{project.locations.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </section>
    </>
  );
}

async function getClientsData() {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { name: "asc" },
      include: {
        projects: {
          include: {
            keywords: true,
            locations: true
          }
        }
      }
    });

    return { clients, dbUnavailable: false };
  } catch {
    return { clients: [], dbUnavailable: true };
  }
}
