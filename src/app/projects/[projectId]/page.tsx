import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  createKeywords,
  disconnectProjectGscProperty,
  queueKeywordMetrics,
  updateProjectGscProperty,
  updateProjectSchedule,
  updateKeywordActive,
  updateLocationActive,
  updateProject
} from "@/app/actions";
import { AreaPickerForm } from "@/components/area-picker-form";
import { Icon } from "@/components/icon";
import { LiveRunForm } from "@/components/live-run-form";
import { SandboxRunForm } from "@/components/sandbox-run-form";
import { prisma } from "@/lib/db";
import { currentActor } from "@/lib/access";
import { configuredKeywordMetricsCostUsd, estimateRankRunCost } from "@/lib/dataforseo-costs";
import {
  googleSearchConsoleConfigured,
  listSearchConsoleSites,
  type SearchConsoleSite
} from "@/lib/google-search-console";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    sandboxError?: string;
    liveError?: string;
    metricsError?: string;
    metricsQueued?: string;
    gscError?: string;
    gscMapped?: string;
  }>;
}) {
  const { projectId } = await params;
  const { sandboxError, liveError, metricsError, metricsQueued, gscError, gscMapped } = await searchParams;
  const actor = await currentActor();
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
  if (actor.role !== "admin") redirect(`/clients/${project.clientId}`);

  const gscConfigured = googleSearchConsoleConfigured();
  const gscConnections = gscConfigured ? await prisma.googleSearchConsoleConnection.findMany({
    orderBy: { accountEmail: "asc" },
    select: { id: true, accountEmail: true, encryptedRefreshToken: true }
  }) : [];
  const gscProperties = await loadGscPropertyOptions(gscConnections);

  const updateProjectWithId = updateProject.bind(null, project.id);
  const updateScheduleWithId = updateProjectSchedule.bind(null, project.id);
  const activeKeywords = project.keywords.filter((keyword) => keyword.active);
  const activeLocations = project.locations.filter((location) => location.active);
  const credentialsConfigured = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const liveEnabled = process.env.DATAFORSEO_LIVE_ENABLED === "true";
  const metricsEnabled = process.env.DATAFORSEO_KEYWORD_METRICS_ENABLED === "true";
  const scheduledSearchTypes = project.scheduleSearchTypes.filter((type) => type !== "local_finder");
  const scheduleEstimate = estimateRankRunCost({
    keywordCount: activeKeywords.length,
    locationCount: activeLocations.length,
    devices: project.scheduleDevices,
    searchTypes: scheduledSearchTypes.length > 0 ? scheduledSearchTypes : ["organic"],
    pageLimit: project.schedulePageLimit
  }, "standard");
  const queueMetrics = queueKeywordMetrics.bind(null, project.id);
  const mapGscProperty = updateProjectGscProperty.bind(null, project.id);
  const unmapGscProperty = disconnectProjectGscProperty.bind(null, project.id);

  return (
    <>
      <header className="page-header">
        <div>
          <p className="breadcrumb">
            <Link href="/clients">Clients</Link> / <Link href={`/clients/${project.client.id}`}>{project.client.name}</Link> / {project.name}
          </p>
          <h2>{project.name}</h2>
          <p>Tracking settings for {project.domain}{project.serviceArea ? ` - ${project.serviceArea}` : ""}</p>
        </div>
        <Link className="button button-secondary" href={`/clients/${project.client.id}`}>View Report</Link>
      </header>

      {sandboxError ? <div className="notice danger-notice"><strong>Sandbox check not started.</strong> {sandboxError}</div> : null}
      {liveError ? <div className="notice danger-notice"><strong>Live check not started.</strong> {liveError}</div> : null}
      {metricsError ? <div className="notice danger-notice"><strong>Keyword metrics not queued.</strong> {metricsError}</div> : null}
      {metricsQueued ? <div className="notice"><strong>Keyword metrics queued.</strong> The worker will submit and collect them.</div> : null}
      {gscError ? <div className="notice danger-notice"><strong>Search Console property not saved.</strong> {gscError}</div> : null}
      {gscMapped ? <div className="notice"><strong>Search Console property mapped.</strong> This report is ready for its first data import.</div> : null}

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

      <section className="card spaced-section gsc-project-card">
        <div className="section-heading compact-heading">
          <div>
            <p className="label label-with-icon"><Icon name="graph" />Google Search Console</p>
            <h3>Property mapping</h3>
          </div>
          <span className={`status ${project.gscPropertyUrl ? "good" : gscConnections.length > 0 ? "warn" : "danger"}`}>
            {project.gscPropertyUrl ? "Mapped" : gscConnections.length > 0 ? "Select property" : "Not connected"}
          </span>
        </div>

        {project.gscPropertyUrl ? (
          <div className="gsc-current-property">
            <div>
              <strong>{displayGscProperty(project.gscPropertyUrl)}</strong>
              <small>{readableGscPermission(project.gscPermissionLevel)} · mapped {project.gscConnectedAt?.toLocaleDateString("en-GB") ?? "recently"}</small>
            </div>
            <form action={unmapGscProperty}>
              <button className="button button-secondary" type="submit">Remove Mapping</button>
            </form>
          </div>
        ) : null}

        {!gscConfigured ? (
          <p className="muted">Search Console environment variables are missing from the server.</p>
        ) : gscConnections.length === 0 ? (
          <div className="integration-empty">
            <p className="muted">Connect a Google account before assigning this report to a property.</p>
            <Link className="button button-secondary" href="/settings">Open Settings</Link>
          </div>
        ) : gscProperties.options.length === 0 ? (
          <p className="danger-text">{gscProperties.error ?? "The connected account has no available Search Console properties."}</p>
        ) : (
          <form className="gsc-property-form" action={mapGscProperty}>
            <label>
              Search Console property
              <select name="gscProperty" required defaultValue={gscDefaultValue(project, gscProperties.options)}>
                <option value="" disabled>Select a property</option>
                {gscProperties.options.map((option) => (
                  <option key={`${option.connectionId}:${option.site.siteUrl}`} value={gscOptionValue(option)}>
                    {displayGscProperty(option.site.siteUrl)} · {option.accountEmail}
                  </option>
                ))}
              </select>
            </label>
            <button className="button" type="submit">Save Property</button>
          </form>
        )}
        {gscProperties.error && gscProperties.options.length > 0 ? <p className="danger-text gsc-property-error">{gscProperties.error}</p> : null}
      </section>

      <form className="card form schedule-card spaced-section" action={updateScheduleWithId}>
        <div className="section-heading compact-heading">
          <div>
            <p className="label label-with-icon"><Icon name="settings" />Monthly Schedule</p>
            <h3>Automated rank report</h3>
          </div>
          <label className="toggle-field">
            <input name="scheduleEnabled" type="checkbox" defaultChecked={project.scheduleEnabled} />
            <span>Enabled</span>
          </label>
        </div>
        <div className="schedule-grid">
          <label>
            Day of month
            <select name="scheduleDay" defaultValue={project.scheduleDay}>
              {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
          </label>
          <label>
            Organic result pages
            <select name="schedulePageLimit" defaultValue={project.schedulePageLimit}>
              {Array.from({ length: 10 }, (_, index) => index + 1).map((page) => <option key={page} value={page}>{page}</option>)}
            </select>
          </label>
          <fieldset className="choice-group">
            <legend>Devices</legend>
            <div className="choice-list horizontal">
              <label><input name="scheduleDevices" type="checkbox" value="desktop" defaultChecked={project.scheduleDevices.includes("desktop")} />Desktop</label>
              <label><input name="scheduleDevices" type="checkbox" value="mobile" defaultChecked={project.scheduleDevices.includes("mobile")} />Mobile</label>
            </div>
          </fieldset>
          <fieldset className="choice-group">
            <legend>Results</legend>
            <div className="choice-list horizontal">
              <label><input name="scheduleSearchTypes" type="checkbox" value="organic" defaultChecked={project.scheduleSearchTypes.includes("organic")} />Organic</label>
              <label><input name="scheduleSearchTypes" type="checkbox" value="maps" defaultChecked={project.scheduleSearchTypes.includes("maps")} />Maps</label>
            </div>
          </fieldset>
        </div>
        <div className="schedule-footer">
          <p className="muted form-note">
            Current selection: {activeKeywords.length * activeLocations.length * project.scheduleDevices.length * Math.max(1, scheduledSearchTypes.length)} Standard task(s). Maximum estimate: ${scheduleEstimate.toFixed(4)} per report.
          </p>
          <button className="button" type="submit">Save Schedule</button>
        </div>
      </form>

      <section className="card spaced-section keyword-metrics-card">
        <div>
          <p className="label label-with-icon"><Icon name="graph" />Keyword Demand</p>
          <h3>Search volume and 12-month trends</h3>
          <p className="muted">One bulk Standard task covers all {activeKeywords.length} active keywords using the first active area.</p>
        </div>
        <div className="metrics-action">
          <span className={`status ${project.keywordMetricsStatus === "completed" ? "good" : project.keywordMetricsStatus === "failed" ? "danger" : "warn"}`}>
            {project.keywordMetricsStatus}
          </span>
          <small>Maximum estimate ${configuredKeywordMetricsCostUsd().toFixed(2)}</small>
          {!metricsEnabled ? <small>Disabled in server settings</small> : null}
          <form action={queueMetrics}>
            <button
              className="button button-secondary"
              type="submit"
              disabled={!metricsEnabled || ["queued", "submitting", "submitted"].includes(project.keywordMetricsStatus)}
            >
              {project.keywordMetricsStatus === "completed" ? "Refresh Metrics" : "Queue Metrics"}
            </button>
          </form>
        </div>
        {project.keywordMetricsError ? <p className="danger-text metrics-error">{project.keywordMetricsError}</p> : null}
      </section>

      <section style={{ marginTop: 18 }}>
        <SandboxRunForm
          projectId={project.id}
          keywords={activeKeywords.map((keyword) => ({ id: keyword.id, label: keyword.phrase }))}
          locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
          credentialsConfigured={credentialsConfigured}
        />
      </section>

      <section style={{ marginTop: 18 }}>
        <LiveRunForm
          projectId={project.id}
          keywords={activeKeywords.map((keyword) => ({ id: keyword.id, label: keyword.phrase }))}
          locations={activeLocations.map((location) => ({ id: location.id, label: location.name }))}
          credentialsConfigured={credentialsConfigured}
          liveEnabled={liveEnabled}
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

        <AreaPickerForm projectId={project.id} />
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
                <td>{readableDeliveryMethod(run.deliveryMethod)}</td>
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

function readableDeliveryMethod(method: string) {
  if (method === "standard") return "Standard";
  if (method === "live") return "Live";
  return method.charAt(0).toUpperCase() + method.slice(1);
}

type GscConnectionOption = {
  id: string;
  accountEmail: string;
  encryptedRefreshToken: string;
};

type GscPropertyOption = {
  connectionId: string;
  accountEmail: string;
  site: SearchConsoleSite;
};

async function loadGscPropertyOptions(connections: GscConnectionOption[]) {
  const results = await Promise.all(connections.map(async (connection) => {
    try {
      const sites = await listSearchConsoleSites(connection.encryptedRefreshToken);
      return {
        options: sites.map((site) => ({ connectionId: connection.id, accountEmail: connection.accountEmail, site })),
        error: null
      };
    } catch (error) {
      return {
        options: [] as GscPropertyOption[],
        error: `${connection.accountEmail}: ${error instanceof Error ? error.message : "Unable to list properties."}`
      };
    }
  }));

  return {
    options: results.flatMap((result) => result.options),
    error: results.map((result) => result.error).filter(Boolean).join(" ") || null
  };
}

function gscOptionValue(option: GscPropertyOption) {
  return JSON.stringify({ connectionId: option.connectionId, siteUrl: option.site.siteUrl });
}

function gscDefaultValue(
  project: { gscConnectionId: string | null; gscPropertyUrl: string | null },
  options: GscPropertyOption[]
) {
  const selected = options.find((option) =>
    option.connectionId === project.gscConnectionId && option.site.siteUrl === project.gscPropertyUrl
  );
  return selected ? gscOptionValue(selected) : "";
}

function displayGscProperty(siteUrl: string) {
  return siteUrl.startsWith("sc-domain:") ? siteUrl.replace("sc-domain:", "") : siteUrl;
}

function readableGscPermission(permission: string | null) {
  if (permission === "siteOwner") return "Owner access";
  if (permission === "siteFullUser") return "Full access";
  if (permission === "siteRestrictedUser") return "Restricted access";
  return "Read access";
}

type Keyword = {
  id: string;
  phrase: string;
  group: string | null;
  targetUrl: string | null;
  active: boolean;
  searchVolume: number | null;
  cpcUsd: { toString(): string } | null;
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
            <th>Volume</th>
            <th>CPC</th>
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
                <td>{keyword.searchVolume?.toLocaleString("en-GB") ?? "-"}</td>
                <td>{keyword.cpcUsd ? `$${keyword.cpcUsd.toString()}` : "-"}</td>
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
              <td colSpan={5} className="muted">No keywords yet.</td>
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
