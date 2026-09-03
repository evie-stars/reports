import Link from "next/link";

export type RankMatrixResult = {
  id: string;
  projectId: string;
  projectName?: string;
  keywordId: string;
  keyword: string;
  locationId: string;
  location: string;
  searchVolume?: number | null;
  searchType: string;
  device: string;
  rank: number | null;
  previousRank: number | null;
  direction: string | null;
  movement?: number | null;
  matchedUrl: string | null;
  checkedAt?: Date;
  issues?: string[];
  details?: string[];
};

type MatrixColumn = {
  key: string;
  searchType: string;
  device: string;
};

type MatrixRow = {
  key: string;
  projectName?: string;
  keywordId: string;
  keyword: string;
  location: string;
  searchVolume?: number | null;
  checkedAt?: Date;
  cells: Record<string, RankMatrixResult>;
};

const searchTypeOrder = ["organic", "local_finder", "maps"];
const deviceOrder = ["desktop", "mobile"];

export function buildRankMatrix(results: RankMatrixResult[]) {
  const columns = Array.from(
    new Map(results.map((result) => [columnKey(result.searchType, result.device), {
      key: columnKey(result.searchType, result.device),
      searchType: result.searchType,
      device: result.device
    }])).values()
  ).sort(compareColumns);

  const rows = new Map<string, MatrixRow>();
  for (const result of results) {
    const key = [result.projectId, result.keywordId, result.locationId].join(":");
    const row = rows.get(key) ?? {
      key,
      projectName: result.projectName,
      keywordId: result.keywordId,
      keyword: result.keyword,
      location: result.location,
      searchVolume: result.searchVolume,
      checkedAt: result.checkedAt,
      cells: {}
    };
    row.cells[columnKey(result.searchType, result.device)] = result;
    if (result.checkedAt && (!row.checkedAt || result.checkedAt > row.checkedAt)) row.checkedAt = result.checkedAt;
    rows.set(key, row);
  }

  return { columns, rows: Array.from(rows.values()) };
}

export function RankMatrix({
  results,
  emptyMessage,
  keywordHref,
  showChecked = false,
  showProject = false,
  showVolume = false
}: {
  results: RankMatrixResult[];
  emptyMessage: string;
  keywordHref?: (keywordId: string) => string;
  showChecked?: boolean;
  showProject?: boolean;
  showVolume?: boolean;
}) {
  const { columns, rows } = buildRankMatrix(results);
  const columnCount = 2 + columns.length + Number(showVolume) + Number(showChecked);

  return (
    <div className="table-scroll rank-matrix-scroll">
      <table className="table rank-matrix-table">
        <thead>
          <tr>
            <th className="matrix-keyword-heading">Keyword</th>
            <th className="matrix-area-heading">Area</th>
            {showVolume ? <th className="matrix-volume-heading">Volume</th> : null}
            {columns.map((column) => (
              <th className="matrix-result-heading" key={column.key}>
                <span>{readableType(column.searchType)}</span>
                <small>{readableType(column.device)}</small>
              </th>
            ))}
            {showChecked ? <th className="matrix-date-heading">Checked</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="matrix-keyword-cell">
                {keywordHref ? (
                  <Link className="keyword-history-link" href={keywordHref(row.keywordId)} scroll={false}>{row.keyword}</Link>
                ) : <strong>{row.keyword}</strong>}
                {showProject && row.projectName ? <small className="row-context">{row.projectName}</small> : null}
              </td>
              <td>{row.location}</td>
              {showVolume ? <td>{row.searchVolume?.toLocaleString("en-GB") ?? "-"}</td> : null}
              {columns.map((column) => (
                <td className="matrix-result-cell" key={column.key}>
                  {row.cells[column.key] ? <RankCell result={row.cells[column.key]} /> : <span className="matrix-empty-cell">-</span>}
                </td>
              ))}
              {showChecked ? <td className="matrix-date-cell">{row.checkedAt?.toLocaleDateString("en-GB") ?? "-"}</td> : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr><td className="empty-table" colSpan={columnCount}>{emptyMessage}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function RankCell({ result }: { result: RankMatrixResult }) {
  const state = movementState(result.direction);
  const movement = movementLabel(result);
  const title = cellTitle(result);
  const rank = result.rank ?? "-";

  return (
    <div className={`matrix-rank ${state}`} title={title}>
      {result.matchedUrl ? (
        <a href={result.matchedUrl} target="_blank" rel="noreferrer" aria-label={`${title}. Open ranked page.`}>{rank}</a>
      ) : <span>{rank}</span>}
      {movement ? <small>{movement}</small> : null}
      {result.issues?.length ? <i aria-label={result.issues.join(", ")}>!</i> : null}
    </div>
  );
}

function movementLabel(result: RankMatrixResult) {
  if (result.direction === "new") return "New";
  if (result.direction === "lost") return "Lost";
  const movement = result.movement ?? (
    result.rank !== null && result.previousRank !== null ? result.previousRank - result.rank : null
  );
  if (movement === null || movement === 0) return "";
  return movement > 0 ? `+${movement}` : movement.toString();
}

function cellTitle(result: RankMatrixResult) {
  const parts = [
    `${readableType(result.searchType)} ${readableType(result.device)}: ${result.rank === null ? "not found" : `position ${result.rank}`}`
  ];
  if (result.previousRank !== null) parts.push(`previously ${result.previousRank}`);
  if (result.matchedUrl) parts.push(result.matchedUrl);
  if (result.issues?.length) parts.push(result.issues.join(", "));
  if (result.details?.length) parts.push(`SERP: ${result.details.join(", ")}`);
  return parts.join(". ");
}

function compareColumns(left: MatrixColumn, right: MatrixColumn) {
  const typeDifference = orderOf(searchTypeOrder, left.searchType) - orderOf(searchTypeOrder, right.searchType);
  if (typeDifference !== 0) return typeDifference;
  return orderOf(deviceOrder, left.device) - orderOf(deviceOrder, right.device);
}

function orderOf(order: string[], value: string) {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function columnKey(searchType: string, device: string) {
  return `${searchType}:${device}`;
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
