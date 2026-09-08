/**
 * Browser-only display names for station ids. HMAC identity is unchanged;
 * this is a local label overlay (localStorage), not a server rename.
 */

export const STATION_ALIASES_KEY = "burnin-station-aliases";

const ALIAS_MAX_LEN = 64;

export function loadStationAliases(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STATION_ALIASES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [id, name] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof name === "string" && name.trim()) {
        out[id] = name.trim().slice(0, ALIAS_MAX_LEN);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveStationAliases(aliases: Record<string, string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STATION_ALIASES_KEY, JSON.stringify(aliases));
}

export function normalizeStationAlias(
  stationId: string,
  name: string,
): string | null {
  const trimmed = name.trim().slice(0, ALIAS_MAX_LEN);
  if (!trimmed || trimmed === stationId) return null;
  return trimmed;
}

export function stationDisplayName(
  stationId: string,
  aliases: Record<string, string> = loadStationAliases(),
): string {
  const alias = aliases[stationId]?.trim();
  return alias || stationId;
}
