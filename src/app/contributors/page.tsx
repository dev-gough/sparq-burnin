"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import ReactECharts from "echarts-for-react";
import { Users, FileText, Target, TrendingUp, Calendar, Award } from "lucide-react";
import Link from "next/link";

interface ContributorStats {
  contributor_name: string;
  total_annotations: number;
  unique_tests_annotated: number;
  percentage_of_tests: number;
  last_activity: string;
  most_used_group: string;
  annotation_groups: {
    group_name: string;
    count: number;
    group_color: string | null;
    categories: { category_name: string; count: number }[];
  }[];
}

interface TeamStats {
  total_annotations: number;
  total_annotated_tests: number;
  total_failed_tests: number;
  coverage_percentage: number;
  active_contributors_week: number;
  active_contributors_month: number;
}

interface ActivityData {
  date: string;
  contributor_name: string;
  annotation_count: number;
}

interface ContributorData {
  contributors: ContributorStats[];
  teamStats: TeamStats;
  activity: ActivityData[];
}

export default function ContributorsPage() {
  const { resolvedTheme } = useTheme();
  const [data, setData] = React.useState<ContributorData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [sortField, setSortField] = React.useState<keyof ContributorStats>("total_annotations");
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("desc");
  const [expandedCharts, setExpandedCharts] = React.useState<Record<string, string | null>>({});

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("/api/contributors");
        const result = await response.json();
        setData(result);
      } catch (error) {
        console.error("Error fetching contributor data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSort = (field: keyof ContributorStats) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const sortedContributors = React.useMemo(() => {
    if (!data?.contributors) return [];

    return [...data.contributors].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      return 0;
    });
  }, [data?.contributors, sortField, sortDirection]);

  // Prepare activity chart data
  const activityChartOption = React.useMemo(() => {
    if (!data?.activity) return {};

    // Group by date and sum all contributors
    const dateMap: Record<string, number> = {};
    data.activity.forEach((item) => {
      if (!dateMap[item.date]) {
        dateMap[item.date] = 0;
      }
      dateMap[item.date] += item.annotation_count;
    });

    const dates = Object.keys(dateMap).sort();
    const counts = dates.map((date) => dateMap[date]);

    return {
      title: {
        text: "Annotation Activity (Last 30 Days)",
        left: "center",
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow",
        },
        backgroundColor: resolvedTheme === "dark" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
        borderColor: resolvedTheme === "dark" ? "#4b5563" : "#e5e7eb",
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: {
          rotate: 45,
        },
      },
      yAxis: {
        type: "value",
        name: "Annotations",
      },
      series: [
        {
          name: "Annotations",
          type: "bar",
          data: counts,
          itemStyle: {
            color: "#3b82f6",
          },
        },
      ],
      grid: {
        left: "3%",
        right: "4%",
        bottom: "15%",
        containLabel: true,
      },
    };
  }, [data?.activity, resolvedTheme]);

  if (loading) {
    return (
      <div className="ml-10">
        <SiteHeader title="Annotation Contributors" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 4xl:gap-8 5xl:gap-10 mx-auto w-full px-4 lg:px-6 4xl:px-8 5xl:px-12">
              <div className="h-8 w-48 bg-muted animate-pulse rounded" />

              {/* Skeleton for summary cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {[...Array(6)].map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                      <div className="h-4 w-4 bg-muted animate-pulse rounded" />
                    </CardHeader>
                    <CardContent>
                      <div className="h-8 w-16 bg-muted animate-pulse rounded mb-2" />
                      <div className="h-3 w-20 bg-muted animate-pulse rounded" />
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Skeleton for activity chart */}
              <Card>
                <CardHeader>
                  <div className="h-6 w-48 bg-muted animate-pulse rounded mb-2" />
                  <div className="h-4 w-64 bg-muted animate-pulse rounded" />
                </CardHeader>
                <CardContent>
                  <div className="h-[300px] bg-muted animate-pulse rounded" />
                </CardContent>
              </Card>

              {/* Skeleton for table */}
              <Card>
                <CardHeader>
                  <div className="h-6 w-48 bg-muted animate-pulse rounded mb-2" />
                  <div className="h-4 w-96 bg-muted animate-pulse rounded" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-12 bg-muted animate-pulse rounded" />
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <SiteHeader />
        <div className="flex flex-1 flex-col ml-10">
          <div className="flex items-center justify-center h-96">
            <p className="text-destructive">Failed to load contributor data</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-10">
      <SiteHeader title="Annotation Contributors" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 4xl:gap-8 5xl:gap-10 mx-auto w-full px-4 lg:px-6 4xl:px-8 5xl:px-12">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">Contributors</h1>
            </div>

            {/* Team Summary Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Annotations</CardTitle>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.teamStats.total_annotations}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Annotated Tests</CardTitle>
                  <Target className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.teamStats.total_annotated_tests}</div>
                  <p className="text-xs text-muted-foreground">
                    of {data.teamStats.total_failed_tests} failed tests
                  </p>
                </CardContent>
              </Card>

              <Link href="/todo">
                <Card className="cursor-pointer hover:bg-muted/50 transition-colors relative">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Coverage</CardTitle>
                    <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{data.teamStats.coverage_percentage}%</div>
                    <p className="text-xs text-muted-foreground">
                      {data.teamStats.coverage_percentage >= 100
                        ? "Perfect! All failures annotated! 🎉"
                        : "of failed tests"}
                    </p>
                    <span className="absolute bottom-2 right-2 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-full">
                      {data.teamStats.coverage_percentage >= 100
                        ? "Amazing work! ✨"
                        : "Get to work →"}
                    </span>
                  </CardContent>
                </Card>
              </Link>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active (Week)</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.teamStats.active_contributors_week}</div>
                  <p className="text-xs text-muted-foreground">contributors</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Active (Month)</CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.teamStats.active_contributors_month}</div>
                  <p className="text-xs text-muted-foreground">contributors</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Top Contributor</CardTitle>
                  <Award className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-lg font-bold truncate">
                    {data.contributors[0]?.contributor_name || "N/A"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {data.contributors[0]?.total_annotations || 0} annotations
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Activity Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Annotation Activity Timeline</CardTitle>
                <CardDescription>Daily annotation activity over the last 30 days</CardDescription>
              </CardHeader>
              <CardContent>
                <ReactECharts option={activityChartOption} style={{ height: "300px" }} />
              </CardContent>
            </Card>

            {/* Contributors Table */}
            <Card>
              <CardHeader>
                <CardTitle>Contributor Statistics</CardTitle>
                <CardDescription>
                  Detailed breakdown of annotation contributions by team member
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th
                          className="text-left p-2 cursor-pointer hover:bg-muted"
                          onClick={() => handleSort("contributor_name")}
                        >
                          Contributor
                          {sortField === "contributor_name" && (
                            <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                          )}
                        </th>
                        <th
                          className="text-right p-2 cursor-pointer hover:bg-muted"
                          onClick={() => handleSort("total_annotations")}
                        >
                          Total Annotations
                          {sortField === "total_annotations" && (
                            <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                          )}
                        </th>
                        <th
                          className="text-right p-2 cursor-pointer hover:bg-muted"
                          onClick={() => handleSort("unique_tests_annotated")}
                        >
                          Tests Annotated
                          {sortField === "unique_tests_annotated" && (
                            <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                          )}
                        </th>
                        <th
                          className="text-right p-2 cursor-pointer hover:bg-muted"
                          onClick={() => handleSort("percentage_of_tests")}
                        >
                          % of Total
                          {sortField === "percentage_of_tests" && (
                            <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                          )}
                        </th>
                        <th className="text-left p-2">Most Used Group</th>
                        <th
                          className="text-right p-2 cursor-pointer hover:bg-muted"
                          onClick={() => handleSort("last_activity")}
                        >
                          Last Activity
                          {sortField === "last_activity" && (
                            <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                          )}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedContributors.map((contributor) => (
                        <tr key={contributor.contributor_name} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-medium">{contributor.contributor_name}</td>
                          <td className="p-2 text-right">{contributor.total_annotations}</td>
                          <td className="p-2 text-right">{contributor.unique_tests_annotated}</td>
                          <td className="p-2 text-right">{contributor.percentage_of_tests}%</td>
                          <td className="p-2">{contributor.most_used_group}</td>
                          <td className="p-2 text-right">
                            {new Date(contributor.last_activity).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Annotation Groups Breakdown */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {sortedContributors.slice(0, 4).map((contributor) => {
                const expandedGroup = expandedCharts[contributor.contributor_name];

                // Determine what data to show
                let chartData;
                let showBackButton = false;

                if (expandedGroup) {
                  // Show categories within the expanded group
                  const group = contributor.annotation_groups.find(g => g.group_name === expandedGroup);
                  chartData = group?.categories.map(c => ({
                    name: c.category_name,
                    value: c.count,
                  })) || [];
                  showBackButton = true;
                } else {
                  // Show top-level groups with colors
                  chartData = contributor.annotation_groups.map((g) => ({
                    name: g.group_name,
                    value: g.count,
                    itemStyle: g.group_color ? { color: g.group_color } : undefined,
                  }));
                  showBackButton = false;
                }

                const chartOption = {
                  title: {
                    text: expandedGroup ? expandedGroup : "Annotation Groups",
                    left: "center",
                    textStyle: {
                      fontSize: 14,
                      color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
                    },
                  },
                  tooltip: {
                    trigger: "item",
                    formatter: "{b}: {c} ({d}%)",
                    backgroundColor: resolvedTheme === "dark" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
                    borderColor: resolvedTheme === "dark" ? "#4b5563" : "#e5e7eb",
                    textStyle: {
                      color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
                    },
                  },
                  series: [
                    {
                      type: "pie",
                      radius: "60%",
                      data: chartData,
                      label: {
                        color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
                        fontSize: 12,
                        textShadowColor: "transparent",
                        textShadowBlur: 0,
                      },
                      emphasis: {
                        itemStyle: {
                          shadowBlur: 10,
                          shadowOffsetX: 0,
                          shadowColor: "rgba(0, 0, 0, 0.5)",
                        },
                        label: {
                          show: true,
                          fontSize: 14,
                          fontWeight: "bold",
                        },
                      },
                    },
                  ],
                };

                const handleChartClick = (params: { componentType?: string; name?: string }) => {
                  if (!expandedGroup && params.componentType === 'series' && params.name) {
                    // User clicked on a group slice - expand it
                    setExpandedCharts(prev => ({
                      ...prev,
                      [contributor.contributor_name]: params.name || null,
                    }));
                  }
                };

                const handleBackClick = () => {
                  setExpandedCharts(prev => ({
                    ...prev,
                    [contributor.contributor_name]: null,
                  }));
                };

                return (
                  <Card key={contributor.contributor_name}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">
                            {contributor.contributor_name}&apos;s Annotations
                          </CardTitle>
                          <CardDescription>
                            {contributor.total_annotations} total annotations
                          </CardDescription>
                        </div>
                        {showBackButton && (
                          <button
                            onClick={handleBackClick}
                            className="text-sm text-primary hover:underline"
                          >
                            ← Back to Groups
                          </button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ReactECharts
                        option={chartOption}
                        style={{ height: "250px" }}
                        onEvents={{
                          click: handleChartClick,
                        }}
                      />
                      {!expandedGroup && (
                        <p className="text-xs text-muted-foreground text-center mt-2">
                          Click a slice to view categories
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
