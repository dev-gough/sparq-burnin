"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useState, useMemo, useCallback } from "react"
import { usePrefetchedTests } from "@/hooks/usePrefetchedTests"
import { useTimezone } from "@/contexts/TimezoneContext"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, Download, Maximize2, X, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import type { TooltipProps as RechartsTooltipProps } from "recharts"
import TestAnnotations from "@/components/TestAnnotations"

interface FailureInfo {
  test_id: number
  start_time: string
  failure_description?: string
}

interface TestData {
  test_id: number
  inv_id: number
  serial_number: string
  firmware_version: string
  start_time: string
  end_time: string
  overall_status: string
  failure_description?: string
  data_points: DataPoint[]
  navigation: {
    previous_failed_test?: FailureInfo
    next_failed_test?: FailureInfo
    current_failure_index?: number
    total_failed_tests: number
  }
}

interface FullScreenState {
  selectedColumns: string[]
  zoomStart: number
  zoomEnd: number
  zoomLevel: number
  decimationEnabled: boolean
  sourceChartTitle: string
}

interface DataPoint {
  timestamp: string
  vgrid?: number
  pgrid?: number
  qgrid?: number
  vpv1?: number
  ppv1?: number
  vpv2?: number
  ppv2?: number
  vpv3?: number
  ppv3?: number
  vpv4?: number
  ppv4?: number
  frequency?: number
  vbus?: number
  extstatus?: number
  status?: number
  temperature?: number
  epv1?: number
  epv2?: number
  epv3?: number
  epv4?: number
  activeenergy?: number
  reactiveenergy?: number
  extstatus_latch?: string
  status_latch?: string
  vgrid_inst_latch?: number
  vntrl_inst_latch?: number
  igrid_inst_latch?: number
  vbus_inst_latch?: number
  vpv1_inst_latch?: number
  ipv1_inst_latch?: number
  vpv2_inst_latch?: number
  ipv2_inst_latch?: number
  vpv3_inst_latch?: number
  ipv3_inst_latch?: number
  vpv4_inst_latch?: number
  ipv4_inst_latch?: number
  status_bits?: string
}

const pvColumns = ["vpv1", "ppv1", "vpv2", "ppv2", "vpv3", "ppv3", "vpv4", "ppv4", "frequency", "temperature"]
const gridColumns = ["vgrid", "pgrid", "qgrid", "vbus", "temperature"]
const latchColumns = [
  "vgrid_inst_latch", "vntrl_inst_latch", "igrid_inst_latch", "vbus_inst_latch",
  "vpv1_inst_latch", "ipv1_inst_latch", "vpv2_inst_latch", "ipv2_inst_latch",
  "vpv3_inst_latch", "ipv3_inst_latch", "vpv4_inst_latch", "ipv4_inst_latch",
  "temperature"
]

// All available columns for full-screen chart
const allColumns = [
  ...pvColumns,
  ...gridColumns,
  ...latchColumns,
  "epv1", "epv2", "epv3", "epv4",
  "activeenergy", "reactiveenergy",
  "extstatus", "status", "extstatus_latch", "status_latch"
].filter((col, index, arr) => arr.indexOf(col) === index) // Remove duplicates

// Column groups for enhanced organization
const columnGroups = {
  "Power Generation": {
    columns: ["vpv1", "vpv2", "vpv3", "vpv4", "ppv1", "ppv2", "ppv3", "ppv4"],
    description: "PV voltages and power outputs",
    color: "bg-green-50 border-green-200"
  },
  "Energy & Efficiency": {
    columns: ["epv1", "epv2", "epv3", "epv4", "activeenergy", "reactiveenergy"],
    description: "Energy measurements and efficiency metrics",
    color: "bg-blue-50 border-blue-200"
  },
  "Grid Connection": {
    columns: ["vgrid", "pgrid", "qgrid", "vbus", "frequency"],
    description: "Grid interface measurements",
    color: "bg-yellow-50 border-yellow-200"
  },
  "Current Latch": {
    columns: ["ipv1_inst_latch", "ipv2_inst_latch", "ipv3_inst_latch", "ipv4_inst_latch", "igrid_inst_latch", "vntrl_inst_latch"],
    description: "Instantaneous current latch readings",
    color: "bg-purple-50 border-purple-200"
  },
  "Voltage Latch": {
    columns: ["vgrid_inst_latch", "vbus_inst_latch", "vpv1_inst_latch", "vpv2_inst_latch", "vpv3_inst_latch", "vpv4_inst_latch"],
    description: "Instantaneous voltage latch readings",
    color: "bg-indigo-50 border-indigo-200"
  },
  "System Status": {
    columns: ["temperature", "extstatus", "status", "extstatus_latch", "status_latch"],
    description: "System health and diagnostics",
    color: "bg-red-50 border-red-200"
  }
}

