import Link from "next/link";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyRow, TableWrap } from "@/components/ui/table";
import { formatDate, formatUsd, readableDeliveryMethod } from "@/lib/format";

type RankRun = {
  id: string;
  createdAt: Date;
  status: string;
  deliveryMethod: string;
  actualCostUsd: { toString(): string };
  results: unknown[];
};

export function RecentRunsCard({ runs }: { runs: RankRun[] }) {
  return (
    <SectionCard id="activity" title="Recent runs" subtitle="The latest rank checks stored for this report" icon="refresh" aside={<Link href="/runs" className="text-xs link">All runs →</Link>}>
      <TableWrap>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Mode</th>
              <th className="text-right">Results</th>
              <th className="text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td><Link href={`/runs/${run.id}`} className="font-medium hover:text-accent hover:underline">{formatDate(run.createdAt)}</Link></td>
                <td><StatusPill status={run.status} /></td>
                <td className="text-slate">{readableDeliveryMethod(run.deliveryMethod)}</td>
                <td className="text-right">{run.results.length}</td>
                <td className="text-right font-mono text-xs">{formatUsd(run.actualCostUsd)}</td>
              </tr>
            ))}
            {runs.length === 0 ? <EmptyRow colSpan={5}>No rank runs for this project yet.</EmptyRow> : null}
          </tbody>
        </table>
      </TableWrap>
    </SectionCard>
  );
}
