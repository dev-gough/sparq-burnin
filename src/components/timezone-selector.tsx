"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTimezone, timezoneOptions } from "@/contexts/TimezoneContext"
import { Clock } from "lucide-react"

export function TimezoneSelector() {
  const { selectedTimezone, setTimezone } = useTimezone()

  return (
    <Select value={selectedTimezone} onValueChange={setTimezone}>
      <SelectTrigger className="w-48">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <SelectValue />
        </div>
      </SelectTrigger>
      <SelectContent>
        {timezoneOptions.map(tz => (
          <SelectItem key={tz.value} value={tz.value}>
            <div className="flex flex-col">
              <div className="font-medium">{tz.label}</div>
              <div className="text-xs text-muted-foreground">{tz.description}</div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}