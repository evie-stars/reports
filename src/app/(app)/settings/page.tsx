import Link from "next/link";
import { redirect } from "next/navigation";
import { disconnectGoogleConnection } from "@/actions/integrations";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { currentActor } from "@/lib/access";
import { getDataForSeoBudgetSummary } from "@/lib/dataforseo-costs";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatUsd, plural, readableAuditEvent, readableValue, type Tone } from "@/lib/format";
import {
  connectionHasScope,
  GA4_READONLY_SCOPE,
  GOOGLE_INTEGRATION_PRODUCTS,
  googleIntegrationsConfigured,
  GSC_READONLY_SCOPE,
  isGoogleIntegrationProduct,
  type GoogleIntegrationProduct
} from "@/lib/google-oauth";
import { workerHealth } from "@/lib/worker-health";

export const dynamic = "force-dynamic";

type GoogleConnectionRow = {
  id: string;
  accountEmail: string;
  connectedAt: Date;
  lastError: string | null;
  grantedScopes: string[];
  _count: { gscProjects: number; ga4Projects: number };
};

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ google?: string; googleWarning?: string; googleError?: string }>;
}) {
  const { google, googleWarning, googleError } = await searchParams;
  const actor = await currentActor();
  if (actor.role !== "admin") redirect("/");
  const sandbox = process.env.DATAFORSEO_SANDBOX !== "false";
  const liveEnabled = process.env.DATAFORSEO_LIVE_ENABLED === "true";
  const maxLiveTasks = process.env.DATAFORSEO_MAX_LIVE_TASKS_PER_RUN ?? "1";
  const maxStandardTasks = process.env.DATAFORSEO_MAX_STANDARD_TASKS_PER_RUN ?? "1000";
  const keywordMetricsEnabled = process.env.DATAFORSEO_KEYWORD_METRICS_ENABLED === "true";
  const credentialsConfigured = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const authEnabled = process.env.AUTH_ENABLED === "true";
  const googleConfigured = googleIntegrationsConfigured();
  const { budget, heartbeat, failedRuns, auditLogs, connections, managedUsers, dbUnavailable } = await getSettingsData();
  const worker = workerHealth(heartbeat);
  const allowedAccessConfigured = managedUsers > 0 || Boolean(process.env.AUTH_ALLOWED_EMAILS || process.env.AUTH_ALLOWED_DOMAINS);
  const gscConnections = connections.filter((connection) => connectionHasScope(connection, GSC_READONLY_SCOPE));
  const ga4Connections = connections.filter((connection) => connectionHasScope(connection, GA4_READONLY_SCOPE));
  const connectedProduct = isGoogleIntegrationProduct(google) ? google : null;
  const warnedProduct = isGoogleIntegrationProduct(googleWarning) ? googleWarning : null;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Connections, access controls and reporting safeguards." />

      {connectedProduct ? (
        <Notice tone="success" title={`${GOOGLE_INTEGRATION_PRODUCTS[connectedProduct].label} connected.`}>
          You can now assign properties from each report’s settings.
        </Notice>
      ) : null}
      {warnedProduct ? (
        <Notice
          tone="warn"
          title={`${GOOGLE_INTEGRATION_PRODUCTS[warnedProduct].label} access is no longer granted for that account.`}
          action={<Link className="btn-ghost" href={connectHref(warnedProduct)}>Grant it again</Link>}
        >
          Reports mapped to it will stop refreshing until the access is granted again.
        </Notice>
      ) : null}
      {googleError ? <Notice tone="danger" title="Google account was not connected.">{googleError}</Notice> : null}
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

        <GoogleProductCard
          product="search-console"
          title="Google Search Console"
          subtitle="Organic performance data"
          icon="search"
          configured={googleConfigured}
          connections={gscConnections}
          otherConnections={connections.length - gscConnections.length}
          mappedCount={(connection) => connection._count.gscProjects}
          intro="Connect the internal Google account that has access to your client properties."
        />

        <GoogleProductCard
          product="analytics"
          title="Google Analytics 4"
          subtitle="Website traffic and engagement"
          icon="zoom-in"
          configured={googleConfigured}
          connections={ga4Connections}
          otherConnections={connections.length - ga4Connections.length}
          mappedCount={(connection) => connection._count.ga4Projects}
          intro="Grant read-only Analytics access to a Google account that can see your client properties."
        />

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

/**
 * One card per Google product. The same connected account can appear in both cards when it holds
 * both scopes; disconnecting removes the account (and every mapping it holds) from both.
 */
function GoogleProductCard({
  product,
  title,
  subtitle,
  icon,
  configured,
  connections,
  otherConnections,
  mappedCount,
  intro
}: {
  product: GoogleIntegrationProduct;
  title: string;
  subtitle: string;
  icon: "search" | "zoom-in";
  configured: boolean;
  connections: GoogleConnectionRow[];
  /** Connected accounts that have not granted this product. */
  otherConnections: number;
  mappedCount: (connection: GoogleConnectionRow) => number;
  intro: string;
}) {
  const label = GOOGLE_INTEGRATION_PRODUCTS[product].label;
  const tone: Tone = connections.length > 0 ? "accent" : configured ? "warn" : "blocked";
  const status = connections.length > 0 ? "Connected" : configured ? "Ready" : "Setup required";

  return (
    <SectionCard title={title} subtitle={subtitle} icon={icon} aside={<StatusPill tone={tone}>{status}</StatusPill>}>
      {!configured ? (
        <p className="text-sm text-slate">Add the four Google integration environment variables before connecting an account.</p>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-slate">{intro}</p>
          <Link className="btn-primary" href={connectHref(product)}>
            <Icon name="add" className="w-3.5 h-3.5" />
            {otherConnections > 0 ? `Grant ${label} access` : "Connect Google account"}
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map((connection) => {
            const disconnect = disconnectGoogleConnection.bind(null, connection.id);
            return (
              <div className="rounded-xl border border-line p-3 flex items-center justify-between gap-3" key={connection.id}>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{connection.accountEmail}</p>
                  <p className="text-xs text-slate">
                    {plural(mappedCount(connection), "mapped report")} · connected {formatDate(connection.connectedAt)}
                  </p>
                  {connection.lastError ? <p className="text-xs text-blocked mt-1">{connection.lastError}</p> : null}
                </div>
                <form action={disconnect} className="shrink-0">
                  <SubmitButton
                    className="btn-danger"
                    confirmMessage={`Disconnect ${connection.accountEmail}? Search Console and Analytics mappings for every report using this account will be removed.`}
                    pendingLabel="Disconnecting..."
                  >
                    Disconnect
                  </SubmitButton>
                </form>
              </div>
            );
          })}
          <Link className="btn-ghost" href={connectHref(product)}>
            <Icon name="add" className="w-3.5 h-3.5" />
            {otherConnections > 0 ? `Grant ${label} access to another account` : "Connect another account"}
          </Link>
        </div>
      )}
    </SectionCard>
  );
}

function connectHref(product: GoogleIntegrationProduct) {
  return `/api/integrations/google/start?product=${product}`;
}

async function getSettingsData() {
  try {
    const weekAgo = sevenDaysAgo();
    const [budget, heartbeat, failedRuns, auditLogs, connections, managedUsers] = await Promise.all([
      getDataForSeoBudgetSummary(),
      prisma.workerHeartbeat.findUnique({ where: { key: "rank-worker" } }),
      prisma.rankRun.count({ where: { status: { in: ["failed", "blocked"] }, createdAt: { gte: weekAgo } } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.googleConnection.findMany({
        orderBy: { connectedAt: "desc" },
        include: { _count: { select: { gscProjects: true, ga4Projects: true } } }
      }),
      prisma.userAccess.count({ where: { enabled: true } })
    ]);
    return { budget, heartbeat, failedRuns, auditLogs, connections, managedUsers, dbUnavailable: false };
  } catch {
    return {
      budget: { limitUsd: 0, spentUsd: 0, reservedUsd: 0, availableUsd: 0 },
      heartbeat: null,
      failedRuns: 0,
      auditLogs: [],
      connections: [] as GoogleConnectionRow[],
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
