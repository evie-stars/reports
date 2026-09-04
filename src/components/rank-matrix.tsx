import Link from "next/link";
import { Icon } from "@/components/icon";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { formatCount, formatDate, movementTone, readableValue, type Tone } from "@/lib/format";

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

const BADGE: Record<Tone, string> = {
  accent: "bg-accent/10 text-accent",
  blocked: "bg-blocked/10 text-blocked",
  default: "bg-line/60 text-ink",
  sky: "bg-sky/10 text-sky",
  warn: "bg-warn/10 text-warn"
};

const MOVEMENT: Record<Tone, string> = {
  accent: "text-accent",
  blocked: "text-blocked",
  default: "text-slate",
  sky: "text-sky",
  warn: "text-warn"
};

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

/** Two-line column heading: result type over device. */
export function RankMatrixColumnHeading({ column }: { column: { searchType: string; device: string } }) {
  return (
    <>
      <span className="block">{readableValue(column.searchType)}</span>
      <span className="block text-[10px] font-normal normal-case tracking-normal text-slate/80">{readableValue(column.device)}</span>
    </>
  );
}

export function RankMatrix({
  results,
  emptyMessage,
  keywordHref,
  showChecked = false,
  showVolume = false
}: {
  results: RankMatrixResult[];
  emptyMessage: string;
  keywordHref?: (keywordId: string) => string;
  showChecked?: boolean;
  showVolume?: boolean;
}) {
  const { columns, rows } = buildRankMatrix(results);
  const columnCount = 2 + columns.length + Number(showVolume) + Number(showChecked);

  return (
    <TableWrap>
      <table className="table">
        <thead>
          <tr>
            <th>Keyword</th>
            <th>Area</th>
            {showVolume ? <th className="text-right">Volume</th> : null}
            {columns.map((column) => (
              <th className="text-center" key={column.key}>
                <RankMatrixColumnHeading column={column} />
              </th>
            ))}
            {showChecked ? <th>Checked</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="min-w-[10rem]">
                {keywordHref ? (
                  <Link className="font-medium hover:text-accent hover:underline" href={keywordHref(row.keywordId)} scroll={false}>{row.keyword}</Link>
                ) : <span className="font-medium">{row.keyword}</span>}
              </td>
              <td className="text-slate whitespace-nowrap">{row.location}</td>
              {showVolume ? (
                <td className="text-right font-mono text-xs text-slate whitespace-nowrap">
                  {row.searchVolume === null || row.searchVolume === undefined ? "-" : formatCount(row.searchVolume)}
                </td>
              ) : null}
              {columns.map((column) => (
                <td className="text-center" key={column.key}>
                  {row.cells[column.key] ? <RankMatrixRank result={row.cells[column.key]} /> : <span className="text-slate">-</span>}
                </td>
              ))}
              {showChecked ? <td className="text-slate whitespace-nowrap">{row.checkedAt ? formatDate(row.checkedAt) : "-"}</td> : null}
            </tr>
          ))}
          {rows.length === 0 ? <EmptyRow colSpan={columnCount}>{emptyMessage}</EmptyRow> : null}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function RankMatrixRank({ result }: { result: RankMatrixResult }) {
  const tone = movementTone(result.direction);
  const movement = movementLabel(result);
  const title = cellTitle(result);
  const rank = result.rank ?? "-";
  const badge = `inline-flex min-w-[2rem] justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold ${result.rank === null ? "text-slate" : BADGE[tone]}`;

  return (
    <span className="inline-flex flex-col items-center gap-0.5" title={title}>
      <span className="inline-flex items-center gap-1">
        {result.matchedUrl ? (
          <a
            href={result.matchedUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`${title}. Open ranked page.`}
            className={`${badge} transition-opacity hover:opacity-75`}
          >
            {rank}
          </a>
        ) : <span className={badge}>{rank}</span>}
        {result.issues?.length ? <Icon name="alert-circle" className="w-3.5 h-3.5 text-warn shrink-0" title={result.issues.join(", ")} /> : null}
      </span>
      {movement ? <span className={`text-[10px] leading-none font-medium ${MOVEMENT[tone]}`}>{movement}</span> : null}
    </span>
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
    `${readableValue(result.searchType)} ${readableValue(result.device)}: ${result.rank === null ? "not found" : `position ${result.rank}`}`
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
