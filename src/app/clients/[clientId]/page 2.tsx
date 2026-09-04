import Link from "next/link";
import { notFound } from "next/navigation";
import { createProject, updateClient } from "@/app/actions";
import { Icon } from "@/components/icon";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ClientDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { clientId } = await params;
  const { view } = await searchParams;
  const settingsOpen = view === "settings";
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      projects: {
        orderBy: { name: "asc" },
        include: {
          keywords: { where: { active: true }, select: { id: true } },
          locations: { where: { active: true }, select: { id: true } },
          rankRuns: {
            where: { sandbox: false },
            orderBy: { createdAt: "desc" },
            take: 5,
            include: { results: true }
          }
        }
      }
    }
  });

  if (!client) notFound();

  const updateClientWithId = updateClient.bind(null, client.id);

  if (settingsOpen) {
    return (
      <>
        <ClientHeader clientId={client.id} clientName={client.name} settingsOpen />
        <section className="settings-panel">
          <div className="grid two">
            <form className="card form" action={updateClientWithId}>
              <p className="label label-with-icon"><Icon name="contacts" />Client Details</p>
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
              <p className="label label-with-icon"><Icon name="home" />New Report</p>
              <input type="hidden" name="clientId" value={client.id} />
              <label>
                Report name
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
                <input name="serviceArea" placeholder="North West" />
              </label>
              <button className="button" type="submit">Create Report</button>
            </form>
          </div>

          <section className="card spaced-section">
            <p className="label label-with-icon"><Icon name="settings" />Report Settings</p>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Report</th>
                    <th>Domain</th>
                    <th>Keywords</th>
                    <th>Areas</th>
                    <th><span className="sr-only">Edit</span></th>
                  </tr>
                </thead>
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
                  {client.projects.length === 0 ? (
                    <tr><td className="empty-table" colSpan={5}>No reports have been created yet.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </>
    );
  }

  const latestResults = await getLatestClientResults(client.id);
  const recentRuns = client.projects
    .flatMap((project) => project.rankRuns.map((run) => ({ ...run, projectName: project.name })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 8);
  const activeKeywords = client.projects.reduce((total, project) => total + project.keywords.length, 0);
  const ranks = latestResults.map((result) => result.rankAbsolute ?? result.rankGroup).filter((rank): rank is number => rank !== null);
  const averageRank = ranks.length > 0 ? (ranks.reduce((total, rank) => total + rank, 0) / ranks.length).toFixed(1) : "-";

  return (
    <>
      <ClientHeader clientId={client.id} clientName={client.name} />

      <section className="summary-strip" aria-label="Report summary">
        <SummaryItem label="Reports" value={client.projects.length.toString()} />
        <SummaryItem label="Active Keywords" value={activeKeywords.toString()} />
        <SummaryItem label="Current Rankings" value={latestResults.length.toString()} />
        <SummaryItem label="Average Position" value={averageRank} />
      </section>

      <section className="card report-table-card spaced-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="label label-with-icon"><Icon name="graph" />Latest Rankings</p>
            <h3>Current search positions</h3>
          </div>
          <span className="muted">Latest live result for each keyword and area</span>
        </div>
        <div className="table-scroll">
          <table className="table results-table">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Report</th>
                <th>Area</th>
                <th>Device</th>
                <th>Rank</th>
                <th>Change</th>
                <th>URL</th>
                <th>Checked</th>
              </tr>
            </thead>
            <tbody>
              {latestResults.map((result) => {
                const rank = result.rankAbsolute ?? result.rankGroup;
                return (
                  <tr key={result.id}>
                    <td><strong>{result.keyword.phrase}</strong></td>
                    <td>{result.run.project.name}</td>
                    <td>{result.location.name}</td>
                    <td>{readableType(result.device)}</td>
                    <td className="rank-cell">{rank ?? <span className="muted">Not found</span>}</td>
                    <td><Movement direction={result.direction} previousRank={result.previousRank} /></td>
                    <td>
                      {result.matchedUrl ? (
                        <a className="result-url" href={result.matchedUrl} target="_blank" rel="noreferrer">{result.matchedUrl}</a>
                      ) : <span className="muted">-</span>}
                    </td>
                    <td>{result.checkedAt.toLocaleDateString("en-GB")}</td>
                  </tr>
                );
              })}
              {latestResults.length === 0 ? (
                <tr>
                  <td className="empty-table" colSpan={8}>
                    No live rankings yet. Use the edit control to configure a report and run its first check.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {recentRuns.length > 0 ? (
        <section className="card spaced-section compact-history">
          <p className="label label-with-icon"><Icon name="graph" />Recent Checks</p>
          <table className="table">
            <thead><tr><th>Date</th><th>Report</th><th>Status</th><th>Results</th></tr></thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr key={run.id}>
                  <td><Link href={`/runs/${run.id}`}>{run.createdAt.toLocaleDateString("en-GB")}</Link></td>
                  <td>{run.projectName}</td>
                  <td><span className={`status ${run.status === "completed" ? "good" : ""}`}>{run.status}</span></td>
                  <td>{run.results.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}

async function getLatestClientResults(clientId: string) {
  const results = await prisma.rankResult.findMany({
    where: {
      run: {
        sandbox: false,
        status: "completed",
        project: { clientId }
      }
    },
    orderBy: { checkedAt: "desc" },
    take: 2000,
    include: {
      keyword: true,
      location: true,
      run: { include: { project: true } }
    }
  });
  const current = new Map<string, (typeof results)[number]>();

  for (const result of results) {
    const key = [result.run.projectId, result.keywordId, result.locationId, result.searchType, result.device].join(":");
    if (!current.has(key)) current.set(key, result);
  }

  return Array.from(current.values()).sort((a, b) => {
    const projectOrder = a.run.project.name.localeCompare(b.run.project.name);
    return projectOrder || a.keyword.phrase.localeCompare(b.keyword.phrase) || a.location.name.localeCompare(b.location.name);
  });
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

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function Movement({ direction, previousRank }: { direction: string | null; previousRank: number | null }) {
  if (!direction) return <span className="muted">-</span>;
  return (
    <span className={`status ${direction === "up" || direction === "new" ? "good" : direction === "down" || direction === "lost" ? "danger" : ""}`}>
      {readableType(direction)}{previousRank !== null ? ` · ${previousRank}` : ""}
    </span>
  );
}

function readableType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
