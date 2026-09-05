import { recordVerification, resolveSecret, secretStatus, type SecretSummary } from "@/lib/app-secrets";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { envList } from "@/lib/env";
import { enforceRateLimit, notificationSendRateLimit, RateLimitError, type RateLimitPolicy } from "@/lib/rate-limit";
import { createSmtpTransport, interpretSmtpError, smtpSettingsFromValues, withSmtpDeadline } from "@/lib/smtp";
import { RANK_WORKER_KEY } from "@/lib/worker-health";

/**
 * Optional email notifications for administrators: a new team report request, and scheduled
 * reports that finished failed, partial, or blocked (one digest per worker run). Nothing is sent
 * unless NOTIFICATIONS_ENABLED is "true", a From address is set, and SMTP credentials are
 * configured. Emails carry client and report names and error text, never tokens, share links, or
 * credentials.
 */

export type NotificationMessage = {
  subject: string;
  text: string;
  html: string;
};

export type NotificationSettings = {
  enabled: boolean;
  from: string | null;
  recipientsOverride: string[];
};

export type SendResult = {
  ok: boolean;
  /** Nothing was attempted (disabled, unconfigured, rate limited, or nobody to send to). */
  skipped: boolean;
  message: string;
};

export type ScheduledReportModuleOutcome = {
  label: string;
  status: string;
  error: string | null;
};

export type ScheduledReportOutcome = {
  executionId: string;
  projectId: string;
  clientId: string;
  rankRunId: string | null;
  status: string;
  clientName: string;
  projectName: string;
  scheduledFor: Date;
  modules: ScheduledReportModuleOutcome[];
};

export const NOTIFIED_REPORT_STATUSES = ["failed", "partial", "blocked"] as const;

const REPORT_REQUEST_KIND = "report_request";
const SCHEDULED_REPORT_KIND = "scheduled_report";
const TEST_KIND = "test";

/** One requester cannot turn the request form into an email cannon: three emails an hour, the rest are stored silently. */
const REPORT_REQUEST_EMAIL_POLICY: RateLimitPolicy = { limit: 3, windowSeconds: 60 * 60 };

export function notificationSettings(env: Record<string, string | undefined> = process.env): NotificationSettings {
  return {
    enabled: env.NOTIFICATIONS_ENABLED === "true",
    from: env.NOTIFICATIONS_FROM?.trim() || null,
    recipientsOverride: envList("NOTIFICATION_EMAILS", env)
  };
}

/** The override list wins when set; otherwise every administrator. Entries are lowercased, deduplicated, and must look like addresses. */
export function resolveRecipients(override: string[], adminEmails: string[]) {
  const source = override.length > 0 ? override : adminEmails;
  return Array.from(new Set(source.map((email) => email.trim().toLowerCase()).filter(isEmailAddress)));
}

export function isEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Administrators who have actually signed in, plus the environment recovery list; an invitation alone is not enough to receive mail. */
export async function notificationRecipients(env: Record<string, string | undefined> = process.env) {
  const settings = notificationSettings(env);
  if (settings.recipientsOverride.length > 0) return resolveRecipients(settings.recipientsOverride, []);
  const admins = await prisma.userAccess.findMany({
    where: { role: "admin", enabled: true, lastSignInAt: { not: null } },
    select: { email: true }
  });
  return resolveRecipients([], [...admins.map((admin) => admin.email), ...envList("AUTH_ADMIN_EMAILS", env)]);
}

/** Absolute URL into the app for links in emails, or null when the deployment has no public URL configured. */
export function publicAppUrl(pathname: string, env: Record<string, string | undefined> = process.env) {
  const base = env.AUTH_URL || env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI;
  if (!base) return null;
  try {
    return new URL(pathname, `${new URL(base).origin}/`).toString();
  } catch {
    return null;
  }
}

export type NotificationStatus = {
  enabled: boolean;
  /** What the worker saw in its own environment on its last run; null when it has never run. */
  workerEnabled: boolean | null;
  from: string | null;
  smtp: SecretSummary;
  recipients: string[];
  recipientsSource: "environment" | "administrators";
  lastOutcome: { ok: boolean; at: Date; kind: string; detail: string } | null;
  ready: boolean;
};

