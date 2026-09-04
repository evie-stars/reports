import { updateProjectModules } from "@/actions/projects";
import { SubmitButton } from "@/components/submit-button";
import { SectionCard } from "@/components/ui/section-card";

export function ReportContentForm({
  projectId,
  reportModules,
  scheduleSearchTypes
}: {
  projectId: string;
  reportModules: string[];
  scheduleSearchTypes: string[];
}) {
  const updateProjectModulesWithId = updateProjectModules.bind(null, projectId);

  return (
    <SectionCard
      id="report-content"
      title="Report content"
      subtitle="Data included in this report"
      icon="drawer"
      aside={<span className="text-xs text-slate">Choose at least one</span>}
    >
      <form action={updateProjectModulesWithId} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ModuleOption
            value="rankings"
            title="SEO"
            description="Organic keyword positions, movement and ranked landing pages"
            defaultChecked={reportModules.includes("rankings")}
          />
          <ModuleOption
            value="maps"
            title="Maps"
            description="Google Maps positions across the selected areas and devices"
            defaultChecked={reportModules.includes("maps") || scheduleSearchTypes.includes("maps")}
          />
          <ModuleOption
            value="gsc"
            title="Search Console"
            description="Clicks, impressions, CTR and organic visibility"
            defaultChecked={reportModules.includes("gsc")}
          />
          <ModuleOption
            value="ga4"
            title="Google Analytics 4"
            description="Sessions, new users, engagement and key events"
            defaultChecked={reportModules.includes("ga4")}
          />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-xs text-slate">The monthly schedule runs each selected and connected data source together.</p>
          <SubmitButton pendingLabel="Saving content…">Save report content</SubmitButton>
        </div>
      </form>
    </SectionCard>
  );
}

function ModuleOption({
  value,
  title,
  description,
  defaultChecked = false,
  disabled = false
}: {
  value: string;
  title: string;
  description: string;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-xl border border-line p-3 transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-slate/40 has-[:checked]:border-accent has-[:checked]:bg-accent/5"}`}
      aria-disabled={disabled || undefined}
    >
      {disabled ? (
        <input type="checkbox" value={value} disabled className="accent-accent w-4 h-4 mt-0.5 shrink-0" />
      ) : (
        <input name="reportModules" type="checkbox" value={value} defaultChecked={defaultChecked} className="accent-accent w-4 h-4 mt-0.5 shrink-0" />
      )}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-slate mt-0.5">{description}</span>
      </span>
    </label>
  );
}
