export function nextScheduleDate(day: number, now = new Date()) {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 12));
  return current >= now ? current : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day, 12));
}

export function scheduleDateIsWithin(date: Date, days: number, now = new Date()) {
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return date >= now && date <= cutoff;
}
