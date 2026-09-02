"use client";

import { useEffect, useMemo, useState } from "react";
import { createLocation } from "@/app/actions";
import { Icon } from "@/components/icon";

type Area = {
  locationCode: number;
  locationName: string;
  countryIsoCode: string;
  locationType: string;
};

export function AreaPickerForm({ projectId }: { projectId: string }) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Area | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <form className="card form area-form" action={createLocation}>
      <p className="label label-with-icon"><Icon name="location" />Add Area</p>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="countryCode" value="GB" />
      <input type="hidden" name="dataForSeoLocationName" value={selected?.locationName ?? ""} />

      <label>
        Search United Kingdom areas
        <div className="search-field">
          <Icon name="search" />
          <input
            aria-autocomplete="list"
            aria-controls="area-options"
            aria-expanded={matches.length > 0}
            autoComplete="off"
            disabled={loading || Boolean(error)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
            placeholder={loading ? "Loading DataForSEO areas..." : "Start typing Manchester, Chester..."}
            role="combobox"
            value={query}
          />
        </div>
      </label>

      {matches.length > 0 ? (
        <div className="area-results" id="area-options" role="listbox" aria-label="Supported DataForSEO areas">
          {matches.map((area) => (
            <button
              key={area.locationCode}
              onClick={() => {
                setSelected(area);
                setQuery(area.locationName);
              }}
              aria-selected={selected?.locationCode === area.locationCode}
              role="option"
              type="button"
            >
              <span>{area.locationName}</span>
              <small>{area.locationType}</small>
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <p className="selection-note"><span className="status good">Selected</span>{selected.locationName}</p>
      ) : null}
      {error ? <p className="danger-text form-note">{error}</p> : null}
      {!loading && !error ? <p className="muted form-note">Only exact areas supplied by DataForSEO can be added.</p> : null}

      <button className="button" disabled={!selected} type="submit">Add Area</button>
    </form>
  );
}
