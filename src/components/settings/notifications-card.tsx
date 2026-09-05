import { sendTestNotification } from "@/actions/notifications";
import { Icon } from "@/components/icon";
import { SubmitButton } from "@/components/submit-button";
import { SectionCard } from "@/components/ui/section-card";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDateTime, type Tone } from "@/lib/format";
import type { NotificationStatus } from "@/lib/notifications";

/** Where administrator emails stand: what is configured in the app and the worker, who receives them, and a test button. */
export function NotificationsCard({ status, actorEmail }: { status: NotificationStatus; actorEmail: string }) {
  const pill = statusPill(status);
  const smtpLabel = status.smtp.unavailable
    ? "Store unavailable"
    : !status.smtp.configured
      ? status.smtp.source === "app" ? "Unreadable" : "Missing"
      : status.smtp.source === "app" ? `Stored in app · ${status.smtp.displayHint}` : "Server environment";
  const workerLabel = status.workerEnabled === null ? "not run yet" : status.workerEnabled ? "enabled" : "disabled";
  const mismatch = status.workerEnabled !== null && status.workerEnabled !== status.enabled;

  return (
    <SectionCard title="Email notifications" subtitle="Report requests and failed schedules" icon="mail" aside={<StatusPill tone={pill.tone}>{pill.label}</StatusPill>}>
      <dl className="divide-y divide-line text-sm">
        <Row label="Sending">
          <StatusPill tone={status.enabled ? "accent" : "warn"}>{status.enabled ? "Enabled" : "Disabled"}</StatusPill>
          <span className={`block text-xs mt-1 ${mismatch ? "text-warn" : "text-slate"}`}>
            Worker: {workerLabel}. {mismatch ? "Set NOTIFICATIONS_ENABLED the same in Plesk and .env; the worker sends the schedule emails." : "Set NOTIFICATIONS_ENABLED=true in both Plesk and .env to send."}
          </span>
        </Row>
        <Row label="Mailbox">
          <StatusPill tone={status.smtp.configured ? "accent" : "blocked"}>{smtpLabel}</StatusPill>
          {!status.smtp.configured ? <span className="block text-xs text-slate mt-1">Add it under API keys below.</span> : null}
          {status.smtp.configured && status.smtp.lastError ? <span className="block text-xs text-blocked mt-1">{status.smtp.lastError}</span> : null}
        </Row>
        <Row label="From address">
          {status.from ? <span className="font-mono text-xs break-all">{status.from}</span> : <StatusPill tone="blocked">NOTIFICATIONS_FROM missing</StatusPill>}
        </Row>
        <Row label="Recipients">
          {status.recipients.length > 0 ? (
            <>
              <span>{status.recipients.length} {status.recipientsSource === "environment" ? "from NOTIFICATION_EMAILS" : status.recipients.length === 1 ? "administrator" : "administrators"}</span>
              <span className="block text-xs text-slate mt-1 break-all">{status.recipients.join(", ")}</span>
            </>
          ) : (
            <>
              <StatusPill tone="blocked">Nobody</StatusPill>
              <span className="block text-xs text-slate mt-1">Administrators receive mail once they have signed in, or set NOTIFICATION_EMAILS.</span>
            </>
          )}
        </Row>
        <Row label="Last send">
          {status.lastOutcome ? (
            <>
              <StatusPill tone={status.lastOutcome.ok ? "accent" : "blocked"}>{status.lastOutcome.ok ? "Delivered" : "Failed"}</StatusPill>
              <span className="block text-xs text-slate mt-1">{formatDateTime(status.lastOutcome.at)} · {status.lastOutcome.kind.replaceAll("_", " ")} · {status.lastOutcome.detail}</span>
            </>
          ) : (
            <span className="text-slate">Nothing sent yet</span>
          )}
        </Row>
      </dl>
      <form action={sendTestNotification} className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-slate">
          Sends one email to {actorEmail} using the mailbox above, even while sending is disabled. A saved mailbox proves the login; this proves delivery.
        </p>
        <SubmitButton className="btn-ghost" disabled={!status.smtp.configured || !status.from} pendingLabel="Sending…">
          <Icon name="mail" className="w-3.5 h-3.5" />Send test email
        </SubmitButton>
      </form>
    </SectionCard>
  );
}

function statusPill(status: NotificationStatus): { tone: Tone; label: string } {
  if (status.ready) return { tone: "accent", label: "Enabled" };
  if (status.smtp.configured && status.from) return { tone: "warn", label: status.enabled ? "No recipients" : "Disabled" };
  return { tone: "blocked", label: "Setup required" };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-2">
      <dt className="text-slate">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
