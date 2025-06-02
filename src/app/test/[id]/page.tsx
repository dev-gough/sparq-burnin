"use client"

import { useParams } from "next/navigation"
import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

interface TestData {
  test_id: number
  inv_id: number
  firmware_version: string
  start_time: string
  end_time: string
  overall_status: string
  failure_description?: string
  data_points: DataPoint[]
}

interface DataPoint {
  timestamp: string
  Vpv1?: number
  Ppv1?: number
  Vpv2?: number
  Ppv2?: number
  Vpv3?: number
  Ppv3?: number
  Vpv4?: number
  Ppv4?: number
  frequency?: number
  Vgrid?: number
  Pgrid?: number
  Qgrid?: number
  Vbus?: number
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
}

const pvColumns = ["Vpv1", "Ppv1", "Vpv2", "Ppv2", "Vpv3", "Ppv3", "Vpv4", "Ppv4", "frequency"]
const gridColumns = ["Vgrid", "Pgrid", "Qgrid", "Vbus"]
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

  const toggleColumn = (column: string) => {
    const newSelected = new Set(selectedColumns)
    if (newSelected.has(column)) {
      newSelected.delete(column)
    } else {
      newSelected.add(column)
    }
    setSelectedColumns(newSelected)
  }

  const chartData = data.map(point => ({
    timestamp: new Date(point.timestamp).toLocaleTimeString(),
    ...Object.fromEntries(
      Array.from(selectedColumns).map(col => [col, point[col as keyof DataPoint]])
    )
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
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
                interval={Math.ceil(chartData.length / 6)}
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>
      </div>

      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold">Inverter {testData.inv_id}</h1>
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