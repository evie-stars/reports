import Link from "next/link";
import { redirect } from "next/navigation";
import { disconnectGoogleConnection } from "@/actions/integrations";
import { Icon } from "@/components/icon";
import { ApiKeyCard } from "@/components/settings/api-key-card";
import { NotificationsCard } from "@/components/settings/notifications-card";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { currentActor } from "@/lib/access";
import { allSecretStatuses, canManageSecrets, isSecretName, SECRET_DEFINITIONS, secretStoreLocked } from "@/lib/app-secrets";
import { BACKUP_HEARTBEAT_KEY, BACKUP_STALE_HOURS_ENV, backupHealth, DEFAULT_BACKUP_STALE_HOURS } from "@/lib/backups";
import { getDataForSeoBudgetSummary } from "@/lib/dataforseo-costs";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime, formatUsd, plural, readableAuditEvent, readableValue, type Tone } from "@/lib/format";
import {
  connectionHasScope,
  GA4_READONLY_SCOPE,
  GOOGLE_INTEGRATION_PRODUCTS,
  googleIntegrationsSetup,
  GSC_READONLY_SCOPE,
  isGoogleIntegrationProduct,
  type GoogleIntegrationProduct,
  type GoogleIntegrationsSetup
} from "@/lib/google-oauth";
import { notificationStatus } from "@/lib/notifications";
import { MASTER_KEY_ENV, masterEncryptionKeyConfigured, readPreviousEncryptionKey } from "@/lib/secret-crypto";
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
  searchParams: Promise<{
    google?: string;
    googleWarning?: string;
    googleError?: string;
    secret?: string;
    secretName?: string;
    secretError?: string;
    notify?: string;
    notifyError?: string;
  }>;
}) {
  const { google, googleWarning, googleError, secret, secretName, secretError, notify, notifyError } = await searchParams;
  const actor = await currentActor();
  if (actor.role !== "admin") redirect("/");
  const sandbox = process.env.DATAFORSEO_SANDBOX !== "false";
  const liveEnabled = process.env.DATAFORSEO_LIVE_ENABLED === "true";
  const maxLiveTasks = process.env.DATAFORSEO_MAX_LIVE_TASKS_PER_RUN ?? "1";
  const maxStandardTasks = process.env.DATAFORSEO_MAX_STANDARD_TASKS_PER_RUN ?? "1000";
  const keywordMetricsEnabled = process.env.DATAFORSEO_KEYWORD_METRICS_ENABLED === "true";
  const authEnabled = process.env.AUTH_ENABLED === "true";
  const [googleSetup, secrets, notifications, { budget, heartbeat, backupHeartbeat, failedRuns, auditLogs, connections, managedUsers, dbUnavailable }] = await Promise.all([
    googleIntegrationsSetup(),
    allSecretStatuses(),
    notificationStatus(),
    getSettingsData()
  ]);
  const googleConfigured = googleSetup.configured;
  const dataForSeoSecret = secrets.find((summary) => summary.name === "dataforseo");
  const credentialsConfigured = dataForSeoSecret?.configured ?? false;
  const canRotateKeys = canManageSecrets(actor);
  const keyStoreDisabledReason = masterEncryptionKeyConfigured()
    ? undefined
    : `${MASTER_KEY_ENV} is not set on the server. Generate one with "openssl rand -hex 32", add it in Plesk, and restart the app.`;
  const keyStoreUsable = !keyStoreDisabledReason && !secretStoreLocked();
  const previousKeyConfigured = Boolean(readPreviousEncryptionKey());
  const secretLabel = isSecretName(secretName) ? SECRET_DEFINITIONS[secretName].label : "API key";
  const worker = workerHealth(heartbeat);
  const backups = backupHealth(backupHeartbeat);
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
      {secret === "saved" ? <Notice tone="success" title={`${secretLabel} credentials saved and verified.`}>They apply to new requests immediately.</Notice> : null}
      {secret === "saved-unverified" ? (
        <Notice tone="warn" title={`${secretLabel} credentials saved, but could not be verified.`}>The provider did not answer conclusively. Run a test from the card below.</Notice>
      ) : null}
      {secret === "verified" ? <Notice tone="success" title={`${secretLabel} credentials verified.`}>The provider accepted them.</Notice> : null}
      {secret === "rolled-back" ? <Notice tone="success" title={`Previous ${secretLabel} credentials restored.`}>Run a test to confirm they still work.</Notice> : null}
      {secret === "removed" ? <Notice tone="success" title={`${secretLabel} credentials removed from the app.`}>The server environment value is used now, if one is set.</Notice> : null}
      {secretError ? <Notice tone="danger" title={`${secretLabel} credentials were not changed.`} role="alert">{secretError}</Notice> : null}
      {notify === "sent" ? <Notice tone="success" title="Test email sent.">Check the inbox for {actor.email}.</Notice> : null}
      {notifyError ? <Notice tone="danger" title="Test email was not sent." role="alert">{notifyError}</Notice> : null}
      {previousKeyConfigured ? (
        <Notice tone="warn" title="A previous master key is still configured.">
          Stored values still open with it for now. Run <code className="font-mono text-xs">npm run secrets:rekey</code>, then remove APP_SECRETS_PREVIOUS_ENCRYPTION_KEY and the legacy GOOGLE_SEARCH_CONSOLE_TOKEN_ENCRYPTION_KEY.
        </Notice>
      ) : null}
      {dbUnavailable ? (
        <Notice tone="warn" title="Database not connected yet.">Budget, worker health, connections and audit events will appear here once the database is configured.</Notice>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="DataForSEO" subtitle="Ranking data provider" icon="cog">
          <dl className="divide-y divide-line text-sm">
            <SettingRow label="Credentials">
              <StatusPill tone={credentialsConfigured ? "accent" : "blocked"}>
                {dataForSeoSecret?.unavailable
                  ? "Store unavailable"
                  : !credentialsConfigured
                    ? dataForSeoSecret?.source === "app" ? "Unreadable" : "Missing"
                    : dataForSeoSecret?.source === "app" ? "Stored in app" : "Server environment"}
              </StatusPill>
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
          setup={googleSetup}
          keyStoreUsable={keyStoreUsable}
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
          setup={googleSetup}
          keyStoreUsable={keyStoreUsable}
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

        <NotificationsCard status={notifications} actorEmail={actor.email} />

        <SectionCard title="Operations" subtitle="Rank worker and database backups" icon="refresh">
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
            <SettingRow label="Database backup">
              <StatusPill tone={backups.healthy ? "accent" : backups.state === "never" ? "warn" : "blocked"}>{backups.label}</StatusPill>
              {backups.state === "never" ? (
                <span className="block text-xs text-slate mt-1">Add the daily <code className="font-mono">npm run db:backup</code> task in Plesk (README, “Database Backups”).</span>
              ) : null}
              {backups.state === "stale" ? <span className="block text-xs text-warn mt-1">No successful backup within the last {process.env[BACKUP_STALE_HOURS_ENV] || DEFAULT_BACKUP_STALE_HOURS} hours. Check the Plesk scheduled task.</span> : null}
              {backups.label === "Did not finish" && backupHeartbeat?.startedAt ? <span className="block text-xs text-blocked mt-1">The run started {formatDateTime(backupHeartbeat.startedAt)} never recorded a result. Check the Plesk task output and the server log.</span> : null}
            </SettingRow>
            <SettingRow label="Last backup">
              {backupHeartbeat?.lastSuccessAt ? (
                <>
                  <span>{formatDateTime(backupHeartbeat.lastSuccessAt)}</span>
                  {backupHeartbeat.status === "healthy" && backupHeartbeat.message ? <span className="block text-xs text-slate mt-1 break-words">{backupHeartbeat.message}</span> : null}
                </>
              ) : "Not recorded"}
            </SettingRow>
            <SettingRow label="Last backup failure">
              {backupHeartbeat?.lastFailureAt ? (
                <>
                  <span>{formatDateTime(backupHeartbeat.lastFailureAt)}</span>
                  {backupHeartbeat.status === "failed" && backupHeartbeat.message ? <span className="block text-xs text-blocked mt-1 break-words">{backupHeartbeat.message}</span> : null}
                </>
              ) : "None recorded"}
            </SettingRow>
          </dl>
        </SectionCard>
      </div>

      <div id="api-keys" className="mt-6">
        <div className="mb-3">
          <h2 className="text-base">API keys</h2>
          <p className="text-xs text-slate mt-0.5">
            Rotate provider credentials without touching the server. Values are encrypted with the server-held key, never shown again, and audited on every change.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {secrets.map((summary) => (
            <ApiKeyCard key={summary.name} summary={summary} canManage={canRotateKeys} disabledReason={keyStoreDisabledReason} />
          ))}
        </div>
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
  setup,
  keyStoreUsable,
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
  setup: GoogleIntegrationsSetup;
  /** False when the in-app key store cannot take a value (no master key, or locked to the environment). */
  keyStoreUsable: boolean;
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
        <p className="text-sm text-slate">Before an account can be connected: {missingGoogleSetup(setup, keyStoreUsable)}.</p>
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

function missingGoogleSetup(setup: GoogleIntegrationsSetup, keyStoreUsable: boolean) {
  const missing = [
    ...(setup.masterKey ? [] : [`set ${MASTER_KEY_ENV} in Plesk`]),
    ...(setup.redirectUri ? [] : ["set GOOGLE_SEARCH_CONSOLE_REDIRECT_URI in Plesk"]),
    ...(setup.credentials
      ? []
      : [keyStoreUsable
        ? "save the Google client ID and secret under API keys below"
        : "set GOOGLE_SEARCH_CONSOLE_CLIENT_ID and GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET in Plesk"])
  ];
  return missing.join(", then ");
}

function connectHref(product: GoogleIntegrationProduct) {
  return `/api/integrations/google/start?product=${product}`;
}

async function getSettingsData() {
  try {
    const weekAgo = sevenDaysAgo();
    const [budget, heartbeat, backupHeartbeat, failedRuns, auditLogs, connections, managedUsers] = await Promise.all([
      getDataForSeoBudgetSummary(),
      prisma.workerHeartbeat.findUnique({ where: { key: "rank-worker" } }),
      prisma.workerHeartbeat.findUnique({ where: { key: BACKUP_HEARTBEAT_KEY } }),
      prisma.rankRun.count({ where: { status: { in: ["failed", "blocked"] }, createdAt: { gte: weekAgo } } }),
      prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.googleConnection.findMany({
        orderBy: { connectedAt: "desc" },
        include: { _count: { select: { gscProjects: true, ga4Projects: true } } }
      }),
      prisma.userAccess.count({ where: { enabled: true } })
    ]);
    return { budget, heartbeat, backupHeartbeat, failedRuns, auditLogs, connections, managedUsers, dbUnavailable: false };
  } catch {
    return {
      budget: { limitUsd: 0, spentUsd: 0, reservedUsd: 0, availableUsd: 0 },
      heartbeat: null,
      backupHeartbeat: null,
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
