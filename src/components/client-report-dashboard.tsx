import Link from "next/link";
import { Icon } from "@/components/icon";
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

  return (
    <>
      <section className="report-stat-grid" aria-label="Ranking summary">
        <ReportStat label="Page 1 Keywords" value={stats.pageOne} detail={`of ${stats.activeKeywords} active`} tone="green" />
        <ReportStat label="Top 3 Keywords" value={stats.topThree} detail="Highest visibility" tone="blue" />
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
        <FilterSelect label="Report" name="project" value={filters.projectId ?? ""}>
          <option value="">All reports</option>
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
          <option value="local_finder">Local Finder</option>
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
          <span className="muted">{latestResults.length} result{latestResults.length === 1 ? "" : "s"}</span>
        </div>
        <div className="table-scroll">
          <table className="table comparison-table">
            <thead>
              <tr>
                <SortableHeader basePath={basePath} column="keyword" filters={filters} label="Keyword" />
                <SortableHeader basePath={basePath} column="area" filters={filters} label="Area" />
                <th>Result</th>
                <SortableHeader basePath={basePath} column="current" filters={filters} label="Current" />
                <th>Previous</th>
                <th>Change</th>
                <th>Ranked URL</th>
                <th>Checked</th>
              </tr>
            </thead>
            <tbody>
              {latestResults.map((result) => (
                <RankingRow key={result.id} result={result} href={reportHref(basePath, filters, result.keywordId)} />
              ))}
              {latestResults.length === 0 ? (
                <tr>
                  <td className="empty-table" colSpan={8}>
                    No live rankings match these filters{readOnly ? "." : ". Adjust the filters or configure a live check in report settings."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {data.selectedKeyword ? (
        <KeywordDrawer
          closeHref={closeDrawerHref}
          history={data.keywordHistory}
          keyword={data.selectedKeyword.phrase}
          targetUrl={data.selectedKeyword.targetUrl}
        />
      ) : null}
    </>
  );
}

function SortableHeader({
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
    <th scope="col" aria-sort={active ? (filters.sortDirection === "asc" ? "ascending" : "descending") : "none"}>
      <Link className={`sort-header${active ? " active" : ""}`} href={href} scroll={false} title={`Sort ${label.toLowerCase()} ${nextDirection === "asc" ? "ascending" : "descending"}`}>
        {label}<span className="sort-indicator" aria-hidden="true">{indicator}</span>
      </Link>
    </th>
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

function RankingRow({ result, href }: { result: CurrentReportResult; href: string }) {
  const state = movementState(result.direction);
  return (
    <tr className={`ranking-row ${state}`}>
      <td>
        <Link className="keyword-history-link" href={href} scroll={false}>{result.keyword.phrase}</Link>
        <small className="row-context">{result.run.project.name} · {readableType(result.device)}</small>
      </td>
      <td>{result.location.name}</td>
      <td>{readableType(result.searchType)}</td>
      <td><span className={`rank-highlight ${state}`}>{result.rank ?? "-"}</span></td>
      <td>{result.previousRank ?? "-"}</td>
      <td><Movement result={result} /></td>
      <td>
        {result.matchedUrl ? (
          <a className="result-url" href={result.matchedUrl} target="_blank" rel="noreferrer">{shortUrl(result.matchedUrl)}</a>
        ) : <span className="muted">Not found</span>}
        {result.issues.length > 0 ? (
          <div className="issue-list">{result.issues.map((issue) => <span key={issue}>{issue}</span>)}</div>
        ) : null}
      </td>
      <td>{result.checkedAt.toLocaleDateString("en-GB")}</td>
    </tr>
  );
}

function Movement({ result }: { result: CurrentReportResult }) {
  if (result.direction === "new") return <span className="change-label new">New</span>;
  if (result.direction === "lost") return <span className="change-label down">Lost</span>;
  if (result.movement === null || result.movement === 0) return <span className="change-label unchanged">No change</span>;
  if (result.movement > 0) return <span className="change-label up">+{result.movement}</span>;
  return <span className="change-label down">{result.movement}</span>;
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
  targetUrl
}: {
  closeHref: string;
  history: ClientReportData["keywordHistory"];
  keyword: string;
  targetUrl: string | null;
}) {
  const chartHistory = [...history].reverse().filter((item) => item.rank !== null);
  return (
    <div className="report-drawer-layer">
      <Link className="drawer-backdrop" href={closeHref} scroll={false} aria-label="Close keyword history" />
      <aside className="report-drawer" role="dialog" aria-modal="true" aria-label={`${keyword} ranking history`}>
        <div className="drawer-header">
          <div><p className="label">Keyword History</p><h3>{keyword}</h3></div>
          <Link className="icon-button drawer-close" href={closeHref} scroll={false} title="Close">×</Link>
        </div>
        {targetUrl ? <p className="drawer-target"><strong>Target:</strong> {targetUrl}</p> : null}
        <RankHistoryChart history={chartHistory} />
        <div className="table-scroll drawer-history-table">
          <table className="table">
            <thead><tr><th>Date</th><th>Area</th><th>Rank</th><th>URL</th></tr></thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>{item.checkedAt.toLocaleDateString("en-GB")}</td>
                  <td>{item.locationName}<small className="row-context">{readableType(item.device)} · {readableType(item.searchType)}</small></td>
                  <td><strong>{item.rank ?? "-"}</strong></td>
                  <td>{item.matchedUrl ? <a className="drawer-url" href={item.matchedUrl} target="_blank" rel="noreferrer">{shortUrl(item.matchedUrl)}</a> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </aside>
    </div>
  );
}

function RankHistoryChart({ history }: { history: ClientReportData["keywordHistory"] }) {
  if (history.length < 2) return <div className="chart-empty compact">More history is needed for this keyword chart.</div>;
  const width = 560;
  const height = 190;
  const padding = 28;
  const ranks = history.map((item) => item.rank).filter((rank): rank is number => rank !== null);
  const maxRank = Math.max(10, ...ranks);
  const x = (index: number) => padding + index * ((width - padding * 2) / (history.length - 1));
  const y = (rank: number) => padding + (rank - 1) * ((height - padding * 2) / Math.max(1, maxRank - 1));
  const path = history.map((item, index) => `${index ? "L" : "M"}${x(index)},${y(item.rank ?? maxRank)}`).join(" ");
  return (
    <svg className="keyword-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Keyword rank history where a lower position is better">
      <line x1={padding} x2={width - padding} y1={y(1)} y2={y(1)} className="chart-grid-line" />
      <line x1={padding} x2={width - padding} y1={y(Math.min(10, maxRank))} y2={y(Math.min(10, maxRank))} className="chart-grid-line" />
      <text x="4" y={y(1) + 4} className="chart-axis-label">1</text>
      <text x="4" y={y(Math.min(10, maxRank)) + 4} className="chart-axis-label">{Math.min(10, maxRank)}</text>
      <path d={path} className="chart-line page-one" />
      {history.map((item, index) => <circle key={item.id} cx={x(index)} cy={y(item.rank ?? maxRank)} r="4" className="chart-point page-one"><title>{item.checkedAt.toLocaleDateString("en-GB")}: position {item.rank}</title></circle>)}
    </svg>
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

function movementState(direction: string | null) {
  if (direction === "up") return "up";
  if (direction === "down" || direction === "lost") return "down";
  if (direction === "new") return "new";
  return "unchanged";
}

function readableType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortUrl(value: string) {
  try {
    const url = new URL(value);
    return url.pathname === "/" ? url.hostname : url.pathname;
  } catch {
    return value;
  }
}
