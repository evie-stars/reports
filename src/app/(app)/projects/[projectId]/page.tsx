import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AreaPickerForm } from "@/components/area-picker-form";
import { Icon } from "@/components/icon";
import { AddKeywordsForm } from "@/components/project/add-keywords-form";
import { AnalyticsCard, type Ga4PropertyOption, type Ga4PropertyOptions } from "@/components/project/analytics-card";
import { KeywordMetricsCard } from "@/components/project/keyword-metrics-card";
import { ProjectDetailsForm } from "@/components/project/project-details-form";
import { RecentRunsCard } from "@/components/project/recent-runs-card";
import { ReportContentForm } from "@/components/project/report-content-form";
import { ScheduleForm } from "@/components/project/schedule-form";
import { SearchConsoleCard, type GscPropertyOption, type GscPropertyOptions } from "@/components/project/search-console-card";
import { SettingsNav } from "@/components/project/settings-nav";
import { TestingTools } from "@/components/project/testing-tools";
import { KeywordTable, LocationTable } from "@/components/project/tracking-tables";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { prisma } from "@/lib/db";
import { canManageReports, currentActor } from "@/lib/access";
import { GA4_READONLY_SCOPE, listAnalyticsProperties } from "@/lib/google-analytics";
import { connectionHasScope, googleIntegrationsConfigured, GSC_READONLY_SCOPE } from "@/lib/google-oauth";
import { listSearchConsoleSites } from "@/lib/google-search-console";

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
    gscImported?: string;
    gscImportError?: string;
    ga4Error?: string;
    ga4Mapped?: string;
    ga4Imported?: string;
    ga4ImportError?: string;
    keywordsAdded?: string;
    duplicatesSkipped?: string;
  }>;
}) {
  const { projectId } = await params;
  const {
    sandboxError,
    liveError,
    metricsError,
    metricsQueued,
    gscError,
    gscMapped,
    gscImported,
    gscImportError,
    ga4Error,
    ga4Mapped,
    ga4Imported,
    ga4ImportError,
    keywordsAdded,
    duplicatesSkipped
  } = await searchParams;
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
  if (!canManageReports(actor.role)) redirect(`/clients/${project.clientId}`);

  const isAdmin = actor.role === "admin";
  const googleConfigured = googleIntegrationsConfigured();
  const connections = googleConfigured ? await prisma.googleConnection.findMany({
    orderBy: { accountEmail: "asc" },
    select: { id: true, accountEmail: true, encryptedRefreshToken: true, grantedScopes: true }
  }) : [];
  // Each product only ever sees the accounts that actually granted it, so an Analytics-only account
  // never produces a Search Console permission error on this page (or vice versa).
  const gscConnections = connections.filter((connection) => connectionHasScope(connection, GSC_READONLY_SCOPE));
  const ga4Connections = connections.filter((connection) => connectionHasScope(connection, GA4_READONLY_SCOPE));
  const [gscProperties, ga4Properties] = await Promise.all([
    loadGscPropertyOptions(gscConnections),
    loadGa4PropertyOptions(ga4Connections)
  ]);

  const activeKeywords = project.keywords.filter((keyword) => keyword.active);
  const activeLocations = project.locations.filter((location) => location.active);
  const keywordChoices = activeKeywords.map((keyword) => ({ id: keyword.id, label: keyword.phrase }));
  const locationChoices = activeLocations.map((location) => ({ id: location.id, label: location.name }));
  const credentialsConfigured = Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const liveEnabled = process.env.DATAFORSEO_LIVE_ENABLED === "true";
  const metricsEnabled = process.env.DATAFORSEO_KEYWORD_METRICS_ENABLED === "true";

  return (
    <div>
      <PageHeader
        eyebrow={project.client.name}
        title={project.name}
        subtitle={`Tracking settings for ${project.domain}${project.serviceArea ? ` · ${project.serviceArea}` : ""}`}
        actions={
          <Link className="btn-ghost" href={`/clients/${project.client.id}`}>
            <Icon name="eye" className="w-3.5 h-3.5" />View report
          </Link>
        }
      />

      {sandboxError ? <Notice tone="danger" title="Sandbox check not started." role="alert">{sandboxError}</Notice> : null}
      {liveError ? <Notice tone="danger" title="Live check not started." role="alert">{liveError}</Notice> : null}
      {metricsError ? <Notice tone="danger" title="Keyword metrics not queued." role="alert">{metricsError}</Notice> : null}
      {metricsQueued ? <Notice tone="success" title="Keyword metrics queued." role="status">The worker will submit and collect them.</Notice> : null}
      {gscError ? <Notice tone="danger" title="Search Console property not saved." role="alert">{gscError}</Notice> : null}
      {gscMapped ? <Notice tone="success" title="Search Console property mapped." role="status">This report is ready for its first data import.</Notice> : null}
      {gscImported !== undefined ? (
        <Notice tone="success" title="Search Console data imported." role="status">
          {gscImported} daily snapshot{gscImported === "1" ? "" : "s"} stored.
        </Notice>
      ) : null}
      {gscImportError ? <Notice tone="danger" title="Search Console import failed." role="alert">{gscImportError}</Notice> : null}
      {ga4Error ? <Notice tone="danger" title="Google Analytics property not saved." role="alert">{ga4Error}</Notice> : null}
      {ga4Mapped ? <Notice tone="success" title="Google Analytics property mapped." role="status">This report is ready for its first data import.</Notice> : null}
      {ga4Imported !== undefined ? (
        <Notice tone="success" title="Google Analytics data imported." role="status">
          {ga4Imported} daily snapshot{ga4Imported === "1" ? "" : "s"} stored.
        </Notice>
      ) : null}
      {ga4ImportError ? <Notice tone="danger" title="Google Analytics import failed." role="alert">{ga4ImportError}</Notice> : null}
      {keywordsAdded !== undefined ? (
        <Notice tone="success" title={`${keywordsAdded} keyword${keywordsAdded === "1" ? "" : "s"} added.`} role="status">
          {Number(duplicatesSkipped) > 0 ? `${duplicatesSkipped} duplicate${duplicatesSkipped === "1" ? " was" : "s were"} skipped.` : null}
        </Notice>
      ) : null}

      <SettingsNav showTesting={isAdmin} />

      <div className="space-y-4">
        <ProjectDetailsForm
          project={project}
          activeKeywordCount={activeKeywords.length}
          activeLocationCount={activeLocations.length}
          recentRunCount={project.rankRuns.length}
        />

        <ReportContentForm projectId={project.id} reportModules={project.reportModules} scheduleSearchTypes={project.scheduleSearchTypes} />

        <SearchConsoleCard
          project={project}
          configured={googleConfigured}
          connectionCount={gscConnections.length}
          properties={gscProperties}
          isAdmin={isAdmin}
        />

        <AnalyticsCard
          project={project}
          configured={googleConfigured}
          connectionCount={ga4Connections.length}
          properties={ga4Properties}
          isAdmin={isAdmin}
        />

        <ScheduleForm project={project} activeKeywordCount={activeKeywords.length} activeLocationCount={activeLocations.length} />

        {isAdmin ? (
          <KeywordMetricsCard
            projectId={project.id}
            status={project.keywordMetricsStatus}
            error={project.keywordMetricsError}
            activeKeywordCount={activeKeywords.length}
            metricsEnabled={metricsEnabled}
          />
        ) : null}

        {isAdmin ? (
          <TestingTools
            projectId={project.id}
            keywords={keywordChoices}
            locations={locationChoices}
            credentialsConfigured={credentialsConfigured}
            liveEnabled={liveEnabled}
          />
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" id="tracking-lists">
          <AddKeywordsForm projectId={project.id} />
          <AreaPickerForm projectId={project.id} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <KeywordTable projectId={project.id} keywords={project.keywords} />
          <LocationTable projectId={project.id} locations={project.locations} />
        </div>

        <RecentRunsCard runs={project.rankRuns} />
      </div>
    </div>
  );
}

type ConnectionOption = {
  id: string;
  accountEmail: string;
  encryptedRefreshToken: string;
};

async function loadGscPropertyOptions(connections: ConnectionOption[]): Promise<GscPropertyOptions> {
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

async function loadGa4PropertyOptions(connections: ConnectionOption[]): Promise<Ga4PropertyOptions> {
  const results = await Promise.all(connections.map(async (connection) => {
    try {
      const properties = await listAnalyticsProperties(connection.encryptedRefreshToken);
      return {
        options: properties.map((property) => ({ connectionId: connection.id, accountEmail: connection.accountEmail, property })),
        error: null
      };
    } catch (error) {
      return {
        options: [] as Ga4PropertyOption[],
        error: `${connection.accountEmail}: ${error instanceof Error ? error.message : "Unable to list properties."}`
      };
    }
  }));

  return {
    options: results.flatMap((result) => result.options),
    error: results.map((result) => result.error).filter(Boolean).join(" ") || null
  };
}
