import Image from "next/image";
import { notFound } from "next/navigation";
import { ClientReportDashboard } from "@/components/client-report-dashboard";
import { getClientReportData, type ReportSearchParams } from "@/lib/client-report";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SharedClientReportPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<ReportSearchParams>;
}) {
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const client = await prisma.client.findUnique({ where: { shareToken: token } });

  if (!client?.shareEnabled) notFound();

  const reportData = await getClientReportData(client.id, resolvedSearchParams);
  if (!reportData) notFound();

  return (
    <div className="shared-report">
      <header className="shared-report-header">
        <div className="shared-brand">
          <Image src="/star-websites.png" alt="Star Websites" width={88} height={34} priority />
          <span>Report Hub</span>
        </div>
        <span className="status good">Read-only report</span>
      </header>
      <header className="page-header client-report-header shared-client-header">
        <div>
          <p className="breadcrumb">Local SEO Performance</p>
          <h1>{client.name}</h1>
          <p>Current search visibility and ranking progress</p>
        </div>
      </header>
      <ClientReportDashboard data={reportData} basePath={`/share/${token}`} readOnly />
    </div>
  );
}
