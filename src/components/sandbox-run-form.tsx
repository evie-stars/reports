"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { runSandboxCheck } from "@/actions/reports";
import { Icon } from "@/components/icon";
import { StatusPill } from "@/components/ui/status-pill";
import { plural } from "@/lib/format";
import { MAX_SANDBOX_TASKS } from "@/lib/rank-config";

type Choice = { id: string; label: string };

export function SandboxRunForm({
  projectId,
  keywords,
  locations,
  credentialsConfigured
}: {
  projectId: string;
  keywords: Choice[];
  locations: Choice[];
  credentialsConfigured: boolean;
}) {
  const [keywordIds, setKeywordIds] = useState(keywords.slice(0, 1).map((keyword) => keyword.id));
  const [locationIds, setLocationIds] = useState(locations.slice(0, 1).map((location) => location.id));
  const [devices, setDevices] = useState(["desktop"]);
  const [searchTypes, setSearchTypes] = useState(["organic"]);
  const taskCount = keywordIds.length * locationIds.length * devices.length * searchTypes.length;
  const overLimit = taskCount > MAX_SANDBOX_TASKS;
  const ready = credentialsConfigured && taskCount > 0 && !overLimit;
  const runSandboxCheckForProject = runSandboxCheck.bind(null, projectId);

  return (
    <form className="card flex flex-col gap-4" action={runSandboxCheckForProject}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base flex items-center gap-2">
            <Icon name="refresh" className="w-4 h-4 text-slate shrink-0" />
            <span className="truncate">Sandbox rank check</span>
          </h3>
          <p className="text-xs text-slate mt-0.5">Test and store ranking results</p>
        </div>
        <StatusPill tone={credentialsConfigured ? "accent" : "blocked"} className="shrink-0">
          {credentialsConfigured ? "Sandbox protected" : "Credentials missing"}
        </StatusPill>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChoiceGroup
          legend="Keywords"
          name="keywordIds"
          choices={keywords}
          selected={keywordIds}
          onChange={setKeywordIds}
          emptyText="Add an active keyword first."
        />
        <ChoiceGroup
          legend="Locations"
          name="locationIds"
          choices={locations}
          selected={locationIds}
          onChange={setLocationIds}
          emptyText="Add an active location first."
        />
        <ChoiceGroup
          legend="Devices"
          name="devices"
          choices={[
            { id: "desktop", label: "Desktop" },
            { id: "mobile", label: "Mobile" }
          ]}
          selected={devices}
          onChange={setDevices}
        />
        <ChoiceGroup
          legend="Result types"
          name="searchTypes"
          choices={[
            { id: "organic", label: "Organic" },
            { id: "maps", label: "Google Maps" }
          ]}
          selected={searchTypes}
          onChange={setSearchTypes}
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-line">
        <p className="text-sm min-w-0">
          <span className="font-medium text-ink">{plural(taskCount, "sandbox task")}</span>
          <span className={`block text-xs ${overLimit ? "text-blocked" : "text-slate"}`}>
            {overLimit
              ? `Reduce the selection to ${MAX_SANDBOX_TASKS} tasks or fewer.`
              : "Sandbox requests do not use live trial credit."}
          </span>
        </p>
        <SandboxSubmit disabled={!ready} />
      </div>
    </form>
  );
}

function ChoiceGroup({
  legend,
  name,
  choices,
  selected,
  onChange,
  emptyText
}: {
  legend: string;
  name: string;
  choices: Choice[];
  selected: string[];
  onChange: (values: string[]) => void;
  emptyText?: string;
}) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  return (
    <fieldset className="min-w-0">
      <legend className="field-label">{legend}</legend>
      <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto pr-1">
        {choices.map((choice) => (
          <label key={choice.id} className="choice">
            <input
              type="checkbox"
              name={name}
              value={choice.id}
              checked={selected.includes(choice.id)}
              onChange={() => toggle(choice.id)}
            />
            <span className="truncate">{choice.label}</span>
          </label>
        ))}
        {choices.length === 0 ? <span className="text-xs text-slate">{emptyText}</span> : null}
      </div>
    </fieldset>
  );
}

function SandboxSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary shrink-0" type="submit" disabled={disabled || pending}>
      <Icon name="refresh" className="w-3.5 h-3.5" />
      {pending ? "Running sandbox check…" : "Run sandbox check"}
    </button>
  );
}
