"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";

/** Searchable select used to map a Search Console site or an Analytics property to a report. */
export function PropertyPicker({
  defaultValue,
  options,
  name,
  label,
  placeholder = "Search by name or account"
}: {
  defaultValue: string;
  options: Array<{ label: string; value: string }>;
  name: string;
  label: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const search = query.trim().toLowerCase();
    return search ? options.filter((option) => option.label.toLowerCase().includes(search)) : options;
  }, [options, query]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block">
        <span className="field-label">Find property</span>
        <span className="relative block">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate pointer-events-none">
            <Icon name="search" className="w-4 h-4" />
          </span>
          <input
            className="field pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            type="search"
            value={query}
          />
        </span>
      </label>
      <label className="block">
        <span className="field-label">{label}</span>
        <select name={name} required defaultValue={defaultValue} className="field">
          <option value="" disabled>Select a property</option>
          {filteredOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <p className="text-xs text-slate sm:col-span-2" aria-live="polite">
        {filteredOptions.length} matching propert{filteredOptions.length === 1 ? "y" : "ies"}
      </p>
    </div>
  );
}
