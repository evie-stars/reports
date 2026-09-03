import Link from "next/link";
import { Icon } from "@/components/icon";
import { buildRankMatrix, RankMatrix, RankMatrixRank, type RankMatrixResult } from "@/components/rank-matrix";
import type { ClientReportData, CurrentReportResult } from "@/lib/client-report";

export function ClientReportDashboard({
  data,
  basePath,
  readOnly = false
}: {
  data: ClientReportData;
  basePath: string;
  readOnly?: boolean;
}) {
  const { filters, latestResults, stats } = data;
  const closeDrawerHref = reportHref(basePath, filters);
  const matrixResults = latestResults.map(toMatrixResult);
  const matrixRowCount = buildRankMatrix(matrixResults).rows.length;

  return (
    <>
      <section className="report-stat-grid" aria-label="Ranking summary">
        <ReportStat label="Top 3 Keywords" value={stats.topThree} detail="Highest visibility" tone="blue" />
        <ReportStat label="Page 1 Keywords" value={stats.pageOne} detail={`of ${stats.activeKeywords} active`} tone="green" />
        <ReportStat label="Top 20 Keywords" value={stats.topTwenty} detail="Within two pages" tone="dark" />
        <ReportStat
          label="Average Position"
          value={stats.averageRank ?? "-"}
          detail={stats.averageRank === null ? "No ranking data" : "Across current results"}
          tone="neutral"
        />
      </section>

      <section className="card trend-card spaced-section">
        <div className="section-heading report-section-heading">
          <div>
            <p className="label label-with-icon"><Icon name="graph" />Ranking Progress</p>
            <h3>Search visibility over time</h3>
          </div>
          <div className="movement-summary" aria-label="Latest movement summary">
            <span className="movement-count up">{stats.improved} improved</span>
            <span className="movement-count new">{stats.newRankings} new</span>
            <span className="movement-count down">{stats.declined} dropped</span>
            {stats.issues ? <span className="movement-count issue">{stats.issues} URL flags</span> : null}
          </div>
        </div>
        <PageOneTrendChart points={data.trend} />
      </section>

      <form className="report-filters spaced-section" action={basePath} method="get">
        <input type="hidden" name="sort" value={filters.sort} />
        <input type="hidden" name="dir" value={filters.sortDirection} />
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
        <FilterSelect label="Result" name="type" value={filters.searchType ?? ""}>
          <option value="">All results</option>
          <option value="organic">Organic</option>
          <option value="maps">Maps</option>
        </FilterSelect>
        {data.options.groups.length > 0 ? (
          <FilterSelect label="Group" name="group" value={filters.group ?? ""}>
            <option value="">All groups</option>
            {data.options.groups.map((group) => <option key={group} value={group}>{group}</option>)}
          </FilterSelect>
        ) : null}
        <div className="filter-actions">
          <button className="button" type="submit">Apply</button>
          <Link className="button button-secondary" href={basePath}>Reset</Link>
        </div>
      </form>

      <section className="card report-table-card spaced-section">
        <div className="section-heading compact-heading">
          <div>
            <p className="label label-with-icon"><Icon name="graph" />Ranking Results</p>
            <h3>Current and previous positions</h3>
          </div>
          <span className="muted">{matrixRowCount} keyword{matrixRowCount === 1 ? "" : "s"}</span>
        </div>
        <div className="matrix-sort-links" aria-label="Ranking result sorting">
          <SortableLink basePath={basePath} column="keyword" filters={filters} label="Keyword" />
          <SortableLink basePath={basePath} column="area" filters={filters} label="Area" />
          <SortableLink basePath={basePath} column="current" filters={filters} label="Best rank" />
        </div>
        <RankMatrix
          results={matrixResults}
          emptyMessage={`No live rankings match these filters${readOnly ? "." : ". Adjust the filters or configure a live check in report settings."}`}
          keywordHref={(keywordId) => reportHref(basePath, filters, keywordId)}
          showChecked
          showVolume
        />
      </section>

      {data.selectedKeyword ? (
        <KeywordDrawer
          closeHref={closeDrawerHref}
          history={data.keywordHistory}
          keyword={data.selectedKeyword.phrase}
          targetUrl={data.selectedKeyword.targetUrl}
          searchVolume={data.selectedKeyword.searchVolume}
          monthlySearches={data.selectedKeyword.monthlySearches}
        />
      ) : null}
    </>
  );
}

