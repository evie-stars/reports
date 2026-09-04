import Image from "next/image";
import { notFound } from "next/navigation";
import { ClientReportDashboard } from "@/components/client-report-dashboard";
import { StatusPill } from "@/components/ui/status-pill";
import { writeRequestAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { readReportSnapshot, reportSnapshotStatus } from "@/lib/report-snapshot";

export const dynamic = "force-dynamic";

export default async function SharedReportSnapshotPage({ params, searchParams }: {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const [{ slug, token }, query] = await Promise.all([params, searchParams]);
  const snapshot = await prisma.reportSnapshot.findUnique({
    where: { token },
    include: { client: { select: { name: true } } }
  });

  if (!snapshot || snapshot.slug !== slug || reportSnapshotStatus(snapshot) !== "active") notFound();

  const accessedAt = new Date();
  await Promise.all([
    prisma.reportSnapshot.update({
      where: { id: snapshot.id },
      data: {
        accessCount: { increment: 1 },
        firstAccessedAt: snapshot.firstAccessedAt ?? accessedAt,
        lastAccessedAt: accessedAt
      }
    }),
    writeRequestAudit({
      event: "report_snapshot.accessed",
      entityType: "reportSnapshot",
      entityId: snapshot.id,
      metadata: { clientId: snapshot.clientId, section: query.section ?? "overview" }
    })
  ]);

  let snapshotReport;
  try {
    snapshotReport = readReportSnapshot(snapshot.payload, query.section);
  } catch {
    notFound();
  }

  const generatedAt = new Date(snapshotReport.stored.generatedAt);
  const path = `/share/${snapshot.slug}/${snapshot.token}`;

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
          <StatusPill tone="accent">Report snapshot</StatusPill>
          <span className="text-white/60 text-xs">Available until {formatDate(snapshot.expiresAt)}</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto w-full p-4 md:p-8">
        <div className="mb-6">
          <p className="eyebrow mb-1">Performance report</p>
          <h1 className="text-2xl">{snapshot.client.name}</h1>
          <p className="text-slate text-sm mt-1">Snapshot created {formatDate(generatedAt, { day: "numeric", month: "long", year: "numeric" })}</p>
          <div className="flex flex-wrap gap-1.5 mt-3" aria-label="Included report sections">
            {snapshot.modules.map((module) => <StatusPill key={module} tone="default" dot={false}>{snapshotModuleLabel(module)}</StatusPill>)}
          </div>
        </div>
        <ClientReportDashboard data={snapshotReport.report} basePath={path} readOnly frozen />
        <footer className="text-xs text-slate text-center py-6">Prepared by Star Websites · Data frozen on {formatDate(generatedAt)}</footer>
      </div>
    </div>
  );
}

function snapshotModuleLabel(module: string) {
  if (module === "rankings") return "SEO";
  if (module === "maps") return "Maps";
  if (module === "gsc") return "Search Console";
  return "Analytics";
}
