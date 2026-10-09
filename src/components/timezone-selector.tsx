"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useTimezone, timezoneOptions } from "@/contexts/TimezoneContext"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"

export function TimezoneSelector({ compact = false, iconOnly = false, onOpenChange }: { compact?: boolean; iconOnly?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { selectedTimezone, setTimezone } = useTimezone()
  const selectedLabel = timezoneOptions.find(tz => tz.value === selectedTimezone)?.label

  return (
    <Select value={selectedTimezone} onValueChange={setTimezone} onOpenChange={onOpenChange}>
      <SelectTrigger
        className={cn("[&>svg]:hidden", iconOnly ? "timezone-icon justify-center rounded-full border-0 bg-transparent p-0 shadow-none dark:bg-transparent" : "w-48")}
        aria-label={iconOnly ? `Display timezone: ${selectedLabel}` : undefined}
        title={iconOnly ? `Display timezone: ${selectedLabel}` : undefined}
      >
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {iconOnly ? (
            <span className="sr-only"><SelectValue>{selectedLabel}</SelectValue></span>
          ) : (
            <SelectValue>{compact ? selectedLabel : undefined}</SelectValue>
          )}
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
