import { Icon } from "@/components/icon";
import Link from "next/link";
import { redirect } from "next/navigation";
import { disconnectGoogleSearchConsole } from "@/app/actions";
import { currentActor } from "@/lib/access";
import { getDataForSeoBudgetSummary } from "@/lib/dataforseo-costs";
import { prisma } from "@/lib/db";
import { workerHealth } from "@/lib/worker-health";
import { googleSearchConsoleConfigured } from "@/lib/google-search-console";
import { SubmitButton } from "@/components/submit-button";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ gsc?: string; gscError?: string }>;
}) {
  const { gsc, gscError } = await searchParams;
  const actor = await currentActor();
  if (actor.role !== "admin") redirect("/");
  const sandbox = process.env.DATAFORSEO_SANDBOX !== "false";
  const liveEnabled = process.env.DATAFORSEO_LIVE_ENABLED === "true";
  const maxLiveTasks = process.env.DATAFORSEO_MAX_LIVE_TASKS_PER_RUN ?? "1";
  const maxStandardTasks = process.env.DATAFORSEO_MAX_STANDARD_TASKS_PER_RUN ?? "1000";
  const keywordMetricsEnabled = process.env.DATAFORSEO_KEYWORD_METRICS_ENABLED === "true";
  const credentialsConfigured = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const authEnabled = process.env.AUTH_ENABLED === "true";
  const allowedAccessConfigured = Boolean(process.env.AUTH_ALLOWED_EMAILS || process.env.AUTH_ALLOWED_DOMAINS);
  const gscConfigured = googleSearchConsoleConfigured();
  const budget = await getDataForSeoBudgetSummary();
  const weekAgo = sevenDaysAgo();
  const [heartbeat, failedRuns, auditLogs, gscConnections] = await Promise.all([
    prisma.workerHeartbeat.findUnique({ where: { key: "rank-worker" } }),
    prisma.rankRun.count({ where: { status: { in: ["failed", "blocked"] }, createdAt: { gte: weekAgo } } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.googleSearchConsoleConnection.findMany({
      orderBy: { connectedAt: "desc" },
      include: { _count: { select: { projects: true } } }
    })
  ]);
  const worker = workerHealth(heartbeat);

  return (
    <>
      <header className="page-header">
        <div>
          <h2>Settings</h2>
          <p>Connections, access controls and reporting safeguards.</p>
        </div>
      </header>

      {gsc === "connected" ? <div className="notice"><strong>Search Console connected.</strong> You can now assign properties from each report’s settings.</div> : null}
      {gscError ? <div className="notice danger-notice"><strong>Search Console was not connected.</strong> {gscError}</div> : null}

      <section className="grid two">
        <div className="card">
          <p className="label label-with-icon"><Icon name="settings" />DataForSEO</p>
          <table className="table">
            <tbody>
              <tr>
                <th>Credentials</th>
                <td><span className={credentialsConfigured ? "status good" : "status danger"}>{credentialsConfigured ? "Configured" : "Missing"}</span></td>
              </tr>
              <tr>
                <th>Default Mode</th>
                <td>{sandbox ? "Sandbox" : "Live"}</td>
              </tr>
              <tr>
                <th>Live Enabled</th>
                <td><span className={liveEnabled ? "status warn" : "status good"}>{liveEnabled ? "Yes" : "No"}</span></td>
              </tr>
              <tr>
                <th>Max Live Tasks</th>
                <td>{maxLiveTasks}</td>
              </tr>
              <tr>
                <th>Max Standard Tasks</th>
                <td>{maxStandardTasks}</td>
              </tr>
              <tr>
                <th>Keyword Metrics</th>
                <td><span className={keywordMetricsEnabled ? "status warn" : "status good"}>{keywordMetricsEnabled ? "Paid access enabled" : "Disabled"}</span></td>
              </tr>
              <tr>
                <th>Monthly Budget</th>
                <td>${budget.spentUsd.toFixed(4)} spent · ${budget.reservedUsd.toFixed(4)} reserved · ${budget.limitUsd.toFixed(2)} limit</td>
              </tr>
              <tr>
                <th>Queue Delay</th>
                <td>{process.env.RANK_QUEUE_DELAY_MS ?? "750"} ms</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card integration-card">
          <div className="section-heading compact-heading">
            <div>
              <p className="label label-with-icon"><Icon name="graph" />Google Search Console</p>
              <h3>Organic performance data</h3>
            </div>
            <span className={`status ${gscConnections.length > 0 ? "good" : gscConfigured ? "warn" : "danger"}`}>
              {gscConnections.length > 0 ? "Connected" : gscConfigured ? "Ready" : "Setup required"}
            </span>
          </div>
          {!gscConfigured ? (
            <p className="muted">Add the four Google Search Console environment variables before connecting an account.</p>
          ) : gscConnections.length === 0 ? (
            <div className="integration-empty">
              <p className="muted">Connect the internal Google account that has access to your client properties.</p>
              <Link className="button" href="/api/integrations/google/start">Connect Google Account</Link>
            </div>
          ) : (
            <div className="integration-connections">
              {gscConnections.map((connection) => {
                const disconnect = disconnectGoogleSearchConsole.bind(null, connection.id);
                return (
                  <div className="integration-connection" key={connection.id}>
                    <div>
                      <strong>{connection.accountEmail}</strong>
                      <small>{connection._count.projects} mapped report{connection._count.projects === 1 ? "" : "s"} · connected {connection.connectedAt.toLocaleDateString("en-GB")}</small>
                    </div>
                    <form action={disconnect}>
                      <SubmitButton className="button button-danger" confirmMessage={`Disconnect ${connection.accountEmail}? Reports mapped to this account will stop refreshing.`} pendingLabel="Disconnecting...">Disconnect</SubmitButton>
                    </form>
                  </div>
                );
              })}
              <Link className="button button-secondary integration-add" href="/api/integrations/google/start">Connect Another Account</Link>
            </div>
          )}
        </div>

        <div className="card">
          <p className="label label-with-icon"><Icon name="contacts" />Access</p>
          <table className="table">
            <tbody>
              <tr>
                <th>Google Sign-in</th>
                <td><span className={authEnabled ? "status good" : "status warn"}>{authEnabled ? "Enabled" : "Setup required"}</span></td>
              </tr>
              <tr>
                <th>Access Allowlist</th>
                <td><span className={allowedAccessConfigured ? "status good" : "status danger"}>{allowedAccessConfigured ? "Configured" : "Missing"}</span></td>
              </tr>
              <tr>
                <th>Sales Cooldown</th>
                <td>{process.env.RANK_SALES_COOLDOWN_DAYS ?? "7"} days</td>
              </tr>
              <tr>
                <th>Session Lifetime</th>
                <td>{process.env.AUTH_SESSION_MAX_AGE_HOURS ?? "10"} hours</td>
              </tr>
              <tr>
                <th>Security Headers</th>
                <td><span className="status good">Enabled</span></td>
              </tr>
              <tr>
                <th>Rate Limits</th>
                <td><span className="status good">Enabled</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <p className="label label-with-icon"><Icon name="graph" />Operations</p>
          <table className="table">
            <tbody>
              <tr>
                <th>Rank Worker</th>
                <td><span className={worker.healthy ? "status good" : "status danger"}>{worker.label}</span></td>
              </tr>
              <tr>
                <th>Last Success</th>
                <td>{heartbeat?.lastSuccessAt ? heartbeat.lastSuccessAt.toLocaleString("en-GB") : "Not recorded"}</td>
              </tr>
              <tr>
                <th>Last Failure</th>
                <td>{heartbeat?.lastFailureAt ? heartbeat.lastFailureAt.toLocaleString("en-GB") : "None recorded"}</td>
              </tr>
              <tr>
                <th>Failed Jobs</th>
                <td><span className={failedRuns === 0 ? "status good" : "status danger"}>{failedRuns} in 7 days</span></td>
              </tr>
              <tr>
                <th>Last Worker Result</th>
                <td>{heartbeat ? `${heartbeat.submitted} submitted, ${heartbeat.collected} collected` : "Not recorded"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card roadmap-card">
          <p className="label label-with-icon"><Icon name="graph" />Planned Integration</p>
          <h3>Google Analytics 4</h3>
          <p className="muted">
            Add website engagement and conversion data alongside rankings and Search Console performance.
          </p>
        </div>
      </section>

      <section className="card spaced-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="label label-with-icon"><Icon name="settings" />Audit Trail</p>
            <h3>Recent security and report activity</h3>
          </div>
          <span className="muted">{auditLogs.length} recent events</span>
        </div>
        <div className="table-scroll">
          <table className="table audit-table">
            <thead>
              <tr><th>Date</th><th>Event</th><th>Result</th><th>Actor</th><th>Record</th></tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td>{log.createdAt.toLocaleString("en-GB")}</td>
                  <td>{formatAuditEvent(log.event)}</td>
                  <td><span className={log.outcome === "success" ? "audit-outcome success" : "audit-outcome failure"}>{log.outcome}</span></td>
                  <td>{log.actorEmail ?? "System"}</td>
                  <td>{log.entityType ?? "-"}{log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ""}</td>
                </tr>
              ))}
              {auditLogs.length === 0 ? <tr><td colSpan={5} className="muted">No audit events have been recorded yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function formatAuditEvent(event: string) {
  return event.split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1).replaceAll("_", " ")).join(" · ");
}

function sevenDaysAgo() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}
