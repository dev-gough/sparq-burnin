"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useTimezone } from "@/contexts/TimezoneContext";
import { useTestDataCache } from "@/contexts/TestDataCacheContext";
import { useAnnotationCache } from "@/contexts/AnnotationCacheContext";

import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircleCheckFilled,
} from "@tabler/icons-react";
import {
  CalendarRange,
  Link2,
  Search,
  Unlink,
  X,
} from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent } from "@/components/ui/tabs";

import { loadDashboardPrefs, patchDashboardPrefs } from "@/lib/dashboard-prefs";
import { cn } from "@/lib/utils";

/** Result filter chips — plain labels for non-technical readers. */
const STATUS_OPTIONS = [
  { value: "all", label: "All results", short: "All" },
  { value: "valid", label: "Passed or failed only", short: "Passed or failed" },
  {
    value: "PASS",
    label: "Passed",
    short: "Passed",
    activeClass:
      "border-emerald-600 bg-emerald-600 text-white shadow-sm hover:bg-emerald-600 hover:text-white dark:border-emerald-500 dark:bg-emerald-600",
  },
  {
    value: "FAIL",
    label: "Failed",
    short: "Failed",
    activeClass:
      "border-rose-600 bg-rose-600 text-white shadow-sm hover:bg-rose-600 hover:text-white dark:border-rose-500 dark:bg-rose-600",
  },
  {
    value: "INVALID",
    label: "Invalid",
    short: "Invalid",
    activeClass:
      "border-amber-600 bg-amber-600 text-white shadow-sm hover:bg-amber-600 hover:text-white dark:border-amber-500 dark:bg-amber-600",
  },
] as const;
import {
  getCachedTestsTable,
  subscribeTestsTableCache,
  type TestsTableFetchKey,
} from "@/lib/tests-table-cache";
import {
  isAbortError,
  loadTestsTableProgressive,
} from "@/lib/tests-table-fetch";

type TableFilterPrefs = {
  serialSearch: string;
  statusFilter: string;
  firmwareFilter: string;
  annotationFilter: string;
  dateFromFilter: string;
  dateToFilter: string;
  latestOnly: boolean;
};

export const testSchema = z.object({
  test_id: z.number(),
  inv_id: z.number(),
  serial_number: z.string(),
  firmware_version: z.string(),
  duration: z.number(),
  non_zero_status_flags: z.number(),
  status: z.string(),
  failure_reason: z.string().nullable(),
  start_time: z.string(),
  annotations: z.string().nullable(),
});

type TestRow = z.infer<typeof testSchema>;

/** Keep first occurrence of each test_id (stable order). */
function dedupeTestsById(rows: TestRow[]): TestRow[] {
  const seen = new Set<number>();
  const out: TestRow[] = [];
  for (const row of rows) {
    if (seen.has(row.test_id)) continue;
    seen.add(row.test_id);
    out.push(row);
  }
  return out;
}

