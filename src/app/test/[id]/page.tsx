"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ArrowLeft, ZoomIn, ZoomOut, RotateCcw, Download } from "lucide-react"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

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

const pvColumns = ["vpv1", "ppv1", "vpv2", "ppv2", "vpv3", "ppv3", "vpv4", "ppv4", "frequency"]
const gridColumns = ["vgrid", "pgrid", "qgrid", "vbus"]
const latchColumns = [
  "vgrid_inst_latch", "vntrl_inst_latch", "igrid_inst_latch", "vbus_inst_latch",
  "vpv1_inst_latch", "ipv1_inst_latch", "vpv2_inst_latch", "ipv2_inst_latch", 
  "vpv3_inst_latch", "ipv3_inst_latch", "vpv4_inst_latch", "ipv4_inst_latch"
]

const colors = [
  "#8884d8", "#82ca9d", "#ffc658", "#ff7300", "#8dd1e1", 
  "#d084d0", "#82d982", "#ffb347", "#87ceeb", "#dda0dd"
]

function ConfigurableChart({ 
  title, 
  data, 
  availableColumns 
}: { 
  title: string
  data: DataPoint[]
  availableColumns: string[]
}) {
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    new Set(availableColumns.slice(0, 3))
  )
  // Zoom controls
  const [zoomStart, setZoomStart] = useState(0)
  const [zoomEnd, setZoomEnd] = useState(100)
  const [zoomLevel, setZoomLevel] = useState(1)

  const toggleColumn = (column: string) => {
    const newSelected = new Set(selectedColumns)
    if (newSelected.has(column)) {
      newSelected.delete(column)
    } else {
      newSelected.add(column)
    }
    setSelectedColumns(newSelected)
  }

  // Calculate zoom range
  const totalPoints = data.length
  const startIndex = Math.floor((zoomStart / 100) * totalPoints)
  const endIndex = Math.ceil((zoomEnd / 100) * totalPoints)
  const zoomedData = data.slice(startIndex, endIndex)

  const chartData = zoomedData.map((point, index) => ({
    timestamp: new Date(point.timestamp).toLocaleTimeString(),
    originalIndex: startIndex + index,
    ...Object.fromEntries(
      Array.from(selectedColumns).map(col => [col, point[col as keyof DataPoint]])
    )
  }))

  const zoomIn = () => {
    const currentRange = zoomEnd - zoomStart
    const newRange = Math.max(currentRange * 0.5, 5) // Minimum 5% range
    const newEnd = Math.min(100, zoomStart + newRange)
    setZoomEnd(newEnd)
    setZoomLevel(zoomLevel * 2)
  }

  const zoomOut = () => {
    const currentRange = zoomEnd - zoomStart
    const newRange = Math.min(currentRange * 2, 100)
    const newEnd = Math.min(100, zoomStart + newRange)
    setZoomEnd(newEnd)
    setZoomLevel(Math.max(zoomLevel * 0.5, 1))
  }

  const resetZoom = () => {
    setZoomStart(0)
    setZoomEnd(100)
    setZoomLevel(1)
  }

  const panLeft = () => {
    const currentRange = zoomEnd - zoomStart
    const panAmount = currentRange * 0.1
    if (zoomStart - panAmount >= 0) {
      setZoomStart(zoomStart - panAmount)
      setZoomEnd(zoomEnd - panAmount)
    }
  }

  const panRight = () => {
    const currentRange = zoomEnd - zoomStart
    const panAmount = currentRange * 0.1
    if (zoomEnd + panAmount <= 100) {
      setZoomStart(zoomStart + panAmount)
      setZoomEnd(zoomEnd + panAmount)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <CardTitle>{title}</CardTitle>
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
                {column}
              </label>
            </div>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
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
              <Tooltip 
                formatter={(value: string | number, name: string) => [
                  typeof value === 'number' ? Number(value).toFixed(3) : value,
                  name
                ]}
                labelFormatter={(label) => `Time: ${label}`}
              />
              <Legend />
              {Array.from(selectedColumns).map((column, index) => (
                <Line
                  key={column}
                  type="monotone"
                  dataKey={column}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2}
                  dot={false}
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
  const testId = params.id as string
  const [testData, setTestData] = useState<TestData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchTestData = async () => {
      try {
        const response = await fetch(`/api/test/${testId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch test data')
        }
        const data = await response.json()
        setTestData(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    if (testId) {
      fetchTestData()
    }
  }, [testId])

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

  const startDate = new Date(testData.start_time).toLocaleString()

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
    <div className="container mx-auto p-6 space-y-6">
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
        <div>
          <h1 className="text-3xl font-bold">Inverter S/N: {testData.serial_number}</h1>
          <h2 className="text-xl text-muted-foreground">Test {testData.test_id}</h2>
          <p className="text-lg text-muted-foreground">{startDate}</p>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant={testData.overall_status === 'PASS' ? 'default' : 'destructive'}>
              {testData.overall_status}
            </Badge>
            {testData.failure_description && (
              <span className="text-sm text-muted-foreground">
                {testData.failure_description}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-6">
          <ConfigurableChart
            title="PV Data & Frequency"
            data={testData.data_points}
            availableColumns={pvColumns}
          />

          <ConfigurableChart
            title="Grid Data"
            data={testData.data_points}
            availableColumns={gridColumns}
          />

          <ConfigurableChart
            title="Latch Data"
            data={testData.data_points}
            availableColumns={latchColumns}
          />
        </div>
      </div>
    </div>
  )
}