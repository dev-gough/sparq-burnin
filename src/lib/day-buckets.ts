/**
 * Continuous UTC day buckets for trend charts, so quiet days read as gaps.
 * Periods longer than WEEKLY_AFTER_DAYS fold into Monday-start UTC weeks.
 */
export const WEEKLY_AFTER_DAYS = 92;
const DAY_MS = 86_400_000;

export const utcDayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const formatUtcDay = (ms: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(ms).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });

export type DayBucket<K extends string> = { start: string; label: string; days: number } & Record<K, number>;

export function fillDayBuckets<K extends string>(
  rows: ({ day: string } & Record<K, number>)[], keys: readonly K[], from: string | null, to: string,
): { buckets: DayBucket<K>[]; weekly: boolean } {
  const start = utcDayMs(from ?? rows[0]?.day ?? to);
  const end = Math.max(utcDayMs(to), start);
  const weekly = (end - start) / DAY_MS > WEEKLY_AFTER_DAYS;
  const byDay = new Map(rows.map(r => [r.day, r]));
  const buckets = new Map<number, DayBucket<K>>();
  for (let t = start; t <= end; t += DAY_MS) {
    const key = weekly ? t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS : t;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        start: new Date(key).toISOString().slice(0, 10),
        label: weekly
          ? `Week of ${formatUtcDay(key, { month: "short", day: "numeric", year: "numeric" })}`
          : formatUtcDay(key, { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
        days: 0,
        ...Object.fromEntries(keys.map(k => [k, 0])),
      } as DayBucket<K>;
      buckets.set(key, bucket);
    }
    bucket.days++;
    const row = byDay.get(new Date(t).toISOString().slice(0, 10));
    if (row) for (const k of keys) (bucket as Record<K, number>)[k] += row[k];
  }
  return { buckets: [...buckets.values()], weekly };
}
