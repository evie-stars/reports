"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";

import type { SnapshotModule } from "@/lib/report-snapshot";

export function SnapshotCreateForm({
  action,
  availability
}: {
  action: (formData: FormData) => void | Promise<void>;
  availability: Record<SnapshotModule, boolean>;
}) {
  const [selected, setSelected] = useState<SnapshotModule[]>(
    (Object.keys(availability) as SnapshotModule[]).filter((module) => availability[module])
  );
  const hasAvailableData = Object.values(availability).some(Boolean);

  function toggle(module: SnapshotModule, checked: boolean) {
    setSelected((current) => checked
      ? Array.from(new Set([...current, module]))
      : current.filter((item) => item !== module));
  }

  return (
    <form action={action} className="space-y-4">
      <fieldset>
        <legend className="field-label">Include</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          <SnapshotOption
            checked={selected.includes("rankings")}
            description="Organic rankings and progress"
            enabled={availability.rankings}
            label="SEO"
            module="rankings"
            onChange={toggle}
          />
          <SnapshotOption
            checked={selected.includes("maps")}
            description="Google Maps rankings"
            enabled={availability.maps}
            label="Maps"
            module="maps"
            onChange={toggle}
          />
          <SnapshotOption
            checked={selected.includes("gsc")}
            description={availability.gsc ? "Clicks and visibility" : "Map and import data first"}
            enabled={availability.gsc}
            label="Search Console"
            module="gsc"
            onChange={toggle}
          />
          <SnapshotOption
            checked={selected.includes("ga4")}
            description={availability.ga4 ? "Sessions, new users and key events" : "Map and import data first"}
            enabled={availability.ga4}
            label="Analytics"
            module="ga4"
            onChange={toggle}
          />
        </div>
      </fieldset>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <label className="block sm:w-44">
          <span className="field-label">Snapshot lifetime</span>
          <select name="shareExpiryDays" defaultValue="30" className="field">
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton disabled={selected.length === 0} pendingLabel="Creating snapshot...">Create snapshot</SubmitButton>
          {!hasAvailableData ? (
            <p className="text-xs text-slate">Add or import report data before creating a snapshot.</p>
          ) : selected.length === 0 ? (
            <p className="text-xs text-slate">Select at least one report section.</p>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function SnapshotOption({
  checked,
  description,
  enabled,
  label,
  module,
  onChange
}: {
  checked: boolean;
  description: string;
  enabled: boolean;
  label: string;
  module: SnapshotModule;
  onChange: (module: SnapshotModule, checked: boolean) => void;
}) {
  return (
    <label
      className={`choice flex items-start rounded-xl border border-line p-3 transition-colors has-[:checked]:border-accent has-[:checked]:bg-accent/5 ${enabled ? "hover:border-slate/40" : "opacity-50 cursor-not-allowed"}`}
    >
      <input
        checked={checked}
        disabled={!enabled}
        name="snapshotModules"
        onChange={(event) => onChange(module, event.target.checked)}
        type="checkbox"
        value={module}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-slate">{description}</span>
      </span>
    </label>
  );
}
