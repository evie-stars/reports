/** Presentation helpers shared by every page so dates, money, and status colours read the same everywhere. */

export type Tone = "accent" | "sky" | "warn" | "blocked" | "default";

export function readableValue(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDate(value: Date | string | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-GB", options);
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatTime(value: Date) {
  return value.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatUsd(value: number | string | { toString(): string }, digits = 4) {
  const amount = typeof value === "number" ? value : Number(value.toString());
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(digits)}`;
}

export function formatCount(value: number) {
  return value.toLocaleString("en-GB");
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Map any run, task, execution, or import status onto a colour tone. */
export function statusTone(status: string): Tone {
  switch (status) {
    case "completed":
    case "healthy":
    case "active":
    case "connected":
    case "enabled":
    case "success":
      return "accent";
    case "running":
    case "submitted":
    case "submitting":
    case "queued":
    case "partial":
    case "expired":
    case "stale":
    case "pending":
    case "warn":
      return "warn";
    case "failed":
    case "blocked":
    case "revoked":
    case "failure":
    case "never":
    case "danger":
      return "blocked";
    case "info":
      return "sky";
    default:
      return "default";
  }
}

export function movementTone(direction: string | null): Tone {
  if (direction === "up" || direction === "new") return "accent";
  if (direction === "down" || direction === "lost") return "blocked";
  return "default";
}

export function readableDeliveryMethod(method: string) {
  if (method === "standard") return "Standard queue";
  if (method === "live") return "Live check";
  return readableValue(method);
}

export function readableAuditEvent(event: string) {
  return event.split(".").map((part) => readableValue(part)).join(" · ");
}
