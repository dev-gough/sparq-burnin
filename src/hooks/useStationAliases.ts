"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  STATION_ALIASES_KEY,
  loadStationAliases,
  normalizeStationAlias,
  saveStationAliases,
  stationDisplayName,
} from "@/lib/stationAliases";

const listeners = new Set<() => void>();
const EMPTY: Record<string, string> = {};

let cachedRaw: string | null | undefined = undefined;
let cachedAliases: Record<string, string> = EMPTY;

function emit() {
  cachedRaw = undefined;
  for (const listener of listeners) listener();
}

function getSnapshot(): Record<string, string> {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STATION_ALIASES_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedAliases;
  cachedRaw = raw;
  cachedAliases = loadStationAliases();
  return cachedAliases;
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STATION_ALIASES_KEY) {
      cachedRaw = undefined;
      onStoreChange();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useStationAliases() {
  const aliases = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);

  const setAlias = useCallback((stationId: string, name: string) => {
    const next = { ...loadStationAliases() };
    const alias = normalizeStationAlias(stationId, name);
    if (alias) next[stationId] = alias;
    else delete next[stationId];
    saveStationAliases(next);
    emit();
  }, []);

  const displayName = useCallback(
    (stationId: string) => stationDisplayName(stationId, aliases),
    [aliases],
  );

  return { aliases, setAlias, displayName };
}
