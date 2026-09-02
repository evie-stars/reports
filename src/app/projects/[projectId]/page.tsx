import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createKeywords,
  createLocation,
  updateKeywordActive,
  updateLocationActive,
  updateProject
} from "@/app/actions";
import { Icon } from "@/components/icon";
import { SandboxRunForm } from "@/components/sandbox-run-form";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ sandboxError?: string }>;
}) {
  const { projectId } = await params;
  const { sandboxError } = await searchParams;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      client: true,
      keywords: { orderBy: [{ active: "desc" }, { phrase: "asc" }] },
      locations: { orderBy: [{ active: "desc" }, { name: "asc" }] },
      rankRuns: { orderBy: { createdAt: "desc" }, take: 5, include: { results: true } }
    }
  });

  if (!project) notFound();

  const updateProjectWithId = updateProject.bind(null, project.id);
  const activeKeywords = project.keywords.filter((keyword) => keyword.active);
  const activeLocations = project.locations.filter((location) => location.active);
  const credentialsConfigured = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="breadcrumb">
            <Link href="/clients">Clients</Link> / <Link href={`/clients/${project.client.id}`}>{project.client.name}</Link> / {project.name}
          </p>
          <h2>{project.name}</h2>
          <p>{project.domain} {project.serviceArea ? `- ${project.serviceArea}` : ""}</p>
        </div>
      </header>

      {sandboxError ? <div className="notice danger-notice"><strong>Sandbox check not started.</strong> {sandboxError}</div> : null}

      <section className="grid two">
        <form className="card form" action={updateProjectWithId}>
          <p className="label label-with-icon"><Icon name="home" />Project Details</p>
          <input type="hidden" name="clientId" value={project.clientId} />
          <label>
            Project name
            <input name="name" required defaultValue={project.name} />
          </label>
          <label>
            Domain
            <input name="domain" required defaultValue={project.domain} />
          </label>
          <label>
            Target business name
            <input name="targetBusinessName" defaultValue={project.targetBusinessName ?? ""} />
          </label>
          <label>
            Service area
            <input name="serviceArea" defaultValue={project.serviceArea ?? ""} />
          </label>
          <button className="button" type="submit">Save Project</button>
        </form>

        <div className="card">
          <p className="label label-with-icon"><Icon name="graph" />Tracking Summary</p>
          <div className="summary-list">
            <span><strong>{activeKeywords.length}</strong> active keywords</span>
            <span><strong>{activeLocations.length}</strong> active locations</span>
            <span><strong>{project.rankRuns.length}</strong> recent runs</span>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <SandboxRunForm
          projectId={project.id}
          keywords={activeKeywords.map((keyword) => ({ id: keyword.id, label: keyword.phrase }))}
          locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
          credentialsConfigured={credentialsConfigured}
        />
      </section>

      <section className="grid two" style={{ marginTop: 18 }}>
        <form className="card form" action={createKeywords}>
          <p className="label label-with-icon"><Icon name="tags" />Add Keywords</p>
          <input type="hidden" name="projectId" value={project.id} />
          <label>
            Keywords
            <textarea
              name="phrases"
              required
              rows={7}
              placeholder={"emergency plumber manchester\nboiler repair manchester\nlocal plumber near me"}
            />
          </label>
          <label>
            Group for all keywords
            <input name="group" placeholder="Emergency" />
          </label>
          <label>
            Target URL for all keywords
            <input name="targetUrl" placeholder="https://example.co.uk/service" />
          </label>
          <button className="button" type="submit">Add Keywords</button>
        </form>

        <form className="card form" action={createLocation}>
          <p className="label label-with-icon"><Icon name="location" />Add Location</p>
          <input type="hidden" name="projectId" value={project.id} />
          <label>
            Location name
            <input name="name" required placeholder="Manchester" />
          </label>
          <label>
            Country code
            <input name="countryCode" required maxLength={2} defaultValue="GB" />
          </label>
          <label>
            DataForSEO location name
            <input name="dataForSeoLocationName" placeholder="Manchester,England,United Kingdom" />
          </label>
          <div className="form-row">
            <label>
              Latitude
              <input name="latitude" inputMode="decimal" placeholder="53.4808" />
            </label>
            <label>
              Longitude
              <input name="longitude" inputMode="decimal" placeholder="-2.2426" />
            </label>
          </div>
          <label>
            Radius metres
            <input name="radiusMeters" inputMode="numeric" placeholder="5000" />
          </label>
          <button className="button" type="submit">Add Location</button>
        </form>
      </section>

      <section className="grid two" style={{ marginTop: 18 }}>
        <KeywordTable projectId={project.id} keywords={project.keywords} />
        <LocationTable projectId={project.id} locations={project.locations} />
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <p className="label label-with-icon"><Icon name="graph" />Recent Runs</p>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Results</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {project.rankRuns.map((run) => (
              <tr key={run.id}>
                <td><Link href={`/runs/${run.id}`}>{run.createdAt.toLocaleDateString("en-GB")}</Link></td>
                <td><span className="status">{run.status}</span></td>
                <td>{run.sandbox ? "Sandbox" : "Live"}</td>
                <td>{run.results.length}</td>
                <td>${run.actualCostUsd.toString()}</td>
              </tr>
            ))}
            {project.rankRuns.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">No rank runs for this project yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </>
  );
}

type Keyword = {
  id: string;
  phrase: string;
  group: string | null;
  targetUrl: string | null;
  active: boolean;
};

type Location = {
  id: string;
  name: string;
  countryCode: string;
  dataForSeoLocationName: string | null;
  active: boolean;
};

function KeywordTable({ projectId, keywords }: { projectId: string; keywords: Keyword[] }) {
  return (
    <div className="card">
      <p className="label label-with-icon"><Icon name="tags" />Keywords</p>
      <table className="table">
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Group</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((keyword) => {
            const toggleKeyword = updateKeywordActive.bind(null, keyword.id, projectId, !keyword.active);
            return (
              <tr key={keyword.id}>
                <td>{keyword.phrase}</td>
                <td>{keyword.group ?? "-"}</td>
                <td>
                  <form action={toggleKeyword}>
                    <button className={`status ${keyword.active ? "good" : ""}`} type="submit">
                      {keyword.active ? "Active" : "Paused"}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
          {keywords.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted">No keywords yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function LocationTable({ projectId, locations }: { projectId: string; locations: Location[] }) {
  return (
    <div className="card">
      <p className="label label-with-icon"><Icon name="location" />Locations</p>
      <table className="table">
        <thead>
          <tr>
            <th>Location</th>
            <th>DataForSEO Name</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {locations.map((location) => {
            const toggleLocation = updateLocationActive.bind(null, location.id, projectId, !location.active);
            return (
              <tr key={location.id}>
                <td>{location.name}, {location.countryCode}</td>
                <td>{location.dataForSeoLocationName ?? "-"}</td>
                <td>
                  <form action={toggleLocation}>
                    <button className={`status ${location.active ? "good" : ""}`} type="submit">
                      {location.active ? "Active" : "Paused"}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
          {locations.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted">No locations yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
