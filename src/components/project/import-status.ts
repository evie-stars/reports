import { formatCount, formatDate, formatDateTime, type Tone } from "@/lib/format";

/** Presentation helpers shared by the Search Console and Analytics mapping cards. */

export function readableImportStatus(status: string) {
  if (status === "completed") return "Imported";
  if (status === "running") return "Importing";
  if (status === "failed") return "Failed";
  return "Ready";
}

export function importStatusTone(status: string): Tone {
  if (status === "completed") return "accent";
  if (status === "failed") return "blocked";
  return "warn";
}

export function importSummary(
  state: { lastImportedAt: Date | null; startDate: Date | null; endDate: Date | null; rows: number },
  prompt: string
) {
  if (!state.lastImportedAt) return prompt;
  const range = state.startDate && state.endDate
    ? `${formatDate(state.startDate)} to ${formatDate(state.endDate)}`
    : "latest 90-day period";
  return `${formatCount(state.rows)} daily snapshots · ${range} · refreshed ${formatDateTime(state.lastImportedAt)}`;
}
