import type { Device, ReportModule, SearchType } from "@prisma/client";
import { updateProjectSchedule } from "@/actions/projects";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { estimateRankRunCost } from "@/lib/dataforseo-costs";
import { formatUsd } from "@/lib/format";
import { enabledRankSearchTypes, hasRankTracking } from "@/lib/report-modules";

const DAYS = Array.from({ length: 28 }, (_, index) => index + 1);
const PAGES = Array.from({ length: 10 }, (_, index) => index + 1);

export function ScheduleForm({
  project,
  activeKeywordCount,
  activeLocationCount
}: {
  project: {
    id: string;
    reportModules: ReportModule[];
    scheduleEnabled: boolean;
    scheduleDay: number;
    schedulePageLimit: number;
    scheduleDevices: Device[];
    scheduleSearchTypes: SearchType[];
    gscPropertyUrl: string | null;
    ga4PropertyId: string | null;
  };
  activeKeywordCount: number;
  activeLocationCount: number;
}) {
  if (project.reportModules.length === 0) {
    return (
      <SectionCard id="schedule" title="Monthly schedule" subtitle="No schedulable data selected" icon="calendar">
        <EmptyState icon="calendar" title="Nothing to schedule yet" compact>
          Enable at least one data source in Report content before scheduling reports.
        </EmptyState>
      </SectionCard>
    );
  }

  const updateScheduleWithId = updateProjectSchedule.bind(null, project.id);
  const scheduledSearchTypes = enabledRankSearchTypes(project.reportModules, project.scheduleSearchTypes);
  const rankingsSelected = hasRankTracking(project.reportModules);
  const scheduleEstimate = estimateRankRunCost({
    keywordCount: activeKeywordCount,
    locationCount: activeLocationCount,
    devices: project.scheduleDevices,
    searchTypes: scheduledSearchTypes.length > 0 ? scheduledSearchTypes : ["organic"],
    pageLimit: project.schedulePageLimit
  }, "standard");
  const taskCount = activeKeywordCount * activeLocationCount * project.scheduleDevices.length * Math.max(1, scheduledSearchTypes.length);

  return (
    <SectionCard id="schedule" title="Monthly schedule" subtitle="Automated monthly report" icon="calendar">
      <form action={updateScheduleWithId} className="space-y-4">
        <label className="choice">
          <input name="scheduleEnabled" type="checkbox" defaultChecked={project.scheduleEnabled} />
          <span>Enabled · run this report automatically each month</span>
        </label>

        <div className={`grid grid-cols-1 gap-3 ${rankingsSelected ? "sm:grid-cols-3" : "sm:max-w-xs"}`}>
          <label className="block">
            <span className="field-label">Day of month</span>
            <select name="scheduleDay" defaultValue={project.scheduleDay} className="field">
              {DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
          </label>
          {rankingsSelected ? (
            <label className="block">
              <span className="field-label">Pages to search</span>
              <select name="schedulePageLimit" defaultValue={project.schedulePageLimit} className="field">
                {PAGES.map((page) => <option key={page} value={page}>{page}</option>)}
              </select>
            </label>
          ) : null}
          {rankingsSelected ? (
            <fieldset className="min-w-0">
              <legend className="field-label">Devices</legend>
              <div className="flex flex-wrap gap-4 pt-1.5">
                <label className="choice">
                  <input name="scheduleDevices" type="checkbox" value="desktop" defaultChecked={project.scheduleDevices.includes("desktop")} />
                  <span>Desktop</span>
                </label>
                <label className="choice">
                  <input name="scheduleDevices" type="checkbox" value="mobile" defaultChecked={project.scheduleDevices.includes("mobile")} />
                  <span>Mobile</span>
                </label>
              </div>
            </fieldset>
          ) : null}
          {scheduledSearchTypes.map((type) => <input key={type} type="hidden" name="scheduleSearchTypes" value={type} />)}
          {!rankingsSelected ? (
            <>
              <input type="hidden" name="schedulePageLimit" value={project.schedulePageLimit} />
              {project.scheduleDevices.map((device) => <input key={device} type="hidden" name="scheduleDevices" value={device} />)}
            </>
          ) : null}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-line">
          <p className="text-xs text-slate">
            {rankingsSelected
              ? `${scheduledSearchTypes.map((type) => type === "organic" ? "SEO" : "Maps").join(" + ")}: ${taskCount} Standard task(s), maximum estimate ${formatUsd(scheduleEstimate)}. `
              : ""}
            {project.reportModules.includes("gsc")
              ? `Search Console: ${project.gscPropertyUrl ? "mapped and ready" : "property mapping required"}. `
              : ""}
            {project.reportModules.includes("ga4")
              ? `Analytics: ${project.ga4PropertyId ? "mapped and ready" : "property mapping required"}.`
              : ""}
          </p>
          <SubmitButton pendingLabel="Saving schedule…"><Icon name="save" className="w-3.5 h-3.5" />Save schedule</SubmitButton>
        </div>
      </form>
    </SectionCard>
  );
}
