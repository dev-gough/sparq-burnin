"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, RefreshCw, Server } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface StationTestStats {
  totalTests: number;
  passCount: number;
  failCount: number;
  invalidCount: number;
  retestCount: number;
  otherCount: number;
  uniqueSerials: number;
  testsLast24h: number;
  testsLast7d: number;
  firstIngestAt: string | null;
  lastIngestAt: string | null;
}

interface StationRow {
  stationId: string;
  enabled: boolean;
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  revision: number;
  hasSecret: boolean;
  lastIngestAt: string | null;
  stats: StationTestStats;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-1.5 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate leading-none">
        {label}
      </div>
      <div
        className={`mt-0.5 text-base font-semibold tabular-nums leading-tight ${accent ?? ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function StationCardSkeleton() {
  return (
    <Card className="py-0 gap-0">
      <CardHeader className="py-3 px-4 pb-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-1.5 h-3 w-16" />
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2.5">
        <div className="grid grid-cols-4 lg:grid-cols-8 gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" />
          ))}
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-20 shrink-0" />
        </div>
        <Skeleton className="h-3 w-full max-w-xl" />
      </CardContent>
    </Card>
  );
}

function StationsPageSkeleton() {
  return (
    <div className="ml-10">
      <SiteHeader title="Stations" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 py-3 mx-auto w-full px-4 lg:px-6 max-w-6xl">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-7 w-64" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="size-8 rounded-md" />
              </div>
            </div>
            <div className="grid gap-2.5">
              <StationCardSkeleton />
              <StationCardSkeleton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StationsPage() {
  const { status: sessionStatus } = useSession();
  const [isAdmin, setIsAdmin] = React.useState<boolean | null>(null);
  const [stations, setStations] = React.useState<StationRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = React.useState<Date | null>(null);
  const [reasonDraft, setReasonDraft] = React.useState<Record<string, string>>(
    {}
  );
  const reasonDraftRef = React.useRef(reasonDraft);
  reasonDraftRef.current = reasonDraft;

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const adminRes = await fetch("/api/stations/admin-status");
      const adminBody = await adminRes.json().catch(() => ({}));
      if (!adminBody.isStationAdmin) {
        setIsAdmin(false);
        setStations([]);
        return;
      }

      const res = await fetch("/api/stations");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed to load (${res.status})`);
        setIsAdmin(true);
        return;
      }
      const data = await res.json();
      const list = (data.stations || []) as StationRow[];
      setStations(list);
      setReasonDraft((prev) => {
        const next = { ...prev };
        for (const s of list) {
          if (!(s.stationId in next)) {
            next[s.stationId] = s.reason || "";
          }
        }
        return next;
      });
      setLastFetchedAt(new Date());
      setIsAdmin(true);
    } catch (e) {
      console.error(e);
      setError("Failed to load stations");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    if (sessionStatus === "loading") return;
    load();
  }, [sessionStatus, load]);

  React.useEffect(() => {
    if (sessionStatus === "loading" || isAdmin === false) return;
    const id = window.setInterval(() => {
      load({ silent: true });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [sessionStatus, isAdmin, load]);

  const setEnabled = async (stationId: string, enabled: boolean) => {
    setBusyId(stationId);
    try {
      const res = await fetch(
        `/api/stations/${encodeURIComponent(stationId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled,
            reason: reasonDraftRef.current[stationId] || null,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `Update failed (${res.status})`);
        return;
      }
      await load({ silent: true });
    } catch (e) {
      console.error(e);
      alert("Update failed");
    } finally {
      setBusyId(null);
    }
  };

  if (sessionStatus === "loading" || (loading && isAdmin !== false)) {
    return <StationsPageSkeleton />;
  }

  if (isAdmin === false) {
    return (
      <div className="ml-10">
        <SiteHeader title="Stations" />
        <div className="flex flex-1 flex-col">
          <div className="flex flex-col gap-3 py-3 mx-auto w-full px-4 lg:px-6 max-w-6xl">
            <Card>
              <CardHeader className="py-4">
                <CardTitle>Access denied</CardTitle>
                <CardDescription>
                  Station control is limited to administrators on the station
                  admin allowlist.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-10">
      <SiteHeader title="Stations" />
      <div className="flex flex-1 flex-col">
        <div className="flex flex-col gap-3 py-3 mx-auto w-full px-4 lg:px-6 max-w-6xl">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Server className="size-5" />
                Remote station control
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
                Disable blocks new tests and HTTPS ingest. Policy is polled by
                masters and cached offline.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground tabular-nums">
                Last updated:{" "}
                {lastFetchedAt ? lastFetchedAt.toLocaleTimeString() : "—"}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                title="Refresh now"
                aria-label="Refresh stations"
                disabled={refreshing || loading}
                onClick={() => load({ silent: true })}
              >
                <RefreshCw
                  className={`size-4 ${refreshing ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          {!loading && stations.length === 0 && !error && (
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                No stations yet. They appear after HTTPS ingest or when listed
                in{" "}
                <code className="text-xs">config.json → ingest.stations</code>.
              </CardContent>
            </Card>
          )}

          <div className="grid gap-2.5">
            {stations.map((s) => {
              const st = s.stats ?? {
                totalTests: 0,
                passCount: 0,
                failCount: 0,
                invalidCount: 0,
                retestCount: 0,
                otherCount: 0,
                uniqueSerials: 0,
                testsLast24h: 0,
                testsLast7d: 0,
                firstIngestAt: null,
                lastIngestAt: s.lastIngestAt,
              };
              const passRate =
                st.totalTests > 0
                  ? `${Math.round((st.passCount / st.totalTests) * 100)}%`
                  : "—";

              return (
                <Card key={s.stationId} className="py-0 gap-0 shadow-sm">
                  <CardHeader className="py-2.5 px-4 pb-2">
                    <div className="flex items-center justify-between gap-3 min-w-0">
                      <div className="min-w-0 flex items-baseline gap-2 flex-wrap">
                        <CardTitle className="text-sm font-mono">
                          {s.stationId}
                        </CardTitle>
                        {s.enabled ? (
                          <span className="text-xs font-medium text-green-600 dark:text-green-400">
                            Enabled
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            Disabled
                          </span>
                        )}
                        {!s.hasSecret && (
                          <span className="text-xs text-muted-foreground">
                            · no secret
                          </span>
                        )}
                        {s.reason && !s.enabled && (
                          <span className="text-xs text-muted-foreground truncate max-w-sm">
                            · {s.reason}
                          </span>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-3 space-y-2.5 text-sm">
                    <div className="grid grid-cols-4 md:grid-cols-8 gap-1.5">
                      <StatTile label="Total" value={st.totalTests} />
                      <StatTile
                        label="Pass"
                        value={st.passCount}
                        accent="text-green-600 dark:text-green-400"
                      />
                      <StatTile
                        label="Fail"
                        value={st.failCount}
                        accent="text-red-600 dark:text-red-400"
                      />
                      <StatTile
                        label="Invalid"
                        value={st.invalidCount}
                        accent="text-amber-600 dark:text-amber-400"
                      />
                      <StatTile label="Pass %" value={passRate} />
                      <StatTile label="Serials" value={st.uniqueSerials} />
                      <StatTile label="24h" value={st.testsLast24h} />
                      <StatTile label="7d" value={st.testsLast7d} />
                    </div>

                    <div className="flex gap-2 items-stretch">
                      <input
                        id={`reason-${s.stationId}`}
                        aria-label="Disable reason"
                        className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm h-9"
                        value={reasonDraft[s.stationId] ?? ""}
                        onChange={(e) =>
                          setReasonDraft((d) => ({
                            ...d,
                            [s.stationId]: e.target.value,
                          }))
                        }
                        placeholder="Disable reason (shown on station)"
                      />
                      {s.enabled ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="shrink-0 h-9 px-3"
                          disabled={busyId === s.stationId}
                          onClick={() => setEnabled(s.stationId, false)}
                        >
                          {busyId === s.stationId ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            "Disable"
                          )}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="shrink-0 h-9 px-3"
                          disabled={busyId === s.stationId}
                          onClick={() => setEnabled(s.stationId, true)}
                        >
                          {busyId === s.stationId ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            "Enable"
                          )}
                        </Button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>
                        Last ingest:{" "}
                        {formatTime(st.lastIngestAt ?? s.lastIngestAt)}
                      </span>
                      <span>
                        Policy: {formatTime(s.updatedAt)}
                        {s.updatedBy ? ` · ${s.updatedBy}` : ""}
                      </span>
                      <span>Rev {s.revision}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
