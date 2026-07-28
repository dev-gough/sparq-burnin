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
    color: "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
  },
  "Energy & Efficiency": {
    columns: ["epv1", "epv2", "epv3", "epv4", "activeenergy", "reactiveenergy"],
    description: "Energy measurements and efficiency metrics",
    color: "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800"
  },
  "Grid Connection": {
    columns: ["vgrid", "pgrid", "qgrid", "vbus", "frequency"],
    description: "Grid interface measurements",
    color: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800"
  },
  "Current Latch": {
    columns: ["ipv1_inst_latch", "ipv2_inst_latch", "ipv3_inst_latch", "ipv4_inst_latch", "igrid_inst_latch", "vntrl_inst_latch"],
    description: "Instantaneous current latch readings",
    color: "bg-purple-50 border-purple-200 dark:bg-purple-950 dark:border-purple-800"
  },
  "Voltage Latch": {
    columns: ["vgrid_inst_latch", "vbus_inst_latch", "vpv1_inst_latch", "vpv2_inst_latch", "vpv3_inst_latch", "vpv4_inst_latch"],
    description: "Instantaneous voltage latch readings",
    color: "bg-indigo-50 border-indigo-200 dark:bg-indigo-950 dark:border-indigo-800"
  },
  "System Status": {
    columns: ["temperature", "extstatus", "status", "extstatus_latch", "status_latch"],
    description: "System health and diagnostics",
    color: "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
  }
}

// Prefer shared `burninChartColors` from `@/lib/chart-theme` when that file
// exists (PR2). Local fallback keeps this PR independent until theme merges.
const seriesPalette = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#06b6d4", // cyan
  "#d946ef", // fuchsia
  "#84cc16", // lime
  "#f97316", // orange
  "#0ea5e9", // sky
  "#a855f7", // purple
  "#14b8a6", // teal
  "#eab308", // yellow
  "#64748b", // slate
]

