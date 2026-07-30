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
import { Link2, Unlink } from "lucide-react";
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
import { Toggle } from "@/components/ui/toggle";

import { loadDashboardPrefs, patchDashboardPrefs } from "@/lib/dashboard-prefs";
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
        {/* Filters — same structure as loaded filter row */}
        <div className="flex flex-col gap-4 rounded-lg border bg-muted/50 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 max-w-sm" />
              <Skeleton className="h-3 w-32" />
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-10 w-32" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-64" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-10 w-40" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-10 w-40" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-10 w-40" />
              </div>
            </div>
            <div className="flex items-end gap-2">
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-10 w-10" />
              <Skeleton className="h-10 w-24" />
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
        {/* Filters Section */}
        <div className="flex flex-col gap-4 rounded-lg border p-4 bg-muted/50">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            {/* Search Input */}
            <div className="flex-1 space-y-2">
              <Label htmlFor="serial-search">Search Serial Number</Label>
              <Input
                id="serial-search"
                placeholder="e.g. 19*265 or 1908254*"
                value={serialSearch}
                onChange={(e) => setSerialSearch(e.target.value)}
                className="max-w-sm"
              />
              <p className="text-xs text-muted-foreground">Use * as wildcard</p>
            </div>

            {/* Status Filter */}
            <div className="flex justify-between sm:gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={statusFilter}
                  onValueChange={onStatusFilterChange}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="valid">Valid Only</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="PASS">Pass</SelectItem>
                    <SelectItem value="FAIL">Fail</SelectItem>
                    <SelectItem value="INVALID">Invalid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Annotation Filter */}
              <div className="space-y-2">
                <Label>Annotation</Label>
                <Select
                  value={annotationFilter}
                  onValueChange={onAnnotationFilterChange}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="All Annotations" />
                  </SelectTrigger>
                  <SelectContent
                    className="max-h-[400px] overflow-y-auto [&>*[data-slot=select-scroll-up-button]]:hidden [&>*[data-slot=select-scroll-down-button]]:hidden"
                    position="popper"
                    sideOffset={4}
                  >
                    <SelectItem value="all">All Annotations</SelectItem>
                    {annotationGroups.map((group) => {
                      // Parse color once for both header and options
                      const hex = group.group_color.replace('#', '')
                      const r = parseInt(hex.substring(0, 2), 16)
                      const g = parseInt(hex.substring(2, 4), 16)
                      const b = parseInt(hex.substring(4, 6), 16)

                      // Determine if we're in dark mode
                      const isDark = resolvedTheme === 'dark'

                      // Calculate header color (use full saturation in light mode, slightly reduced in dark mode)
                      const headerColor = isDark
                        ? `rgb(${Math.round(r * 0.85)}, ${Math.round(g * 0.85)}, ${Math.round(b * 0.85)})`
                        : group.group_color

                      return (
                        <React.Fragment key={group.group_name}>
                          {/* Group Header - Clickable */}
                          <SelectItem
                            value={`group:${group.group_name}`}
                            className="font-semibold rounded-none border-y border-white/20 hover:brightness-90 transition-all"
                            style={{
                              backgroundColor: headerColor,
                              color: 'white'
                            }}
                          >
                            {group.group_name} (All)
                          </SelectItem>
                          {/* Individual Options */}
                          {group.options.map((option) => {
                            // Calculate lighter color for light mode, darker for dark mode
                            let optionColor: string
                            if (isDark) {
                              // Dark mode: darker color (reduce brightness by 40%)
                              const darkR = Math.round(r * 0.6)
                              const darkG = Math.round(g * 0.6)
                              const darkB = Math.round(b * 0.6)
                              optionColor = `rgb(${darkR}, ${darkG}, ${darkB})`
                            } else {
                              // Light mode: lighter color (mix 70% toward white)
                              const lightR = Math.round(r + (255 - r) * 0.7)
                              const lightG = Math.round(g + (255 - g) * 0.7)
                              const lightB = Math.round(b + (255 - b) * 0.7)
                              optionColor = `rgb(${lightR}, ${lightG}, ${lightB})`
                            }

                            return (
                              <SelectItem
                                key={option}
                                value={option}
                                className="pl-6 rounded-none border-b border-white/10 hover:brightness-95 transition-all"
                                style={{
                                  backgroundColor: optionColor,
                                  color: isDark ? 'white' : 'inherit'
                                }}
                              >
                                {option}
                              </SelectItem>
                            )
                          })}
                        </React.Fragment>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              {/* Firmware Version Filter */}
              <div className="space-y-2">
                <Label>Firmware</Label>
                <Select
                  value={firmwareFilter}
                  onValueChange={setFirmwareFilter}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Versions</SelectItem>
                    {firmwareVersions.map((version) => (
                      <SelectItem key={version} value={version}>
                        {version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* Date Range Filters — UTC calendar days (match charts / hero) */}
            <div className="flex justify-between sm:gap-4">
              <div className="space-y-2">
                <Label htmlFor="date-from" className="text-xs sm:text-sm">
                  From{" "}
                  <span className="font-normal text-muted-foreground">(UTC)</span>
                </Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFromFilter}
                  onChange={(e) => onDateFromFilterChange(e.target.value)}
                  className="h-10 min-h-10 w-36 sm:w-40 sm:px-3 px-1"
                  title="UTC calendar day — matches dashboard period filters"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date-to" className="text-xs sm:text-sm">
                  To{" "}
                  <span className="font-normal text-muted-foreground">(UTC)</span>
                </Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateToFilter}
                  onChange={(e) => onDateToFilterChange(e.target.value)}
                  className="h-10 min-h-10 w-36 sm:w-40 sm:px-3 px-1"
                  title="UTC calendar day — matches dashboard period filters"
                />
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <InfoTooltip content="Linked to Result mode in the header (Latest / All tests). Latest = one row per inverter (same population as the summary cards)." />
                <Toggle
                  pressed={latestOnly}
                  onPressedChange={(pressed) =>
                    onChartModeChange(pressed ? "recent" : "all")
                  }
                  variant="outline"
                  className="h-10 px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                  aria-label={
                    latestOnly
                      ? "Latest only (matches header Latest)"
                      : "All test runs (matches header All tests)"
                  }
                  title={
                    latestOnly
                      ? "On — same as header Latest"
                      : "Off — same as header All tests"
                  }
                >
                  Latest Only
                </Toggle>
              </div>
              <div className="flex flex-col items-center gap-1">
                <InfoTooltip content="When linked, table dates stay in sync with the dashboard period (pills / custom range). Annotation filters always apply to both the dashboard and table." />
                <Button
                  size="sm"
                  variant={filterLinked ? "default" : "outline"}
                  onClick={() => onFilterLinkedChange(!filterLinked)}
                  title={
                    filterLinked
                      ? "Table dates linked to dashboard period"
                      : "Table dates independent of dashboard"
                  }
                  className="h-10"
                >
                  {filterLinked ? <Link2 className="h-4 w-4" /> : <Unlink className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="h-4" /> {/* Spacer to match tooltip height */}
                <Button
                  variant="outline"
                  onClick={() => {
                    setSerialSearch("");
                    onStatusFilterChange("all");
                    setFirmwareFilter("all");
                    onAnnotationFilterChange("all");
                    // Align with header All tests (same switch as Latest only)
                    onChartModeChange("all");
                    // Prefer parent clear (handles linked period revert + both dates atomically)
                    if (onClearDateFilter) {
                      onClearDateFilter();
                    } else {
                      onDateFromFilterChange("");
                      onDateToFilterChange("");
                    }
                  }}
                  className="h-10"
                >
                  Clear Filters
                </Button>
              </div>
            </div>
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
