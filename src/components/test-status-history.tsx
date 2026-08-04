"use client"

import { useCallback, useEffect, useState } from "react"
import { History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useTimezone } from "@/contexts/TimezoneContext"

export interface StatusRevision {
  revision_id: number
  test_id: number
  old_status: string | null
  new_status: string
  changed_by_email: string | null
  changed_by_name: string | null
  changed_at: string
  source: string
}

interface TestStatusHistoryProps {
  testId: number
  /** Bump after a successful status change to refetch. */
  refreshKey?: number
}

function statusBadgeClass(status: string | null | undefined): string {
  if (status === "PASS") {
    return "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950 border-transparent"
  }
  if (status === "FAIL") {
    return "bg-destructive text-destructive-foreground border-transparent"
  }
  if (status === "RETEST") {
    return "border-sky-600 bg-sky-50 text-sky-900 dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-200"
  }
  return ""
}

function actorLabel(rev: StatusRevision): string {
  if (rev.changed_by_name && rev.changed_by_email) {
    return `${rev.changed_by_name} (${rev.changed_by_email})`
  }
  return rev.changed_by_email || rev.changed_by_name || "unknown"
}

export function TestStatusHistory({ testId, refreshKey = 0 }: TestStatusHistoryProps) {
  const { formatInTimezone } = useTimezone()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revisions, setRevisions] = useState<StatusRevision[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/test-status?testId=${testId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed to load history (${res.status})`)
      }
      const data = await res.json()
      setRevisions(data.revisions ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history")
      setRevisions(null)
    } finally {
      setLoading(false)
    }
  }, [testId])

  // Prefetch when opened; also refresh when parent signals a status change
  useEffect(() => {
    if (open || refreshKey > 0) {
      void load()
    }
  }, [open, refreshKey, load])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          aria-label="Status change history"
          title="Status change history"
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          History
          {revisions && revisions.length > 0 ? (
            <span className="text-muted-foreground tabular-nums">
              ({revisions.length})
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0" sideOffset={6}>
        <div className="border-b px-3 py-2">
          <p className="text-sm font-medium">Status history</p>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {loading && !revisions ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="px-3 py-4 text-sm text-destructive">{error}</p>
          ) : !revisions || revisions.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No status changes recorded yet.
            </p>
          ) : (
            <ul className="divide-y">
              {revisions.map((rev) => (
                <li key={rev.revision_id} className="px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {rev.old_status ? (
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${statusBadgeClass(rev.old_status)}`}
                      >
                        {rev.old_status}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    <span className="text-muted-foreground" aria-hidden>
                      →
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${statusBadgeClass(rev.new_status)}`}
                    >
                      {rev.new_status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-foreground/90">{actorLabel(rev)}</p>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {formatInTimezone(rev.changed_at)}
                    {rev.source && rev.source !== "ui" ? ` · ${rev.source}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
