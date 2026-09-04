import Link from "next/link";
import { Icon } from "@/components/icon";
import { buildRankMatrix, RankMatrix, RankMatrixColumnHeading, RankMatrixRank, type RankMatrixResult } from "@/components/rank-matrix";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import type { ClientReportViewData, CurrentReportResult } from "@/lib/client-report";
import { formatCount, formatDate, plural, readableValue } from "@/lib/format";

export function ClientReportDashboard({
  data,
  basePath,
  readOnly = false,
  frozen = false
}: {
  data: ClientReportViewData;
  basePath: string;
  readOnly?: boolean;
  frozen?: boolean;
}) {
  const { filters, latestResults, stats } = data;
  const closeDrawerHref = reportHref(basePath, filters);
  const matrixResults = latestResults.map(toMatrixResult);
  const matrixRowCount = buildRankMatrix(matrixResults).rows.length;
  const mapsSection = filters.section === "maps";
  const tabs: TabItem[] = [
    { key: "overview", label: "Overview", href: reportHref(basePath, { ...filters, section: "overview", searchType: undefined }) },
    ...(data.modules.seo ? [{ key: "seo", label: "SEO", href: reportHref(basePath, { ...filters, section: "seo", searchType: undefined }) }] : []),
    ...(data.modules.maps ? [{ key: "maps", label: "Maps", href: reportHref(basePath, { ...filters, section: "maps", searchType: undefined }) }] : [])
  ];

  return (
    <div>
      <Tabs items={tabs} active={filters.section} ariaLabel="Report sections" />

      {data.modules.rankings ? (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-6" aria-label="Ranking summary">
          <StatCard label={mapsSection ? "Top 3 map rankings" : "Top 3 keywords"} value={stats.topThree} icon="star" tone="sky" detail="Highest visibility" />
          <StatCard label={mapsSection ? "Top 10 map rankings" : "Page 1 keywords"} value={stats.pageOne} icon="tick-circle" tone="accent" detail={`of ${stats.activeKeywords} active`} />
          <StatCard label={mapsSection ? "Top 20 map rankings" : "Top 20 keywords"} value={stats.topTwenty} icon="tick-badge" detail="Within two pages" />
          <StatCard
            label="Average position"
            value={stats.averageRank ?? "-"}
            icon="zoom-in"
            detail={stats.averageRank === null ? "No ranking data" : "Across current results"}
          />
        </section>
      ) : null}

      {data.modules.rankings ? (
        <SectionCard
          title="Ranking progress"
          subtitle={mapsSection ? "Maps position distribution over time" : "Keyword position distribution over time"}
          icon="calendar"
          className="mb-4"
        >
          <div className="flex flex-wrap gap-1.5 mb-4" aria-label="Latest movement summary">
            <StatusPill tone="accent">{stats.improved} improved</StatusPill>
            <StatusPill tone="sky">{stats.newRankings} new</StatusPill>
            <StatusPill tone="blocked">{stats.declined} dropped</StatusPill>
            {stats.issues ? <StatusPill tone="warn">{stats.issues} URL flags</StatusPill> : null}
          </div>
          <PositionDistributionChart points={data.trend} />
        </SectionCard>
      ) : null}

      {data.modules.gsc && data.gsc.mapped && (!readOnly || data.gsc.trend.length > 0) ? (
        <SearchConsolePerformance data={data.gsc} />
      ) : null}

      {data.modules.rankings && !frozen ? (
        <form className="card mb-4" action={basePath} method="get">
          {filters.section !== "overview" ? <input type="hidden" name="section" value={filters.section} /> : null}
          <input type="hidden" name="sort" value={filters.sort} />
          <input type="hidden" name="dir" value={filters.sortDirection} />
          <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2 items-end">
            <FilterSelect label="Period" name="period" value={filters.period}>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="all">All time</option>
            </FilterSelect>
            <FilterSelect label="Project" name="project" value={filters.projectId ?? ""}>
              <option value="">All projects</option>
              {data.options.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </FilterSelect>
            <FilterSelect label="Area" name="area" value={filters.locationId ?? ""}>
              <option value="">All areas</option>
              {data.options.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </FilterSelect>
            <FilterSelect label="Device" name="device" value={filters.device ?? ""}>
              <option value="">All devices</option>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </FilterSelect>
            {filters.section === "overview" && data.modules.seo && data.modules.maps ? (
              <FilterSelect label="Result" name="type" value={filters.searchType ?? ""}>
                <option value="">All results</option>
                <option value="organic">Organic</option>
                <option value="maps">Maps</option>
              </FilterSelect>
            ) : null}
            {data.options.groups.length > 0 ? (
              <FilterSelect label="Group" name="group" value={filters.group ?? ""}>
                <option value="">All groups</option>
                {data.options.groups.map((group) => <option key={group} value={group}>{group}</option>)}
              </FilterSelect>
            ) : null}
            <div className="col-span-2 md:col-span-1 flex items-center gap-2">
              <button className="btn-primary" type="submit"><Icon name="tick" className="w-3.5 h-3.5" />Apply</button>
              <Link className="btn-ghost" href={basePath}>Reset</Link>
            </div>
          </div>
        </form>
      ) : null}

      {data.modules.rankings ? (
        <SectionCard
          title="Ranking results"
          subtitle="Current and previous positions"
          icon="bookmark"
          className="mb-4"
          aside={<span className="text-xs text-slate">{plural(matrixRowCount, "keyword")}</span>}
        >
          {!frozen ? (
            <div className="flex flex-wrap items-center gap-1.5 mb-3" aria-label="Ranking result sorting">
              <span className="text-xs text-slate mr-1">Sort by</span>
              <SortableLink basePath={basePath} column="keyword" filters={filters} label="Keyword" />
              <SortableLink basePath={basePath} column="area" filters={filters} label="Area" />
              <SortableLink basePath={basePath} column="current" filters={filters} label="Best rank" />
            </div>
          ) : null}
          <RankMatrix
            results={matrixResults}
            emptyMessage={frozen
              ? "No rankings were included in this snapshot."
              : `No live rankings match these filters${readOnly ? "." : ". Adjust the filters or configure a live check in report settings."}`}
            keywordHref={frozen ? undefined : (keywordId) => reportHref(basePath, filters, keywordId)}
            showChecked
            showVolume
          />
        </SectionCard>
      ) : null}

      {!data.modules.rankings && !(data.modules.gsc && data.gsc.mapped) ? (
        <div className="card">
          <EmptyState icon="drawer" title="No reporting data is available yet">
            A manager can enable an available data source from the report settings.
          </EmptyState>
        </div>
      ) : null}

      {data.modules.rankings && data.selectedKeyword ? (
        <KeywordDrawer
          closeHref={closeDrawerHref}
          history={data.keywordHistory}
          keyword={data.selectedKeyword.phrase}
          targetUrl={data.selectedKeyword.targetUrl}
          searchVolume={data.selectedKeyword.searchVolume}
          monthlySearches={data.selectedKeyword.monthlySearches}
        />
      ) : null}
    </div>
  );
}

function SortableLink({
  basePath,
  column,
  filters,
  label
}: {
  basePath: string;
  column: ClientReportViewData["filters"]["sort"];
  filters: ClientReportViewData["filters"];
  label: string;
}) {
  const active = filters.sort === column;
  const nextDirection = active && filters.sortDirection === "asc" ? "desc" : "asc";
  const href = reportHref(basePath, { ...filters, sort: column, sortDirection: nextDirection });
  const indicator = active ? (filters.sortDirection === "asc" ? "↑" : "↓") : "↕";
  return (
    <Link
      className={`btn-ghost px-2 py-0.5 text-xs ${active ? "border-accent text-ink" : ""}`}
      href={href}
      scroll={false}
      title={`Sort ${label.toLowerCase()} ${nextDirection === "asc" ? "ascending" : "descending"}`}
    >
      {label}<span className={active ? "text-accent" : "text-slate/70"} aria-hidden="true">{indicator}</span>
    </Link>
  );
}

function FilterSelect({ label, name, value, children }: { label: string; name: string; value: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="field-label">{label}</span>
      <select name={name} defaultValue={value} className="field">{children}</select>
    </label>
  );
}

function toMatrixResult(result: CurrentReportResult): RankMatrixResult {
  return {
    id: result.id,
    projectId: result.run.projectId,
    projectName: result.run.project.name,
    keywordId: result.keywordId,
    keyword: result.keyword.phrase,
    locationId: result.locationId,
    location: result.location.name,
    searchVolume: result.keyword.searchVolume,
    searchType: result.searchType,
    device: result.device,
    rank: result.rank,
    previousRank: result.previousRank,
    direction: result.direction,
    movement: result.movement,
    matchedUrl: result.matchedUrl,
    checkedAt: result.checkedAt,
    issues: result.issues
  };
}

const POSITION_BUCKETS = [
  { key: "beyondThirty", label: "#31+", fill: "fill-line", swatch: "bg-line" },
  { key: "twentyOneToThirty", label: "#21-30", fill: "fill-[#B8C0C9]", swatch: "bg-[#B8C0C9]" },
  { key: "elevenToTwenty", label: "#11-20", fill: "fill-slate", swatch: "bg-slate" },
  { key: "fourToTen", label: "#4-10", fill: "fill-ink", swatch: "bg-ink" },
  { key: "twoToThree", label: "#2-3", fill: "fill-sky", swatch: "bg-sky" },
  { key: "first", label: "#1", fill: "fill-accent", swatch: "bg-accent" }
] as const;

function PositionDistributionChart({ points }: { points: ClientReportViewData["trend"] }) {
  if (points.length < 2) {
    return (
      <EmptyState compact icon="clock" title="Not enough check dates yet">
        A progress chart will appear after at least two check dates in this period.
      </EmptyState>
    );
  }

  const width = 900;
  const height = 270;
  const padding = { top: 18, right: 18, bottom: 42, left: 38 };
  const maxTotal = Math.max(1, ...points.map((point) => point.total));
  const plotWidth = width - padding.left - padding.right;
  const slotWidth = plotWidth / points.length;
  const barWidth = Math.min(72, Math.max(22, slotWidth * 0.54));
  const y = (value: number) => height - padding.bottom - value * ((height - padding.top - padding.bottom) / maxTotal);
  const gridValues = Array.from(new Set([0, Math.ceil(maxTotal / 2), maxTotal]));

  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-xs text-slate" aria-label="Position ranges">
        {[...POSITION_BUCKETS].reverse().map((bucket) => (
          <span className="inline-flex items-center gap-1.5" key={bucket.key}>
            <span className={`w-2.5 h-2.5 rounded-sm ${bucket.swatch}`} aria-hidden="true" />
            {bucket.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg className="block w-full h-auto min-w-[560px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tracked keywords grouped into position ranges over time">
          {gridValues.map((value) => (
            <g key={value}>
              <line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} className="chart-grid-line" />
              <text x={padding.left - 10} y={y(value) + 4} textAnchor="end" className="chart-axis-label">{value}</text>
            </g>
          ))}
          {points.map((point, index) => {
            const x = padding.left + index * slotWidth + (slotWidth - barWidth) / 2;
            let accumulated = 0;
            return (
              <g key={point.date}>
                {POSITION_BUCKETS.map((bucket) => {
                  const count = point[bucket.key];
                  const start = accumulated;
                  accumulated += count;
                  if (count === 0) return null;
                  const percentage = point.total ? Math.round((count / point.total) * 100) : 0;
                  return (
                    <rect
                      className={`animate-grow-up origin-bottom ${bucket.fill}`}
                      height={y(start) - y(accumulated)}
                      key={bucket.key}
                      style={{ animationDelay: `${120 + index * 45}ms` }}
                      width={barWidth}
                      x={x}
                      y={y(accumulated)}
                    >
                      <title>{`${point.label} · ${bucket.label}: ${plural(count, "keyword")} (${percentage}%)`}</title>
                    </rect>
                  );
                })}
                {(index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0) ? (
                  <text x={x + barWidth / 2} y={height - 14} textAnchor="middle" className="chart-axis-label">{point.label}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function SearchConsolePerformance({ data }: { data: ClientReportViewData["gsc"] }) {
  return (
    <SectionCard
      title="Search Console"
      subtitle="Google organic performance"
      icon="search"
      className="mb-4"
      aside={
        <span className="text-xs text-slate">
          {data.latestDataDate ? `Data through ${formatDate(`${data.latestDataDate}T12:00:00Z`)}` : "No imported data yet"}
        </span>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4" aria-label="Search Console summary">
        <StatCard label="Clicks" value={formatCount(data.stats.clicks)} icon="tick-circle" tone="accent" />
        <StatCard label="Impressions" value={formatCount(data.stats.impressions)} icon="eye" tone="sky" />
        <StatCard label="Average CTR" value={data.stats.ctr === null ? "-" : `${(data.stats.ctr * 100).toFixed(1)}%`} icon="tick-badge" />
        <StatCard label="Average position" value={data.stats.position === null ? "-" : data.stats.position.toFixed(1)} icon="zoom-in" />
      </div>
      <SearchConsoleChart points={data.trend} />
    </SectionCard>
  );
}

function SearchConsoleChart({ points }: { points: ClientReportViewData["gsc"]["trend"] }) {
  if (points.length < 2) {
    return (
      <EmptyState compact icon="search" title="No Search Console trend yet">
        Import Search Console data to see clicks and impressions over time.
      </EmptyState>
    );
  }

  const width = 900;
  const height = 250;
  const padding = { top: 18, right: 42, bottom: 36, left: 48 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxImpressions = Math.max(1, ...points.map((point) => point.impressions));
  const maxClicks = Math.max(1, ...points.map((point) => point.clicks));
  const slotWidth = plotWidth / points.length;
  const barWidth = Math.max(2, Math.min(12, slotWidth * 0.62));
  const x = (index: number) => padding.left + slotWidth * index + slotWidth / 2;
  const impressionY = (value: number) => padding.top + plotHeight - (value / maxImpressions) * plotHeight;
  const clickY = (value: number) => padding.top + plotHeight - (value / maxClicks) * plotHeight;
  const clickPath = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${clickY(point.clicks)}`).join(" ");
  const gridValues = [0, 0.5, 1];
  const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);

  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-xs text-slate" aria-label="Chart series">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded-full bg-accent" aria-hidden="true" />Clicks</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-sky/30" aria-hidden="true" />Impressions</span>
      </div>
      <div className="overflow-x-auto">
        <svg className="block w-full h-auto min-w-[560px]" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Google Search Console clicks and impressions over time">
          {gridValues.map((ratio) => {
            const y = padding.top + plotHeight - ratio * plotHeight;
            return (
              <g key={ratio}>
                <line className="chart-grid-line" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
                <text className="chart-axis-label" x={padding.left - 8} y={y + 4} textAnchor="end">{formatCount(Math.round(maxImpressions * ratio))}</text>
                <text className="chart-axis-label" x={width - padding.right + 8} y={y + 4}>{formatCount(Math.round(maxClicks * ratio))}</text>
              </g>
            );
          })}
          {points.map((point, index) => (
            <rect
              className="fill-sky/30"
              height={padding.top + plotHeight - impressionY(point.impressions)}
              key={point.date}
              width={barWidth}
              x={x(index) - barWidth / 2}
              y={impressionY(point.impressions)}
            >
              <title>{`${point.label}: ${formatCount(point.impressions)} impressions`}</title>
            </rect>
          ))}
          <path className="stroke-accent stroke-2 fill-none" strokeLinejoin="round" strokeLinecap="round" d={clickPath} />
          {points.map((point, index) => (
            <g key={`click-${point.date}`}>
              <circle className="fill-accent" cx={x(index)} cy={clickY(point.clicks)} r="2.4">
                <title>{`${point.label}: ${formatCount(point.clicks)} clicks`}</title>
              </circle>
              {labelIndexes.has(index) ? (
                <text className="chart-axis-label" x={x(index)} y={height - 10} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{point.label}</text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function KeywordDrawer({
  closeHref,
  history,
  keyword,
  targetUrl,
  searchVolume,
  monthlySearches
}: {
  closeHref: string;
  history: ClientReportViewData["keywordHistory"];
  keyword: string;
  targetUrl: string | null;
  searchVolume: number | null;
  monthlySearches: unknown;
}) {
  const matrixHistory: RankMatrixResult[] = history.map((item) => ({
    id: item.id,
    projectId: item.runId,
    projectName: item.projectName,
    keywordId: "history",
    keyword,
    locationId: `${item.projectId}:${item.locationName}`,
    location: item.locationName,
    searchType: item.searchType,
    device: item.device,
    rank: item.rank,
    previousRank: item.previousRank,
    direction: item.direction,
    matchedUrl: item.matchedUrl,
    checkedAt: item.checkedAt
  }));
  const volumeTrend = readVolumeTrend(monthlySearches);
  return (
    <>
      <Link className="fixed inset-0 z-40 bg-ink/40" href={closeHref} scroll={false} aria-label="Close keyword history" />
      <aside
        className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-lift overflow-y-auto animate-fade-in-up p-5"
        role="dialog"
        aria-modal="true"
        aria-label={`${keyword} ranking history`}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="eyebrow mb-1">Keyword history</p>
            <h2 className="text-lg leading-tight break-words">{keyword}</h2>
          </div>
          <Link className="btn-icon shrink-0" href={closeHref} scroll={false} title="Close">
            <Icon name="x" className="w-4 h-4" title="Close" />
          </Link>
        </div>
        {targetUrl ? (
          <p className="text-xs text-slate mb-4 break-all"><span className="font-medium text-ink">Target:</span> {targetUrl}</p>
        ) : null}
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 rounded-xl border border-line bg-paper/60 p-3 mb-4">
          <div>
            <p className="text-xs text-slate">Average monthly searches</p>
            <p className="text-xl font-display font-semibold leading-tight">{searchVolume === null ? "-" : formatCount(searchVolume)}</p>
          </div>
          <VolumeTrend points={volumeTrend} />
        </div>
        <RankHistoryChart history={matrixHistory} />
        <KeywordHistoryMatrix history={matrixHistory} />
      </aside>
    </>
  );
}

function VolumeTrend({ points }: { points: Array<{ label: string; value: number }> }) {
  if (points.length === 0) return <p className="text-xs text-slate italic self-center">No search trend stored yet.</p>;
  const max = Math.max(1, ...points.map((point) => point.value));
  return (
    <div className="flex items-end gap-1 h-16 min-w-0" role="img" aria-label="Monthly search volume trend">
      {points.map((point) => (
        <span key={point.label} className="flex-1 min-w-0 h-full flex flex-col" title={`${point.label}: ${formatCount(point.value)}`}>
          <span className="flex-1 flex items-end">
            <span className="block w-full rounded-sm bg-sky/70" style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }} />
          </span>
          <span className="block text-[9px] text-slate text-center leading-none mt-1 truncate">{point.label}</span>
        </span>
      ))}
    </div>
  );
}

function readVolumeTrend(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as { year?: unknown; month?: unknown; search_volume?: unknown };
    if (typeof item.year !== "number" || typeof item.month !== "number" || typeof item.search_volume !== "number") return [];
    const date = new Date(Date.UTC(item.year, item.month - 1, 1));
    return [{ label: date.toLocaleDateString("en-GB", { month: "short" }), value: item.search_volume }];
  }).slice(-12);
}

function KeywordHistoryMatrix({ history }: { history: RankMatrixResult[] }) {
  const { columns, rows } = buildRankMatrix(history);
  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Area</th>
            {columns.map((column) => (
              <th className="text-center" key={column.key}>
                <RankMatrixColumnHeading column={column} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="text-slate whitespace-nowrap">{row.checkedAt ? formatDate(row.checkedAt) : "-"}</td>
              <td className="whitespace-nowrap">{row.location}</td>
              {columns.map((column) => (
                <td className="text-center" key={column.key}>
                  {row.cells[column.key] ? <RankMatrixRank result={row.cells[column.key]} /> : <span className="text-slate">-</span>}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={columns.length + 2}>No ranking history stored yet.</EmptyRow> : null}
        </tbody>
      </table>
    </TableWrap>
  );
}

const SERIES_STROKE = ["stroke-accent", "stroke-sky", "stroke-warn", "stroke-ink"];
const SERIES_FILL = ["fill-accent", "fill-sky", "fill-warn", "fill-ink"];
const SERIES_SWATCH = ["bg-accent", "bg-sky", "bg-warn", "bg-ink"];

function RankHistoryChart({ history }: { history: RankMatrixResult[] }) {
  const rankedResults = history.filter((item) => item.rank !== null && item.checkedAt);
  const runDates = Array.from(
    new Map(history.filter((item) => item.checkedAt).map((item) => [item.projectId, item.checkedAt as Date])).entries()
  ).sort((left, right) => left[1].getTime() - right[1].getTime());
  if (rankedResults.length < 2 || runDates.length < 2) {
    return (
      <div className="mb-4">
        <EmptyState compact icon="clock" title="More history is needed">More history is needed for this keyword chart.</EmptyState>
      </div>
    );
  }

  const { columns } = buildRankMatrix(history);
  const runIndexes = new Map(runDates.map(([runId], index) => [runId, index]));
  const series = columns.map((column, index) => ({
    ...column,
    index: index % SERIES_STROKE.length,
    points: rankedResults
      .filter((item) => `${item.searchType}:${item.device}` === column.key)
      .sort((left, right) => (left.checkedAt as Date).getTime() - (right.checkedAt as Date).getTime())
  })).filter((item) => item.points.length > 0);
  const width = 560;
  const height = 190;
  const padding = { top: 24, right: 20, bottom: 30, left: 28 };
  const ranks = rankedResults.map((item) => item.rank as number);
  const maxRank = Math.max(10, ...ranks);
  const x = (runId: string) => padding.left + (runIndexes.get(runId) ?? 0) * ((width - padding.left - padding.right) / Math.max(1, runDates.length - 1));
  const y = (rank: number) => padding.top + (rank - 1) * ((height - padding.top - padding.bottom) / Math.max(1, maxRank - 1));
  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 text-xs text-slate" aria-label="Chart series">
        {series.map((item) => (
          <span className="inline-flex items-center gap-1.5" key={item.key}>
            <span className={`w-2.5 h-2.5 rounded-full ${SERIES_SWATCH[item.index]}`} aria-hidden="true" />
            {readableValue(item.searchType)} · {readableValue(item.device)}
          </span>
        ))}
      </div>
      <svg className="block w-full h-auto" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Keyword rank history split by result type and device; a lower position is better">
        <line x1={padding.left} x2={width - padding.right} y1={y(1)} y2={y(1)} className="chart-grid-line" />
        <line x1={padding.left} x2={width - padding.right} y1={y(Math.min(10, maxRank))} y2={y(Math.min(10, maxRank))} className="chart-grid-line" />
        <text x="4" y={y(1) + 4} className="chart-axis-label">1</text>
        <text x="4" y={y(Math.min(10, maxRank)) + 4} className="chart-axis-label">{Math.min(10, maxRank)}</text>
        {series.map((item) => {
          const path = item.points.map((point, index) => `${index ? "L" : "M"}${x(point.projectId)},${y(point.rank as number)}`).join(" ");
          return (
            <g key={item.key}>
              {item.points.length > 1 ? (
                <path d={path} className={`fill-none stroke-2 ${SERIES_STROKE[item.index]}`} strokeLinejoin="round" strokeLinecap="round" />
              ) : null}
              {item.points.map((point) => (
                <circle key={point.id} cx={x(point.projectId)} cy={y(point.rank as number)} r="4" className={`stroke-white stroke-2 ${SERIES_FILL[item.index]}`}>
                  <title>{`${formatDate(point.checkedAt)}: ${readableValue(point.searchType)} ${readableValue(point.device)} position ${point.rank}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {runDates.map(([runId, date], index) => index === 0 || index === runDates.length - 1 ? (
          <text key={runId} x={x(runId)} y={height - 7} textAnchor={index === 0 ? "start" : "end"} className="chart-axis-label">
            {formatDate(date, { day: "2-digit", month: "short" })}
          </text>
        ) : null)}
      </svg>
    </div>
  );
}

function reportHref(basePath: string, filters: ClientReportViewData["filters"], keywordId?: string) {
  const params = new URLSearchParams();
  if (filters.section !== "overview") params.set("section", filters.section);
  if (filters.period !== "90") params.set("period", filters.period);
  if (filters.projectId) params.set("project", filters.projectId);
  if (filters.locationId) params.set("area", filters.locationId);
  if (filters.device) params.set("device", filters.device);
  if (filters.searchType) params.set("type", filters.searchType);
  if (filters.group) params.set("group", filters.group);
  if (filters.sort !== "keyword") params.set("sort", filters.sort);
  if (filters.sortDirection !== "asc") params.set("dir", filters.sortDirection);
  if (keywordId) params.set("keyword", keywordId);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}
