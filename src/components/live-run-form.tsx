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
  const [searchType, setSearchType] = useState("organic");
  const [pageLimit, setPageLimit] = useState(1);
  const hasTrackingData = keywords.length > 0 && locations.length > 0;
  const ready = credentialsConfigured && liveEnabled && hasTrackingData && confirmed;
  const estimatedMaximumCost = pageLimit * 0.002;
  const runLiveCheckForProject = runLiveCheck.bind(null, projectId);

  function changeSearchType(value: string) {
    setSearchType(value);
    if (value !== "organic") setPageLimit(1);
  }

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
          <select name="searchType" value={searchType} onChange={(event) => changeSearchType(event.target.value)}>
            <option value="organic">Organic</option>
            <option value="local_finder">Local Finder</option>
            <option value="maps">Google Maps</option>
          </select>
        </label>
        <label>
          Page limit
          <select
            name="pageLimit"
            value={pageLimit}
            onChange={(event) => setPageLimit(Number(event.target.value))}
            disabled={searchType !== "organic"}
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map((page) => (
              <option key={page} value={page}>{page} page{page === 1 ? "" : "s"} · top {page * 10}</option>
            ))}
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
        <span>I confirm this will send one paid request covering up to {pageLimit} result page{pageLimit === 1 ? "" : "s"}.</span>
      </label>

      <div className="sandbox-run-footer">
        <div>
          <strong>Maximum base cost ${estimatedMaximumCost.toFixed(3)}</strong>
          <span className="muted">The crawl stops when the domain is found; the exact charge is stored with the result.</span>
        </div>
        <LiveSubmit disabled={!ready} pageLimit={pageLimit} />
      </div>
    </form>
  );
}

function LiveSubmit({ disabled, pageLimit }: { disabled: boolean; pageLimit: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="button live-button" type="submit" disabled={disabled || pending}>
      {pending ? "Running live check..." : `Check Up To Page ${pageLimit}`}
    </button>
  );
}