export async function notificationStatus(env: Record<string, string | undefined> = process.env): Promise<NotificationStatus> {
  const settings = notificationSettings(env);
  const [smtp, recipients, heartbeat, lastAudit] = await Promise.all([
    secretStatus("smtp", env),
    notificationRecipients(env).catch(() => [] as string[]),
    prisma.workerHeartbeat.findUnique({ where: { key: RANK_WORKER_KEY }, select: { notificationsEnabled: true } }).catch(() => null),
    prisma.auditLog.findFirst({
      where: { event: { in: ["notification.sent", "notification.failed"] } },
      orderBy: { createdAt: "desc" },
      select: { event: true, createdAt: true, metadata: true }
    }).catch(() => null)
  ]);
  const metadata = (lastAudit?.metadata && typeof lastAudit.metadata === "object" ? lastAudit.metadata : {}) as Record<string, unknown>;
  return {
    enabled: settings.enabled,
    workerEnabled: heartbeat ? heartbeat.notificationsEnabled : null,
    from: settings.from,
    smtp,
    recipients,
    recipientsSource: settings.recipientsOverride.length > 0 ? "environment" : "administrators",
    lastOutcome: lastAudit
      ? {
          ok: lastAudit.event === "notification.sent",
          at: lastAudit.createdAt,
          kind: typeof metadata.kind === "string" ? metadata.kind : "notification",
          detail: typeof metadata.reason === "string" ? metadata.reason : `${typeof metadata.recipients === "number" ? metadata.recipients : "?"} delivered`
        }
      : null,
    ready: settings.enabled && Boolean(settings.from) && smtp.configured && recipients.length > 0
  };
}

/**
 * Send one message. Never throws: a disabled or unconfigured setup is reported as skipped, and a
 * delivery failure is audited and returned, so the caller's own work is never blocked by email.
 */
export async function sendNotification(
  message: NotificationMessage,
  options: {
    kind: string;
    to?: string[];
    ignoreEnabledFlag?: boolean;
    limiter?: { scope: string; identifier: string; policy: RateLimitPolicy };
  }
): Promise<SendResult> {
  const settings = notificationSettings();
  if (!settings.enabled && !options.ignoreEnabledFlag) return { ok: false, skipped: true, message: "Notifications are disabled (NOTIFICATIONS_ENABLED is not \"true\")." };
  if (!settings.from) return { ok: false, skipped: true, message: "NOTIFICATIONS_FROM is not set." };

  // Two budgets before any SMTP connection: a per-kind cap for the whole app, and the caller's own (per requester).
  const limiters = [
    { scope: `notification:${options.kind}`, identifier: "global", policy: notificationSendRateLimit() },
    ...(options.limiter ? [options.limiter] : [])
  ];
  for (const limiter of limiters) {
    try {
      await enforceRateLimit(limiter.scope, limiter.identifier, limiter.policy);
    } catch (error) {
      if (error instanceof RateLimitError) {
        await writeAuditLog({ event: "notification.skipped", actorEmail: "system", actorRole: "system", entityType: "notification", metadata: { kind: options.kind, subject: message.subject, reason: "rate_limited", scope: limiter.scope } });
        return { ok: false, skipped: true, message: "Too many emails of this kind recently; this one was not sent." };
      }
      return recordFailure(options.kind, message.subject, error instanceof Error ? error.message : "The email rate limit could not be checked.");
    }
  }

  let recipients: string[];
  let smtpValues: Record<string, string> | null;
  let smtpSource: string;
  try {
    const resolved = await resolveSecret("smtp");
    smtpValues = resolved.values;
    smtpSource = resolved.source;
    recipients = options.to ? resolveRecipients(options.to, []) : await notificationRecipients();
  } catch (error) {
    return recordFailure(options.kind, message.subject, error instanceof Error ? error.message : "The SMTP settings could not be read.");
  }
  if (!smtpValues) return { ok: false, skipped: true, message: "SMTP credentials are not configured." };
  if (recipients.length === 0) return { ok: false, skipped: true, message: "There is nobody to notify: no administrator has signed in yet and NOTIFICATION_EMAILS is empty." };

  const settingsForSmtp = smtpSettingsFromValues(smtpValues);
  const transport = createSmtpTransport(settingsForSmtp);
  try {
    const info = await withSmtpDeadline(
      transport,
      transport.sendMail({ from: settings.from, to: recipients, subject: message.subject, text: message.text, html: message.html })
    );
    const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [];
    const rejected = Array.isArray(info.rejected) ? info.rejected.map(String) : [];
    if (accepted.length === 0) {
      return recordFailure(options.kind, message.subject, "The mail server accepted the message for none of the recipients.", rejected);
    }
    await writeAuditLog({
      event: "notification.sent",
      actorEmail: "system",
      actorRole: "system",
      entityType: "notification",
      metadata: { kind: options.kind, subject: message.subject, recipients: accepted.length, ...(rejected.length > 0 ? { rejected } : {}) }
    });
    return {
      ok: true,
      skipped: false,
      message: rejected.length > 0
        ? `Sent to ${accepted.length} of ${recipients.length} recipients; rejected: ${rejected.join(", ")}.`
        : `Sent to ${accepted.length} recipient${accepted.length === 1 ? "" : "s"}.`
    };
  } catch (error) {
    const verdict = interpretSmtpError(error, settingsForSmtp);
    // A definitive credential rejection means the stored mailbox password is stale: say so on its card.
    if (!verdict.indeterminate && smtpSource === "app" && (error as { code?: unknown })?.code === "EAUTH") {
      await recordVerification("smtp", verdict).catch(() => undefined);
    }
    return recordFailure(options.kind, message.subject, verdict.message);
  } finally {
    transport.close();
  }
}

