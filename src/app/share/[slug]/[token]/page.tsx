import Image from "next/image";
import { notFound } from "next/navigation";
import { ClientReportDashboard } from "@/components/client-report-dashboard";
import { writeRequestAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
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
    <div className="shared-report snapshot-report">
      <header className="shared-report-header">
        <div className="shared-brand">
          <Image src="/star-websites.png" alt="Star Websites" width={88} height={34} priority />
          <span>Report Hub</span>
        </div>
        <div className="shared-access-status">
          <span className="status good">Report snapshot</span>
          <span>Available until {snapshot.expiresAt.toLocaleDateString("en-GB")}</span>
        </div>
      </header>
      <header className="page-header client-report-header shared-client-header">
        <div>
          <p className="breadcrumb">Performance Report</p>
          <h1>{snapshot.client.name}</h1>
          <p>Snapshot created {generatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="snapshot-content-key" aria-label="Included report sections">
          {snapshot.modules.map((module) => <span key={module}>{snapshotModuleLabel(module)}</span>)}
        </div>
      </header>
      <ClientReportDashboard data={snapshotReport.report} basePath={path} readOnly frozen />
      <footer className="snapshot-footer">Prepared by Star Websites · Data frozen on {generatedAt.toLocaleDateString("en-GB")}</footer>
    </div>
  );
}

function snapshotModuleLabel(module: string) {
  if (module === "rankings") return "SEO";
  if (module === "maps") return "Maps";
  if (module === "gsc") return "Search Console";
  return "Analytics";
}
