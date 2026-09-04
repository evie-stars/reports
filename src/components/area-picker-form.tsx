"use client";

import { useEffect, useMemo, useState } from "react";
import { createLocation } from "@/actions/projects";
import { Icon } from "@/components/icon";
import { StatusPill } from "@/components/ui/status-pill";

type Area = {
  locationCode: number;
  locationName: string;
  countryIsoCode: string;
  locationType: string;
};

const LIST_ID = "area-options";

function optionId(area: Area) {
  return `area-option-${area.locationCode}`;
}

export function AreaPickerForm({ projectId }: { projectId: string }) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Area | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const [listOpen, setListOpen] = useState(true);

  useEffect(() => {
    let active = true;

    fetch("/api/dataforseo/locations")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load supported areas.");
        return body.locations as Area[];
      })
      .then((locations) => {
        if (!active) return;
        setAreas(locations);
        setLoading(false);
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load supported areas.");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const matches = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (search.length < 2 || selected?.locationName === query) return [];

    return areas
      .filter((area) => area.locationName.toLowerCase().includes(search))
      .sort((a, b) => {
        const aStarts = a.locationName.toLowerCase().startsWith(search) ? 0 : 1;
        const bStarts = b.locationName.toLowerCase().startsWith(search) ? 0 : 1;
        return aStarts - bStarts || a.locationName.localeCompare(b.locationName);
      })
      .slice(0, 10);
  }, [areas, query, selected]);

  const showList = listOpen && matches.length > 0;
  const highlightedArea = showList && highlighted >= 0 ? matches[highlighted] : undefined;

  useEffect(() => {
    if (!highlightedArea) return;
    document.getElementById(optionId(highlightedArea))?.scrollIntoView({ block: "nearest" });
  }, [highlightedArea]);

  function choose(area: Area) {
    setSelected(area);
    setQuery(area.locationName);
    setHighlighted(-1);
    setListOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (matches.length === 0) return;
      event.preventDefault();
      setListOpen(true);
      setHighlighted((index) => (index + 1 >= matches.length ? 0 : index + 1));
    } else if (event.key === "ArrowUp") {
      if (matches.length === 0) return;
      event.preventDefault();
      setListOpen(true);
      setHighlighted((index) => (index <= 0 ? matches.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      if (!showList) return;
      event.preventDefault();
      if (highlightedArea) choose(highlightedArea);
    } else if (event.key === "Escape") {
      if (!showList) return;
      event.preventDefault();
      setListOpen(false);
      setHighlighted(-1);
    }
  }

  return (
    <form className="card flex flex-col" action={createLocation}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="font-display text-base flex items-center gap-2">
            <Icon name="map-pin" className="w-4 h-4 text-slate shrink-0" />
            <span className="truncate">Add area</span>
          </h2>
          <p className="text-xs text-slate mt-0.5">Only exact areas supplied by DataForSEO can be added.</p>
        </div>
      </div>

      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="countryCode" value="GB" />
      <input type="hidden" name="dataForSeoLocationName" value={selected?.locationName ?? ""} />

      <div className="flex-1 space-y-3">
        <label className="block">
          <span className="field-label">Search United Kingdom areas</span>
          <span className="relative block">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate pointer-events-none">
              <Icon name="search" className="w-4 h-4" />
            </span>
            <input
              aria-activedescendant={highlightedArea ? optionId(highlightedArea) : undefined}
              aria-autocomplete="list"
              aria-controls={LIST_ID}
              aria-expanded={showList}
              autoComplete="off"
              className="field pl-9"
              disabled={loading || Boolean(error)}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
                setHighlighted(-1);
                setListOpen(true);
              }}
              onKeyDown={handleKeyDown}
              placeholder={loading ? "Loading DataForSEO areas…" : "Start typing Manchester, Chester…"}
              role="combobox"
              value={query}
            />
          </span>
        </label>

        {showList ? (
          <div
            className="rounded-xl border border-line divide-y divide-line max-h-64 overflow-auto shadow-lift bg-white"
            id={LIST_ID}
            role="listbox"
            aria-label="Supported DataForSEO areas"
          >
            {matches.map((area, index) => {
              const isHighlighted = index === highlighted;
              return (
                <button
                  key={area.locationCode}
                  id={optionId(area)}
                  aria-selected={isHighlighted}
                  role="option"
                  type="button"
                  tabIndex={-1}
                  onClick={() => choose(area)}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${isHighlighted ? "bg-accent/5 text-ink" : "text-ink hover:bg-paper"}`}
                >
                  <span className="truncate">{area.locationName}</span>
                  <span className="text-xs text-slate shrink-0">{area.locationType}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {selected ? (
          <p className="flex items-center gap-2 text-sm">
            <StatusPill tone="accent">Selected</StatusPill>
            <span className="truncate">{selected.locationName}</span>
          </p>
        ) : null}
        {error ? <p className="text-xs text-blocked">{error}</p> : null}
      </div>

      <div className="flex justify-end mt-4">
        <button className="btn-primary" disabled={!selected} type="submit">
          <Icon name="add" className="w-3.5 h-3.5" />
          Add area
        </button>
      </div>
    </form>
  );
}
