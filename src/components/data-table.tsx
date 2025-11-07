"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTimezone } from "@/contexts/TimezoneContext";

import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircleCheckFilled,
} from "@tabler/icons-react";
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

const FILTER_COOKIE_KEY = "burnin-data-table-filters";

type FilterState = {
  serialSearch: string;
  statusFilter: string;
  firmwareFilter: string;
  annotationFilter: string;
  dateFromFilter: string;
  dateToFilter: string;
  latestOnly: boolean;
};

const saveFiltersToCookie = (filters: FilterState) => {
  try {
    document.cookie = `${FILTER_COOKIE_KEY}=${encodeURIComponent(JSON.stringify(filters))}; path=/; max-age=${60 * 60 * 24 * 30}`; // 30 days
  } catch (error) {
    console.warn("Failed to save filters to cookie:", error);
  }
};

const loadFiltersFromCookie = (): Partial<FilterState> => {
  try {
    if (typeof document === "undefined") return {};

    const cookies = document.cookie.split(";");
    const filterCookie = cookies.find((cookie) =>
      cookie.trim().startsWith(`${FILTER_COOKIE_KEY}=`),
    );

    if (!filterCookie) return {};

    const cookieValue = filterCookie.split("=")[1];
    const decodedValue = decodeURIComponent(cookieValue);
    return JSON.parse(decodedValue);
  } catch (error) {
    console.warn("Failed to load filters from cookie:", error);
    return {};
  }
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
      return (row.getValue(id) as string)
        .toLowerCase()
        .includes(value.toLowerCase());
    },
  },
  {
    accessorKey: "firmware_version",
    header: "Firmware Version",
    cell: ({ row }) => (
      <div className="w-28">{row.original.firmware_version}</div>
    ),
    filterFn: (row, id, value) => {
      return row.getValue(id) === value;
    },
  },
  {
    accessorKey: "start_time",
    header: "Test Date",
    cell: ({ row }) => {
      return (
        <div className="w-36 text-sm">
          {formatInTimezone(row.original.start_time)}
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const rowDate = new Date(row.getValue(id) as string);
      const { from, to } = value as { from: string; to: string };

      // Helper function to create dates in the selected timezone
      const createDateInTimezone = (dateString: string, endOfDay: boolean = false) => {
        const time = endOfDay ? "T23:59:59.999" : "T00:00:00";
        if (selectedTimezone === 'utc') {
          return new Date(dateString + time + "Z");
        } else if (selectedTimezone === 'delhi') {
          // For Delhi time, we need to adjust for IST offset
          const localDate = new Date(dateString + time);
          return new Date(localDate.getTime() - (5.5 * 60 * 60 * 1000)); // Subtract IST offset
        } else {
          // For local timezone
          return new Date(dateString + time);
        }
      };

      if (from && to) {
        const fromDate = createDateInTimezone(from, false);
        const toDate = createDateInTimezone(to, true);
        return rowDate >= fromDate && rowDate <= toDate;
      } else if (from) {
        const fromDate = createDateInTimezone(from, false);
        return rowDate >= fromDate;
      } else if (to) {
        const toDate = createDateInTimezone(to, true);
        return rowDate <= toDate;
      }
      return true;
    },
  },
  {
    accessorKey: "duration",
    header: "Test Duration",
    cell: ({ row }) => {
      const durationMs = row.original.duration;
      const hours = Math.floor(durationMs / (1000 * 60 * 60));
      const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);
      return (
        <div className="w-24 text-right tabular-nums">
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
        <Badge variant={variant} className="px-2">
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
    cell: ({ row }) => {
      const annotations = row.original.annotations;
      if (!annotations) {
        return <div className="text-muted-foreground text-sm">-</div>;
      }
      return (
        <div className="text-sm max-w-xs truncate" title={annotations}>
          {annotations}
        </div>
      );
    },
  },
];

interface DataTableProps {
  selectedDate?: string;
  onClearDateFilter?: () => void;
}

export function DataTable({
  selectedDate,
  onClearDateFilter,
}: DataTableProps = {}) {
  const router = useRouter();
  const { formatInTimezone, selectedTimezone } = useTimezone();
  const [data, setData] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 30,
  });
  // Initialize filter states from cookies
  const [serialSearch, setSerialSearch] = React.useState(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.serialSearch || "";
  });
  const [statusFilter, setStatusFilter] = React.useState(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.statusFilter || "valid";
  });
  const [firmwareFilter, setFirmwareFilter] = React.useState(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.firmwareFilter || "all";
  });
  const [annotationFilter, setAnnotationFilter] = React.useState(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.annotationFilter || "all";
  });
  const [dateFromFilter, setDateFromFilter] = React.useState(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.dateFromFilter || "";
  });
  const [dateToFilter, setDateToFilter] = React.useState(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.dateToFilter || "";
  });
  const [latestOnly, setLatestOnly] = React.useState(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.latestOnly || false;
  });
  const [firmwareVersions, setFirmwareVersions] = React.useState<string[]>([]);
  const [annotations, setAnnotations] = React.useState<string[]>([]);
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

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ view: "tests" });
        if (latestOnly) {
          params.append("latestOnly", "true");
        }
        if (annotationFilter && annotationFilter !== "all") {
          params.append("annotation", annotationFilter);
        }

        const [testsResponse, firmwareResponse, annotationsResponse, groupsResponse, quickOptionsResponse] = await Promise.all([
          fetch(`/api/test-stats?${params}`),
          fetch("/api/test-stats?view=firmware-versions"),
          fetch("/api/test-stats?view=annotations"),
          fetch("/api/annotation-groups"),
          fetch("/api/annotation-quick-options"),
        ]);

        if (testsResponse.ok) {
          const testData = await testsResponse.json();
          setData(testData);
        }

        if (firmwareResponse.ok) {
          const versions = await firmwareResponse.json();
          setFirmwareVersions(versions);
        }

        if (annotationsResponse.ok) {
          const annotationsList = await annotationsResponse.json();
          setAnnotations(annotationsList);
        }

        if (groupsResponse.ok && quickOptionsResponse.ok) {
          const groups = await groupsResponse.json();
          const options = await quickOptionsResponse.json();

          // Group options by group_name
          const grouped = groups.map((group: any) => ({
            group_name: group.group_name,
            group_color: group.group_color,
            options: options
              .filter((opt: any) => opt.group_name === group.group_name)
              .map((opt: any) => opt.option_text)
          }));

          // Add ungrouped options
          const ungroupedOptions = options
            .filter((opt: any) => !opt.group_name)
            .map((opt: any) => opt.option_text);

          if (ungroupedOptions.length > 0) {
            grouped.push({
              group_name: 'Ungrouped',
              group_color: '#6b7280',
              options: ungroupedOptions
            });
          }

          setAnnotationGroups(grouped);
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [latestOnly, annotationFilter]);

  // Apply selectedDate from chart click to date filters
  React.useEffect(() => {
    if (selectedDate) {
      setDateFromFilter(selectedDate);
      setDateToFilter(selectedDate);
    }
  }, [selectedDate]);

  // Save filters to cookies when they change
  React.useEffect(() => {
    const filterState: FilterState = {
      serialSearch,
      statusFilter,
      firmwareFilter,
      annotationFilter,
      dateFromFilter,
      dateToFilter,
      latestOnly,
    };
    saveFiltersToCookie(filterState);
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
    getRowId: (row) => row.test_id.toString(),
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading test data...</div>
      </div>
    );
  }

  return (
    <Tabs
      defaultValue="outline"
      className="w-full flex-col justify-start gap-6"
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
                placeholder="Enter inverter serial number..."
                value={serialSearch}
                onChange={(e) => setSerialSearch(e.target.value)}
                className="max-w-sm"
              />
            </div>

            {/* Status Filter */}
            <div className="flex justify-between sm:gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
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
                  onValueChange={setAnnotationFilter}
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
                    {annotationGroups.map((group) => (
                      <React.Fragment key={group.group_name}>
                        {/* Group Header - Clickable */}
                        <SelectItem
                          value={`group:${group.group_name}`}
                          className="font-semibold rounded-none border-y border-white/20 hover:brightness-90 transition-all"
                          style={{
                            backgroundColor: group.group_color,
                            color: 'white'
                          }}
                        >
                          {group.group_name} (All)
                        </SelectItem>
                        {/* Individual Options */}
                        {group.options.map((option, idx) => {
                          // Calculate lighter color
                          const hex = group.group_color.replace('#', '')
                          const r = parseInt(hex.substring(0, 2), 16)
                          const g = parseInt(hex.substring(2, 4), 16)
                          const b = parseInt(hex.substring(4, 6), 16)
                          const newR = Math.round(r + (255 - r) * 0.7)
                          const newG = Math.round(g + (255 - g) * 0.7)
                          const newB = Math.round(b + (255 - b) * 0.7)
                          const lightColor = `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`

                          return (
                            <SelectItem
                              key={option}
                              value={option}
                              className="pl-6 rounded-none border-b border-white/10 hover:brightness-95 transition-all"
                              style={{
                                backgroundColor: lightColor
                              }}
                            >
                              {option}
                            </SelectItem>
                          )
                        })}
                      </React.Fragment>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Latest Only Filter */}
              <div className="space-y-2">
                <Label>Filter Mode</Label>
                <Toggle
                  pressed={latestOnly}
                  onPressedChange={setLatestOnly}
                  variant="outline"
                  className="h-10 px-3"
                >
                  Latest Only
                </Toggle>
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
            {/* Date Range Filters */}
            <div className="flex justify-between sm:gap-4">
              <div className="space-y-2">
                <Label htmlFor="date-from">From Date</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFromFilter}
                  onChange={(e) => setDateFromFilter(e.target.value)}
                  className="w-40 sm:px-3 px-1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date-to">To Date</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateToFilter}
                  onChange={(e) => setDateToFilter(e.target.value)}
                  className="w-40 sm:px-3 px-1"
                />
              </div>
            </div>
            {/* Clear Filters Button */}
            <Button
              variant="outline"
              onClick={() => {
                setSerialSearch("");
                setStatusFilter("all");
                setFirmwareFilter("all");
                setDateFromFilter("");
                setDateToFilter("");
                setLatestOnly(false);
                onClearDateFilter?.();
              }}
              className="h-10"
            >
              Clear Filters
            </Button>
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
          <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {table.getFilteredRowModel().rows.length} row(s) selected.
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
