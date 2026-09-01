import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const { clients, dbUnavailable } = await getClientsData();

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Clients</h2>
          <p>Client and project setup for local SEO tracking. Editing forms are the next build step; the schema is ready for them.</p>
        </div>
      </header>

      {dbUnavailable ? (
        <div className="notice">
          <strong>Database not connected yet.</strong>
          <span> Client records will appear here after `DATABASE_URL` is configured and seed data is loaded.</span>
        </div>
      ) : null}

      <section className="grid">
        {clients.map((client) => (
          <article className="card" key={client.id}>
            <p className="label">{client.projects.length} Projects</p>
            <h3>{client.name}</h3>
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
                    <td>{project.name}</td>
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
