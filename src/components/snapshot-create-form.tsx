"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";

type SnapshotModule = "rankings" | "maps" | "gsc";

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
    <form className="snapshot-create-form" action={action}>
      <fieldset className="snapshot-module-options">
        <legend>Include</legend>
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
        <label className="disabled">
          <input type="checkbox" disabled />
          <span><strong>Analytics</strong><small>Available after GA4 is connected</small></span>
        </label>
      </fieldset>
      <label className="share-expiry-select">
        Snapshot lifetime
        <select name="shareExpiryDays" defaultValue="30">
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="365">1 year</option>
        </select>
      </label>
      <div className="snapshot-create-action">
        <SubmitButton disabled={selected.length === 0} pendingLabel="Creating snapshot...">Create Snapshot</SubmitButton>
        {!hasAvailableData ? <small>Add or import report data before creating a snapshot.</small> : selected.length === 0 ? <small>Select at least one report section.</small> : null}
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
    <label className={!enabled ? "disabled" : ""}>
      <input
        checked={checked}
        disabled={!enabled}
        name="snapshotModules"
        onChange={(event) => onChange(module, event.target.checked)}
        type="checkbox"
        value={module}
      />
      <span><strong>{label}</strong><small>{description}</small></span>
    </label>
  );
}
