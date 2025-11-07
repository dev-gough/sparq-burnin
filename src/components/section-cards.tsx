"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SummaryStats {
  total: number;
  passed: number;
  failed: number;
  failureRate: number;
}

interface SectionCardsProps {
  chartMode: string;
  timeRange: string;
  annotationFilter: string;
  dateFrom: string;
  dateTo: string;
}

export function SectionCards({ chartMode, timeRange, annotationFilter, dateFrom, dateTo }: SectionCardsProps) {
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const params = new URLSearchParams({
          view: "summary",
          chartMode,
          timeRange,
          annotation: annotationFilter,
        });
        if (dateFrom) params.append('dateFrom', dateFrom);
        if (dateTo) params.append('dateTo', dateTo);

        const response = await fetch(`/api/test-stats?${params}`);
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error("Failed to fetch stats:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [chartMode, timeRange, annotationFilter, dateFrom, dateTo]);

  if (loading) {
    return (
      <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 4xl:gap-6 5xl:gap-8 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="@container/card">
            <CardHeader>
              <CardDescription>Loading...</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                -
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-2 gap-4 4xl:gap-6 5xl:gap-8 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs md:grid-cols-4">
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>
            {chartMode === "recent" ? "Unique Inverters" : "Total Tests"}
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats?.total ?? 0}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>
            Passed {chartMode === "recent" ? "(Most Recent)" : ""}
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats?.passed ?? 0}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>
            Failed {chartMode === "recent" ? "(Most Recent)" : ""}
          </CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats?.failed ?? 0}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Failure Rate</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {stats?.failureRate ?? 0}%
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}
