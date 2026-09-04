import Link from "next/link";
import { redirect } from "next/navigation";
import { disconnectGoogleSearchConsole } from "@/actions/integrations";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { currentActor } from "@/lib/access";
import { getDataForSeoBudgetSummary } from "@/lib/dataforseo-costs";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatUsd, plural, readableAuditEvent, readableValue } from "@/lib/format";
import { googleSearchConsoleConfigured } from "@/lib/google-search-console";
import { workerHealth } from "@/lib/worker-health";

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
  const gscConfigured = googleSearchConsoleConfigured();
  const { budget, heartbeat, failedRuns, auditLogs, gscConnections, managedUsers, dbUnavailable } = await getSettingsData();
  const worker = workerHealth(heartbeat);
  const allowedAccessConfigured = managedUsers > 0 || Boolean(process.env.AUTH_ALLOWED_EMAILS || process.env.AUTH_ALLOWED_DOMAINS);
  const gscTone = gscConnections.length > 0 ? "accent" : gscConfigured ? "warn" : "blocked";
  const gscLabel = gscConnections.length > 0 ? "Connected" : gscConfigured ? "Ready" : "Setup required";

  return (
    <div>
      <PageHeader title="Settings" subtitle="Connections, access controls and reporting safeguards." />

      {gsc === "connected" ? (
        <Notice tone="success" title="Search Console connected.">You can now assign properties from each report’s settings.</Notice>
      ) : null}
      {gscError ? <Notice tone="danger" title="Search Console was not connected.">{gscError}</Notice> : null}
      {dbUnavailable ? (
        <Notice tone="warn" title="Database not connected yet.">Budget, worker health, connections and audit events will appear here once the database is configured.</Notice>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="DataForSEO" subtitle="Ranking data provider" icon="cog">
          <dl className="divide-y divide-line text-sm">
            <SettingRow label="Credentials">
              <StatusPill tone={credentialsConfigured ? "accent" : "blocked"}>{credentialsConfigured ? "Configured" : "Missing"}</StatusPill>
            </SettingRow>
            <SettingRow label="Default mode">{sandbox ? "Sandbox" : "Live"}</SettingRow>
            <SettingRow label="Live enabled">
              <StatusPill tone={liveEnabled ? "warn" : "accent"}>{liveEnabled ? "Yes" : "No"}</StatusPill>
            </SettingRow>
            <SettingRow label="Max live tasks">{maxLiveTasks}</SettingRow>
            <SettingRow label="Max standard tasks">{maxStandardTasks}</SettingRow>
            <SettingRow label="Keyword metrics">
              <StatusPill tone={keywordMetricsEnabled ? "warn" : "accent"}>{keywordMetricsEnabled ? "Paid access enabled" : "Disabled"}</StatusPill>
            </SettingRow>
            <SettingRow label="Monthly budget">
              <span className="font-mono text-xs">
                {formatUsd(budget.spentUsd)} spent · {formatUsd(budget.reservedUsd)} reserved · {formatUsd(budget.limitUsd, 2)} limit
              </span>
            </SettingRow>
            <SettingRow label="Queue delay">{process.env.RANK_QUEUE_DELAY_MS ?? "750"} ms</SettingRow>
          </dl>
        </SectionCard>

        <SectionCard
          title="Google Search Console"
          subtitle="Organic performance data"
          icon="zoom-in"
          aside={<StatusPill tone={gscTone}>{gscLabel}</StatusPill>}
        >
          {!gscConfigured ? (
            <p className="text-sm text-slate">Add the four Google Search Console environment variables before connecting an account.</p>
          ) : gscConnections.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-slate">Connect the internal Google account that has access to your client properties.</p>
              <Link className="btn-primary" href="/api/integrations/google/start">
                <Icon name="add" className="w-3.5 h-3.5" />Connect Google account
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {gscConnections.map((connection) => {
                const disconnect = disconnectGoogleSearchConsole.bind(null, connection.id);
                return (
                  <div className="rounded-xl border border-line p-3 flex items-center justify-between gap-3" key={connection.id}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{connection.accountEmail}</p>
                      <p className="text-xs text-slate">
                        {plural(connection._count.projects, "mapped report")} · connected {formatDate(connection.connectedAt)}
                      </p>
                    </div>
                    <form action={disconnect} className="shrink-0">
                      <SubmitButton
                        className="btn-danger"
                        confirmMessage={`Disconnect ${connection.accountEmail}? Reports mapped to this account will stop refreshing.`}
                        pendingLabel="Disconnecting..."
                      >
                        Disconnect
                      </SubmitButton>
                    </form>
                  </div>
                );
              })}
              <Link className="btn-ghost" href="/api/integrations/google/start">
                <Icon name="add" className="w-3.5 h-3.5" />Connect another account
              </Link>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Access" subtitle="Sign-in and role controls" icon="lock">
          <dl className="divide-y divide-line text-sm">
            <SettingRow label="Google sign-in">
              <StatusPill tone={authEnabled ? "accent" : "warn"}>{authEnabled ? "Enabled" : "Setup required"}</StatusPill>
            </SettingRow>
            <SettingRow label="Access allowlist">
              <StatusPill tone={allowedAccessConfigured ? "accent" : "blocked"}>{allowedAccessConfigured ? "Configured" : "Missing"}</StatusPill>
            </SettingRow>
            <SettingRow label="Access roles">
              <StatusPill tone="accent">Admin · Manager · Team</StatusPill>
              <span className="block text-xs text-slate mt-1">{managedUsers} dashboard-managed</span>
            </SettingRow>
            <SettingRow label="Team re-run cooldown">{process.env.RANK_TEAM_COOLDOWN_DAYS ?? process.env.RANK_SALES_COOLDOWN_DAYS ?? "7"} days</SettingRow>
            <SettingRow label="Session lifetime">{process.env.AUTH_SESSION_MAX_AGE_HOURS ?? "10"} hours</SettingRow>
            <SettingRow label="Security headers"><StatusPill tone="accent">Enabled</StatusPill></SettingRow>
            <SettingRow label="Rate limits"><StatusPill tone="accent">Enabled</StatusPill></SettingRow>
          </dl>
        </SectionCard>

        <SectionCard title="Operations" subtitle="Rank worker health" icon="refresh">
          <dl className="divide-y divide-line text-sm">
            <SettingRow label="Rank worker">
              <StatusPill tone={worker.healthy ? "accent" : "blocked"}>{worker.label}</StatusPill>
            </SettingRow>
            <SettingRow label="Last success">{heartbeat?.lastSuccessAt ? formatDateTime(heartbeat.lastSuccessAt) : "Not recorded"}</SettingRow>
            <SettingRow label="Last failure">{heartbeat?.lastFailureAt ? formatDateTime(heartbeat.lastFailureAt) : "None recorded"}</SettingRow>
            <SettingRow label="Failed jobs">
              <StatusPill tone={failedRuns === 0 ? "accent" : "blocked"}>{failedRuns} in 7 days</StatusPill>
            </SettingRow>
            <SettingRow label="Last worker result">
              {heartbeat ? `${heartbeat.submitted} submitted, ${heartbeat.collected} collected` : "Not recorded"}
            </SettingRow>
          </dl>
        </SectionCard>

        <SectionCard title="Planned integration" subtitle="Coming next" icon="map">
          <EmptyState compact icon="map" title="Google Analytics 4">
            Add website engagement and conversion data alongside rankings and Search Console performance.
          </EmptyState>
        </SectionCard>
      </div>

      <SectionCard
        title="Audit trail"
        subtitle="Recent security and report activity"
        icon="lock"
        className="mt-4"
        aside={<span className="text-xs text-slate">{plural(auditLogs.length, "recent event")}</span>}
      >
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Event</th>
                <th>Result</th>
                <th>Actor</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap text-slate">{formatDateTime(log.createdAt)}</td>
                  <td>{readableAuditEvent(log.event)}</td>
                  <td><StatusPill tone={log.outcome === "success" ? "accent" : "blocked"}>{readableValue(log.outcome)}</StatusPill></td>
                  <td>{log.actorEmail ?? "System"}</td>
                  <td className="font-mono text-xs whitespace-nowrap">{log.entityType ?? "-"}{log.entityId ? ` · ${log.entityId.slice(0, 8)}` : ""}</td>
                </tr>
              ))}
              {auditLogs.length === 0 ? <EmptyRow colSpan={5}>No audit events have been recorded yet.</EmptyRow> : null}
            </tbody>
          </table>
        </TableWrap>
      </SectionCard>
    </div>
  );
}

async function getSettingsData() {
  try {
    const weekAgo = sevenDaysAgo();
    const [budget, heartbeat, failedRuns, auditLogs, gscConnections, managedUsers] = await Promise.all([
      getDataForSeoBudgetSummary(),
      prisma.workerHeartbeat.findUnique({ where: { key: "rank-worker" } }),
      prisma.rankRun.count({ where: { status: { in: ["failed", "blocked"] }, createdAt: { gte: weekAgo } } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.googleSearchConsoleConnection.findMany({
        orderBy: { connectedAt: "desc" },
        include: { _count: { select: { projects: true } } }
      }),
      prisma.userAccess.count({ where: { enabled: true } })
    ]);
    return { budget, heartbeat, failedRuns, auditLogs, gscConnections, managedUsers, dbUnavailable: false };
  } catch {
    return {
      budget: { limitUsd: 0, spentUsd: 0, reservedUsd: 0, availableUsd: 0 },
      heartbeat: null,
      failedRuns: 0,
      auditLogs: [],
      gscConnections: [],
      managedUsers: 0,
      dbUnavailable: true
    };
  }
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2">
      <dt className="text-slate">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function sevenDaysAgo() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}