async function recordFailure(kind: string, subject: string, reason: string, rejected?: string[]): Promise<SendResult> {
  await writeAuditLog({
    event: "notification.failed",
    outcome: "failure",
    actorEmail: "system",
    actorRole: "system",
    entityType: "notification",
    metadata: { kind, subject, reason, ...(rejected && rejected.length > 0 ? { rejected } : {}) }
  });
  return { ok: false, skipped: false, message: reason };
}

/* ---------- messages (pure) ---------- */

export function reportRequestMessage(input: {
  clientName: string;
  websiteUrl: string | null;
  notes: string | null;
  requestedByEmail: string;
  requestedByName: string | null;
  appUrl: string | null;
}): NotificationMessage {
  const requester = input.requestedByName ? `${input.requestedByName} (${input.requestedByEmail})` : input.requestedByEmail;
  const lines = [
    `${requester} has requested a report for ${input.clientName}.`,
    "",
    ...(input.websiteUrl ? [`Website: ${input.websiteUrl}`] : []),
    ...(input.notes ? [`Notes: ${input.notes}`] : []),
    "",
    ...(input.appUrl ? [`Review it on the dashboard: ${input.appUrl}`] : [])
  ];
  return {
    subject: `New report request: ${input.clientName}`,
    text: lines.join("\n"),
    html: htmlDocument(`New report request: ${escapeHtml(input.clientName)}`, [
      `<p>${escapeHtml(requester)} has requested a report for <strong>${escapeHtml(input.clientName)}</strong>.</p>`,
      ...(input.websiteUrl ? [`<p>Website: ${escapeHtml(input.websiteUrl)}</p>`] : []),
      ...(input.notes ? [`<p>Notes:<br>${escapeHtml(input.notes).replaceAll("\n", "<br>")}</p>`] : []),
      ...(input.appUrl ? [`<p><a href="${escapeHtml(input.appUrl)}">Review it on the dashboard</a></p>`] : [])
    ])
  };
}

/** One email per worker run listing every report that needs attention, with a link to where each is fixed. */
export function scheduledReportDigestMessage(outcomes: ScheduledReportOutcome[], appUrl: (pathname: string) => string | null): NotificationMessage {
  const subject = outcomes.length === 1
    ? `Scheduled report ${outcomeVerb(outcomes[0].status)}: ${outcomes[0].clientName} / ${outcomes[0].projectName}`
    : `${outcomes.length} scheduled reports need attention`;
  const textBlocks = outcomes.map((outcome) => {
    const settingsUrl = appUrl(`/projects/${outcome.projectId}#schedule`);
    const runUrl = outcome.rankRunId ? appUrl(`/runs/${outcome.rankRunId}`) : null;
    return [
      `${outcome.clientName} / ${outcome.projectName} (scheduled ${formatDay(outcome.scheduledFor)}) ${outcomeVerb(outcome.status)}.`,
      ...outcome.modules.map((module) => `  ${module.label}: ${readable(module.status)}${module.error ? ` (${module.error})` : ""}`),
      ...(settingsUrl ? [`  Fix the report settings: ${settingsUrl}`] : []),
      ...(runUrl ? [`  Rank run: ${runUrl}`] : [])
    ].join("\n");
  });
  const scheduledUrl = appUrl("/scheduled");
  const htmlBlocks = outcomes.map((outcome) => {
    const settingsUrl = appUrl(`/projects/${outcome.projectId}#schedule`);
    const runUrl = outcome.rankRunId ? appUrl(`/runs/${outcome.rankRunId}`) : null;
    return [
      `<p><strong>${escapeHtml(outcome.clientName)} / ${escapeHtml(outcome.projectName)}</strong> (scheduled ${escapeHtml(formatDay(outcome.scheduledFor))}) ${escapeHtml(outcomeVerb(outcome.status))}.</p>`,
      `<ul>${outcome.modules.map((module) => `<li>${escapeHtml(module.label)}: ${escapeHtml(readable(module.status))}${module.error ? ` <em>(${escapeHtml(module.error)})</em>` : ""}</li>`).join("")}</ul>`,
      ...(settingsUrl || runUrl
        ? [`<p>${[
            settingsUrl ? `<a href="${escapeHtml(settingsUrl)}">Fix the report settings</a>` : null,
            runUrl ? `<a href="${escapeHtml(runUrl)}">Open the rank run</a>` : null
          ].filter(Boolean).join(" · ")}</p>`]
        : [])
    ].join("\n");
  });
  return {
    subject,
    text: [...textBlocks, "", ...(scheduledUrl ? [`All scheduled reports: ${scheduledUrl}`] : [])].join("\n\n"),
    html: htmlDocument(escapeHtml(subject), [
      ...htmlBlocks,
      ...(scheduledUrl ? [`<p><a href="${escapeHtml(scheduledUrl)}">All scheduled reports</a></p>`] : [])
    ])
  };
}

