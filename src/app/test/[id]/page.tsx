"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { useTestDataCache } from "@/contexts/TestDataCacheContext"
import { useTimezone } from "@/contexts/TimezoneContext"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft, Download, Maximize2, X, ChevronLeft, ChevronRight, AlertTriangle, PanelRightClose, PanelRightOpen } from "lucide-react"
import Link from "next/link"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"
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
  navigation?: {
    previous_failed_test?: FailureInfo
    next_failed_test?: FailureInfo
    current_failure_index?: number
    total_failed_tests: number
  }
  _metadata?: {
    mode: string
    total_points: number
    returned_points: number
    decimated: boolean
    decimation_factor: number
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

const pvColumns = ["vpv1", "ppv1", "vpv2", "ppv2", "vpv3", "ppv3", "vpv4", "ppv4", "frequency", "vbus", "temperature"]
const gridColumns = ["vgrid", "pgrid", "qgrid", "frequency", "temperature"]
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

  // Don't show if navigation info is missing (from cached batch data)
  if (!navigation) {
    return null
  }

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
    <Card className="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950 w-full">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            <CardTitle className="text-orange-800 dark:text-orange-200 text-base">Failed Test History</CardTitle>
          </div>
          {navigation.current_failure_index && (
            <span className="text-sm text-orange-600 dark:text-orange-400 font-medium">
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

// Helper function to create tooltip formatter for ECharts
function createTooltipFormatter(chartData: Array<{ originalDataPoint?: DataPoint }>, isDarkMode: boolean, enabled: boolean = true) {
  const textColor = isDarkMode ? "#e5e7eb" : "#374151"
  const borderColor = isDarkMode ? "#374151" : "#e5e7eb"

  return (params: unknown) => {
    if (!enabled) return ""
    if (!Array.isArray(params) || params.length === 0) return ""

    const dataIndex = params[0].dataIndex
    const dataPoint = chartData[dataIndex]?.originalDataPoint
    const timestamp = params[0].name

    let html = `<div style="font-weight: 600; margin-bottom: 8px; color: ${textColor};">Time: ${timestamp}</div>`

    // Filter out null/undefined values and sort by series name for consistent display
    const validParams = params.filter((param: { value?: number | number[] | null }) => {
      if (Array.isArray(param.value)) {
        return param.value[param.value.length - 1] != null
      }
      return param.value != null
    })

    validParams.forEach((param: { color?: string; seriesName?: string; value?: number | number[]; dataIndex?: number }) => {
      const name = param.seriesName?.replace('_inst_latch', '') || ''
      // Handle both simple values and array values [x, y]
      let displayValue: string
      if (Array.isArray(param.value)) {
        // If value is an array, use the last element (y-value)
        displayValue = typeof param.value[param.value.length - 1] === 'number'
          ? param.value[param.value.length - 1].toFixed(3)
          : String(param.value[param.value.length - 1])
      } else if (typeof param.value === 'number') {
        displayValue = param.value.toFixed(3)
      } else {
        displayValue = String(param.value)
      }
      html += `<div style="margin: 4px 0; color: ${param.color}; font-size: 14px;">`
      html += `${name}: ${displayValue}`
      html += `</div>`
    })

    if (dataPoint?.status_bits) {
      html += `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${borderColor};">`
      html += `<div style="font-size: 12px; font-weight: 500; color: ${isDarkMode ? '#9ca3af' : '#6b7280'}; margin-bottom: 4px;">Status Bits:</div>`
      html += `<div style="font-size: 12px; font-family: monospace; color: ${textColor};">${dataPoint.status_bits.split(';').filter(s => s.trim()).join('<br/>')}</div>`
      html += `</div>`
    }

    return html
  }
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
  const { formatTimeWithSecondsInTimezone } = useTimezone()
  const chartRef = useRef<ReactECharts>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Dark mode detection
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"))
    }
    checkDarkMode()
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])

  // Initialize state from inherited values
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(initialState.selectedColumns)
  )
  const [decimationEnabled, setDecimationEnabled] = useState(initialState.decimationEnabled)
  const [tooltipEnabled, setTooltipEnabled] = useState(true)

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

  // Apply decimation if enabled
  const processedData = useMemo(() => {
    return decimationEnabled ? decimateData(data, 1000) : data
  }, [data, decimationEnabled])

  // Memoize chart data transformation
  const chartData = useMemo(() => {
    return processedData.map((point) => ({
      timestamp: formatTimeWithSecondsInTimezone(point.timestamp),
      originalDataPoint: point, // Preserve full original data point for tooltip access
      ...Object.fromEntries(
        Array.from(selectedColumns).map(col => [col, point[col as keyof DataPoint]])
      )
    }))
  }, [processedData, selectedColumns, formatTimeWithSecondsInTimezone])

  const getDisplayName = (column: string) => {
    return column.replace('_inst_latch', '')
  }

  // ECharts configuration
  const chartOption: EChartsOption = useMemo(() => {
    const textColor = isDarkMode ? "#e5e7eb" : "#374151"
    const gridColor = isDarkMode ? "#374151" : "#e5e7eb"

    const series = Array.from(selectedColumns).map((column, index) => ({
      name: getDisplayName(column),
      type: "line" as const,
      data: chartData.map((point) => (point as Record<string, unknown>)[column] as number | null),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 2, color: colors[index % colors.length] },
      itemStyle: { color: colors[index % colors.length] },
      connectNulls: false,
      // Progressive rendering for large datasets
      progressive: 1000,
      progressiveThreshold: 3000,
      progressiveChunkMode: 'mod' as const,
      // Only apply sampling when decimation is enabled - this prevents tooltip issues
      // When sampling is active, different series may sample different points, causing
      // incomplete tooltips. Decimation handles this better by pre-processing the data.
      ...(decimationEnabled ? { sampling: 'lttb' as const } : {}),
    }))

    return {
      backgroundColor: "transparent",
      textStyle: { color: textColor },
      grid: {
        left: 60,
        right: 50,
        bottom: 80,
        top: 40,
      },
      xAxis: {
        type: "category",
        data: chartData.map((point) => point.timestamp),
        axisLabel: {
          color: textColor,
          fontSize: 12,
          rotate: -45,
          interval: Math.max(0, Math.ceil(chartData.length / 12)),
        },
        axisTick: { show: true },
        axisLine: { show: true, lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: "value",
        scale: true, // Enable autoscaling to fit visible data range
        axisLabel: { color: textColor },
        axisLine: { show: true, lineStyle: { color: gridColor } },
        splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
      },
      series,
      axisPointer: {
        show: true,
        triggerOn: "mousemove",
        type: "cross",
        snap: true,
        label: {
          show: true,
          backgroundColor: isDarkMode ? "#1f2937" : "#374151",
          color: "#ffffff",
          borderColor: isDarkMode ? "#374151" : "#6b7280",
          borderWidth: 1,
          padding: [5, 8],
          fontSize: 12,
          fontWeight: "bold",
        },
        crossStyle: {
          type: "dashed",
          color: isDarkMode ? "#6b7280" : "#9ca3af",
          width: 1,
        },
      },
      tooltip: {
        show: true,
        trigger: "axis",
        backgroundColor: tooltipEnabled
          ? (isDarkMode ? "rgba(17, 24, 39, 0.85)" : "rgba(255, 255, 255, 0.85)")
          : "rgba(0, 0, 0, 0)",
        borderColor: tooltipEnabled
          ? (isDarkMode ? "#374151" : "#e5e7eb")
          : "rgba(0, 0, 0, 0)",
        borderWidth: tooltipEnabled ? 1 : 0,
        textStyle: {
          color: tooltipEnabled ? "inherit" : "rgba(0, 0, 0, 0)",
        },
        formatter: createTooltipFormatter(chartData, isDarkMode, tooltipEnabled),
        axisPointer: {
          type: "cross",
        },
        // Ensure all series are included in tooltip, not limited by performance optimization
        renderMode: 'html' as const,
        appendToBody: false,
        // Show all series in tooltip regardless of count
        confine: true,
      },
      legend: {
        show: true,
        textStyle: { color: textColor },
        top: 5,
        type: "scroll",
      },
      dataZoom: [
        {
          type: "inside",
          start: 0,
          end: 100,
          zoomOnMouseWheel: true, // Enable scroll to zoom
          moveOnMouseMove: true, // Enable click-drag to pan
          moveOnMouseWheel: false, // Disable pan on scroll
          zoomLock: false,
          orient: "horizontal",
          filterMode: "filter", // Enable y-axis autoscaling
        },
        {
          type: "slider",
          start: 0,
          end: 100,
          height: 25,
          bottom: 10,
          handleSize: "80%",
          textStyle: { color: textColor },
          borderColor: gridColor,
          fillerColor: isDarkMode ? "rgba(59, 130, 246, 0.2)" : "rgba(59, 130, 246, 0.15)",
          handleStyle: {
            color: "#3b82f6",
            borderColor: "#3b82f6",
          },
        },
      ],
    }
  }, [chartData, selectedColumns, isDarkMode, tooltipEnabled])

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl w-[95vw] h-[95vh] p-4 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold">Full Screen - {initialState.sourceChartTitle}</h2>
            <span className="text-sm text-muted-foreground">
              Showing {chartData.length} of {data.length} data points
              {decimationEnabled && processedData.length < data.length && " (decimated for performance)"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {data.length > 1000 && (
              <Button
                size="sm"
                variant={decimationEnabled ? "default" : "outline"}
                onClick={toggleDecimation}
                title={decimationEnabled ? "Disable decimation (show all data points)" : "Enable decimation (improve performance)"}
              >
                {decimationEnabled ? "Decimated" : "Full Data"}
              </Button>
            )}
            <Button
              size="sm"
              variant={tooltipEnabled ? "default" : "outline"}
              onClick={() => setTooltipEnabled(!tooltipEnabled)}
              title={tooltipEnabled ? "Disable tooltip" : "Enable tooltip"}
            >
              Tooltip
            </Button>
            <Button size="sm" variant="outline" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Chart */}
        <div className="flex-1 min-h-0 max-h-[calc(100vh-400px)]">
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
            notMerge={true}
            lazyUpdate={true}
          />
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
  const { formatTimeWithSecondsInTimezone } = useTimezone()
  const chartRef = useRef<ReactECharts>(null)
  const [isDarkMode, setIsDarkMode] = useState(false)

  // Dark mode detection
  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"))
    }
    checkDarkMode()
    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])

  // Function to get display name for columns
  const getDisplayName = (column: string) => {
    return column.replace('_inst_latch', '')
  }

  // Set default columns based on chart type
  const getDefaultColumns = () => {
    if (title === "PV Data") {
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
  // Decimation toggle
  const [decimationEnabled, setDecimationEnabled] = useState(() => loadDecimationFromCookie())
  const [tooltipEnabled, setTooltipEnabled] = useState(true)

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

  // Apply decimation if enabled
  const processedData = useMemo(() => {
    return decimationEnabled ? decimateData(data, 1000) : data
  }, [data, decimationEnabled])

  // Memoize chart data transformation
  const chartData = useMemo(() => {
    return processedData.map((point) => ({
      timestamp: formatTimeWithSecondsInTimezone(point.timestamp),
      originalDataPoint: point, // Preserve full original data point for tooltip access
      ...Object.fromEntries(
        Array.from(selectedColumns).map(col => [col, point[col as keyof DataPoint]])
      )
    }))
  }, [processedData, selectedColumns, formatTimeWithSecondsInTimezone])

  // ECharts configuration
  const chartOption: EChartsOption = useMemo(() => {
    const textColor = isDarkMode ? "#e5e7eb" : "#374151"
    const gridColor = isDarkMode ? "#374151" : "#e5e7eb"

    const series = Array.from(selectedColumns).map((column, index) => ({
      name: getDisplayName(column),
      type: "line" as const,
      data: chartData.map((point) => (point as Record<string, unknown>)[column] as number | null),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 2, color: colors[index % colors.length] },
      itemStyle: { color: colors[index % colors.length] },
      connectNulls: false,
      // Progressive rendering for large datasets
      progressive: 1000,
      progressiveThreshold: 3000,
      progressiveChunkMode: 'mod' as const,
      // Only apply sampling when decimation is enabled - this prevents tooltip issues
      // When sampling is active, different series may sample different points, causing
      // incomplete tooltips. Decimation handles this better by pre-processing the data.
      ...(decimationEnabled ? { sampling: 'lttb' as const } : {}),
    }))

    return {
      backgroundColor: "transparent",
      textStyle: { color: textColor },
      grid: {
        left: 60,
        right: 50,
        bottom: 80,
        top: 40,
      },
      xAxis: {
        type: "category",
        data: chartData.map((point) => point.timestamp),
        axisLabel: {
          color: textColor,
          fontSize: 12,
          rotate: -45,
          interval: Math.max(0, Math.ceil(chartData.length / 8)),
        },
        axisTick: { show: true },
        axisLine: { show: true, lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: "value",
        scale: true, // Enable autoscaling to fit visible data range
        axisLabel: { color: textColor },
        axisLine: { show: true, lineStyle: { color: gridColor } },
        splitLine: { lineStyle: { color: gridColor, type: "dashed" } },
      },
      series,
      axisPointer: {
        show: true,
        triggerOn: "mousemove",
        type: "cross",
        snap: true,
        label: {
          show: true,
          backgroundColor: isDarkMode ? "#1f2937" : "#374151",
          color: "#ffffff",
          borderColor: isDarkMode ? "#374151" : "#6b7280",
          borderWidth: 1,
          padding: [5, 8],
          fontSize: 12,
          fontWeight: "bold",
        },
        crossStyle: {
          type: "dashed",
          color: isDarkMode ? "#6b7280" : "#9ca3af",
          width: 1,
        },
      },
      tooltip: {
        show: true,
        trigger: "axis",
        backgroundColor: tooltipEnabled
          ? (isDarkMode ? "rgba(17, 24, 39, 0.85)" : "rgba(255, 255, 255, 0.85)")
          : "rgba(0, 0, 0, 0)",
        borderColor: tooltipEnabled
          ? (isDarkMode ? "#374151" : "#e5e7eb")
          : "rgba(0, 0, 0, 0)",
        borderWidth: tooltipEnabled ? 1 : 0,
        textStyle: {
          color: tooltipEnabled ? "inherit" : "rgba(0, 0, 0, 0)",
        },
        formatter: createTooltipFormatter(chartData, isDarkMode, tooltipEnabled),
        axisPointer: {
          type: "cross",
        },
        // Ensure all series are included in tooltip, not limited by performance optimization
        renderMode: 'html' as const,
        appendToBody: false,
        // Show all series in tooltip regardless of count
        confine: true,
      },
      legend: {
        show: true,
        textStyle: { color: textColor },
        top: 5,
        type: "scroll",
      },
      dataZoom: [
        {
          type: "inside",
          start: 0,
          end: 100,
          zoomOnMouseWheel: true, // Enable scroll to zoom
          moveOnMouseMove: true, // Enable click-drag to pan
          moveOnMouseWheel: false, // Disable pan on scroll
          zoomLock: false,
          orient: "horizontal",
          filterMode: "filter", // Enable y-axis autoscaling
        },
        {
          type: "slider",
          start: 0,
          end: 100,
          height: 25,
          bottom: 10,
          handleSize: "80%",
          textStyle: { color: textColor },
          borderColor: gridColor,
          fillerColor: isDarkMode ? "rgba(59, 130, 246, 0.2)" : "rgba(59, 130, 246, 0.15)",
          handleStyle: {
            color: "#3b82f6",
            borderColor: "#3b82f6",
          },
        },
      ],
    }
  }, [chartData, selectedColumns, isDarkMode, tooltipEnabled])

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div className="flex flex-col">
            <CardTitle>{title}</CardTitle>
            <span className="text-xs text-muted-foreground">
              Showing {chartData.length} of {data.length} data points
              {decimationEnabled && processedData.length < data.length && " (decimated for performance)"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {data.length > 1000 && (
              <Button
                size="sm"
                variant={decimationEnabled ? "default" : "outline"}
                onClick={toggleDecimation}
                title={decimationEnabled ? "Disable decimation (show all data points)" : "Enable decimation (improve performance)"}
              >
                {decimationEnabled ? "Decimated" : "Full Data"}
              </Button>
            )}
            <Button
              size="sm"
              variant={tooltipEnabled ? "default" : "outline"}
              onClick={() => setTooltipEnabled(!tooltipEnabled)}
              title={tooltipEnabled ? "Disable tooltip" : "Enable tooltip"}
            >
              Tooltip
            </Button>
            {onFullScreen && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onFullScreen({
                  selectedColumns: Array.from(selectedColumns),
                  zoomStart: 0,
                  zoomEnd: 100,
                  zoomLevel: 1,
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
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
            notMerge={true}
            lazyUpdate={true}
          />
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
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const { formatInTimezone } = useTimezone()

  // Cache hook
  const { getTest, setTest } = useTestDataCache()

  const openFullScreen = useCallback((state: FullScreenState) => {
    setFullScreenState(state)
  }, [])

  const closeFullScreen = useCallback(() => {
    setFullScreenState(null)
  }, [])

  const navigateToTest = useCallback((newTestId: number) => {
    // Check if we have cached data for instant navigation
    const cachedData = getTest(newTestId)

    if (cachedData) {
      console.log(`✅ Cache HIT for test ${newTestId} - instant navigation!`)
      // Instant navigation with cached data
      setTestData(cachedData as unknown as TestData)
      setLoading(false)
      setError(null)

      // Update URL without triggering Next.js routing
      window.history.replaceState(null, '', `/test/${newTestId}`)
    } else {
      console.log(`❌ Cache MISS for test ${newTestId} - normal navigation`)
      // Fallback to normal navigation
      router.push(`/test/${newTestId}`)
    }
  }, [router, getTest])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ESC key to close fullscreen
      if (event.key === 'Escape' && fullScreenState) {
        closeFullScreen()
        return
      }

      // Arrow key navigation (only when not in fullscreen and no input focused)
      if (!fullScreenState && testData && testData.navigation && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
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
      const numericTestId = parseInt(testId)

      // Check cache first
      const cachedData = getTest(numericTestId)

      if (cachedData) {
        console.log(`✅ Cache HIT for test ${testId} - instant load!`)
        setTestData(cachedData as unknown as TestData)
        setLoading(false)

        // Only fetch full data if we don't have navigation yet (means it's decimated batch data)
        const needsFullData = !cachedData.navigation || cachedData._metadata?.decimated

        if (needsFullData) {
          console.log('Loading full data with navigation in background...')
          try {
            const fullResponse = await fetch(`/api/test/${testId}?mode=full`)
            if (fullResponse.ok) {
              const fullData = await fullResponse.json()
              setTestData(fullData)
              setTest(numericTestId, fullData)
              console.log(`Full data loaded: ${fullData.data_points?.length || 0} points, navigation available`)
            }
          } catch (err) {
            console.error('Failed to load full data in background:', err)
          }
        } else {
          console.log('Already have full data with navigation, skipping fetch')
        }
        return
      }

      console.log(`❌ Cache MISS for test ${testId} - fetching...`)

      try {
        // Fetch with quick mode first for faster initial load
        const response = await fetch(`/api/test/${testId}?mode=quick`)
        if (!response.ok) {
          throw new Error('Failed to fetch test data')
        }
        const data = await response.json()
        setTestData(data)
        setLoading(false)

        // Add to cache
        setTest(numericTestId, data)

        // Fetch full data in background if decimated
        if (data._metadata?.decimated) {
          console.log('Loading full data in background...')
          const fullResponse = await fetch(`/api/test/${testId}?mode=full`)
          if (fullResponse.ok) {
            const fullData = await fullResponse.json()
            setTestData(fullData)
            setTest(numericTestId, fullData)
            console.log(`Full data loaded: ${fullData.data_points?.length || 0} points`)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
        setLoading(false)
      }
    }

    if (testId) {
      fetchTestData()
    }
  }, [testId, getTest, setTest])

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
      <div className="ml-10 px-6 py-6 4xl:px-8 4xl:py-8 5xl:px-12 5xl:py-12 space-y-6 4xl:space-y-8 5xl:space-y-10">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-36" />
        </div>

        <div className="space-y-4 4xl:space-y-6 5xl:space-y-8">
          {/* Test Info Header Skeleton */}
          <div className="grid grid-cols-2 gap-6 4xl:gap-8 5xl:gap-12">
            {/* Left Column - Test Information */}
            <div className="space-y-2">
              <Skeleton className="h-10 w-96" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-6 w-64" />
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-16" />
                  <Skeleton className="h-10 w-32" />
                </div>
              </div>
            </div>

            {/* Right Column - Navigation & Toggle */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-end">
                <Skeleton className="h-9 w-9" />
              </div>
            </div>
          </div>

          {/* Charts Grid Skeleton */}
          <div className="grid grid-cols-[1fr_320px] 4xl:grid-cols-[1fr_400px] 5xl:grid-cols-[1fr_480px] gap-6 4xl:gap-8 5xl:gap-12">
            {/* Charts Column */}
            <div className="space-y-6 4xl:space-y-8 5xl:space-y-10">
              {/* Chart 1 Skeleton */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-6 w-32" />
                    <div className="flex gap-2">
                      <Skeleton className="h-9 w-24" />
                      <Skeleton className="h-9 w-9" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Skeleton key={i} className="h-6 w-16" />
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-80 w-full" />
                </CardContent>
              </Card>

              {/* Chart 2 Skeleton */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-6 w-32" />
                    <div className="flex gap-2">
                      <Skeleton className="h-9 w-24" />
                      <Skeleton className="h-9 w-9" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-6 w-16" />
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-80 w-full" />
                </CardContent>
              </Card>

              {/* Chart 3 Skeleton */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-6 w-32" />
                    <div className="flex gap-2">
                      <Skeleton className="h-9 w-24" />
                      <Skeleton className="h-9 w-9" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <Skeleton key={i} className="h-6 w-16" />
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-80 w-full" />
                </CardContent>
              </Card>
            </div>

            {/* Annotations Sidebar Skeleton */}
            <div className="sticky top-6 h-fit">
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-20" />
                      ))}
                    </div>
                  </div>
                  <Skeleton className="h-10 w-full" />
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ml-10 px-6 py-6 pr-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-red-500">Error: {error}</div>
        </div>
      </div>
    )
  }

  if (!testData) {
    return (
      <div className="ml-10 px-6 py-6 pr-6">
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
    <div className="ml-10 px-6 py-6 4xl:px-8 4xl:py-8 5xl:px-12 5xl:py-12 space-y-6 4xl:space-y-8 5xl:space-y-10">
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

      <div className="space-y-4 4xl:space-y-6 5xl:space-y-8">
        <div className="grid grid-cols-2 gap-6 4xl:gap-8 5xl:gap-12">
          {/* Test Information - Left Column */}
          <div>
            <h1 className="text-3xl 4xl:text-4xl 5xl:text-5xl font-bold">Inverter S/N: {testData.serial_number}</h1>
            <h2 className="text-xl 4xl:text-2xl text-muted-foreground">Test {testData.test_id}</h2>
            <p className="text-lg 4xl:text-xl text-muted-foreground">Started: {startDate}</p>
            <p className="text-lg 4xl:text-xl text-muted-foreground">Ended: {endDate}</p>
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
          <div className="flex flex-col gap-2">
            <FailedTestNavigation testData={testData} onNavigate={navigateToTest} />
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSidebarVisible(!sidebarVisible)}
                title={sidebarVisible ? "Hide annotations" : "Show annotations"}
              >
                {sidebarVisible ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        <div
          key={`layout-${sidebarVisible}`}
          className={`grid gap-6 4xl:gap-8 5xl:gap-12 ${sidebarVisible ? 'grid-cols-[1fr_320px] 4xl:grid-cols-[1fr_400px] 5xl:grid-cols-[1fr_480px]' : 'grid-cols-1'}`}
        >
          {/* Charts Column */}
          <div className="space-y-6 4xl:space-y-8 5xl:space-y-10">
            <ConfigurableChart
              title="PV Data"
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
          {sidebarVisible && (
            <div className="sticky top-6 h-fit">
              <TestAnnotations
                testId={testData.test_id}
                serialNumber={testData.serial_number}
                startTime={testData.start_time}
              />
            </div>
          )}
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