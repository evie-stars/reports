import { updateKeywordActive, updateLocationActive } from "@/actions/projects";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { formatCount, plural } from "@/lib/format";

type Keyword = {
  id: string;
  phrase: string;
  group: string | null;
  targetUrl: string | null;
  active: boolean;
  searchVolume: number | null;
  cpcUsd: { toString(): string } | null;
};

type Location = {
  id: string;
  name: string;
  countryCode: string;
  dataForSeoLocationName: string | null;
  active: boolean;
};

const TABLE_HEIGHT = "28rem";

export function KeywordTable({ projectId, keywords }: { projectId: string; keywords: Keyword[] }) {
  const activeCount = keywords.filter((keyword) => keyword.active).length;

  return (
    <SectionCard title="Keywords" icon="bookmark" aside={<span className="text-xs text-slate">{activeCount} of {plural(keywords.length, "keyword")} active</span>}>
      <TableWrap maxHeight={TABLE_HEIGHT}>
        <table className="table">
          <thead>
            <tr>
              <th className="th-sticky">Keyword</th>
              <th className="th-sticky">Group</th>
              <th className="th-sticky text-right">Volume</th>
              <th className="th-sticky text-right">CPC</th>
              <th className="th-sticky">Status</th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((keyword) => {
              const toggleKeyword = updateKeywordActive.bind(null, keyword.id, projectId, !keyword.active);
              return (
                <tr key={keyword.id}>
                  <td>
                    <span className="font-medium">{keyword.phrase}</span>
                    {keyword.targetUrl ? <span className="table-sub truncate max-w-xs">{keyword.targetUrl}</span> : null}
                  </td>
                  <td className="text-slate">{keyword.group ?? "-"}</td>
                  <td className="text-right">{keyword.searchVolume !== null ? formatCount(keyword.searchVolume) : "-"}</td>
                  <td className="text-right font-mono text-xs">{keyword.cpcUsd ? `$${keyword.cpcUsd.toString()}` : "-"}</td>
                  <td>
                    <form action={toggleKeyword}>
                      <ActiveToggle active={keyword.active} title={`Toggle tracking for ${keyword.phrase}`} />
                    </form>
                  </td>
                </tr>
              );
            })}
            {keywords.length === 0 ? <EmptyRow colSpan={5}>No keywords yet.</EmptyRow> : null}
          </tbody>
        </table>
      </TableWrap>
    </SectionCard>
  );
}

export function LocationTable({ projectId, locations }: { projectId: string; locations: Location[] }) {
  const activeCount = locations.filter((location) => location.active).length;

  return (
    <SectionCard title="Areas" icon="map-pin" aside={<span className="text-xs text-slate">{activeCount} of {plural(locations.length, "area")} active</span>}>
      <TableWrap maxHeight={TABLE_HEIGHT}>
        <table className="table">
          <thead>
            <tr>
              <th className="th-sticky">Location</th>
              <th className="th-sticky">DataForSEO name</th>
              <th className="th-sticky">Status</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => {
              const toggleLocation = updateLocationActive.bind(null, location.id, projectId, !location.active);
              return (
                <tr key={location.id}>
                  <td className="font-medium">{location.name}, {location.countryCode}</td>
                  <td className="text-slate">{location.dataForSeoLocationName ?? "-"}</td>
                  <td>
                    <form action={toggleLocation}>
                      <ActiveToggle active={location.active} title={`Toggle tracking for ${location.name}`} />
                    </form>
                  </td>
                </tr>
              );
            })}
            {locations.length === 0 ? <EmptyRow colSpan={3}>No locations yet.</EmptyRow> : null}
          </tbody>
        </table>
      </TableWrap>
    </SectionCard>
  );
}

/** Submits the enclosing form to flip the active flag; styled like a status pill so the state reads at a glance. */
function ActiveToggle({ active, title }: { active: boolean; title: string }) {
  return (
    <button
      type="submit"
      aria-pressed={active}
      title={title}
      className={`status-pill transition-colors ${active ? "border-accent text-accent bg-accent/5 hover:bg-accent/10" : "border-line text-slate bg-white hover:border-slate/40 hover:text-ink"}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {active ? "Active" : "Paused"}
    </button>
  );
}
