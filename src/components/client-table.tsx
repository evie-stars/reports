"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import { EmptyRow, TableWrap } from "@/components/ui/table";

export type ClientRow = {
  id: string;
  name: string;
  projectCount: number;
  keywordCount: number;
  areaCount: number;
  lastReport: string | null;
};

export function ClientTable({ clients }: { clients: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const filteredClients = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return clients;
    return clients.filter((client) => client.name.toLowerCase().includes(search));
  }, [clients, query]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate"><Icon name="search" className="w-4 h-4" /></span>
          <input
            aria-label="Search clients"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clients…"
            type="search"
            value={query}
            className="field pl-9"
          />
        </div>
        <p className="text-xs text-slate sm:ml-auto">{filteredClients.length} of {clients.length} clients</p>
      </div>

      <TableWrap maxHeight="calc(100vh - 16rem)">
        <table className="table">
          <thead>
            <tr>
              <th className="th-sticky">Client</th>
              <th className="th-sticky">Reports</th>
              <th className="th-sticky">Keywords</th>
              <th className="th-sticky">Areas</th>
              <th className="th-sticky">Last checked</th>
              <th className="th-sticky"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.map((client) => (
              <tr key={client.id}>
                <td><Link className="font-medium hover:text-accent hover:underline" href={`/clients/${client.id}`}>{client.name}</Link></td>
                <td>{client.projectCount}</td>
                <td>{client.keywordCount}</td>
                <td>{client.areaCount}</td>
                <td className="text-slate">{client.lastReport ?? "Not checked"}</td>
                <td className="text-right">
                  <Link className="btn-icon" href={`/clients/${client.id}`} title={`Open ${client.name} report`}>
                    <Icon name="eye" className="w-4 h-4" title={`Open ${client.name} report`} />
                  </Link>
                </td>
              </tr>
            ))}
            {filteredClients.length === 0 ? (
              <EmptyRow colSpan={6}>{query ? `No clients match “${query}”.` : "No clients have been added yet."}</EmptyRow>
            ) : null}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}
