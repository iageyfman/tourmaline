// Local-timezone date helpers for daily notes (SPEC 2.1). "Today" and prev/next day
// are computed CLIENT-side and passed to the server as YYYY-MM-DD strings — the server
// may run in UTC and would pick the wrong day near midnight.
//
// NEVER use toISOString() here: it formats in UTC, which is the exact off-by-one trap
// (e.g. 2026-06-13 00:00 local in a US timezone is still 2026-06-12 in UTC).

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** A Date → "YYYY-MM-DD" in the LOCAL timezone. */
export function localDateString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** A Date → "HH:MM" (24h) in the LOCAL timezone. */
export function localTimeString(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Shift a "YYYY-MM-DD" string by n days, parsing AND formatting in LOCAL time.
 * Uses `new Date(y, m-1, d+n)` (local constructor, normalizes month/day overflow) —
 * not `new Date("YYYY-MM-DD")`, which parses as UTC midnight and shifts the day.
 */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDateString(new Date(y, m - 1, d + n));
}
