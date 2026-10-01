import * as React from "react";
import { IconChartBarOff } from "@tabler/icons-react";
import type { FailureChartEmptyState } from "@/lib/failure-chart-state";

/** Empty charts use HTML rather than ECharts graphics, so labels cannot linger. */
export function FailureChartPanel({ title, emptyState, children }: {
  title: string;
  emptyState: FailureChartEmptyState | null;
  children?: React.ReactNode;
}) {
  if (!emptyState) return children;
  return (
    <div className="flex h-[400px] flex-col">
      <h3 className="text-center text-lg font-semibold">{title}</h3>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center" role="status">
        <div className="flex size-12 items-center justify-center rounded-xl border bg-muted/40">
          <IconChartBarOff className="size-6 text-muted-foreground" stroke={1.5} aria-hidden />
        </div>
        <p className="text-sm font-medium">{emptyState.heading}</p>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{emptyState.description}</p>
      </div>
    </div>
  );
}
