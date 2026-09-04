export function daysInUtcMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** A schedule day beyond the end of a month runs on that month's last day instead of never. */
export function effectiveScheduleDay(scheduleDay: number, year: number, monthIndex: number) {
  return Math.max(1, Math.min(scheduleDay, daysInUtcMonth(year, monthIndex)));
}

export function scheduleIsDue(scheduleDay: number, now = new Date()) {
  return effectiveScheduleDay(scheduleDay, now.getUTCFullYear(), now.getUTCMonth()) <= now.getUTCDate();
}

export function nextScheduleDate(day: number, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const current = new Date(Date.UTC(year, month, effectiveScheduleDay(day, year, month), 12));
  if (current >= now) return current;
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));
  return new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), effectiveScheduleDay(day, nextMonth.getUTCFullYear(), nextMonth.getUTCMonth()), 12));
}

export function scheduleDateIsWithin(date: Date, days: number, now = new Date()) {
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return date >= now && date <= cutoff;
}