// Stable color per column (keyed to its position in the chart's column list),
// so a series keeps its color no matter which subset is selected.
const seriesColor = (column: string, orderedColumns: string[]) =>
  seriesPalette[Math.max(0, orderedColumns.indexOf(column)) % seriesPalette.length]

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

  const describe = (info?: FailureInfo) => {
    if (!info) return undefined
    const desc = info.failure_description ? ` — ${info.failure_description}` : ''
    return `${formatDate(info.start_time)} ${formatTime(info.start_time)}${desc}`
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-300/70 bg-amber-50 py-1.5 pr-1.5 pl-3 dark:border-amber-700/60 dark:bg-amber-950/40">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="whitespace-nowrap text-sm font-medium text-amber-800 dark:text-amber-200">
        {navigation.current_failure_index
          ? `Failure ${navigation.current_failure_index} of ${navigation.total_failed_tests} for this S/N`
          : `${navigation.total_failed_tests} failures for this S/N`}
      </span>
      <div className="ml-1 flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigation.previous_failed_test && onNavigate(navigation.previous_failed_test.test_id)}
          disabled={!navigation.previous_failed_test}
          title={navigation.previous_failed_test
            ? `Previous failure: ${describe(navigation.previous_failed_test)}`
            : 'No previous failures'}
          className="h-7 w-7 p-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigation.next_failed_test && onNavigate(navigation.next_failed_test.test_id)}
          disabled={!navigation.next_failed_test}
          title={navigation.next_failed_test
            ? `Next failure: ${describe(navigation.next_failed_test)}`
            : 'No next failures'}
          className="h-7 w-7 p-0"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// Label-over-value item for the dense test metadata band
function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
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

    let html = `<div style="min-width: 150px;">`
    html += `<div style="font-weight: 700; margin-bottom: 6px; color: ${textColor};">${timestamp}</div>`

    // Filter out null/undefined values
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
      html += `<div style="display: flex; align-items: center; gap: 8px; margin: 3px 0; font-size: 13px; color: ${textColor};">`
      html += `<span style="display: inline-block; width: 9px; height: 9px; border-radius: 3px; background: ${param.color}; flex-shrink: 0;"></span>`
      html += `<span style="flex: 1; opacity: 0.85;">${name}</span>`
      html += `<span style="font-weight: 600; margin-left: 14px; font-variant-numeric: tabular-nums;">${displayValue}</span>`
      html += `</div>`
    })

    if (dataPoint?.status_bits) {
      html += `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${borderColor};">`
      html += `<div style="font-size: 12px; font-weight: 500; color: ${isDarkMode ? '#9ca3af' : '#6b7280'}; margin-bottom: 4px;">Status Bits:</div>`
      html += `<div style="font-size: 12px; font-family: monospace; color: ${textColor};">${dataPoint.status_bits.split(';').filter(s => s.trim()).join('<br/>')}</div>`
      html += `</div>`
    }

    html += `</div>`
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

  // Custom wheel event handler for SHIFT+scroll panning
  useEffect(() => {
    if (!chartRef.current) return

    const chartInstance = chartRef.current.getEchartsInstance()
    const chartDom = chartInstance.getDom()

    const handleWheel = (e: WheelEvent) => {
      // Only intercept when SHIFT is pressed - otherwise let eCharts handle it
      if (!e.shiftKey) return

      // SHIFT is pressed - get fresh instance from ref
      if (!chartRef.current) return

      const freshInstance = chartRef.current.getEchartsInstance()
      const option = freshInstance.getOption()

      if (!option || typeof option !== 'object') return

      const dataZoomArray = (option as { dataZoom?: Array<{ start?: number; end?: number }> }).dataZoom

      if (!dataZoomArray || !Array.isArray(dataZoomArray) || dataZoomArray.length === 0) return

      const dataZoom = dataZoomArray[0]
      const currentStart = dataZoom.start ?? 0
      const currentEnd = dataZoom.end ?? 100
      const range = currentEnd - currentStart

      // Prevent default and handle panning
      e.preventDefault()
      e.stopPropagation()

      // Horizontal pan when SHIFT is held
      const panAmount = (e.deltaY / 100) * range * 0.3 // Adjust sensitivity

      let newStart = currentStart + panAmount
      let newEnd = currentEnd + panAmount

      // Clamp to valid range [0, 100]
      if (newStart < 0) {
        newStart = 0
        newEnd = range
      }
      if (newEnd > 100) {
        newEnd = 100
        newStart = 100 - range
      }

      freshInstance.dispatchAction({
        type: 'dataZoom',
        dataZoomIndex: 0,
        start: newStart,
        end: newEnd,
      })
    }

    chartDom.addEventListener('wheel', handleWheel, { passive: false, capture: true })

    return () => {
      chartDom.removeEventListener('wheel', handleWheel, { capture: true })
    }
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
    const textColor = isDarkMode ? "#d1d5db" : "#4b5563"
    const mutedColor = isDarkMode ? "#6b7280" : "#9ca3af"
    const gridColor = isDarkMode ? "rgba(148, 163, 184, 0.16)" : "rgba(100, 116, 139, 0.16)"

    // Series follow allColumns order so colors stay stable per column
    const series = allColumns.filter((col) => selectedColumns.has(col)).map((column) => ({
      name: getDisplayName(column),
      type: "line" as const,
      data: chartData.map((point) => (point as Record<string, unknown>)[column] as number | null),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 1.8, color: seriesColor(column, allColumns) },
      itemStyle: { color: seriesColor(column, allColumns) },
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
      textStyle: { color: textColor, fontFamily: "var(--font-geist-sans), sans-serif" },
      grid: {
        left: 56,
        right: 24,
        bottom: 76,
        top: 44,
      },
      xAxis: {
        type: "category",
        data: chartData.map((point) => point.timestamp),
        axisLabel: {
          color: mutedColor,
          fontSize: 11,
          rotate: -45,
          hideOverlap: true,
          interval: Math.max(0, Math.ceil(chartData.length / 12)),
        },
        axisTick: { show: false },
        axisLine: { show: true, lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: "value",
        scale: true, // Enable autoscaling to fit visible data range
        axisLabel: { color: mutedColor, fontSize: 11 },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: gridColor, type: "dashed" as const } },
      },
      series,
      axisPointer: {
        show: true,
        triggerOn: "mousemove",
        type: "cross",
        snap: true,
        label: {
          show: true,
          backgroundColor: isDarkMode ? "#27272a" : "#3f3f46",
          color: "#ffffff",
          borderColor: "transparent",
          borderWidth: 0,
          padding: [4, 8],
          fontSize: 11,
          fontWeight: "bold",
          borderRadius: 4,
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
          ? (isDarkMode ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.95)")
          : "rgba(0, 0, 0, 0)",
        borderColor: tooltipEnabled
          ? (isDarkMode ? "rgba(148, 163, 184, 0.25)" : "rgba(100, 116, 139, 0.2)")
          : "rgba(0, 0, 0, 0)",
        borderWidth: tooltipEnabled ? 1 : 0,
        padding: tooltipEnabled ? [10, 14] : 0,
        extraCssText: tooltipEnabled
          ? "border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);"
          : "",
        textStyle: {
          color: tooltipEnabled ? textColor : "rgba(0, 0, 0, 0)",
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
        textStyle: { color: textColor, fontSize: 12 },
        top: 5,
        type: "scroll",
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 12,
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
          height: 22,
          bottom: 8,
          handleSize: "80%",
          textStyle: { color: mutedColor, fontSize: 10 },
          borderColor: "transparent",
          backgroundColor: isDarkMode ? "rgba(148, 163, 184, 0.08)" : "rgba(100, 116, 139, 0.06)",
          fillerColor: isDarkMode ? "rgba(99, 102, 241, 0.22)" : "rgba(99, 102, 241, 0.15)",
          handleStyle: {
            color: "#6366f1",
            borderColor: "#6366f1",
          },
        },
      ],
    }
  }, [chartData, selectedColumns, isDarkMode, tooltipEnabled, decimationEnabled])

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-background rounded-xl border shadow-2xl w-[96vw] h-[96vh] p-4 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-3">
          <div>
            <h2 className="text-lg font-bold">{initialState.sourceChartTitle} — Full Screen</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {chartData.length.toLocaleString()} of {data.length.toLocaleString()} points
              {decimationEnabled && processedData.length < data.length && " · decimated for performance"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {data.length > 1000 && (
              <Button
                size="sm"
                variant={decimationEnabled ? "default" : "outline"}
                onClick={toggleDecimation}
                className="h-7 px-2.5 text-xs"
                title={decimationEnabled ? "Disable decimation (show all data points)" : "Enable decimation (improve performance)"}
              >
                {decimationEnabled ? "Decimated" : "Full Data"}
              </Button>
            )}
            <Button
              size="sm"
              variant={tooltipEnabled ? "default" : "outline"}
              onClick={() => setTooltipEnabled(!tooltipEnabled)}
              className="h-7 px-2.5 text-xs"
              title={tooltipEnabled ? "Disable tooltip" : "Enable tooltip"}
            >
              Tooltip
            </Button>
            <Button size="sm" variant="outline" onClick={onClose} className="h-7 w-7 p-0" title="Close (Esc)">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Chart */}
        <div className="flex-1 min-h-0">
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
          <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-900 rounded border dark:border-gray-700">
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

          {/* Compact grouped column selector */}
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3 xl:grid-cols-6">
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

  // Custom wheel event handler for SHIFT+scroll panning
  useEffect(() => {
    if (!chartRef.current) return

    const chartInstance = chartRef.current.getEchartsInstance()
    const chartDom = chartInstance.getDom()

    const handleWheel = (e: WheelEvent) => {
      // Only intercept when SHIFT is pressed - otherwise let eCharts handle it
      if (!e.shiftKey) return

      // SHIFT is pressed - get fresh instance from ref
      if (!chartRef.current) return

      const freshInstance = chartRef.current.getEchartsInstance()
      const option = freshInstance.getOption()

      if (!option || typeof option !== 'object') return

      const dataZoomArray = (option as { dataZoom?: Array<{ start?: number; end?: number }> }).dataZoom

      if (!dataZoomArray || !Array.isArray(dataZoomArray) || dataZoomArray.length === 0) return

      const dataZoom = dataZoomArray[0]
      const currentStart = dataZoom.start ?? 0
      const currentEnd = dataZoom.end ?? 100
      const range = currentEnd - currentStart

      // Prevent default and handle panning
      e.preventDefault()
      e.stopPropagation()

      // Horizontal pan when SHIFT is held
      const panAmount = (e.deltaY / 100) * range * 0.3 // Adjust sensitivity

      let newStart = currentStart + panAmount
      let newEnd = currentEnd + panAmount

      // Clamp to valid range [0, 100]
      if (newStart < 0) {
        newStart = 0
        newEnd = range
      }
      if (newEnd > 100) {
        newEnd = 100
        newStart = 100 - range
      }

      freshInstance.dispatchAction({
        type: 'dataZoom',
        dataZoomIndex: 0,
        start: newStart,
        end: newEnd,
      })
    }

    chartDom.addEventListener('wheel', handleWheel, { passive: false, capture: true })

    return () => {
      chartDom.removeEventListener('wheel', handleWheel, { capture: true })
    }
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
    const textColor = isDarkMode ? "#d1d5db" : "#4b5563"
    const mutedColor = isDarkMode ? "#6b7280" : "#9ca3af"
    const gridColor = isDarkMode ? "rgba(148, 163, 184, 0.16)" : "rgba(100, 116, 139, 0.16)"

    // Series follow availableColumns order so colors stay stable per column
    const series = availableColumns.filter((col) => selectedColumns.has(col)).map((column) => ({
      name: getDisplayName(column),
      type: "line" as const,
      data: chartData.map((point) => (point as Record<string, unknown>)[column] as number | null),
      smooth: false,
      symbol: "none",
      lineStyle: { width: 1.8, color: seriesColor(column, availableColumns) },
      itemStyle: { color: seriesColor(column, availableColumns) },
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
      textStyle: { color: textColor, fontFamily: "var(--font-geist-sans), sans-serif" },
      grid: {
        left: 56,
        right: 20,
        bottom: 74,
        top: 16,
      },
      xAxis: {
        type: "category",
        data: chartData.map((point) => point.timestamp),
        axisLabel: {
          color: mutedColor,
          fontSize: 11,
          rotate: -45,
          hideOverlap: true,
          interval: Math.max(0, Math.ceil(chartData.length / 8)),
        },
        axisTick: { show: false },
        axisLine: { show: true, lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: "value",
        scale: true, // Enable autoscaling to fit visible data range
        axisLabel: { color: mutedColor, fontSize: 11 },
        axisLine: { show: false },
        splitLine: { lineStyle: { color: gridColor, type: "dashed" as const } },
      },
      series,
      axisPointer: {
        show: true,
        triggerOn: "mousemove",
        type: "cross",
        snap: true,
        label: {
          show: true,
          backgroundColor: isDarkMode ? "#27272a" : "#3f3f46",
          color: "#ffffff",
          borderColor: "transparent",
          borderWidth: 0,
          padding: [4, 8],
          fontSize: 11,
          fontWeight: "bold",
          borderRadius: 4,
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
          ? (isDarkMode ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.95)")
          : "rgba(0, 0, 0, 0)",
        borderColor: tooltipEnabled
          ? (isDarkMode ? "rgba(148, 163, 184, 0.25)" : "rgba(100, 116, 139, 0.2)")
          : "rgba(0, 0, 0, 0)",
        borderWidth: tooltipEnabled ? 1 : 0,
        padding: tooltipEnabled ? [10, 14] : 0,
        extraCssText: tooltipEnabled
          ? "border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);"
          : "",
        textStyle: {
          color: tooltipEnabled ? textColor : "rgba(0, 0, 0, 0)",
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
      // Column chips below the title carry the color key; a legend would duplicate it
      legend: { show: false },
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
          height: 22,
          bottom: 8,
          handleSize: "80%",
          textStyle: { color: mutedColor, fontSize: 10 },
          borderColor: "transparent",
          backgroundColor: isDarkMode ? "rgba(148, 163, 184, 0.08)" : "rgba(100, 116, 139, 0.06)",
          fillerColor: isDarkMode ? "rgba(99, 102, 241, 0.22)" : "rgba(99, 102, 241, 0.15)",
          handleStyle: {
            color: "#6366f1",
            borderColor: "#6366f1",
          },
        },
      ],
    }
  }, [chartData, selectedColumns, availableColumns, isDarkMode, tooltipEnabled, decimationEnabled])

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="gap-2 px-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <CardTitle className="text-base">{title}</CardTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {chartData.length.toLocaleString()} of {data.length.toLocaleString()} points
              {decimationEnabled && processedData.length < data.length && " · decimated for performance"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {data.length > 1000 && (
              <Button
                size="sm"
                variant={decimationEnabled ? "default" : "outline"}
                onClick={toggleDecimation}
                className="h-7 px-2.5 text-xs"
                title={decimationEnabled ? "Disable decimation (show all data points)" : "Enable decimation (improve performance)"}
              >
                {decimationEnabled ? "Decimated" : "Full Data"}
              </Button>
            )}
            <Button
              size="sm"
              variant={tooltipEnabled ? "default" : "outline"}
              onClick={() => setTooltipEnabled(!tooltipEnabled)}
              className="h-7 px-2.5 text-xs"
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
                className="h-7 w-7 p-0"
                title="Open in full screen"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {availableColumns.map(column => {
            const isSelected = selectedColumns.has(column)
            const color = seriesColor(column, availableColumns)
            return (
              <button
                key={column}
                type="button"
                onClick={() => toggleColumn(column)}
                aria-pressed={isSelected}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  isSelected
                    ? "text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                style={isSelected ? { backgroundColor: `${color}1f`, borderColor: `${color}80` } : undefined}
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: color, opacity: isSelected ? 1 : 0.35 }}
                />
                {getDisplayName(column)}
              </button>
            )
          })}
          <div className="mx-1 h-4 w-px bg-border" />
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
              className="h-7 rounded-full px-3 text-xs"
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
              className="h-7 rounded-full px-3 text-xs"
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
              className="h-7 rounded-full px-3 text-xs"
            >
              IPV
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:px-4">
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId]) // Only refetch when testId changes, not when cache functions change

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
          <div className="grid grid-cols-[1fr_360px] 4xl:grid-cols-[1fr_400px] 5xl:grid-cols-[1fr_480px] gap-6 4xl:gap-8 5xl:gap-12">
            {/* Charts Column */}
            <div className="min-w-0 space-y-6 4xl:space-y-8 5xl:space-y-10">
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
  const durationMs = new Date(testData.end_time).getTime() - new Date(testData.start_time).getTime()
  const durationLabel = Number.isFinite(durationMs) && durationMs > 0
    ? `${Math.floor(durationMs / 3600000)}h ${Math.floor((durationMs % 3600000) / 60000)}m`
    : '—'
  const totalPoints = testData._metadata?.total_points ?? testData.data_points.length

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
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          {/* Test Information */}
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-2xl 4xl:text-3xl 5xl:text-4xl font-bold tracking-tight">
                <span className="font-medium text-muted-foreground">S/N</span>{" "}
                {testData.serial_number}
              </h1>
              <Badge
                variant={
                  testData.overall_status === 'PASS' ? 'default' :
                    testData.overall_status === 'FAIL' ? 'destructive' :
                      'secondary'
                }
                className={
                  testData.overall_status === 'PASS'
                    ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950'
                    : undefined
                }
              >
                {testData.overall_status}
              </Badge>
              <Select
                value={testData.overall_status}
                onValueChange={updateTestStatus}
                disabled={updatingStatus}
              >
                <SelectTrigger size="sm" className="w-28">
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
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <MetaItem label="Test" value={`#${testData.test_id}`} />
              <MetaItem label="Firmware" value={testData.firmware_version || '—'} />
              <MetaItem label="Started" value={startDate} />
              <MetaItem label="Ended" value={endDate} />
              <MetaItem label="Duration" value={durationLabel} />
              <MetaItem label="Data points" value={totalPoints.toLocaleString()} />
            </dl>
            {testData.failure_description && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">{testData.failure_description}</span>
              </div>
            )}
          </div>

          {/* Failed-test navigation + annotations toggle */}
          <div className="flex items-center gap-2">
            <FailedTestNavigation testData={testData} onNavigate={navigateToTest} />
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

        {/* No key here: remounting would destroy the ECharts instances (blank
            redraw, lost zoom) and refetch annotations. The column collapse is
            animated instead; charts follow along via their container resize
            observer. */}
        <div
          className={`grid transition-[grid-template-columns,gap] duration-300 ease-in-out ${
            sidebarVisible
              ? 'gap-6 4xl:gap-8 5xl:gap-12 grid-cols-[1fr_360px] 4xl:grid-cols-[1fr_400px] 5xl:grid-cols-[1fr_480px]'
              : 'gap-0 grid-cols-[1fr_0px] 4xl:grid-cols-[1fr_0px] 5xl:grid-cols-[1fr_0px]'
          }`}
        >
          {/* Charts Column */}
          <div className="min-w-0 space-y-6 4xl:space-y-8 5xl:space-y-10">
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

          {/* Annotations Sidebar — stays mounted while hidden so reopening is
              instant (no refetch) and the column width can animate closed */}
          <div
            aria-hidden={!sidebarVisible}
            className={`sticky top-6 h-fit min-w-0 overflow-hidden transition-opacity duration-300 ${
              sidebarVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <div className="w-[360px] 4xl:w-[400px] 5xl:w-[480px]">
              <TestAnnotations
                testId={testData.test_id}
                serialNumber={testData.serial_number}
                startTime={testData.start_time}
              />
            </div>
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