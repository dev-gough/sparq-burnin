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
import {
  Check,
  Copy,
  Inbox,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  Server,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useStationAliases } from "@/hooks/useStationAliases";

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
  hasDbCredential: boolean;
  credentialRevokedAt: string | null;
  lastIngestAt: string | null;
  stats: StationTestStats;
}

interface EnrollmentRow {
  id: number;
  stationId: string;
  candidateStationId: string | null;
  enrollmentRequestId: string | null;
  tokenId: string | null;
  tokenLabel: string | null;
  fingerprint: Record<string, string> | null;
  requestIp: string | null;
  status: string;
  requestedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
}

interface TokenRow {
  tokenId: string;
  label: string;
  createdBy: string;
  createdAt: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  revokedAt: string | null;
}

function StationHeading({
  stationId,
  displayName,
  onRename,
}: {
  stationId: string;
  displayName: string;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(displayName);
  const aliased = displayName !== stationId;

  const commit = () => {
    onRename(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="min-w-0 flex items-center gap-2">
        <input
          autoFocus
          aria-label={`Rename station ${stationId}`}
          className="min-w-0 w-56 max-w-full rounded-md border bg-background px-2 py-1 text-sm h-8"
          value={draft}
          maxLength={64}
          placeholder="e.g. Line 3"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(displayName);
              setEditing(false);
            }
          }}
        />
        <span className="text-[11px] text-muted-foreground font-mono truncate">
          {stationId}
        </span>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex items-baseline gap-2">
      <CardTitle className={aliased ? "text-sm font-medium" : "text-sm font-mono"}>
        {displayName}
      </CardTitle>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground shrink-0 rounded-sm p-0.5"
        aria-label={`Rename ${displayName}`}
        title="Rename this station (local label only)"
        onClick={() => {
          setDraft(aliased ? displayName : "");
          setEditing(true);
        }}
      >
        <Pencil className="size-3.5" />
      </button>
      {aliased && (
        <span className="text-[11px] text-muted-foreground font-mono truncate">
          {stationId}
        </span>
      )}
    </div>
  );
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
  const { displayName, setAlias } = useStationAliases();
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

  const [enrollments, setEnrollments] = React.useState<EnrollmentRow[]>([]);
  const [tokens, setTokens] = React.useState<TokenRow[]>([]);
  const [enrollBusyId, setEnrollBusyId] = React.useState<number | null>(null);
  const [tokenBusyId, setTokenBusyId] = React.useState<string | null>(null);
  const [credBusyId, setCredBusyId] = React.useState<string | null>(null);
  const [mintLabel, setMintLabel] = React.useState("");
  const [mintDays, setMintDays] = React.useState("30");
  const [minting, setMinting] = React.useState(false);
  const [mintedToken, setMintedToken] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const [res, enrollRes, tokenRes] = await Promise.all([
        fetch("/api/stations"),
        fetch("/api/stations/enrollments").catch(() => null),
        fetch("/api/stations/tokens").catch(() => null),
      ]);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed to load (${res.status})`);
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
      if (enrollRes?.ok) {
        const body = await enrollRes.json().catch(() => ({}));
        setEnrollments((body.enrollments || []) as EnrollmentRow[]);
      }
      if (tokenRes?.ok) {
        const body = await tokenRes.json().catch(() => ({}));
        setTokens((body.tokens || []) as TokenRow[]);
      }
      setLastFetchedAt(new Date());
    } catch (e) {
      console.error(e);
      setError("Failed to load stations");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Admin membership is stable for a session — check it once, not on every
  // 30 s refresh tick.
  React.useEffect(() => {
    if (sessionStatus === "loading") return;
    let cancelled = false;
    (async () => {
      try {
        const adminRes = await fetch("/api/stations/admin-status");
        const adminBody = await adminRes.json().catch(() => ({}));
        if (!cancelled) setIsAdmin(Boolean(adminBody.isStationAdmin));
      } catch (e) {
        console.error(e);
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus]);

  React.useEffect(() => {
    if (isAdmin !== true) return;
    load();
    const id = window.setInterval(() => {
      load({ silent: true });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [isAdmin, load]);

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

  const decideEnrollment = async (id: number, action: "approve" | "reject") => {
    setEnrollBusyId(id);
    try {
      const res = await fetch(`/api/stations/enrollments/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `${action} failed (${res.status})`);
        return;
      }
      await load({ silent: true });
    } catch (e) {
      console.error(e);
      alert(`${action} failed`);
    } finally {
      setEnrollBusyId(null);
    }
  };

  const mintToken = async () => {
    setMinting(true);
    try {
      const res = await fetch("/api/stations/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: mintLabel.trim(),
          expiresInDays: Number(mintDays),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error || `Mint failed (${res.status})`);
        return;
      }
      setMintedToken(body.bootstrapToken || null);
      setCopied(false);
      setMintLabel("");
      await load({ silent: true });
    } catch (e) {
      console.error(e);
      alert("Mint failed");
    } finally {
      setMinting(false);
    }
  };

  const copyMintedToken = async () => {
    if (!mintedToken) return;
    try {
      await navigator.clipboard.writeText(mintedToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error(e);
      alert("Copy failed — select and copy the token manually.");
    }
  };

  const revokeToken = async (tokenId: string) => {
    if (
      !window.confirm(
        `Revoke bootstrap token ${tokenId}? Builds carrying it can no longer enroll.`
      )
    ) {
      return;
    }
    setTokenBusyId(tokenId);
    try {
      const res = await fetch(
        `/api/stations/tokens/${encodeURIComponent(tokenId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `Revoke failed (${res.status})`);
        return;
      }
      await load({ silent: true });
    } catch (e) {
      console.error(e);
      alert("Revoke failed");
    } finally {
      setTokenBusyId(null);
    }
  };

  const revokeCredential = async (stationId: string) => {
    if (
      !window.confirm(
        `Revoke the credential for ${displayName(stationId)}? The station immediately loses ingest and policy access until it re-enrolls.`
      )
    ) {
      return;
    }
    setCredBusyId(stationId);
    try {
      const res = await fetch(
        `/api/stations/credentials/${encodeURIComponent(stationId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `Revoke failed (${res.status})`);
        return;
      }
      await load({ silent: true });
    } catch (e) {
      console.error(e);
      alert("Revoke failed");
    } finally {
      setCredBusyId(null);
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

  const pendingEnrollments = enrollments.filter((e) => e.status === "pending");

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

          <Card className="py-0 gap-0 shadow-sm">
            <CardHeader className="py-2.5 px-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Inbox className="size-4" />
                Pending enrollments
                {pendingEnrollments.length > 0 && (
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {pendingEnrollments.length} awaiting approval
                  </span>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                Re-image or candidate-collision requests against an assigned
                station ID. Approving rotates the secret on that ID; the
                station converges on its next retry.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2 text-sm">
              {pendingEnrollments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pending enrollment requests.
                </p>
              ) : (
                pendingEnrollments.map((e) => (
                  <div
                    key={e.id}
                    className="rounded-md border bg-muted/30 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm flex items-baseline gap-2 min-w-0">
                        <span
                          className={
                            displayName(e.stationId) === e.stationId
                              ? "font-mono"
                              : "font-medium"
                          }
                        >
                          {displayName(e.stationId)}
                        </span>
                        {displayName(e.stationId) !== e.stationId && (
                          <span className="font-mono text-[11px] text-muted-foreground truncate">
                            {e.stationId}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        {e.candidateStationId && (
                          <span>
                            Candidate:{" "}
                            <span className="font-mono">
                              {e.candidateStationId}
                            </span>
                          </span>
                        )}
                        {e.enrollmentRequestId && (
                          <span>
                            Request:{" "}
                            <span className="font-mono">
                              {e.enrollmentRequestId}
                            </span>
                          </span>
                        )}
                        {(e.tokenLabel || e.tokenId) && (
                          <span>
                            Token:{" "}
                            {e.tokenLabel
                              ? `${e.tokenLabel}${
                                  e.tokenId ? ` (${e.tokenId})` : ""
                                }`
                              : e.tokenId}
                          </span>
                        )}
                        <span>IP: {e.requestIp ?? "—"}</span>
                        <span>Requested: {formatTime(e.requestedAt)}</span>
                        {e.fingerprint?.hostname && (
                          <span>Host: {e.fingerprint.hostname}</span>
                        )}
                        {e.fingerprint?.machineId && (
                          <span>Machine: {e.fingerprint.machineId}</span>
                        )}
                        {e.fingerprint?.os && (
                          <span>OS: {e.fingerprint.os}</span>
                        )}
                        {e.fingerprint?.appVersion && (
                          <span>App: {e.fingerprint.appVersion}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="h-8 px-3"
                        disabled={enrollBusyId === e.id}
                        onClick={() => decideEnrollment(e.id, "approve")}
                      >
                        {enrollBusyId === e.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          "Approve"
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 px-3"
                        disabled={enrollBusyId === e.id}
                        onClick={() => decideEnrollment(e.id, "reject")}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

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
                        <StationHeading
                          stationId={s.stationId}
                          displayName={displayName(s.stationId)}
                          onRename={(name) => setAlias(s.stationId, name)}
                        />
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
                        {s.credentialRevokedAt && (
                          <span className="text-xs font-medium text-red-600 dark:text-red-400">
                            · credential revoked
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
                    <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-1.5">
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
                      <StatTile
                        label="Retest"
                        value={st.retestCount}
                        accent="text-sky-600 dark:text-sky-400"
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
                      {s.hasDbCredential && !s.credentialRevokedAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0 h-9 px-3 text-destructive hover:text-destructive"
                          disabled={credBusyId === s.stationId}
                          onClick={() => revokeCredential(s.stationId)}
                        >
                          {credBusyId === s.stationId ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            "Revoke credential"
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

          <Card className="py-0 gap-0 shadow-sm">
            <CardHeader className="py-2.5 px-4 pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <KeyRound className="size-4" />
                Bootstrap tokens
              </CardTitle>
              <CardDescription className="text-xs">
                Baked into station builds for zero-touch enrollment. The full
                token is shown exactly once when minted — copy it into the
                build script.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2.5 text-sm">
              <div className="flex gap-2 items-stretch flex-wrap">
                <input
                  aria-label="Token label"
                  className="min-w-0 flex-1 rounded-md border bg-background px-3 py-1.5 text-sm h-9"
                  value={mintLabel}
                  onChange={(e) => setMintLabel(e.target.value)}
                  placeholder='Label (e.g. "MFG shipment 2026-09")'
                />
                <input
                  aria-label="Token expiry in days"
                  type="number"
                  min={1}
                  className="w-28 rounded-md border bg-background px-3 py-1.5 text-sm h-9"
                  value={mintDays}
                  onChange={(e) => setMintDays(e.target.value)}
                  placeholder="Days"
                  title="Expiry (days)"
                />
                <Button
                  size="sm"
                  className="shrink-0 h-9 px-3"
                  disabled={minting || !mintLabel.trim() || !(Number(mintDays) > 0)}
                  onClick={mintToken}
                >
                  {minting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Mint token"
                  )}
                </Button>
              </div>

              {mintedToken && (
                <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2">
                  <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                    Copy now — shown only once
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all font-mono text-xs">
                      {mintedToken}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 h-8 px-2.5"
                      onClick={copyMintedToken}
                    >
                      {copied ? (
                        <>
                          <Check className="size-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {tokens.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No bootstrap tokens minted yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {tokens.map((t) => {
                    // Compared against the last fetch time (state) rather than
                    // Date.now() so render stays pure; staleness is bounded by
                    // the 30 s poll.
                    const nowMs = lastFetchedAt?.getTime() ?? 0;
                    const expired =
                      t.expiresAt != null &&
                      nowMs > 0 &&
                      new Date(t.expiresAt).getTime() <= nowMs;
                    return (
                      <div
                        key={t.tokenId}
                        className="rounded-md border bg-muted/30 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-sm font-medium">
                              {t.label}
                            </span>
                            <code className="font-mono text-xs text-muted-foreground">
                              {t.tokenId}
                            </code>
                            {t.revokedAt ? (
                              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                                Revoked
                              </span>
                            ) : expired ? (
                              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                                Expired
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-green-600 dark:text-green-400">
                                Active
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span>Expires: {formatTime(t.expiresAt)}</span>
                            <span>
                              Uses: {t.uses}
                              {t.maxUses != null ? ` / ${t.maxUses}` : ""}
                            </span>
                            <span>By: {t.createdBy}</span>
                            <span>Created: {formatTime(t.createdAt)}</span>
                          </div>
                        </div>
                        {!t.revokedAt && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 h-8 px-3 text-destructive hover:text-destructive"
                            disabled={tokenBusyId === t.tokenId}
                            onClick={() => revokeToken(t.tokenId)}
                          >
                            {tokenBusyId === t.tokenId ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              "Revoke"
                            )}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
