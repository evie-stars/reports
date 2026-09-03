"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { runSandboxCheck } from "@/app/actions";
import { Icon } from "@/components/icon";
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
  const ready = credentialsConfigured && taskCount > 0 && taskCount <= MAX_SANDBOX_TASKS;
  const runSandboxCheckForProject = runSandboxCheck.bind(null, projectId);

  return (
    <form className="card sandbox-run" action={runSandboxCheckForProject}>
      <div className="sandbox-run-header">
        <div>
          <p className="label label-with-icon"><Icon name="graph" />Sandbox Rank Check</p>
          <h3>Test and store ranking results</h3>
        </div>
        <span className={`status ${credentialsConfigured ? "good" : "danger"}`}>
          {credentialsConfigured ? "Sandbox protected" : "Credentials missing"}
        </span>
      </div>

      <div className="sandbox-options">
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

      <div className="sandbox-run-footer">
        <div>
          <strong>{taskCount} sandbox task{taskCount === 1 ? "" : "s"}</strong>
          <span className={taskCount > MAX_SANDBOX_TASKS ? "danger-text" : "muted"}>
            {taskCount > MAX_SANDBOX_TASKS
              ? ` Reduce the selection to ${MAX_SANDBOX_TASKS} tasks or fewer.`
              : " Sandbox requests do not use live trial credit."}
          </span>
        </div>
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
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      <div className="choice-list">
        {choices.map((choice) => (
          <label key={choice.id}>
            <input
              type="checkbox"
              name={name}
              value={choice.id}
              checked={selected.includes(choice.id)}
              onChange={() => toggle(choice.id)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
        {choices.length === 0 ? <span className="muted choice-empty">{emptyText}</span> : null}
      </div>
    </fieldset>
  );
}

function SandboxSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={disabled || pending}>
      {pending ? "Running sandbox check..." : "Run Sandbox Check"}
    </button>
  );
}
