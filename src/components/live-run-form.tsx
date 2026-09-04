"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { runLiveCheck } from "@/actions/reports";
import { Icon } from "@/components/icon";
import { StatusPill } from "@/components/ui/status-pill";
import { formatUsd } from "@/lib/format";

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
    <form className="card flex flex-col gap-4" action={runLiveCheckForProject}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base flex items-center gap-2">
            <Icon name="zoom-in" className="w-4 h-4 text-slate shrink-0" />
            <span className="truncate">Single live verification</span>
          </h3>
          <p className="text-xs text-slate mt-0.5">Check one genuine Google result</p>
        </div>
        <StatusPill tone={liveEnabled ? "warn" : "blocked"} className="shrink-0">
          {liveEnabled ? "Paid API enabled" : "Live requests disabled"}
        </StatusPill>
      </div>

      <fieldset className="min-w-0">
        <legend className="field-label">Request</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="field-label">Keyword</span>
            <select name="keywordId" required defaultValue={keywords[0]?.id} disabled={keywords.length === 0} className="field">
              {keywords.map((keyword) => <option key={keyword.id} value={keyword.id}>{keyword.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Location</span>
            <select name="locationId" required defaultValue={locations[0]?.id} disabled={locations.length === 0} className="field">
              {locations.map((location) => <option key={location.id} value={location.id}>{location.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Device</span>
            <select name="device" defaultValue="desktop" className="field">
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
          </label>
          <label className="block">
            <span className="field-label">Result type</span>
            <select name="searchType" value={searchType} onChange={(event) => changeSearchType(event.target.value)} className="field">
              <option value="organic">Organic</option>
              <option value="maps">Google Maps</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="field-label">Page limit</span>
            <select
              name="pageLimit"
              value={pageLimit}
              onChange={(event) => setPageLimit(Number(event.target.value))}
              disabled={searchType !== "organic"}
              className="field"
            >
              {Array.from({ length: 10 }, (_, index) => index + 1).map((page) => (
                <option key={page} value={page}>{page} page{page === 1 ? "" : "s"} · top {page * 10}</option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <label className="choice items-start">
        <input
          type="checkbox"
          name="confirmLiveCost"
          value="yes"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5"
        />
        <span>I confirm this will send one paid request covering up to {pageLimit} result page{pageLimit === 1 ? "" : "s"}.</span>
      </label>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-line">
        <p className="text-sm min-w-0">
          <span className="font-medium text-ink">Maximum base cost {formatUsd(estimatedMaximumCost, 3)}</span>
          <span className="block text-xs text-slate">The crawl stops when the domain is found; the exact charge is stored with the result.</span>
        </p>
        <LiveSubmit disabled={!ready} pageLimit={pageLimit} />
      </div>
    </form>
  );
}

function LiveSubmit({ disabled, pageLimit }: { disabled: boolean; pageLimit: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary shrink-0" type="submit" disabled={disabled || pending}>
      <Icon name="zoom-in" className="w-3.5 h-3.5" />
      {pending ? "Adding to queue…" : `Queue check to page ${pageLimit}`}
    </button>
  );
}