// Create columns dynamically to access timezone context
const createColumns = (formatInTimezone: (dateString: string) => string, selectedTimezone: string): ColumnDef<z.infer<typeof testSchema>>[] => [
  {
    accessorKey: "serial_number",
    header: "Inverter Serial Number",
    cell: ({ row }) => (
      <div className="font-medium">{row.original.serial_number}</div>
    ),
    enableHiding: false,
    filterFn: (row, id, value) => {
      // Support wildcard pattern with *
      const pattern = value
        .toLowerCase()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
        .replace(/\*/g, '.*'); // Replace * with .*
      const regex = new RegExp(pattern);
      return regex.test((row.getValue(id) as string).toLowerCase());
    },
  },
  {
    accessorKey: "firmware_version",
    // O36: dense header; full name on hover
    header: () => <span title="Firmware Version">FW</span>,
    cell: ({ row }) => (
      <div className="w-20 truncate font-mono text-xs sm:w-28 sm:text-sm" title={row.original.firmware_version}>
        {row.original.firmware_version}
      </div>
    ),
    filterFn: (row, id, value) => {
      return row.getValue(id) === value;
    },
  },
  {
    accessorKey: "start_time",
    header: () => (
      <span
        title={`Shown in ${selectedTimezone === "utc" ? "UTC" : selectedTimezone === "delhi" ? "Delhi (IST)" : "local"} time · filters use UTC calendar days`}
      >
        Test Date
      </span>
    ),
    cell: ({ row }) => {
      return (
        <div className="w-36 text-sm">
          {formatInTimezone(row.original.start_time)}
        </div>
      );
    },
    filterFn: (row, id, value) => {
      // Bounds are UTC calendar days (same as dashboard period / charts).
      // Display timezone only affects how the cell is formatted, not the filter.
      const rowDate = new Date(row.getValue(id) as string);
      const { from, to } = value as { from: string; to: string };

      const utcStart = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
      const utcEnd = (ymd: string) => new Date(`${ymd}T23:59:59.999Z`);

      if (from && to) {
        return rowDate >= utcStart(from) && rowDate <= utcEnd(to);
      }
      if (from) return rowDate >= utcStart(from);
      if (to) return rowDate <= utcEnd(to);
      return true;
    },
  },
  {
    accessorKey: "duration",
    header: "Duration",
    cell: ({ row }) => {
      const durationMs = row.original.duration;
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);
      // O37: nominal aging target is currently 2h (was 24 → 16 → 12 → …)
      const NOMINAL_AGING_MS = 2 * 60 * 60 * 1000;
      const nearComplete = durationMs >= NOMINAL_AGING_MS;
      return (
        <div
          className={
            nearComplete
              ? "w-24 text-right tabular-nums text-emerald-700 dark:text-emerald-400"
              : "w-24 text-right tabular-nums"
          }
          title={
            nearComplete
              ? "At or above nominal aging duration (≥2h)"
              : undefined
          }
        >
          {hours > 0 ? `${hours}h ` : ""}
          {minutes > 0 ? `${minutes}m ` : ""}
          {seconds}s
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Result",
    cell: ({ row }) => {
      const status = row.original.status;
      const variant =
        status === "PASS"
          ? "default"
          : status === "FAIL"
            ? "destructive"
            : "secondary";
      return (
        <Badge
          variant={variant}
          className={`px-2 ${status === "PASS" ? "dark:bg-green-900/30 dark:text-green-400 dark:border-green-800" : ""}`}
        >
          {status === "PASS" ? (
            <>
              <IconCircleCheckFilled className="w-3 h-3 mr-1 fill-green-500 dark:fill-green-400" />
              PASS
            </>
          ) : status === "FAIL" ? (
            "FAIL"
          ) : (
            "INVALID"
          )}
        </Badge>
      );
    },
    filterFn: (row, id, value) => {
      const status = row.getValue(id) as string;
      if (value === "valid") {
        return status === "PASS" || status === "FAIL";
      }
      return status === value;
    },
  },
  {
    accessorKey: "annotations",
    header: "Annotations",
    // O26: keep column narrow when empty; expand only with content
    size: 120,
    cell: ({ row }) => {
      const annotations = row.original.annotations;
      if (!annotations || annotations === "-") {
        return (
          <div className="w-8 text-muted-foreground/50 text-sm" aria-hidden>
            —
          </div>
        );
      }
      return (
        <div className="max-w-[10rem] truncate text-sm" title={annotations}>
          {annotations}
        </div>
      );
    },
  },
];

interface DataTableProps {
  onClearDateFilter?: () => void;
  annotationFilter: string;
  onAnnotationFilterChange: (filter: string) => void;
  filterLinked: boolean;
  onFilterLinkedChange: (linked: boolean) => void;
  dateFromFilter: string;
  onDateFromFilterChange: (date: string) => void;
  dateToFilter: string;
  onDateToFilterChange: (date: string) => void;
  /** Controlled status filter (lifted for hero Failures click). */
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  /**
   * Same Result mode as the header (Latest / All tests).
   * Drives the table’s latest-per-inverter fetch so FAIL counts match the hero.
   */
  chartMode: "all" | "recent";
  onChartModeChange: (mode: "all" | "recent") => void;
}

/** Default page size — skeleton rows match the loaded table footprint. */
const TABLE_PAGE_SIZE = 30;

/**
 * Full-height skeleton matching the filter bar + table + pagination layout.
 * Used for both in-table loading and the pre-hydrate page placeholder.
 */
export function DataTableSkeleton({
  rowCount = TABLE_PAGE_SIZE,
}: {
  rowCount?: number;
}) {
  return (
    <Tabs
      id="test-table"
      defaultValue="outline"
      className="w-full flex-col justify-start gap-6 scroll-mt-4"
    >
      <TabsContent
        value="outline"
        className="relative flex flex-col gap-4 overflow-auto"
      >
        {/* Filters — mirrors loaded filter card footprint */}
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3 sm:px-5">
            <div className="space-y-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-9 w-28" />
          </div>
          <div className="space-y-5 p-4 sm:p-5">
            <Skeleton className="h-12 w-full max-w-xl" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-11 w-16 rounded-full" />
                <Skeleton className="h-11 w-36 rounded-full" />
                <Skeleton className="h-11 w-20 rounded-full" />
                <Skeleton className="h-11 w-20 rounded-full" />
                <Skeleton className="h-11 w-20 rounded-full" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-11 w-48 rounded-lg" />
              <Skeleton className="h-11 w-52 rounded-lg" />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted sticky top-0 z-10">
              <TableRow>
                <TableHead>
                  <Skeleton className="h-4 w-40" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-32" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-24" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-28" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-16" />
                </TableHead>
                <TableHead>
                  <Skeleton className="h-4 w-24" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: rowCount }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-5 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-36" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-40" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between px-4">
          <Skeleton className="hidden h-4 w-48 lg:block" />
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-20" />
            </div>
            <Skeleton className="h-4 w-32" />
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Skeleton className="hidden h-8 w-8 lg:block" />
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-8" />
              <Skeleton className="hidden h-8 w-8 lg:block" />
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

export function DataTable({
  onClearDateFilter,
  annotationFilter,
  onAnnotationFilterChange,
  filterLinked,
  onFilterLinkedChange,
  dateFromFilter,
  onDateFromFilterChange,
  dateToFilter,
  onDateToFilterChange,
  statusFilter,
  onStatusFilterChange,
  chartMode,
  onChartModeChange,
}: DataTableProps) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const { formatInTimezone, selectedTimezone } = useTimezone();
  const { prefetchTests } = useTestDataCache();
  const { quickOptions: cachedQuickOptions, groups: cachedGroups } = useAnnotationCache();
  const [data, setData] = React.useState<z.infer<typeof testSchema>[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: TABLE_PAGE_SIZE,
  });
  // Table-only prefs from localStorage (status/dates/annotation/mode owned by parent)
  const [serialSearch, setSerialSearch] = React.useState(() => {
    return loadDashboardPrefs().serialSearch || "";
  });
  const [firmwareFilter, setFirmwareFilter] = React.useState(() => {
    return loadDashboardPrefs().firmwareFilter || "all";
  });
  /** Mirrors header Result mode — not an independent filter. */
  const latestOnly = chartMode === "recent";
  const [firmwareVersions, setFirmwareVersions] = React.useState<string[]>([]);
  const [annotationGroups, setAnnotationGroups] = React.useState<Array<{
    group_name: string;
    group_color: string;
    options: string[];
  }>>([]);

  // Create columns using timezone context
  const columns = React.useMemo(() =>
    createColumns(formatInTimezone, selectedTimezone),
    [formatInTimezone, selectedTimezone]
  );

  const handleRowClick = (testId: number) => {
    router.push(`/test/${testId}`);
  };

  const testsFetchKey = React.useMemo<TestsTableFetchKey>(
    () => ({
      latestOnly,
      annotationFilter: annotationFilter || "all",
      dateFrom: dateFromFilter || "",
      dateTo: dateToFilter || "",
      // Empty dates = all-time open window (linked "All" pill or cleared filters)
      timeRange:
        !dateFromFilter && !dateToFilter ? "all" : undefined,
    }),
    [latestOnly, annotationFilter, dateFromFilter, dateToFilter],
  );

  // Hydration-safe: null on server; warm session cache after client mount.
  const cachedTable = React.useSyncExternalStore(
    subscribeTestsTableCache,
    () => getCachedTestsTable(testsFetchKey) ?? null,
    () => null,
  );

  // Apply cache hits before paint when the filter key is already warm.
  React.useLayoutEffect(() => {
    if (cachedTable) {
      setData(dedupeTestsById(cachedTable));
      setLoading(false);
    }
  }, [cachedTable, testsFetchKey]);

  React.useEffect(() => {
    const abort = new AbortController();
    const { signal } = abort;

    const fetchData = async () => {
      // Stay interactive on cache hit; progressive loader returns immediately.
      if (!getCachedTestsTable(testsFetchKey)) {
        setLoading(true);
      }
      try {
        // Swallow abort on the parallel firmware fetch so cleanup never
        // leaves an unhandled rejection (Next overlays AbortError otherwise).
        const firmwarePromise = fetch(
          "/api/test-stats?view=firmware-versions",
          { signal },
        ).then(
          (res) => res,
          (error: unknown) => {
            if (signal.aborted || isAbortError(error)) return null;
            throw error;
          },
        );

        await loadTestsTableProgressive(testsFetchKey, {
          signal,
          onChunk: (rows) => {
            if (signal.aborted) return;
            setData(dedupeTestsById(rows));
            setLoading(false);
          },
        });

        if (signal.aborted) return;
        const firmwareResponse = await firmwarePromise;
        if (firmwareResponse?.ok && !signal.aborted) {
          const versions = await firmwareResponse.json();
          setFirmwareVersions(versions);
        }
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        console.error("Failed to fetch data:", error);
      } finally {
        if (!signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchData();
    return () => {
      abort.abort();
    };
  }, [testsFetchKey]);

  // Build annotation groups from cached data
  React.useEffect(() => {
    if (cachedGroups.length > 0 && cachedQuickOptions.length > 0) {
      // Group options by group_name
      const grouped = cachedGroups.map((group) => ({
        group_name: group.group_name,
        group_color: group.group_color,
        options: cachedQuickOptions
          .filter((opt) => opt.group_name === group.group_name)
          .map((opt) => opt.option_text)
      }));

      // Add ungrouped options
      const ungroupedOptions = cachedQuickOptions
        .filter((opt) => !opt.group_name)
        .map((opt) => opt.option_text);

      if (ungroupedOptions.length > 0) {
        grouped.push({
          group_name: 'Ungrouped',
          group_color: '#6b7280',
          options: ungroupedOptions
        });
      }

      setAnnotationGroups(grouped);
    }
  }, [cachedGroups, cachedQuickOptions]);

  // Persist table-owned filters to localStorage (merge — keep dashboard fields)
  React.useEffect(() => {
    const patch: Partial<TableFilterPrefs> = {
      serialSearch,
      firmwareFilter,
      // Keep legacy key in sync with header Result mode
      latestOnly,
      // Shared fields also written so a lone table update does not wipe them
      // when page effect has not run yet; page is source of truth for these.
      statusFilter,
      annotationFilter,
      dateFromFilter,
      dateToFilter,
    };
    patchDashboardPrefs(patch);
  }, [
    serialSearch,
    statusFilter,
    firmwareFilter,
    annotationFilter,
    dateFromFilter,
    dateToFilter,
    latestOnly,
  ]);

  // Apply filters to table
  React.useEffect(() => {
    const filters: ColumnFiltersState = [];

    // Serial number search
    if (serialSearch) {
      filters.push({
        id: "serial_number",
        value: serialSearch,
      });
    }

    // Status filter
    if (statusFilter !== "all") {
      filters.push({
        id: "status",
        value: statusFilter,
      });
    }

    // Firmware version filter
    if (firmwareFilter !== "all") {
      filters.push({
        id: "firmware_version",
        value: firmwareFilter,
      });
    }

    // Date range filter
    if (dateFromFilter || dateToFilter) {
      filters.push({
        id: "start_time",
        value: { from: dateFromFilter, to: dateToFilter },
      });
    }

    setColumnFilters(filters);
  }, [
    serialSearch,
    statusFilter,
    firmwareFilter,
    dateFromFilter,
    dateToFilter,
  ]);

  const table = useReactTable({
    data: data || [],
    columns,
    state: {
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    // test_id is the stable identity; progressive-load races must not create dups
    getRowId: (row) => String(row.test_id),

    enableRowSelection: false,
    onRowSelectionChange: setRowSelection,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  // Prefetch failed tests when filters change
  React.useEffect(() => {
    // Only prefetch if there are active filters (prevent prefetch on initial load)
    if (columnFilters.length === 0) {
      return;
    }

    const filteredRows = table.getFilteredRowModel().rows;

    // Get test IDs of failed tests (status 'FAIL')
    const failedTestIds = filteredRows
      .map(row => row.original)
      .filter(test => test.status === 'FAIL')
      .map(test => test.test_id)
      .slice(0, 30); // Limit to first 30 failed tests

    if (failedTestIds.length > 0) {
      console.log(`Prefetching ${failedTestIds.length} failed tests:`, failedTestIds);
      prefetchTests(failedTestIds);
    }
  }, [columnFilters, data, prefetchTests, table]);

  if (loading) {
    return <DataTableSkeleton />;
  }

  const statusMeta =
    STATUS_OPTIONS.find((o) => o.value === statusFilter) ?? STATUS_OPTIONS[0];
  const annotationActive = Boolean(
    annotationFilter && annotationFilter !== "all",
  );
  const annotationLabel = annotationActive
    ? annotationFilter.startsWith("group:")
      ? `Category: ${annotationFilter.slice(6)}`
      : annotationFilter
    : null;
  const firmwareActive = Boolean(firmwareFilter && firmwareFilter !== "all");
  const serialActive = serialSearch.trim().length > 0;
  const statusActive = statusFilter !== "all";
  const datesActive = Boolean(dateFromFilter || dateToFilter);
  const hasActiveFilters =
    serialActive ||
    statusActive ||
    annotationActive ||
    firmwareActive ||
    datesActive;

  const clearAllFilters = () => {
    setSerialSearch("");
    onStatusFilterChange("all");
    setFirmwareFilter("all");
    onAnnotationFilterChange("all");
    onChartModeChange("all");
    if (onClearDateFilter) {
      onClearDateFilter();
    } else {
      onDateFromFilterChange("");
      onDateToFilterChange("");
    }
  };

  const formatUtcDay = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    try {
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    } catch {
      return iso;
    }
  };
  const dateRangeLabel = (() => {
    if (dateFromFilter && dateToFilter) {
      return dateFromFilter === dateToFilter
        ? formatUtcDay(dateFromFilter)
        : `${formatUtcDay(dateFromFilter)} – ${formatUtcDay(dateToFilter)}`;
    }
    if (dateFromFilter) return `From ${formatUtcDay(dateFromFilter)}`;
    if (dateToFilter) return `Until ${formatUtcDay(dateToFilter)}`;
    return null;
  })();

  return (
    <Tabs
      id="test-table"
      defaultValue="outline"
      className="w-full flex-col justify-start gap-6 scroll-mt-4"
    >
      <TabsContent
        value="outline"
        className="relative flex flex-col gap-4 overflow-auto"
      >
        {/* Filters — executive-friendly: plain labels, large targets, active chips */}
        <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/40 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight">
                Find tests
              </h2>
              <p className="text-xs text-muted-foreground">
                Narrow the list below. Click any row to open the full test.
              </p>
            </div>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                className="h-9 shrink-0 gap-1.5"
              >
                <X className="size-3.5" />
                Clear all filters
              </Button>
            )}
          </div>

          <div className="space-y-5 p-4 sm:p-5">
            {/* Search — primary action */}
            <div className="space-y-1.5">
              <Label
                htmlFor="serial-search"
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                Serial number
              </Label>
              <div className="relative max-w-xl">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="serial-search"
                  placeholder="Type a serial number to search…"
                  value={serialSearch}
                  onChange={(e) => setSerialSearch(e.target.value)}
                  className="h-12 border-border/80 bg-background pr-10 pl-10 text-base shadow-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
                {serialActive && (
                  <button
                    type="button"
                    onClick={() => setSerialSearch("")}
                    className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Clear serial search"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: use <span className="font-mono">*</span> as a wildcard —
                e.g. <span className="font-mono">19*265</span>
              </p>
            </div>

            {/* Result — big colored pills, no dropdown */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Result
                </Label>
                <InfoTooltip content="Choose which test outcomes to show. “Passed or failed” hides invalid runs." />
              </div>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label="Filter by result"
              >
                {STATUS_OPTIONS.map((opt) => {
                  const selected = statusFilter === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onStatusFilterChange(opt.value)}
                      aria-pressed={selected}
                      title={opt.label}
                      className={cn(
                        "h-11 min-w-[4.5rem] rounded-full border px-4 text-sm font-medium transition-[color,background-color,border-color,box-shadow]",
                        selected
                          ? "activeClass" in opt && opt.activeClass
                            ? opt.activeClass
                            : "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-border bg-background text-foreground hover:bg-muted",
                      )}
                    >
                      {opt.short}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Secondary filters */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Category / note
                </Label>
                <Select
                  value={annotationFilter}
                  onValueChange={onAnnotationFilterChange}
                >
                  <SelectTrigger className="h-11 w-full min-w-0 bg-background shadow-xs">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent
                    className="max-h-[400px] overflow-y-auto [&>*[data-slot=select-scroll-up-button]]:hidden [&>*[data-slot=select-scroll-down-button]]:hidden"
                    position="popper"
                    sideOffset={4}
                  >
                    <SelectItem value="all">All categories</SelectItem>
                    {annotationGroups.map((group) => {
                      const hex = group.group_color.replace("#", "");
                      const r = parseInt(hex.substring(0, 2), 16);
                      const g = parseInt(hex.substring(2, 4), 16);
                      const b = parseInt(hex.substring(4, 6), 16);
                      const isDark = resolvedTheme === "dark";
                      const headerColor = isDark
                        ? `rgb(${Math.round(r * 0.85)}, ${Math.round(g * 0.85)}, ${Math.round(b * 0.85)})`
                        : group.group_color;

                      return (
                        <React.Fragment key={group.group_name}>
                          <SelectItem
                            value={`group:${group.group_name}`}
                            className="rounded-none border-y border-white/20 font-semibold transition-all hover:brightness-90"
                            style={{
                              backgroundColor: headerColor,
                              color: "white",
                            }}
                          >
                            {group.group_name} (All)
                          </SelectItem>
                          {group.options.map((option) => {
                            let optionColor: string;
                            if (isDark) {
                              optionColor = `rgb(${Math.round(r * 0.6)}, ${Math.round(g * 0.6)}, ${Math.round(b * 0.6)})`;
                            } else {
                              optionColor = `rgb(${Math.round(r + (255 - r) * 0.7)}, ${Math.round(g + (255 - g) * 0.7)}, ${Math.round(b + (255 - b) * 0.7)})`;
                            }
                            return (
                              <SelectItem
                                key={option}
                                value={option}
                                className="rounded-none border-b border-white/10 pl-6 transition-all hover:brightness-95"
                                style={{
                                  backgroundColor: optionColor,
                                  color: isDark ? "white" : "inherit",
                                }}
                              >
                                {option}
                              </SelectItem>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Firmware version
                </Label>
                <Select
                  value={firmwareFilter}
                  onValueChange={setFirmwareFilter}
                >
                  <SelectTrigger className="h-11 w-full min-w-0 bg-background shadow-xs">
                    <SelectValue placeholder="All versions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All versions</SelectItem>
                    {firmwareVersions.map((version) => (
                      <SelectItem key={version} value={version}>
                        {version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="date-from"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  From date{" "}
                  <span className="font-normal normal-case tracking-normal">
                    (UTC)
                  </span>
                </Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFromFilter}
                  onChange={(e) => onDateFromFilterChange(e.target.value)}
                  className="h-11 min-h-11 bg-background shadow-xs"
                  title="UTC calendar day — matches dashboard period filters"
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="date-to"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  To date{" "}
                  <span className="font-normal normal-case tracking-normal">
                    (UTC)
                  </span>
                </Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateToFilter}
                  onChange={(e) => onDateToFilterChange(e.target.value)}
                  className="h-11 min-h-11 bg-background shadow-xs"
                  title="UTC calendar day — matches dashboard period filters"
                />
              </div>
            </div>

            {/* Mode switches — full labels, not icon-only */}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={latestOnly}
                  onClick={() =>
                    onChartModeChange(latestOnly ? "all" : "recent")
                  }
                  className={cn(
                    "flex h-11 min-w-0 items-center gap-2.5 rounded-lg border px-3 text-left text-sm transition-colors sm:min-w-[14rem]",
                    latestOnly
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  title="Matches Latest / All tests in the page header"
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold",
                      latestOnly
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-muted",
                    )}
                    aria-hidden
                  >
                    {latestOnly ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block font-medium text-foreground">
                      One row per inverter
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Latest test only
                    </span>
                  </span>
                </button>
                <InfoTooltip content="Same as Latest / All tests in the header. On = one row per inverter (matches the summary cards)." />
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={filterLinked}
                  onClick={() => onFilterLinkedChange(!filterLinked)}
                  className={cn(
                    "flex h-11 min-w-0 items-center gap-2.5 rounded-lg border px-3 text-left text-sm transition-colors sm:min-w-[14rem]",
                    filterLinked
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  title={
                    filterLinked
                      ? "Table dates follow the dashboard period"
                      : "Table dates are independent of the dashboard"
                  }
                >
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-md",
                      filterLinked
                        ? "text-primary"
                        : "text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    {filterLinked ? (
                      <Link2 className="size-4" />
                    ) : (
                      <Unlink className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block font-medium text-foreground">
                      {filterLinked
                        ? "Dates match dashboard"
                        : "Dates set separately"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {filterLinked
                        ? "Pills update this table"
                        : "Pick your own range"}
                    </span>
                  </span>
                </button>
                <InfoTooltip content="When on, table dates stay in sync with the dashboard period (7d / 30d / …). Category filters always apply to both." />
              </div>
            </div>

            {/* Active filter chips — dismissible summary */}
            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <span className="text-xs font-medium text-muted-foreground">
                  Showing:
                </span>
                {serialActive && (
                  <button
                    type="button"
                    onClick={() => setSerialSearch("")}
                    className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <span className="truncate">
                      Serial: {serialSearch.trim()}
                    </span>
                    <X className="size-3.5 shrink-0 opacity-60" />
                  </button>
                )}
                {statusActive && (
                  <button
                    type="button"
                    onClick={() => onStatusFilterChange("all")}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
                      "activeClass" in statusMeta && statusMeta.activeClass
                        ? statusMeta.activeClass
                        : "border-border bg-muted/60 hover:bg-muted",
                    )}
                  >
                    {statusMeta.short}
                    <X className="size-3.5 shrink-0 opacity-80" />
                  </button>
                )}
                {annotationLabel && (
                  <button
                    type="button"
                    onClick={() => onAnnotationFilterChange("all")}
                    className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <span className="truncate">{annotationLabel}</span>
                    <X className="size-3.5 shrink-0 opacity-60" />
                  </button>
                )}
                {firmwareActive && (
                  <button
                    type="button"
                    onClick={() => setFirmwareFilter("all")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    FW {firmwareFilter}
                    <X className="size-3.5 shrink-0 opacity-60" />
                  </button>
                )}
                {datesActive && dateRangeLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onClearDateFilter) onClearDateFilter();
                      else {
                        onDateFromFilterChange("");
                        onDateToFilterChange("");
                      }
                    }}
                    className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    <CalendarRange className="size-3.5 shrink-0 opacity-70" />
                    <span className="truncate">{dateRangeLabel}</span>
                    <X className="size-3.5 shrink-0 opacity-60" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="**:data-[slot=table-cell]:first:w-8">
              {table.getRowModel().rows?.length ? (
                <>
                  {table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className="relative z-0 cursor-pointer hover:bg-muted/50"
                      onClick={() => handleRowClick(row.original.test_id)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </>
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-4">
          {/* O27: hide selection chrome until something is selected */}
          <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
            {table.getFilteredSelectedRowModel().rows.length > 0 ? (
              <span>
                {table.getFilteredSelectedRowModel().rows.length} of{" "}
                {table.getFilteredRowModel().rows.length} row(s) selected
              </span>
            ) : (
              <span className="tabular-nums">
                {table.getFilteredRowModel().rows.length} row
                {table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Rows per page
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => {
                  table.setPageSize(Number(value));
                }}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue
                    placeholder={table.getState().pagination.pageSize}
                  />
                </SelectTrigger>
                <SelectContent side="top">
                  {[10, 20, 30, 40, 50, 75, 100].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {table.getState().pagination.pageIndex + 1} of{" "}
              {table.getPageCount()}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to first page</span>
                <IconChevronsLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>
                <IconChevronLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>
                <IconChevronRight />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to last page</span>
                <IconChevronsRight />
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>
      <TabsContent
        value="past-performance"
        className="flex flex-col px-4 lg:px-6"
      >
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed"></div>
      </TabsContent>
      <TabsContent value="key-personnel" className="flex flex-col px-4 lg:px-6">
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed"></div>
      </TabsContent>
      <TabsContent
        value="focus-documents"
        className="flex flex-col px-4 lg:px-6"
      >
        <div className="aspect-video w-full flex-1 rounded-lg border border-dashed"></div>
      </TabsContent>
    </Tabs>
  );
}
