import Link from "next/link";
import { notFound } from "next/navigation";
import { createProject, updateClient } from "@/app/actions";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      projects: {
        orderBy: { createdAt: "desc" },
        include: {
          keywords: { where: { active: true } },
          locations: { where: { active: true } },
          rankRuns: { orderBy: { createdAt: "desc" }, take: 1 }
        }
      }
    }
  });

  if (!client) notFound();

  const updateClientWithId = updateClient.bind(null, client.id);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="breadcrumb"><Link href="/clients">Clients</Link> / {client.name}</p>
          <h2>{client.name}</h2>
          <p>{client.notes || "Manage client details and reporting projects."}</p>
        </div>
      </header>

      <section className="grid two">
        <form className="card form" action={updateClientWithId}>
          <p className="label">Client Details</p>
          <label>
            Client name
            <input name="name" required defaultValue={client.name} />
          </label>
          <label>
            Notes
            <textarea name="notes" rows={4} defaultValue={client.notes ?? ""} />
          </label>
          <button className="button" type="submit">Save Client</button>
        </form>

        <form className="card form" action={createProject}>
          <p className="label">New Project</p>
          <input type="hidden" name="clientId" value={client.id} />
          <label>
            Project name
            <input name="name" required placeholder="Main website" />
          </label>
          <label>
            Domain
            <input name="domain" required placeholder="example.co.uk" />
          </label>
          <label>
            Target business name
            <input name="targetBusinessName" placeholder="Example Local Business" />
          </label>
          <label>
            Service area
            <input name="serviceArea" placeholder="Manchester" />
          </label>
          <button className="button" type="submit">Create Project</button>
        </form>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <p className="label">Projects</p>
        <table className="table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Domain</th>
              <th>Keywords</th>
              <th>Locations</th>
              <th>Latest Run</th>
            </tr>
          </thead>
          <tbody>
            {client.projects.map((project) => (
              <tr key={project.id}>
                <td><Link href={`/projects/${project.id}`}>{project.name}</Link></td>
                <td>{project.domain}</td>
                <td>{project.keywords.length}</td>
                <td>{project.locations.length}</td>
                <td>{project.rankRuns[0]?.createdAt.toLocaleDateString("en-GB") ?? "Not run"}</td>
              </tr>
            ))}
            {client.projects.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">No projects yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}