function SortableLink({
  basePath,
  column,
  filters,
  label
}: {
  basePath: string;
  column: ClientReportData["filters"]["sort"];
  filters: ClientReportData["filters"];
  label: string;
}) {
  const active = filters.sort === column;
  const nextDirection = active && filters.sortDirection === "asc" ? "desc" : "asc";
  const href = reportHref(basePath, { ...filters, sort: column, sortDirection: nextDirection });
  const indicator = active ? (filters.sortDirection === "asc" ? "↑" : "↓") : "↕";
  return (
    <Link className={`sort-header${active ? " active" : ""}`} href={href} scroll={false} title={`Sort ${label.toLowerCase()} ${nextDirection === "asc" ? "ascending" : "descending"}`}>
      {label}<span className="sort-indicator" aria-hidden="true">{indicator}</span>
    </Link>
  );
}

function ReportStat({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone: string }) {
  return (
    <div className={`report-stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function FilterSelect({ label, name, value, children }: { label: string; name: string; value: string; children: React.ReactNode }) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value}>{children}</select>
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

function PageOneTrendChart({ points }: { points: ClientReportData["trend"] }) {
  if (points.length < 2) {
    return <div className="chart-empty">A progress chart will appear after at least two check dates in this period.</div>;
  }

  const width = 900;
  const height = 250;
  const padding = { top: 24, right: 28, bottom: 42, left: 42 };
  const maxValue = Math.max(1, ...points.map((point) => Math.max(point.pageOne, point.topThree)));
  const x = (index: number) => padding.left + index * ((width - padding.left - padding.right) / (points.length - 1));
  const y = (value: number) => height - padding.bottom - value * ((height - padding.top - padding.bottom) / maxValue);
  const pageOnePath = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.pageOne)}`).join(" ");
  const topThreePath = points.map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.topThree)}`).join(" ");
  const gridValues = Array.from(new Set([0, Math.ceil(maxValue / 2), maxValue]));

  return (
    <div className="trend-chart-wrap">
      <div className="chart-legend"><span className="page-one">Page 1</span><span className="top-three">Top 3</span></div>
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Page one and top three keyword rankings over time">
        {gridValues.map((value) => (
          <g key={value}>
            <line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} className="chart-grid-line" />
            <text x={padding.left - 10} y={y(value) + 4} textAnchor="end" className="chart-axis-label">{value}</text>
          </g>
        ))}
        <path d={pageOnePath} className="chart-line page-one" />
        <path d={topThreePath} className="chart-line top-three" />
        {points.map((point, index) => (
          <g key={point.date}>
            <circle cx={x(index)} cy={y(point.pageOne)} r="4" className="chart-point page-one"><title>{point.label}: {point.pageOne} page-one keywords</title></circle>
            <circle cx={x(index)} cy={y(point.topThree)} r="4" className="chart-point top-three"><title>{point.label}: {point.topThree} top-three keywords</title></circle>
            {(index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 5) === 0) ? (
              <text x={x(index)} y={height - 14} textAnchor="middle" className="chart-axis-label">{point.label}</text>
            ) : null}
          </g>
        ))}
      </svg>
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
  history: ClientReportData["keywordHistory"];
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
    <div className="report-drawer-layer">
      <Link className="drawer-backdrop" href={closeHref} scroll={false} aria-label="Close keyword history" />
      <aside className="report-drawer" role="dialog" aria-modal="true" aria-label={`${keyword} ranking history`}>
        <div className="drawer-header">
          <div><p className="label">Keyword History</p><h3>{keyword}</h3></div>
          <Link className="icon-button drawer-close" href={closeHref} scroll={false} title="Close">×</Link>
        </div>
        {targetUrl ? <p className="drawer-target"><strong>Target:</strong> {targetUrl}</p> : null}
        <div className="keyword-demand-summary">
          <div><span>Average monthly searches</span><strong>{searchVolume?.toLocaleString("en-GB") ?? "-"}</strong></div>
          <VolumeTrend points={volumeTrend} />
        </div>
        <RankHistoryChart history={matrixHistory} />
        <KeywordHistoryMatrix history={matrixHistory} />
      </aside>
    </div>
  );
}

function VolumeTrend({ points }: { points: Array<{ label: string; value: number }> }) {
  if (points.length === 0) return <span className="muted">No search trend stored yet.</span>;
  const max = Math.max(1, ...points.map((point) => point.value));
  return (
    <div className="volume-trend" role="img" aria-label="Monthly search volume trend">
      {points.map((point) => (
        <span key={point.label} className="volume-bar-wrap" title={`${point.label}: ${point.value.toLocaleString("en-GB")}`}>
          <i className="volume-bar" style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }} />
          <small>{point.label}</small>
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
    <div className="table-scroll drawer-history-table">
      <table className="table history-matrix-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Area</th>
            {columns.map((column) => (
              <th className="matrix-result-heading" key={column.key}>
                <span>{readableType(column.searchType)}</span>
                <small>{readableType(column.device)}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="matrix-date-cell">{row.checkedAt?.toLocaleDateString("en-GB") ?? "-"}</td>
              <td>{row.location}</td>
              {columns.map((column) => (
                <td className="matrix-result-cell" key={column.key}>
                  {row.cells[column.key] ? <RankMatrixRank result={row.cells[column.key]} /> : <span className="matrix-empty-cell">-</span>}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? <tr><td className="empty-table" colSpan={columns.length + 2}>No ranking history stored yet.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

function RankHistoryChart({ history }: { history: RankMatrixResult[] }) {
  const rankedResults = history.filter((item) => item.rank !== null && item.checkedAt);
  const runDates = Array.from(
    new Map(history.filter((item) => item.checkedAt).map((item) => [item.projectId, item.checkedAt as Date])).entries()
  ).sort((left, right) => left[1].getTime() - right[1].getTime());
  if (rankedResults.length < 2 || runDates.length < 2) {
    return <div className="chart-empty compact">More history is needed for this keyword chart.</div>;
  }

  const { columns } = buildRankMatrix(history);
  const runIndexes = new Map(runDates.map(([runId], index) => [runId, index]));
  const series = columns.map((column, index) => ({
    ...column,
    index,
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
    <div className="keyword-history-chart">
      <div className="history-chart-legend">
        {series.map((item) => <span className={`history-series-${item.index}`} key={item.key}>{readableType(item.searchType)} · {readableType(item.device)}</span>)}
      </div>
      <svg className="keyword-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Keyword rank history split by result type and device; a lower position is better">
        <line x1={padding.left} x2={width - padding.right} y1={y(1)} y2={y(1)} className="chart-grid-line" />
        <line x1={padding.left} x2={width - padding.right} y1={y(Math.min(10, maxRank))} y2={y(Math.min(10, maxRank))} className="chart-grid-line" />
        <text x="4" y={y(1) + 4} className="chart-axis-label">1</text>
        <text x="4" y={y(Math.min(10, maxRank)) + 4} className="chart-axis-label">{Math.min(10, maxRank)}</text>
        {series.map((item) => {
          const path = item.points.map((point, index) => `${index ? "L" : "M"}${x(point.projectId)},${y(point.rank as number)}`).join(" ");
          return (
            <g key={item.key}>
              {item.points.length > 1 ? <path d={path} className={`chart-line history-series-${item.index}`} /> : null}
              {item.points.map((point) => (
                <circle key={point.id} cx={x(point.projectId)} cy={y(point.rank as number)} r="4" className={`chart-point history-series-${item.index}`}>
                  <title>{point.checkedAt?.toLocaleDateString("en-GB")}: {readableType(point.searchType)} {readableType(point.device)} position {point.rank}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {runDates.map(([runId, date], index) => index === 0 || index === runDates.length - 1 ? (
          <text key={runId} x={x(runId)} y={height - 7} textAnchor={index === 0 ? "start" : "end"} className="chart-axis-label">
            {date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
          </text>
        ) : null)}
      </svg>
    </div>
  );
}

function reportHref(basePath: string, filters: ClientReportData["filters"], keywordId?: string) {
  const params = new URLSearchParams();
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

function readableType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
