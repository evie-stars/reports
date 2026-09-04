"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";

export function PropertyPicker({
  defaultValue,
  options
}: {
  defaultValue: string;
  options: Array<{ label: string; value: string }>;
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return search ? options.filter((option) => option.label.toLowerCase().includes(search)) : options;
  }, [options, query]);

  return (
    <div className="property-picker">
      <label>
        Find property
        <span className="search-field property-search">
          <Icon name="search" />
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by domain or account"
            type="search"
            value={query}
          />
        </span>
      </label>
      <label>
        Search Console property
        <select name="gscProperty" required defaultValue={defaultValue}>
          <option value="" disabled>Select a property</option>
          {filteredOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <small aria-live="polite">{filteredOptions.length} matching propert{filteredOptions.length === 1 ? "y" : "ies"}</small>
    </div>
  );
}
