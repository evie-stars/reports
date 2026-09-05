import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

/**
 * Outgoing mail transport. Credentials come from the key store (or the SMTP_* environment
 * variables) and are only ever used over TLS: implicit TLS on port 465, STARTTLS required on
 * every other port, so a mailbox password is never sent in the clear.
 */
export type SmtpSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
};

export type SmtpCheck = {
  ok: boolean;
  /** True when the server could not be reached or answered unexpectedly, so nothing was proven. */
  indeterminate: boolean;
  message: string;
};

/** Per-phase limit (DNS, connect, greeting, idle socket). */
const SMTP_PHASE_TIMEOUT_MS = 15_000;
/** Ceiling for a whole verify or send, since the phases above are sequential. */
export const SMTP_DEADLINE_MS = 30_000;

export function validateSmtpPort(value: string) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? null : "Enter a port between 1 and 65535.";
}

export function smtpSettingsFromValues(values: Record<string, string>): SmtpSettings {
  const portError = validateSmtpPort(values.port ?? "");
  if (!values.host || portError || !values.user || !values.password) throw new Error("The SMTP settings are incomplete.");
  return { host: values.host, port: Number(values.port), user: values.user, password: values.password };
}

/** Pure, so the TLS promise can be tested without a network. */
export function smtpTransportOptions(settings: SmtpSettings): SMTPTransport.Options {
  const secure = settings.port === 465;
  return {
    host: settings.host,
    port: settings.port,
    secure,
    requireTLS: !secure,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: SMTP_PHASE_TIMEOUT_MS,
    greetingTimeout: SMTP_PHASE_TIMEOUT_MS,
    socketTimeout: SMTP_PHASE_TIMEOUT_MS,
    dnsTimeout: SMTP_PHASE_TIMEOUT_MS
  };
}

export function createSmtpTransport(settings: SmtpSettings) {
  return nodemailer.createTransport(smtpTransportOptions(settings));
}

/** Race an SMTP operation against a total deadline and tear the connection down if it loses. */
export async function withSmtpDeadline<T>(transport: Transporter, work: Promise<T>, ms = SMTP_DEADLINE_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      transport.close();
      reject(Object.assign(new Error(`The mail server did not finish within ${Math.round(ms / 1000)} seconds.`), { code: "ETIMEDOUT" }));
    }, ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn a nodemailer error into a verdict and an operator-facing sentence. Server response text is
 * never copied through (it can carry challenge URLs, addresses, or the server's own details); only
 * the error class and numeric reply code inform the message.
 */
export function interpretSmtpError(error: unknown, context: { host: string; port: number }): SmtpCheck {
  const details = (error && typeof error === "object" ? error : {}) as { code?: unknown; responseCode?: unknown; message?: unknown; command?: unknown };
  const code = typeof details.code === "string" ? details.code : null;
  const responseCode = typeof details.responseCode === "number" ? details.responseCode : null;
  const message = typeof details.message === "string" ? details.message : "";
  const where = `${context.host}:${context.port}`;

  if (code === "EAUTH") {
    if (responseCode !== null && responseCode >= 400 && responseCode < 500) {
      return { ok: false, indeterminate: true, message: `The mail server at ${where} could not authenticate right now (reply ${responseCode}). Try again shortly.` };
    }
    if (responseCode === 500 || responseCode === 502 || responseCode === 503) {
      return { ok: false, indeterminate: false, message: `The mail server at ${where} does not offer authentication on this port (reply ${responseCode}). Use port 587 or 465.` };
    }
    return { ok: false, indeterminate: false, message: "The mail server rejected the mailbox username and password." };
  }
  if (code === "ETLS") {
    return { ok: false, indeterminate: false, message: `The mail server at ${where} does not offer TLS on this port, so the password cannot be sent safely. Use port 465 or a STARTTLS port.` };
  }
  if (code === "EDNS" || /ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(message)) {
    return { ok: false, indeterminate: false, message: `No mail server was found at ${context.host}. Check the host name.` };
  }
  if (/ECONNREFUSED/.test(message)) {
    return { ok: false, indeterminate: false, message: `Nothing is listening at ${where}. Check the host and port.` };
  }
  if (/certificate|altnames|self.signed|unable to verify/i.test(message)) {
    return { ok: false, indeterminate: false, message: `The TLS certificate presented at ${where} does not match the host name. Use the host name shown on the mail server's certificate.` };
  }
  if (code === "EENVELOPE") {
    return { ok: false, indeterminate: false, message: `The mail server rejected the sender or a recipient address${responseCode ? ` (reply ${responseCode})` : ""}. Check NOTIFICATIONS_FROM matches the mailbox.` };
  }
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET" || /ECONNRESET|timed out|timeout/i.test(message)) {
    return { ok: false, indeterminate: true, message: `The mail server at ${where} could not be reached or timed out.` };
  }
  return { ok: false, indeterminate: true, message: `The mail server at ${where} answered unexpectedly${code ? ` (${code})` : ""}.` };
}

export async function verifySmtpSettings(settings: SmtpSettings): Promise<SmtpCheck> {
  const transport = createSmtpTransport(settings);
  try {
    await withSmtpDeadline(transport, transport.verify());
    return { ok: true, indeterminate: false, message: "The mail server accepted the mailbox credentials." };
  } catch (error) {
    return interpretSmtpError(error, settings);
  } finally {
    transport.close();
  }
}
