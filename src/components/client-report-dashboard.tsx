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
      <nav className="report-view-tabs" aria-label="Report sections">
        <Link aria-current={filters.section === "overview" ? "page" : undefined} className={filters.section === "overview" ? "active" : ""} href={reportHref(basePath, { ...filters, section: "overview", searchType: undefined })}>Overview</Link>
        {data.modules.seo ? <Link aria-current={filters.section === "seo" ? "page" : undefined} className={filters.section === "seo" ? "active" : ""} href={reportHref(basePath, { ...filters, section: "seo", searchType: undefined })}>SEO</Link> : null}
        {data.modules.maps ? <Link aria-current={filters.section === "maps" ? "page" : undefined} className={filters.section === "maps" ? "active" : ""} href={reportHref(basePath, { ...filters, section: "maps", searchType: undefined })}>Maps</Link> : null}
      </nav>

      {data.modules.rankings ? <section className="report-stat-grid" aria-label="Ranking summary">
        <ReportStat label={filters.section === "maps" ? "Top 3 Map Rankings" : "Top 3 Keywords"} value={stats.topThree} detail="Highest visibility" tone="blue" />
        <ReportStat label={filters.section === "maps" ? "Top 10 Map Rankings" : "Page 1 Keywords"} value={stats.pageOne} detail={`of ${stats.activeKeywords} active`} tone="green" />
        <ReportStat label={filters.section === "maps" ? "Top 20 Map Rankings" : "Top 20 Keywords"} value={stats.topTwenty} detail="Within two pages" tone="dark" />
        <ReportStat
          label="Average Position"
          value={stats.averageRank ?? "-"}
          detail={stats.averageRank === null ? "No ranking data" : "Across current results"}
          tone="neutral"
        />
      </section> : null}

      {data.modules.rankings ? <section className="card trend-card spaced-section">
        <div className="section-heading report-section-heading">
          <div>
            <p className="label label-with-icon"><Icon name="graph" />Ranking Progress</p>
            <h3>{filters.section === "maps" ? "Maps position distribution" : "Keyword position distribution"}</h3>
          </div>
          <div className="movement-summary" aria-label="Latest movement summary">
            <span className="movement-count up">{stats.improved} improved</span>
            <span className="movement-count new">{stats.newRankings} new</span>
            <span className="movement-count down">{stats.declined} dropped</span>
            {stats.issues ? <span className="movement-count issue">{stats.issues} URL flags</span> : null}
          </div>
        </div>
        <PositionDistributionChart points={data.trend} />
      </section> : null}

      {data.modules.gsc && data.gsc.mapped && (!readOnly || data.gsc.trend.length > 0) ? (
        <SearchConsolePerformance data={data.gsc} />
      ) : null}

      {data.modules.rankings ? <form className="report-filters spaced-section" action={basePath} method="get">
        {filters.section !== "overview" ? <input type="hidden" name="section" value={filters.section} /> : null}
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
        {filters.section === "overview" && data.modules.seo && data.modules.maps ? <FilterSelect label="Result" name="type" value={filters.searchType ?? ""}>
          <option value="">All results</option>
          <option value="organic">Organic</option>
          <option value="maps">Maps</option>
        </FilterSelect> : null}
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
      </form> : null}

      {data.modules.rankings ? <section className="card report-table-card spaced-section">
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
      </section> : null}

      {!data.modules.rankings && !(data.modules.gsc && data.gsc.mapped) ? (
        <section className="card report-empty-state">
          <p className="label label-with-icon"><Icon name="graph" />Report Content</p>
          <h3>No reporting data is available yet</h3>
          <p className="muted">A manager can enable an available data source from the report settings.</p>
        </section>
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

function PositionDistributionChart({ points }: { points: ClientReportData["trend"] }) {
  if (points.length < 2) {
    return <div className="chart-empty">A progress chart will appear after at least two check dates in this period.</div>;
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
  const buckets = [
    { key: "beyondThirty", label: "#31+", className: "beyond-thirty" },
    { key: "twentyOneToThirty", label: "#21-30", className: "twenty-one-thirty" },
    { key: "elevenToTwenty", label: "#11-20", className: "eleven-twenty" },
    { key: "fourToTen", label: "#4-10", className: "four-ten" },
    { key: "twoToThree", label: "#2-3", className: "two-three" },
    { key: "first", label: "#1", className: "first" }
  ] as const;

  return (
    <div className="trend-chart-wrap position-chart-wrap">
      <div className="position-chart-legend">
        {[...buckets].reverse().map((bucket) => <span className={bucket.className} key={bucket.key}>{bucket.label}</span>)}
      </div>
      <svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tracked keywords grouped into position ranges over time">
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
              {buckets.map((bucket) => {
                const count = point[bucket.key];
                const start = accumulated;
                accumulated += count;
                if (count === 0) return null;
                const percentage = point.total ? Math.round((count / point.total) * 100) : 0;
                return (
                  <rect
                    className={`position-bar ${bucket.className}`}
                    height={y(start) - y(accumulated)}
                    key={bucket.key}
                    style={{ animationDelay: `${120 + index * 45}ms` }}
                    width={barWidth}
                    x={x}
                    y={y(accumulated)}
                  >
                    <title>{point.label} · {bucket.label}: {count} keyword{count === 1 ? "" : "s"} ({percentage}%)</title>
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
  );
}

function SearchConsolePerformance({ data }: { data: ClientReportData["gsc"] }) {
  return (
    <section className="card gsc-performance-card spaced-section">
      <div className="section-heading report-section-heading">
        <div>
          <p className="label label-with-icon"><Icon name="graph" />Search Console</p>
          <h3>Google organic performance</h3>
        </div>
        <span className="muted gsc-data-date">
          {data.latestDataDate
            ? `Data through ${new Date(`${data.latestDataDate}T12:00:00Z`).toLocaleDateString("en-GB")}`
            : "No imported data yet"}
        </span>
      </div>
      <div className="gsc-metric-strip" aria-label="Search Console summary">
        <GscMetric label="Clicks" value={data.stats.clicks.toLocaleString("en-GB")} />
        <GscMetric label="Impressions" value={data.stats.impressions.toLocaleString("en-GB")} />
        <GscMetric label="Average CTR" value={data.stats.ctr === null ? "-" : `${(data.stats.ctr * 100).toFixed(1)}%`} />
        <GscMetric label="Average Position" value={data.stats.position === null ? "-" : data.stats.position.toFixed(1)} />
      </div>
      <SearchConsoleChart points={data.trend} />
    </section>
  );
}

function GscMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function SearchConsoleChart({ points }: { points: ClientReportData["gsc"]["trend"] }) {
  if (points.length < 2) {
    return <div className="chart-empty compact">Import Search Console data to see clicks and impressions over time.</div>;
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
    <div className="gsc-chart-wrap">
      <div className="gsc-chart-legend">
        <span className="clicks">Clicks</span>
        <span className="impressions">Impressions</span>
      </div>
      <svg className="gsc-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Google Search Console clicks and impressions over time">
        {gridValues.map((ratio) => {
          const y = padding.top + plotHeight - ratio * plotHeight;
          return (
            <g key={ratio}>
              <line className="chart-grid-line" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text className="chart-axis-label" x={padding.left - 8} y={y + 4} textAnchor="end">{Math.round(maxImpressions * ratio).toLocaleString("en-GB")}</text>
              <text className="chart-axis-label" x={width - padding.right + 8} y={y + 4}>{Math.round(maxClicks * ratio).toLocaleString("en-GB")}</text>
            </g>
          );
        })}
        {points.map((point, index) => (
          <rect
            className="gsc-impression-bar"
            height={padding.top + plotHeight - impressionY(point.impressions)}
            key={point.date}
            width={barWidth}
            x={x(index) - barWidth / 2}
            y={impressionY(point.impressions)}
          >
            <title>{point.label}: {point.impressions.toLocaleString("en-GB")} impressions</title>
          </rect>
        ))}
        <path className="gsc-click-line" d={clickPath} />
        {points.map((point, index) => (
          <g key={`click-${point.date}`}>
            <circle className="gsc-click-point" cx={x(index)} cy={clickY(point.clicks)} r="2.4">
              <title>{point.label}: {point.clicks.toLocaleString("en-GB")} clicks</title>
            </circle>
            {labelIndexes.has(index) ? (
              <text className="chart-axis-label" x={x(index)} y={height - 10} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{point.label}</text>
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

function readableType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