export function testMessage(input: { actorEmail: string; appUrl: string | null }): NotificationMessage {
  return {
    subject: "Star Reports test email",
    text: [
      `This test was sent from Star Reports Settings by ${input.actorEmail}.`,
      "If you received it, outgoing email is working.",
      ...(input.appUrl ? ["", input.appUrl] : [])
    ].join("\n"),
    html: htmlDocument("Star Reports test email", [
      `<p>This test was sent from Star Reports Settings by ${escapeHtml(input.actorEmail)}.</p>`,
      "<p>If you received it, outgoing email is working.</p>",
      ...(input.appUrl ? [`<p><a href="${escapeHtml(input.appUrl)}">${escapeHtml(input.appUrl)}</a></p>`] : [])
    ])
  };
}

/* ---------- event hooks ---------- */

export async function notifyReportRequest(request: {
  clientName: string;
  websiteUrl: string | null;
  notes: string | null;
  requestedByEmail: string;
  requestedByName: string | null;
}) {
  return sendNotification(reportRequestMessage({ ...request, appUrl: publicAppUrl("/") }), {
    kind: REPORT_REQUEST_KIND,
    limiter: { scope: "notification:report_request", identifier: request.requestedByEmail, policy: REPORT_REQUEST_EMAIL_POLICY }
  });
}

/** Only failed, partial, and blocked outcomes are emailed, all together in one digest. */
export function outcomesNeedingAttention(outcomes: ScheduledReportOutcome[]) {
  return outcomes.filter((outcome) => (NOTIFIED_REPORT_STATUSES as readonly string[]).includes(outcome.status));
}

export async function notifyScheduledReportOutcomes(outcomes: ScheduledReportOutcome[]): Promise<SendResult> {
  const attention = outcomesNeedingAttention(outcomes);
  if (attention.length === 0) return { ok: false, skipped: true, message: "No scheduled report needs attention." };
  return sendNotification(scheduledReportDigestMessage(attention, (pathname) => publicAppUrl(pathname)), { kind: SCHEDULED_REPORT_KIND });
}

export async function sendTestNotification(actorEmail: string): Promise<SendResult> {
  if (!isEmailAddress(actorEmail)) {
    return { ok: false, skipped: true, message: "Sign in with a Google account to receive a test email; the local administrator has no address." };
  }
  return sendNotification(testMessage({ actorEmail, appUrl: publicAppUrl("/settings") }), { kind: TEST_KIND, to: [actorEmail], ignoreEnabledFlag: true });
}

/* ---------- helpers ---------- */

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function outcomeVerb(status: string) {
  return status === "partial" ? "finished partially" : status === "blocked" ? "was blocked" : "failed";
}

function formatDay(value: Date) {
  return value.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function readable(status: string) {
  return status.replaceAll("_", " ");
}

function htmlDocument(title: string, paragraphs: string[]) {
  return [
    "<!doctype html>",
    "<html><body style=\"font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #1E232D; line-height: 1.5;\">",
    `<h2 style="font-size: 18px;">${title}</h2>`,
    ...paragraphs,
    "<p style=\"color: #5B6672; font-size: 12px;\">Sent by Star Reports.</p>",
    "</body></html>"
  ].join("\n");
}
