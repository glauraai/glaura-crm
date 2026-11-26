// Pure date/layout helpers for the availability views (no I/O, unit-tested).
// All "days" are Paris calendar days written YYYY-MM-DD.

export type Interval = { start: Date; end: Date };

const TZ = "Europe/Paris";
export const DAY_START_HOUR = 8;
export const DAY_END_HOUR = 20;

/** Minutes Paris is ahead of UTC at `at` (60 in winter, 120 in summer). */
function parisOffsetMinutes(at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(at).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant of `hour`:00 Paris time on `day`. */
export function parisTime(day: string, hour: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour));
  return new Date(guess.getTime() - parisOffsetMinutes(guess) * 60_000);
}

export function parisDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(at);
}

/** The next `count` Monday–Friday Paris days, starting today (or next Monday on weekends). */
export function workingDays(from: Date, count: number): string[] {
  const days: string[] = [];
  let cursor = parisTime(parisDay(from), 12);
  while (days.length < count) {
    const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(cursor);
    if (weekday !== "Sat" && weekday !== "Sun") days.push(parisDay(cursor));
    cursor = new Date(cursor.getTime() + 864e5);
  }
  return days;
}

export function dayLabel(day: string, today: string): string {
  if (day === today) return "Aujourd’hui";
  const label = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, weekday: "long", day: "numeric", month: "short" }).format(parisTime(day, 12));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function timeLabel(at: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(at).replace(":", "h");
}

/**
 * Busy blocks of one day positioned on the 8h–20h track, as percentages.
 * Overlapping blocks are merged; anything outside the window is clipped.
 */
export function dayBlocks(busy: Interval[], day: string): { left: number; width: number; label: string }[] {
  const windowStart = parisTime(day, DAY_START_HOUR).getTime();
  const windowEnd = parisTime(day, DAY_END_HOUR).getTime();
  const span = windowEnd - windowStart;
  const clipped = busy
    .map(b => ({ start: Math.max(b.start.getTime(), windowStart), end: Math.min(b.end.getTime(), windowEnd) }))
    .filter(b => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  const merged = clipped.reduce<{ start: number; end: number }[]>((acc, b) => {
    const last = acc[acc.length - 1];
    return last && b.start <= last.end
      ? [...acc.slice(0, -1), { start: last.start, end: Math.max(last.end, b.end) }]
      : [...acc, b];
  }, []);
  return merged.map(b => ({
    left: ((b.start - windowStart) / span) * 100,
    width: ((b.end - b.start) / span) * 100,
    label: `${timeLabel(new Date(b.start))}–${timeLabel(new Date(b.end))}`,
  }));
}
