"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconCircleCheckFilled,
} from "@tabler/icons-react"
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
} from "@tanstack/react-table"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
} from "@/components/ui/tabs"

export const testSchema = z.object({
  test_id: z.number(),
  inv_id: z.number(),
  serial_number: z.string(),
  firmware_version: z.string(),
  duration: z.number(),
  non_zero_status_flags: z.number(),
  passed: z.boolean(),
  failure_reason: z.string().nullable(),
  start_time: z.string(),
})

const columns: ColumnDef<z.infer<typeof testSchema>>[] = [
  {
    accessorKey: "serial_number",
    header: "Inverter Serial Number",
    cell: ({ row }) => (
      <div className="font-medium">
        {row.original.serial_number}
      </div>
    ),
    enableHiding: false,
    filterFn: (row, id, value) => {
      return (row.getValue(id) as string).toLowerCase().includes(value.toLowerCase())
    },
  },
  {
    accessorKey: "firmware_version",
    header: "Firmware Version",
    cell: ({ row }) => (
      <div className="w-28">
        {row.original.firmware_version}
      </div>
    ),
    filterFn: (row, id, value) => {
      return row.getValue(id) === value
    },
  },
  {
    accessorKey: "start_time",
    header: "Test Date",
    cell: ({ row }) => {
      const date = new Date(row.original.start_time);
      return (
        <div className="w-32 text-sm">
          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      );
    },
    filterFn: (row, id, value) => {
      const rowDate = new Date(row.getValue(id) as string)
      const { from, to } = value as { from: string, to: string }
      if (from && to) {
        // Create dates using UTC to match the ISO string format from the database
        const fromDate = new Date(from + 'T00:00:00.000Z')
        const toDate = new Date(to + 'T23:59:59.999Z')
        return rowDate >= fromDate && rowDate <= toDate
      } else if (from) {
        const fromDate = new Date(from + 'T00:00:00.000Z')
        return rowDate >= fromDate
      } else if (to) {
        const toDate = new Date(to + 'T23:59:59.999Z')
        return rowDate <= toDate
      }
      return true
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
          {hours > 0 ? `${hours}h ` : ""}{minutes > 0 ? `${minutes}m ` : ""}{seconds}s
        </div>
      );
    },
  },
  {
    accessorKey: "passed",
    header: "Result",
    cell: ({ row }) => (
      <Badge variant={row.original.passed ? "default" : "destructive"} className="px-2">
        {row.original.passed ? (
          <>
            <IconCircleCheckFilled className="w-3 h-3 mr-1 fill-green-500 dark:fill-green-400" />
            PASS
          </>
        ) : (
          "FAIL"
        )}
      </Badge>
    ),
    filterFn: (row, id, value) => {
      return row.getValue(id) === value
    },
  },
]

interface DataTableProps {
  selectedDate?: string;
  onClearDateFilter?: () => void;
}

export function DataTable({ selectedDate, onClearDateFilter }: DataTableProps = {}) {
  const router = useRouter()
  const [data, setData] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 30,
  })
  // Filter states
  const [serialSearch, setSerialSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState("all")
  const [firmwareFilter, setFirmwareFilter] = React.useState("all")
  const [dateFromFilter, setDateFromFilter] = React.useState("")
  const [dateToFilter, setDateToFilter] = React.useState("")
  const [firmwareVersions, setFirmwareVersions] = React.useState<string[]>([])

  const handleRowClick = (testId: number) => {
    router.push(`/test/${testId}`)
  }

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const [testsResponse, firmwareResponse] = await Promise.all([
          fetch('/api/test-stats?view=tests'),
          fetch('/api/test-stats?view=firmware-versions')
        ])

        if (testsResponse.ok) {
          const testData = await testsResponse.json()
          setData(testData)
        }

        if (firmwareResponse.ok) {
          const versions = await firmwareResponse.json()
          setFirmwareVersions(versions)
        }
      } catch (error) {
        console.error('Failed to fetch data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  // Apply selectedDate from chart click to date filters
  React.useEffect(() => {
    if (selectedDate) {
      setDateFromFilter(selectedDate)
      setDateToFilter(selectedDate)
    }
  }, [selectedDate])

  // Apply filters to table
  React.useEffect(() => {
    const filters: ColumnFiltersState = []

    // Serial number search
    if (serialSearch) {
      filters.push({
        id: "serial_number",
        value: serialSearch,
      })
    }

    // Status filter
    if (statusFilter !== "all") {
      filters.push({
        id: "passed",
        value: statusFilter === "passed",
      })
    }

    // Firmware version filter
    if (firmwareFilter !== "all") {
      filters.push({
        id: "firmware_version",
        value: firmwareFilter,
      })
    }

    // Date range filter
    if (dateFromFilter || dateToFilter) {
      filters.push({
        id: "start_time",
        value: { from: dateFromFilter, to: dateToFilter },
      })
    }

    setColumnFilters(filters)
  }, [serialSearch, statusFilter, firmwareFilter, dateFromFilter, dateToFilter])

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
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading test data...</div>
      </div>
    )
  }

  return (
    <Tabs
      defaultValue="outline"
      className="w-full flex-col justify-start gap-6"
    >
      <TabsContent
        value="outline"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
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
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="passed">Pass</SelectItem>
                  <SelectItem value="failed">Fail</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Firmware Version Filter */}
            <div className="space-y-2">
              <Label>Firmware</Label>
              <Select value={firmwareFilter} onValueChange={setFirmwareFilter}>
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
            {/* Date Range Filters */}
            <div className="flex gap-2">
              <div className="space-y-2">
                <Label htmlFor="date-from">From Date</Label>
                <Input
                  id="date-from"
                  type="date"
                  value={dateFromFilter}
                  onChange={(e) => setDateFromFilter(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="date-to">To Date</Label>
                <Input
                  id="date-to"
                  type="date"
                  value={dateToFilter}
                  onChange={(e) => setDateToFilter(e.target.value)}
                  className="w-40"
                />
              </div>
            </div>
            {/* Clear Filters Button */}
            <Button
              variant="outline"
              onClick={() => {
                setSerialSearch("")
                setStatusFilter("all")
                setFirmwareFilter("all")
                setDateFromFilter("")
                setDateToFilter("")
                onClearDateFilter?.()
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
                            header.getContext()
                          )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="**:data-[slot=table-cell]:first:w-8">
              {table.getRowModel().rows?.length ? (
                <>
                  {
                    table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                        className="relative z-0 cursor-pointer hover:bg-muted/50"
                        onClick={() => handleRowClick(row.original.test_id)}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  }
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
                  table.setPageSize(Number(value))
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
  )
}
