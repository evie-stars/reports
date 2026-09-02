"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icon";

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
    <>
      <div className="table-tools">
        <div className="search-field client-search">
          <Icon name="search" />
          <input
            aria-label="Search clients"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clients"
            type="search"
            value={query}
          />
        </div>
        <span className="muted table-count">{filteredClients.length} client{filteredClients.length === 1 ? "" : "s"}</span>
      </div>

      <div className="table-scroll">
        <table className="table client-list-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Reports</th>
              <th>Keywords</th>
              <th>Areas</th>
              <th>Last Checked</th>
              <th><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {filteredClients.map((client) => (
              <tr key={client.id}>
                <td><Link className="client-name-link" href={`/clients/${client.id}`}>{client.name}</Link></td>
                <td>{client.projectCount}</td>
                <td>{client.keywordCount}</td>
                <td>{client.areaCount}</td>
                <td>{client.lastReport ?? <span className="muted">Not checked</span>}</td>
                <td className="table-action-cell">
                  <Link className="icon-button" href={`/clients/${client.id}`} title={`Open ${client.name} report`}>
                    <Icon name="graph" label={`Open ${client.name} report`} />
                  </Link>
                </td>
              </tr>
            ))}
            {filteredClients.length === 0 ? (
              <tr>
                <td className="empty-table" colSpan={6}>
                  {query ? `No clients match “${query}”.` : "No clients have been added yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
