"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { DEFAULT_FAILURE_RATE_PREFS, failureRatePrefsSchema, type FailureRatePrefs } from "@/lib/failure-rate-prefs";

const endpoint = "/api/user/failure-rate-prefs";
const saves = new Map<string, Promise<void>>();

function savePrefs(email: string, prefs: FailureRatePrefs) {
  const next = (saves.get(email) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const response = await fetch(endpoint, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs), keepalive: true,
    });
    if (!response.ok) throw new Error("Failed to save preferences");
  });
  saves.set(email, next);
  return next;
}

/** Account-backed chart preferences; anonymous development sessions stay in memory. */
export function useFailureRatePrefs() {
  const { data: session, status } = useSession();
  const email = session?.user?.email?.trim().toLowerCase();
  const [prefs, setPrefs] = React.useState(DEFAULT_FAILURE_RATE_PREFS);
  const [ready, setReady] = React.useState(false);
  const [saveError, setSaveError] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const pending = React.useRef<{ email: string; prefs: FailureRatePrefs } | null>(null);

  React.useEffect(() => {
    setPrefs(DEFAULT_FAILURE_RATE_PREFS);
    setReady(false);
    setDirty(false);
    setSaveError(false);
    pending.current = null;
    if (status === "loading") return;
    if (!email) {
      setReady(true);
      return;
    }
    const abort = new AbortController();
    // A navigation may have just flushed a slider change from the prior mount.
    (saves.get(email) ?? Promise.resolve()).catch(() => {}).then(() => {
      if (abort.signal.aborted) return null;
      return fetch(endpoint, { signal: abort.signal });
    })
      .then(async response => {
        if (!response) return;
        if (!response.ok) throw new Error("Failed to load preferences");
        const saved = failureRatePrefsSchema.parse(await response.json());
        if (!abort.signal.aborted) setPrefs(saved);
      })
      .catch(() => {
        if (!abort.signal.aborted) setSaveError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setReady(true);
      });
    return () => abort.abort();
  }, [email, status]);

  React.useEffect(() => {
    if (!ready || !dirty || !email) return;
    let cancelled = false;
    // Coalesce slider changes; serialize writes so an older window cannot win.
    const timer = window.setTimeout(() => {
      pending.current = null;
      savePrefs(email, prefs)
        .then(() => { if (!cancelled) setSaveError(false); })
        .catch(() => { if (!cancelled) setSaveError(true); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [prefs, ready, dirty, email]);

  React.useEffect(() => () => {
    // Save the final slider position even when navigating before the debounce.
    const last = pending.current;
    if (last) void savePrefs(last.email, last.prefs).catch(() => {});
  }, []);

  const updatePrefs = (patch: Partial<FailureRatePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    pending.current = email ? { email, prefs: next } : null;
    setDirty(true);
  };
  return { prefs, updatePrefs, ready, saveError };
}
