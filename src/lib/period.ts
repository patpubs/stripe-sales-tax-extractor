// Report periods are defined in local time for the Stripe account's timezone
// (e.g. "September 2026 in America/Chicago") and converted to UTC instants
// for the Stripe API.

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Offset in ms of `timeZone` from UTC at the given instant. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant of local midnight on y-m-d in `timeZone` (m is 1-12). */
export function localMidnightUtc(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  // Two passes handle DST transitions correctly.
  let ts = guess - tzOffsetMs(new Date(guess), timeZone);
  ts = guess - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

export type Period = { start: Date; end: Date; label: string };

export function monthPeriod(year: number, month: number, timeZone: string): Period {
  const start = localMidnightUtc(year, month, 1, timeZone);
  const end = month === 12
    ? localMidnightUtc(year + 1, 1, 1, timeZone)
    : localMidnightUtc(year, month + 1, 1, timeZone);
  return { start, end, label: `${MONTHS[month - 1]} ${year}` };
}

/** Calendar quarter (Q1 = Jan–Mar), quarter is 1-4. */
export function quarterPeriod(year: number, quarter: number, timeZone: string): Period {
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) throw new Error("Pick a quarter.");
  const first = (quarter - 1) * 3 + 1;
  const start = localMidnightUtc(year, first, 1, timeZone);
  const end = quarter === 4 ? localMidnightUtc(year + 1, 1, 1, timeZone) : localMidnightUtc(year, first + 3, 1, timeZone);
  return { start, end, label: `Q${quarter} ${year}` };
}

/** The last full month and quarter before `now`, in `timeZone`. */
export function previousPeriods(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const year = get("year");
  const month = get("month");
  const quarter = Math.ceil(month / 3);
  return {
    day: get("day"),
    /** 1-3: which month of the current quarter today is in. */
    monthOfQuarter: month - (quarter - 1) * 3,
    month: month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 },
    quarter: quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 },
  };
}

/** Inclusive date range given as YYYY-MM-DD strings. */
export function customPeriod(from: string, to: string, timeZone: string): Period {
  const [fy, fm, fd] = parseDate(from);
  const [ty, tm, td] = parseDate(to);
  const start = localMidnightUtc(fy, fm, fd, timeZone);
  // Exclusive end: midnight after the last selected day.
  const next = new Date(Date.UTC(ty, tm - 1, td + 1));
  const end = localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
  if (end <= start) throw new Error("End date must be on or after start date");
  return { start, end, label: `${formatShort(fy, fm, fd)} – ${formatShort(ty, tm, td)}` };
}

function parseDate(s: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function formatShort(y: number, m: number, d: number): string {
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
}
