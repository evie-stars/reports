import Image from "next/image";
import { notFound } from "next/navigation";
import { ClientReportDashboard } from "@/components/client-report-dashboard";
import { StatusPill } from "@/components/ui/status-pill";
import { getClientReportData, type ReportSearchParams } from "@/lib/client-report";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Always-current client report. The first path segment is the bearer token; it shares the
 * `[slug]` segment name with the snapshot route below because Next.js requires one name per level.
 */
export default async function SharedClientReportPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ReportSearchParams>;
}) {
  const { slug: token } = await params;
  const resolvedSearchParams = await searchParams;
  const client = await prisma.client.findUnique({ where: { shareToken: token } });

  if (
    !client?.shareEnabled ||
    !client.shareExpiresAt ||
    client.shareExpiresAt <= new Date()
  ) notFound();

  const reportData = await getClientReportData(client.id, resolvedSearchParams);
  if (!reportData) notFound();

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-ink text-white px-4 md:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Image src="/star-websites.png" alt="Star Websites" width={96} height={38} priority className="h-8 w-auto" />
          <span className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-accent shadow-[0_0_10px] shadow-accent/50" aria-hidden="true" />
            <span className="font-display font-semibold">Report Hub</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill tone="accent">Read-only report</StatusPill>
          <span className="text-white/60 text-xs">Expires {formatDate(client.shareExpiresAt)}</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto w-full p-4 md:p-8">
        <div className="mb-6">
          <p className="eyebrow mb-1">Local SEO performance</p>
          <h1 className="text-2xl">{client.name}</h1>
          <p className="text-slate text-sm mt-1">Current search visibility and ranking progress</p>
        </div>
        <ClientReportDashboard data={reportData} basePath={`/share/${token}`} readOnly />
      </div>
    </div>
  );
}