const colors = [
  "#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#8dd1e1",
  "#d084d0", "#82d982", "#ffb347", "#87ceeb", "#dda0dd"
]

// Component for navigating between failed tests
function FailedTestNavigation({
  testData,
  onNavigate
}: {
  testData: TestData
  onNavigate: (testId: number) => void
}) {
  const { navigation } = testData
  const { formatDateInTimezone, formatInTimezone } = useTimezone()

  // Only show if there are other failed tests for this serial number
  if (navigation.total_failed_tests <= 1) {
    return null
  }

  const formatDate = (dateString: string) => {
    return formatDateInTimezone(dateString)
  }

  const formatTime = (dateString: string) => {
    return formatInTimezone(dateString)
  }

  return (
    <Card className="border-orange-200 bg-orange-50 w-full">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            <CardTitle className="text-orange-800 text-base">Failed Test History</CardTitle>
          </div>
          {navigation.current_failure_index && (
            <span className="text-sm text-orange-600 font-medium">
              {navigation.current_failure_index} of {navigation.total_failed_tests} failures
            </span>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigation.previous_failed_test && onNavigate(navigation.previous_failed_test.test_id)}
              disabled={!navigation.previous_failed_test}
              title={navigation.previous_failed_test ?
                `Previous failure: ${formatTime(navigation.previous_failed_test.start_time)}` :
                'No previous failures'
              }
              className="flex-1"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => navigation.next_failed_test && onNavigate(navigation.next_failed_test.test_id)}
              disabled={!navigation.next_failed_test}
              title={navigation.next_failed_test ?
                `Next failure: ${formatTime(navigation.next_failed_test.start_time)}` :
                'No next failures'
              }
              className="flex-1"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {(navigation.previous_failed_test || navigation.next_failed_test) && (
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>
              {navigation.previous_failed_test && (
                <>
                  <div>← {formatDate(navigation.previous_failed_test.start_time)}</div>
                  {navigation.previous_failed_test.failure_description && (
                    <div className="truncate">
                      {navigation.previous_failed_test.failure_description.substring(0, 30)}...
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              {navigation.next_failed_test && (
                <>
                  <div>→ {formatDate(navigation.next_failed_test.start_time)}</div>
                  {navigation.next_failed_test.failure_description && (
                    <div className="truncate">
                      {navigation.next_failed_test.failure_description.substring(0, 30)}...
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Custom tooltip component that shows status_bits for all charts
function StatusBitsTooltip({ active, payload, label }: RechartsTooltipProps<string | number, string>) {
  if (active && payload && payload.length) {
    const dataPoint = payload[0]?.payload?.originalDataPoint as DataPoint

    return (
      <div className="bg-background/80 border border-border rounded-lg shadow-lg p-3 max-w-xs">
        <p className="font-medium mb-2">{`Time: ${label}`}</p>
        {payload.map((entry, index: number) => (
          <p key={index} style={{ color: entry.color }} className="text-base">
            {`${entry.name?.replace('_inst_latch', '') || entry.dataKey}: ${typeof entry.value === 'number' ? Number(entry.value).toFixed(3) : entry.value}`}
          </p>
        ))}
        {dataPoint?.status_bits && (
          <div className="mt-2 pt-2 border-t border-border">
            <p className="text-sm font-medium text-muted-foreground">Status Bits:</p>
            <p className="text-sm font-mono">{dataPoint.status_bits}</p>
          </div>
        )}
      </div>
    )
  }
  return null
}

const DECIMATION_COOKIE_KEY = "burnin-chart-decimation-enabled"

const saveDecimationToCookie = (enabled: boolean) => {
  try {
    document.cookie = `${DECIMATION_COOKIE_KEY}=${enabled}; path=/; max-age=${60 * 60 * 24 * 30}` // 30 days
  } catch (error) {
    console.warn("Failed to save decimation setting to cookie:", error)
  }
}

const loadDecimationFromCookie = (): boolean => {
  try {
    if (typeof document === "undefined") return true // Default to enabled

    const cookies = document.cookie.split(";")
    const decimationCookie = cookies.find((cookie) =>
      cookie.trim().startsWith(`${DECIMATION_COOKIE_KEY}=`)
    )

    if (decimationCookie) {
      const value = decimationCookie.split("=")[1]
      return value === "true"
    }
  } catch (error) {
    console.warn("Failed to load decimation setting from cookie:", error)
  }
  return true // Default to enabled
}

// Data decimation function to reduce points while preserving visual fidelity
function decimateData(data: DataPoint[], maxPoints: number = 1000): DataPoint[] {
  if (data.length <= maxPoints) return data

  const step = Math.ceil(data.length / maxPoints)
  const decimated: DataPoint[] = []

  for (let i = 0; i < data.length; i += step) {
    // Always include the first and last points
    if (i === 0 || i >= data.length - step) {
      decimated.push(data[i])
    } else {
      // For intermediate points, use a simple averaging approach
      const slice = data.slice(i, Math.min(i + step, data.length))
      const avgPoint = slice.reduce((acc, point, idx) => {
        if (idx === 0) return { ...point }

        // Average numeric values
        Object.keys(point).forEach(key => {
          const typedKey = key as keyof DataPoint
          if (typeof point[typedKey] === 'number' && typeof acc[typedKey] === 'number') {
            ; (acc[typedKey] as number) = ((acc[typedKey] as number) * idx + (point[typedKey] as number)) / (idx + 1)
          }
        })
        return acc
      }, { ...slice[0] })

      decimated.push(avgPoint)
    }
  }

  return decimated
}

function FullScreenChart({
  data,
  initialState,
  onClose
}: {
  data: DataPoint[]
  initialState: FullScreenState
  onClose: () => void
}) {
  const { formatTimeInTimezone } = useTimezone()

  // Initialize state from inherited values
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(initialState.selectedColumns)
  )
  const [zoomStart, setZoomStart] = useState(initialState.zoomStart)
  const [zoomEnd, setZoomEnd] = useState(initialState.zoomEnd)
  const [zoomLevel, setZoomLevel] = useState(initialState.zoomLevel)
  const [decimationEnabled, setDecimationEnabled] = useState(initialState.decimationEnabled)

  // Reuse the same logic from ConfigurableChart
  const toggleColumn = useCallback((column: string) => {
    const newSelected = new Set(selectedColumns)
    if (newSelected.has(column)) {
      newSelected.delete(column)
    } else {
      newSelected.add(column)
    }
    setSelectedColumns(newSelected)
  }, [selectedColumns])

  const toggleDecimation = useCallback(() => {
    const newEnabled = !decimationEnabled
    setDecimationEnabled(newEnabled)
    saveDecimationToCookie(newEnabled)
  }, [decimationEnabled])

  // Group control functions
  const selectAllInGroup = useCallback((groupColumns: string[]) => {
    const newSelected = new Set(selectedColumns)
    groupColumns.forEach(col => {
      if (allColumns.includes(col)) {
        newSelected.add(col)
      }
    })
    setSelectedColumns(newSelected)
  }, [selectedColumns])

  const deselectAllInGroup = useCallback((groupColumns: string[]) => {
    const newSelected = new Set(selectedColumns)
    groupColumns.forEach(col => newSelected.delete(col))
    setSelectedColumns(newSelected)
  }, [selectedColumns])

  const isGroupFullySelected = useCallback((groupColumns: string[]) => {
    return groupColumns.every(col => selectedColumns.has(col))
  }, [selectedColumns])

  const getGroupSelectedCount = useCallback((groupColumns: string[]) => {
    return groupColumns.filter(col => selectedColumns.has(col)).length
  }, [selectedColumns])

  // Quick preset functions
  const applyPreset = useCallback((presetColumns: string[]) => {
    const newSelected = new Set<string>()
    presetColumns.forEach(col => {
      if (allColumns.includes(col)) {
        newSelected.add(col)
      }
    })
    setSelectedColumns(newSelected)
  }, [])

  const clearAllSelections = useCallback(() => {
    setSelectedColumns(new Set())
  }, [])

  // Calculate zoom range and apply adaptive decimation
  const { zoomedData, zoomedSliceLength } = useMemo(() => {
    const totalPoints = data.length
    const startIndex = Math.floor((zoomStart / 100) * totalPoints)
    const endIndex = Math.ceil((zoomEnd / 100) * totalPoints)

    const zoomedSlice = data.slice(startIndex, endIndex)
    const zoomedData = decimationEnabled ? decimateData(zoomedSlice, 1000) : zoomedSlice

    return { zoomedData, zoomedSliceLength: zoomedSlice.length }
  }, [data, zoomStart, zoomEnd, decimationEnabled])

  // Memoize chart data transformation
  const chartData = useMemo(() => {
    return zoomedData.map((point, index) => ({
      timestamp: formatTimeInTimezone(point.timestamp),
      originalIndex: Math.floor((zoomStart / 100) * data.length) + index,
      originalDataPoint: point, // Preserve full original data point for tooltip access
      ...Object.fromEntries(
        Array.from(selectedColumns).map(col => [col, point[col as keyof DataPoint]])
      )
    }))
  }, [zoomedData, selectedColumns, zoomStart, data.length, formatTimeInTimezone])

  // Zoom functions (same as ConfigurableChart)
  const zoomIn = useCallback(() => {
    const currentRange = zoomEnd - zoomStart
    const newRange = Math.max(currentRange * 0.5, 5)
    const newEnd = Math.min(100, zoomStart + newRange)
    setZoomEnd(newEnd)
    setZoomLevel(zoomLevel * 2)
  }, [zoomStart, zoomEnd, zoomLevel])

  const zoomOut = useCallback(() => {
    const currentRange = zoomEnd - zoomStart
    const newRange = Math.min(currentRange * 2, 100)
    const newEnd = Math.min(100, zoomStart + newRange)
    setZoomEnd(newEnd)
    setZoomLevel(Math.max(zoomLevel * 0.5, 1))
  }, [zoomStart, zoomEnd, zoomLevel])

  const resetZoom = useCallback(() => {
    setZoomStart(0)
    setZoomEnd(100)
    setZoomLevel(1)
  }, [])

  const panLeft = useCallback(() => {
    const currentRange = zoomEnd - zoomStart
    const panAmount = currentRange * 0.1
    if (zoomStart - panAmount >= 0) {
      setZoomStart(zoomStart - panAmount)
      setZoomEnd(zoomEnd - panAmount)
    }
  }, [zoomStart, zoomEnd])

  const panRight = useCallback(() => {
    const currentRange = zoomEnd - zoomStart
    const panAmount = currentRange * 0.1
    if (zoomEnd + panAmount <= 100) {
      setZoomStart(zoomStart + panAmount)
      setZoomEnd(zoomEnd + panAmount)
    }
  }, [zoomStart, zoomEnd])

  const getDisplayName = (column: string) => {
    return column.replace('_inst_latch', '')
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl w-[95vw] h-[95vh] p-4 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold">Full Screen - {initialState.sourceChartTitle}</h2>
            <span className="text-sm text-muted-foreground">
              Showing {chartData.length} of {data.length} data points
              {decimationEnabled && zoomedData.length < zoomedSliceLength && " (decimated for performance)"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={panLeft} disabled={zoomStart <= 0}>
              ←
            </Button>
            <Button size="sm" variant="outline" onClick={zoomOut} disabled={zoomLevel <= 1}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              {zoomLevel.toFixed(1)}x
            </span>
            <Button size="sm" variant="outline" onClick={zoomIn}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={panRight} disabled={zoomEnd >= 100}>
              →
            </Button>
            <Button size="sm" variant="outline" onClick={resetZoom} disabled={zoomLevel <= 1}>
              <RotateCcw className="h-4 w-4" />
            </Button>
            {zoomedSliceLength > 1000 && (
              <Button
                size="sm"
                variant={decimationEnabled ? "default" : "outline"}
                onClick={toggleDecimation}
                title={decimationEnabled ? "Disable decimation (show all data points)" : "Enable decimation (improve performance)"}
              >
                {decimationEnabled ? "Decimated" : "Full Data"}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Chart */}
        <div className="flex-1 min-h-0 max-h-[calc(100vh-400px)]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                interval={Math.max(0, Math.ceil(chartData.length / 12))}
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis />
              <Tooltip content={StatusBitsTooltip} animationDuration={0} />
              <Legend />
              {Array.from(selectedColumns).map((column, index) => (
                <Line
                  key={column}
                  type="monotone"
                  dataKey={column}
                  name={getDisplayName(column)}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Enhanced Column Selection with Compact Grouping */}
        <div className="mt-4 max-h-80 overflow-y-auto">
          {/* Quick Presets */}
          <div className="mb-3 p-2 bg-gray-50 rounded border">
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyPreset(["ppv1", "ppv2", "ppv3", "ppv4"])}
                className="h-6 px-2 text-xs"
              >
                All PPV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyPreset(["vpv1", "vpv2", "vpv3", "vpv4"])}
                className="h-6 px-2 text-xs"
              >
                All VPV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyPreset(["temperature", "vgrid", "pgrid", "frequency"])}
                className="h-6 px-2 text-xs"
              >
                Grid + Temp
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => applyPreset(["temperature", "extstatus", "status"])}
                className="h-6 px-2 text-xs"
              >
                Diagnostics
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={clearAllSelections}
                className="h-6 px-2 text-xs"
              >
                Clear All
              </Button>
            </div>
          </div>

          {/* Ultra-Compact Single-Row Layout */}
          <div className="grid grid-cols-6 gap-1">
            {Object.entries(columnGroups).map(([groupName, group]) => {
              const selectedCount = getGroupSelectedCount(group.columns)
              const totalCount = group.columns.length
              const isFullySelected = isGroupFullySelected(group.columns)

              return (
                <div key={groupName} className={`border rounded p-2 ${group.color}`}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-sm truncate">{groupName}</h3>
                    <span className="text-sm text-muted-foreground ml-1">
                      {selectedCount}/{totalCount}
                    </span>
                  </div>
                  <div className="flex gap-1 mb-2">
                    <Button
                      size="sm"
                      variant={isFullySelected ? "default" : "outline"}
                      onClick={() => selectAllInGroup(group.columns)}
                      className="h-6 px-2 text-xs flex-1"
                    >
                      All
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deselectAllInGroup(group.columns)}
                      className="h-6 px-2 text-xs flex-1"
                    >
                      None
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                    {group.columns.map(column => (
                      <div key={column} className="flex items-center space-x-2">
                        <Checkbox
                          id={`fs-${column}`}
                          checked={selectedColumns.has(column)}
                          onCheckedChange={() => toggleColumn(column)}
                          className="h-4 w-4 flex-shrink-0"
                        />
                        <label
                          htmlFor={`fs-${column}`}
                          className="text-sm leading-relaxed cursor-pointer truncate"
                        >
                          {getDisplayName(column)}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function ConfigurableChart({
  title,
  data,
  availableColumns,
  onFullScreen
}: {
  title: string
  data: DataPoint[]
  availableColumns: string[]
  onFullScreen?: (state: FullScreenState) => void
}) {
  const { formatTimeInTimezone } = useTimezone()

  // Function to get display name for columns
  const getDisplayName = (column: string) => {
    return column.replace('_inst_latch', '')
  }

  // Set default columns based on chart type
  const getDefaultColumns = () => {
    if (title === "PV Data & Frequency") {
      // Default to PPV columns for PV data, plus temperature
      const ppvColumns = availableColumns.filter(col => col.includes('ppv'))
      const defaultCols = ppvColumns.length > 0 ? ppvColumns : availableColumns.slice(0, 3)
      // Add temperature if it's available and not already included
      if (availableColumns.includes('temperature') && !defaultCols.includes('temperature')) {
        defaultCols.push('temperature')
      }
      return defaultCols
    } else if (title === "Latch Data") {
      // Default to IPV columns for latch data
      const ipvColumns = availableColumns.filter(col => col.includes('ipv'))
      return ipvColumns.length > 0 ? ipvColumns : availableColumns.slice(0, 3)
    }
    // Default behavior for other charts
    return availableColumns.slice(0, 3)
  }

  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(getDefaultColumns())
  )
  // Zoom controls
  const [zoomStart, setZoomStart] = useState(0)
  const [zoomEnd, setZoomEnd] = useState(100)
  const [zoomLevel, setZoomLevel] = useState(1)
  // Decimation toggle
  const [decimationEnabled, setDecimationEnabled] = useState(() => loadDecimationFromCookie())

  const toggleColumn = useCallback((column: string) => {
    const newSelected = new Set(selectedColumns)
    if (newSelected.has(column)) {
      newSelected.delete(column)
    } else {
      newSelected.add(column)
    }
    setSelectedColumns(newSelected)
  }, [selectedColumns])

  const toggleDecimation = useCallback(() => {
    const newEnabled = !decimationEnabled
    setDecimationEnabled(newEnabled)
    saveDecimationToCookie(newEnabled)
  }, [decimationEnabled])

  // Calculate zoom range and apply adaptive decimation
  const { totalPoints, zoomedData, zoomedSliceLength } = useMemo(() => {
    const totalPoints = data.length
    const startIndex = Math.floor((zoomStart / 100) * totalPoints)
    const endIndex = Math.ceil((zoomEnd / 100) * totalPoints)

    // First slice the data based on zoom
    const zoomedSlice = data.slice(startIndex, endIndex)

    // Then apply decimation to the zoomed slice if enabled
    const zoomedData = decimationEnabled ? decimateData(zoomedSlice, 1000) : zoomedSlice

    return { totalPoints, zoomedData, zoomedSliceLength: zoomedSlice.length }
  }, [data, zoomStart, zoomEnd, decimationEnabled])

  // Memoize chart data transformation
  const chartData = useMemo(() => {
    return zoomedData.map((point, index) => ({
      timestamp: formatTimeInTimezone(point.timestamp),
      originalIndex: Math.floor((zoomStart / 100) * data.length) + index,
      originalDataPoint: point, // Preserve full original data point for tooltip access
      ...Object.fromEntries(
        Array.from(selectedColumns).map(col => [col, point[col as keyof DataPoint]])
      )
    }))
  }, [zoomedData, selectedColumns, zoomStart, data.length, formatTimeInTimezone])

  const zoomIn = useCallback(() => {
    const currentRange = zoomEnd - zoomStart
    const newRange = Math.max(currentRange * 0.5, 5) // Minimum 5% range
    const newEnd = Math.min(100, zoomStart + newRange)
    setZoomEnd(newEnd)
    setZoomLevel(zoomLevel * 2)
  }, [zoomStart, zoomEnd, zoomLevel])

  const zoomOut = useCallback(() => {
    const currentRange = zoomEnd - zoomStart
    const newRange = Math.min(currentRange * 2, 100)
    const newEnd = Math.min(100, zoomStart + newRange)
    setZoomEnd(newEnd)
    setZoomLevel(Math.max(zoomLevel * 0.5, 1))
  }, [zoomStart, zoomEnd, zoomLevel])

  const resetZoom = useCallback(() => {
    setZoomStart(0)
    setZoomEnd(100)
    setZoomLevel(1)
  }, [])

  const panLeft = useCallback(() => {
    const currentRange = zoomEnd - zoomStart
    const panAmount = currentRange * 0.1
    if (zoomStart - panAmount >= 0) {
      setZoomStart(zoomStart - panAmount)
      setZoomEnd(zoomEnd - panAmount)
    }
  }, [zoomStart, zoomEnd])

  const panRight = useCallback(() => {
    const currentRange = zoomEnd - zoomStart
    const panAmount = currentRange * 0.1
    if (zoomEnd + panAmount <= 100) {
      setZoomStart(zoomStart + panAmount)
      setZoomEnd(zoomEnd + panAmount)
    }
  }, [zoomStart, zoomEnd])

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex flex-col">
            <CardTitle>{title}</CardTitle>
            <span className="text-xs text-muted-foreground">
              Showing {chartData.length} of {data.length} data points
              {decimationEnabled && zoomedData.length < zoomedSliceLength && " (decimated for performance)"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={panLeft} disabled={zoomStart <= 0}>
              ←
            </Button>
            <Button size="sm" variant="outline" onClick={zoomOut} disabled={zoomLevel <= 1}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              {zoomLevel.toFixed(1)}x
            </span>
            <Button size="sm" variant="outline" onClick={zoomIn}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={panRight} disabled={zoomEnd >= 100}>
              →
            </Button>
            <Button size="sm" variant="outline" onClick={resetZoom} disabled={zoomLevel <= 1}>
              <RotateCcw className="h-4 w-4" />
            </Button>
            {zoomedSliceLength > 1000 && (
              <Button
                size="sm"
                variant={decimationEnabled ? "default" : "outline"}
                onClick={toggleDecimation}
                title={decimationEnabled ? "Disable decimation (show all data points)" : "Enable decimation (improve performance)"}
              >
                {decimationEnabled ? "Decimated" : "Full Data"}
              </Button>
            )}
            {onFullScreen && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onFullScreen({
                  selectedColumns: Array.from(selectedColumns),
                  zoomStart,
                  zoomEnd,
                  zoomLevel,
                  decimationEnabled,
                  sourceChartTitle: title
                })}
                title="Open in full screen"
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {/* Range slider for zoom position */}
        {zoomLevel > 1 && (
          <div className="space-y-2">
            <Label className="text-sm">Zoom Position</Label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max={100 - (zoomEnd - zoomStart)}
                value={zoomStart}
                onChange={(e) => {
                  const newStart = parseFloat(e.target.value)
                  const range = zoomEnd - zoomStart
                  setZoomStart(newStart)
                  setZoomEnd(newStart + range)
                }}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs text-muted-foreground w-20">
                {Math.round((zoomStart / 100) * totalPoints)} - {Math.round((zoomEnd / 100) * totalPoints)}
              </span>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {availableColumns.map(column => (
            <div key={column} className="flex items-center space-x-2">
              <Checkbox
                id={column}
                checked={selectedColumns.has(column)}
                onCheckedChange={() => toggleColumn(column)}
              />
              <label
                htmlFor={column}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {getDisplayName(column)}
              </label>
            </div>
          ))}
          {/* VPV toggle buttons - works for both vpv and vpv_inst_latch columns */}
          {availableColumns.some(col => col.includes('vpv')) && (
            <Button
              size="sm"
              variant={availableColumns.filter(col => col.includes('vpv')).every(col => selectedColumns.has(col)) ? "default" : "outline"}
              onClick={() => {
                const vpvColumns = availableColumns.filter(col => col.includes('vpv'))
                const allVpvSelected = vpvColumns.every(col => selectedColumns.has(col))
                const newSelected = new Set(selectedColumns)

                if (allVpvSelected) {
                  // Deselect all VPV columns
                  vpvColumns.forEach(col => newSelected.delete(col))
                } else {
                  // Select all VPV columns and deselect all other columns
                  vpvColumns.forEach(col => newSelected.add(col))
                  availableColumns.filter(col => !col.includes('vpv')).forEach(col => newSelected.delete(col))
                }
                setSelectedColumns(newSelected)
              }}
              className="ml-2"
            >
              VPV
            </Button>
          )}
          {/* PPV toggle buttons - only for PV data chart */}
          {availableColumns.some(col => col.includes('ppv')) && (
            <Button
              size="sm"
              variant={availableColumns.filter(col => col.includes('ppv')).every(col => selectedColumns.has(col)) ? "default" : "outline"}
              onClick={() => {
                const ppvColumns = availableColumns.filter(col => col.includes('ppv'))
                const allPpvSelected = ppvColumns.every(col => selectedColumns.has(col))
                const newSelected = new Set(selectedColumns)

                if (allPpvSelected) {
                  // Deselect all PPV columns
                  ppvColumns.forEach(col => newSelected.delete(col))
                } else {
                  // Select all PPV columns and deselect VPV columns
                  ppvColumns.forEach(col => newSelected.add(col))
                  availableColumns.filter(col => col.includes('vpv')).forEach(col => newSelected.delete(col))
                }
                setSelectedColumns(newSelected)
              }}
              className="ml-1"
            >
              PPV
            </Button>
          )}
          {/* IPV toggle buttons - only for latch data chart */}
          {availableColumns.some(col => col.includes('ipv')) && (
            <Button
              size="sm"
              variant={availableColumns.filter(col => col.includes('ipv')).every(col => selectedColumns.has(col)) ? "default" : "outline"}
              onClick={() => {
                const ipvColumns = availableColumns.filter(col => col.includes('ipv'))
                const allIpvSelected = ipvColumns.every(col => selectedColumns.has(col))
                const newSelected = new Set(selectedColumns)

                if (allIpvSelected) {
                  // Deselect all IPV columns
                  ipvColumns.forEach(col => newSelected.delete(col))
                } else {
                  // Select all IPV columns and deselect all other columns
                  ipvColumns.forEach(col => newSelected.add(col))
                  availableColumns.filter(col => !col.includes('ipv')).forEach(col => newSelected.delete(col))
                }
                setSelectedColumns(newSelected)
              }}
              className="ml-1"
            >
              IPV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              margin={{ top: 5, right: 30, left: 20, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="timestamp"
                interval={Math.max(0, Math.ceil(chartData.length / 8))}
                tick={{ fontSize: 12 }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis />
              <Tooltip content={StatusBitsTooltip} animationDuration={0} />
              <Legend />
              {Array.from(selectedColumns).map((column, index) => (
                <Line
                  key={column}
                  type="monotone"
                  dataKey={column}
                  name={getDisplayName(column)}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

export default function TestPage() {
  const params = useParams()
  const router = useRouter()
  const testId = params.id as string
  const [testData, setTestData] = useState<TestData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [fullScreenState, setFullScreenState] = useState<FullScreenState | null>(null)
  const { formatInTimezone } = useTimezone()

  // Prefetch hook
  const { prefetchAdjacentTests, getCachedTest, clearCache } = usePrefetchedTests()

  const openFullScreen = useCallback((state: FullScreenState) => {
    setFullScreenState(state)
  }, [])

  const closeFullScreen = useCallback(() => {
    setFullScreenState(null)
  }, [])

  const navigateToTest = useCallback((newTestId: number) => {
    // Check if we have cached data for instant navigation
    const cachedData = getCachedTest(newTestId)

    if (cachedData) {
      // Instant navigation with cached data
      setTestData(cachedData)
      setLoading(false)
      setError(null)

      // Update URL without triggering Next.js routing
      window.history.replaceState(null, '', `/test/${newTestId}`)

      // Prefetch new adjacent tests for the cached data
      prefetchAdjacentTests(cachedData.navigation)
    } else {
      // Fallback to normal navigation
      router.push(`/test/${newTestId}`)
    }
  }, [router, getCachedTest, prefetchAdjacentTests])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ESC key to close fullscreen
      if (event.key === 'Escape' && fullScreenState) {
        closeFullScreen()
        return
      }

      // Arrow key navigation (only when not in fullscreen and no input focused)
      if (!fullScreenState && testData && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        const { navigation } = testData

        if (event.key === 'ArrowLeft' && navigation.previous_failed_test) {
          event.preventDefault()
          navigateToTest(navigation.previous_failed_test.test_id)
        } else if (event.key === 'ArrowRight' && navigation.next_failed_test) {
          event.preventDefault()
          navigateToTest(navigation.next_failed_test.test_id)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [fullScreenState, closeFullScreen, testData, navigateToTest])

  useEffect(() => {
    const fetchTestData = async () => {
      try {
        const response = await fetch(`/api/test/${testId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch test data')
        }
        const data = await response.json()
        setTestData(data)

        // Trigger prefetch of adjacent tests after initial load
        if (data.navigation) {
          prefetchAdjacentTests(data.navigation)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    if (testId) {
      fetchTestData()
    }
  }, [testId, prefetchAdjacentTests])

  // Clear cache when component unmounts or testId changes
  useEffect(() => {
    return () => {
      clearCache()
    }
  }, [testId, clearCache])

  const updateTestStatus = async (newStatus: string) => {
    if (!testData) return

    setUpdatingStatus(true)
    try {
      const response = await fetch('/api/test-status', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testId: testData.test_id,
          status: newStatus,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update test status')
      }

      // Update local state
      setTestData(prev => prev ? { ...prev, overall_status: newStatus } : null)
    } catch (err) {
      console.error('Error updating test status:', err)
      alert('Failed to update test status')
    } finally {
      setUpdatingStatus(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading test data...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">Error: {error}</div>
        </div>
      </div>
    )
  }

  if (!testData) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">No test data found</div>
        </div>
      </div>
    )
  }

  const startDate = formatInTimezone(testData.start_time)
  const endDate = formatInTimezone(testData.end_time)

  const downloadCSV = () => {
    // Create CSV filename based on test data
    const testDate = new Date(testData.start_time)
    const dateStr = testDate.toISOString().split('T')[0]
    const timeStr = testDate.toTimeString().split(' ')[0].replace(/:/g, '-')
    const fileName = `test_${testData.test_id}_${testData.serial_number}_${dateStr}_${timeStr}.csv`
    // Convert data points to CSV format
    if (testData.data_points.length === 0) {
      alert('No data points available for download')
      return
    }
    // Get all column headers from the first data point
    const headers = Object.keys(testData.data_points[0])
    // Helper function to escape CSV values
    const escapeCsvValue = (value: string | number | undefined): string => {
      if (value === undefined || value === null) return ''
      const str = value.toString()
      // If value contains comma, semicolon, newline, or quotes, wrap in quotes and escape internal quotes
      if (str.includes(',') || str.includes(';') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
        return '"' + str.replace(/"/g, '""') + '"'
      }
      return str
    }

    // Create CSV content
    const csvContent = [
      headers.join(','), // Header row
      ...testData.data_points.map(point =>
        headers.map(header => {
          const value = point[header as keyof DataPoint]
          return escapeCsvValue(value)
        }).join(',')
      )
    ].join('\n')
    // Create and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob)
      link.setAttribute('href', url)
      link.setAttribute('download', fileName)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    }
  }

  return (
    <div className="container p-6 mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
        <Button variant="outline" size="sm" onClick={downloadCSV}>
          <Download className="h-4 w-4 mr-2" />
          Download CSV
        </Button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-6">
          {/* Test Information - Left Column */}
          <div>
            <h1 className="text-3xl font-bold">Inverter S/N: {testData.serial_number}</h1>
            <h2 className="text-xl text-muted-foreground">Test {testData.test_id}</h2>
            <p className="text-lg text-muted-foreground">Started: {startDate}</p>
            <p className="text-lg text-muted-foreground">Ended: {endDate}</p>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2">
                <Badge variant={
                  testData.overall_status === 'PASS' ? 'default' :
                    testData.overall_status === 'FAIL' ? 'destructive' :
                      'secondary'
                }>
                  {testData.overall_status}
                </Badge>
                <Select
                  value={testData.overall_status}
                  onValueChange={updateTestStatus}
                  disabled={updatingStatus}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PASS">PASS</SelectItem>
                    <SelectItem value="FAIL">FAIL</SelectItem>
                    <SelectItem value="INVALID">INVALID</SelectItem>
                  </SelectContent>
                </Select>
                {updatingStatus && <span className="text-sm text-muted-foreground">Updating...</span>}
              </div>
              {testData.failure_description && (
                <span className="text-sm text-muted-foreground">
                  {testData.failure_description}
                </span>
              )}
            </div>
          </div>

          {/* Failed Test Navigation - Right Column */}
          <div className="flex items-start">
            <FailedTestNavigation testData={testData} onNavigate={navigateToTest} />
          </div>
        </div>

        <div className="grid grid-cols-[1fr_320px] gap-6">
          {/* Charts Column */}
          <div className="space-y-6">
            <ConfigurableChart
              title="PV Data & Frequency"
              data={testData.data_points}
              availableColumns={pvColumns}
              onFullScreen={openFullScreen}
            />

            <ConfigurableChart
              title="Grid Data"
              data={testData.data_points}
              availableColumns={gridColumns}
              onFullScreen={openFullScreen}
            />

            <ConfigurableChart
              title="Latch Data"
              data={testData.data_points}
              availableColumns={latchColumns}
              onFullScreen={openFullScreen}
            />
          </div>

          {/* Annotations Sidebar */}
          <div className="sticky top-6 h-fit">
            <TestAnnotations
              testId={testData.test_id}
              serialNumber={testData.serial_number}
              startTime={testData.start_time}
            />
          </div>
        </div>

        {/* Full Screen Modal */}
        {fullScreenState && (
          <FullScreenChart
            data={testData.data_points}
            initialState={fullScreenState}
            onClose={closeFullScreen}
          />
        )}
      </div>
    </div>
  )
}