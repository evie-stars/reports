import Link from "next/link";
import { disconnectProjectGscProperty, importProjectGscData, updateProjectGscProperty } from "@/actions/integrations";
import { GscImportButton } from "@/components/gsc-import-button";
import { Icon } from "@/components/icon";
import { PropertyPicker } from "@/components/property-picker";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCount, formatDate, formatDateTime, type Tone } from "@/lib/format";
import type { SearchConsoleSite } from "@/lib/google-search-console";

export type GscPropertyOption = {
  connectionId: string;
  accountEmail: string;
  site: SearchConsoleSite;
};

export type GscPropertyOptions = {
  options: GscPropertyOption[];
  error: string | null;
};

type GscProject = {
  id: string;
  gscConnectionId: string | null;
  gscPropertyUrl: string | null;
  gscPermissionLevel: string | null;
  gscConnectedAt: Date | null;
  gscImportStatus: string;
  gscImportError: string | null;
  gscLastImportedAt: Date | null;
  gscImportStartDate: Date | null;
  gscImportEndDate: Date | null;
  gscImportedRows: number;
};

export function SearchConsoleCard({
  project,
  configured,
  connectionCount,
  properties,
  isAdmin
}: {
  project: GscProject;
  configured: boolean;
  connectionCount: number;
  properties: GscPropertyOptions;
  isAdmin: boolean;
}) {
  const mapGscProperty = updateProjectGscProperty.bind(null, project.id);
  const unmapGscProperty = disconnectProjectGscProperty.bind(null, project.id);
  const importGscData = importProjectGscData.bind(null, project.id);
  const mapped = Boolean(project.gscPropertyUrl);

  return (
    <SectionCard
      id="search-console"
      title="Google Search Console"
      subtitle="Property mapping"
      icon="map"
      aside={
        <StatusPill tone={mapped ? "accent" : connectionCount > 0 ? "warn" : "blocked"}>
          {mapped ? "Mapped" : connectionCount > 0 ? "Select property" : "Not connected"}
        </StatusPill>
      }
    >
      {project.gscPropertyUrl ? (
        <div className="space-y-3 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-line bg-paper/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{displayGscProperty(project.gscPropertyUrl)}</p>
              <p className="text-xs text-slate">
                {readableGscPermission(project.gscPermissionLevel)} · mapped {formatDate(project.gscConnectedAt) || "recently"}
              </p>
            </div>
            <form action={unmapGscProperty} className="shrink-0">
              <SubmitButton
                className="btn-danger"
                confirmMessage="Remove this Search Console mapping? Existing imported data will remain, but future imports will stop."
                pendingLabel="Removing…"
              >
                <Icon name="x" className="w-3.5 h-3.5" />Remove mapping
              </SubmitButton>
            </form>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <StatusPill tone={gscImportStatusTone(project.gscImportStatus)}>{readableGscImportStatus(project.gscImportStatus)}</StatusPill>
              <p className="text-xs text-slate">{gscImportSummary(project)}</p>
              {project.gscImportError ? <p className="text-xs text-blocked">{project.gscImportError}</p> : null}
            </div>
            <form action={importGscData} className="shrink-0">
              <GscImportButton hasData={Boolean(project.gscLastImportedAt)} />
            </form>
          </div>
        </div>
      ) : null}

      {!configured ? (
        <EmptyState icon="alert-circle" title="Search Console is not configured" compact>
          Search Console environment variables are missing from the server.
        </EmptyState>
      ) : connectionCount === 0 ? (
        <EmptyState
          icon="user-add"
          title="No Google account connected"
          compact
          action={isAdmin ? <Link className="btn-ghost" href="/settings"><Icon name="cog" className="w-3.5 h-3.5" />Open settings</Link> : undefined}
        >
          An administrator needs to connect a Google account before a property can be assigned.
        </EmptyState>
      ) : properties.options.length === 0 ? (
        <Notice tone="danger" title="No properties available.">
          {properties.error ?? "The connected account has no available Search Console properties."}
        </Notice>
      ) : (
        <form action={mapGscProperty} className="space-y-3">
          <PropertyPicker
            defaultValue={gscDefaultValue(project, properties.options)}
            options={properties.options.map((option) => ({
              label: `${displayGscProperty(option.site.siteUrl)} · ${option.accountEmail}`,
              value: gscOptionValue(option)
            }))}
          />
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Saving property…"><Icon name="save" className="w-3.5 h-3.5" />Save property</SubmitButton>
          </div>
        </form>
      )}
      {properties.error && properties.options.length > 0 ? <p className="text-xs text-blocked mt-3">{properties.error}</p> : null}
    </SectionCard>
  );
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

function readableGscImportStatus(status: string) {
  if (status === "completed") return "Imported";
  if (status === "running") return "Importing";
  if (status === "failed") return "Failed";
  return "Ready";
}

function gscImportStatusTone(status: string): Tone {
  if (status === "completed") return "accent";
  if (status === "failed") return "blocked";
  return "warn";
}

function gscImportSummary(project: {
  gscLastImportedAt: Date | null;
  gscImportStartDate: Date | null;
  gscImportEndDate: Date | null;
  gscImportedRows: number;
}) {
  if (!project.gscLastImportedAt) return "Import the previous 90 days of final Google web-search data.";
  const range = project.gscImportStartDate && project.gscImportEndDate
    ? `${formatDate(project.gscImportStartDate)} to ${formatDate(project.gscImportEndDate)}`
    : "latest 90-day period";
  return `${formatCount(project.gscImportedRows)} daily snapshots · ${range} · refreshed ${formatDateTime(project.gscLastImportedAt)}`;
}
