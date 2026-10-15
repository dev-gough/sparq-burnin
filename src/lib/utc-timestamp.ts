/**
 * Parse an API timestamp. Strings with their own zone (`Z`, `+05:30`, `-04`)
 * are used as given — PostgreSQL's json_build_object emits timestamptz with
 * the session offset. Zone-less date-times and bare dates are treated as UTC.
 */
export function parseUtcTimestamp(value: string): Date {
  const text = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) (?=\d)/, "$1T");
  if (/(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(text) && text.includes("T")) {
    // Normalise "-04" / "+0530" offsets to "±hh:mm" for strict parsers.
    return new Date(text.replace(/([+-]\d{2})(?::?(\d{2}))?$/, (_, h: string, m?: string) => `${h}:${m ?? "00"}`));
  }
  return new Date(text.includes("T") ? `${text}Z` : `${text}T00:00:00Z`);
}
