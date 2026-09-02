"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { runLiveCheck } from "@/app/actions";
import { Icon } from "@/components/icon";

type Choice = { id: string; label: string };

export function LiveRunForm({
  projectId,
  keywords,
  locations,
  credentialsConfigured,
  liveEnabled
}: {
  projectId: string;
  keywords: Choice[];
  locations: Choice[];
  credentialsConfigured: boolean;
  liveEnabled: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const hasTrackingData = keywords.length > 0 && locations.length > 0;
  const ready = credentialsConfigured && liveEnabled && hasTrackingData && confirmed;
  const runLiveCheckForProject = runLiveCheck.bind(null, projectId);

  return (
    <form className="card sandbox-run live-run" action={runLiveCheckForProject}>
      <div className="sandbox-run-header">
        <div>
          <p className="label label-with-icon"><Icon name="graph" />Single Live Verification</p>
          <h3>Check one genuine Google result</h3>
        </div>
        <span className={`status ${liveEnabled ? "warn" : "danger"}`}>
          {liveEnabled ? "Paid API enabled" : "Live requests disabled"}
        </span>
      </div>

      <div className="live-options">
        <label>
          Keyword
          <select name="keywordId" required defaultValue={keywords[0]?.id} disabled={keywords.length === 0}>
            {keywords.map((keyword) => <option key={keyword.id} value={keyword.id}>{keyword.label}</option>)}
          </select>
        </label>
        <label>
          Location
          <select name="locationId" required defaultValue={locations[0]?.id} disabled={locations.length === 0}>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
          </select>
        </label>
        <label>
          Device
          <select name="device" defaultValue="desktop">
            <option value="desktop">Desktop</option>
            <option value="mobile">Mobile</option>
          </select>
        </label>
        <label>
          Result type
          <select name="searchType" defaultValue="organic">
            <option value="organic">Organic</option>
            <option value="local_finder">Local Finder</option>
            <option value="maps">Google Maps</option>
          </select>
        </label>
      </div>

      <label className="live-confirmation">
        <input
          type="checkbox"
          name="confirmLiveCost"
          value="yes"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>I confirm this will send exactly one paid DataForSEO request.</span>
      </label>

      <div className="sandbox-run-footer">
        <div>
          <strong>1 live task · current base price $0.002</strong>
          <span className="muted">The exact DataForSEO charge will be stored with the result.</span>
        </div>
        <LiveSubmit disabled={!ready} />
      </div>
    </form>
  );
}

function LiveSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="button live-button" type="submit" disabled={disabled || pending}>
      {pending ? "Running live check..." : "Run One Live Check"}
    </button>
  );
}
