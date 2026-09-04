import Link from "next/link";
import { disconnectProjectGa4Property, importProjectGa4Data, updateProjectGa4Property } from "@/actions/integrations";
import { Icon } from "@/components/icon";
import { ImportButton } from "@/components/import-button";
import { importStatusTone, importSummary, readableImportStatus } from "@/components/project/import-status";
import { PropertyPicker } from "@/components/property-picker";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDate } from "@/lib/format";
import { displayAnalyticsProperty, type AnalyticsProperty } from "@/lib/google-analytics";

export type Ga4PropertyOption = {
  connectionId: string;
  accountEmail: string;
  property: AnalyticsProperty;
};

export type Ga4PropertyOptions = {
  options: Ga4PropertyOption[];
  error: string | null;
};

type Ga4Project = {
  id: string;
  ga4ConnectionId: string | null;
  ga4PropertyId: string | null;
  ga4PropertyName: string | null;
  ga4AccountName: string | null;
  ga4ConnectedAt: Date | null;
  ga4ImportStatus: string;
  ga4ImportError: string | null;
  ga4LastImportedAt: Date | null;
  ga4ImportStartDate: Date | null;
  ga4ImportEndDate: Date | null;
  ga4ImportedRows: number;
};

export function AnalyticsCard({
  project,
  configured,
  connectionCount,
  properties,
  isAdmin
}: {
  project: Ga4Project;
  configured: boolean;
  /** Connected Google accounts that hold Analytics access. */
  connectionCount: number;
  properties: Ga4PropertyOptions;
  isAdmin: boolean;
}) {
  const mapProperty = updateProjectGa4Property.bind(null, project.id);
  const unmapProperty = disconnectProjectGa4Property.bind(null, project.id);
  const importData = importProjectGa4Data.bind(null, project.id);
  const mapped = Boolean(project.ga4PropertyId);

  return (
    <SectionCard
      id="analytics"
      title="Google Analytics 4"
      subtitle="Property mapping"
      icon="zoom-in"
      aside={
        <StatusPill tone={mapped ? "accent" : connectionCount > 0 ? "warn" : "blocked"}>
          {mapped ? "Mapped" : connectionCount > 0 ? "Select property" : "Not connected"}
        </StatusPill>
      }
    >
      {project.ga4PropertyId ? (
        <div className="space-y-3 mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-line bg-paper/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{displayAnalyticsProperty(project)}</p>
              <p className="text-xs text-slate">
                {project.ga4AccountName ? `${project.ga4AccountName} · ` : ""}{project.ga4PropertyId} · mapped {formatDate(project.ga4ConnectedAt) || "recently"}
              </p>
            </div>
            <form action={unmapProperty} className="shrink-0">
              <SubmitButton
                className="btn-danger"
                confirmMessage="Remove this Google Analytics mapping? Existing imported data will remain, but future imports will stop."
                pendingLabel="Removing…"
              >
                <Icon name="x" className="w-3.5 h-3.5" />Remove mapping
              </SubmitButton>
            </form>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <StatusPill tone={importStatusTone(project.ga4ImportStatus)}>{readableImportStatus(project.ga4ImportStatus)}</StatusPill>
              <p className="text-xs text-slate">
                {importSummary(
                  {
                    lastImportedAt: project.ga4LastImportedAt,
                    startDate: project.ga4ImportStartDate,
                    endDate: project.ga4ImportEndDate,
                    rows: project.ga4ImportedRows
                  },
                  "Import the previous 90 days of sessions, users, engagement and key events, split by channel."
                )}
              </p>
              {project.ga4ImportError ? <p className="text-xs text-blocked">{project.ga4ImportError}</p> : null}
            </div>
            <form action={importData} className="shrink-0">
              <ImportButton hasData={Boolean(project.ga4LastImportedAt)} />
            </form>
          </div>
        </div>
      ) : null}

      {!configured ? (
        <EmptyState icon="alert-circle" title="Google integrations are not configured" compact>
          The Google OAuth environment variables are missing from the server.
        </EmptyState>
      ) : connectionCount === 0 ? (
        <EmptyState
          icon="user-add"
          title="No Google account with Analytics access"
          compact
          action={isAdmin ? <Link className="btn-ghost" href="/settings"><Icon name="cog" className="w-3.5 h-3.5" />Open settings</Link> : undefined}
        >
          An administrator needs to grant Analytics access to a connected Google account before a property can be assigned.
        </EmptyState>
      ) : properties.options.length === 0 ? (
        <Notice tone="danger" title="No properties available.">
          {properties.error ?? "The connected account has no Google Analytics 4 properties."}
        </Notice>
      ) : (
        <form action={mapProperty} className="space-y-3">
          <PropertyPicker
            defaultValue={ga4DefaultValue(project, properties.options)}
            label="Analytics property"
            name="ga4Property"
            options={properties.options.map((option) => ({
              label: `${option.property.displayName} · ${option.property.accountName} · ${option.accountEmail}`,
              value: ga4OptionValue(option)
            }))}
            placeholder="Search by property, account or email"
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

function ga4OptionValue(option: Ga4PropertyOption) {
  return JSON.stringify({ connectionId: option.connectionId, propertyId: option.property.propertyId });
}

function ga4DefaultValue(
  project: { ga4ConnectionId: string | null; ga4PropertyId: string | null },
  options: Ga4PropertyOption[]
) {
  const selected = options.find((option) =>
    option.connectionId === project.ga4ConnectionId && option.property.propertyId === project.ga4PropertyId
  );
  return selected ? ga4OptionValue(selected) : "";
}
