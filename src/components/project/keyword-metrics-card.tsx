import { queueKeywordMetrics } from "@/actions/reports";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { configuredKeywordMetricsCostUsd } from "@/lib/dataforseo-costs";
import { formatUsd, readableValue } from "@/lib/format";

const IN_FLIGHT = ["queued", "submitting", "submitted"];

export function KeywordMetricsCard({
  projectId,
  status,
  error,
  activeKeywordCount,
  metricsEnabled
}: {
  projectId: string;
  status: string;
  error: string | null;
  activeKeywordCount: number;
  metricsEnabled: boolean;
}) {
  const queueMetrics = queueKeywordMetrics.bind(null, projectId);
  const tone = status === "completed" ? "accent" : status === "failed" ? "blocked" : "warn";

  return (
    <SectionCard
      id="tracking"
      title="Keyword demand"
      subtitle="Search volume and 12-month trends"
      icon="star"
      aside={<StatusPill tone={tone}>{readableValue(status)}</StatusPill>}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink">One bulk Standard task covers all {activeKeywordCount} active keywords using the first active area.</p>
          <p className="text-xs text-slate mt-1">
            Maximum estimate {formatUsd(configuredKeywordMetricsCostUsd(), 2)}
            {!metricsEnabled ? " · Disabled in server settings" : ""}
          </p>
        </div>
        <form action={queueMetrics} className="shrink-0">
          <SubmitButton
            className="btn-ghost"
            disabled={!metricsEnabled || IN_FLIGHT.includes(status)}
            pendingLabel="Queueing…"
          >
            <Icon name="refresh" className="w-3.5 h-3.5" />
            {status === "completed" ? "Refresh metrics" : "Queue metrics"}
          </SubmitButton>
        </form>
      </div>
      {error ? <p className="text-xs text-blocked mt-3">{error}</p> : null}
    </SectionCard>
  );
}
