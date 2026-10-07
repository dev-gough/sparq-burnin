"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import Link from "next/link";
import ReactECharts from "echarts-for-react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  CheckCheck,
  FileText,
  RefreshCw,
  Search,
  Target,
  Users,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { burninChartColors, burninSeriesPalette } from "@/lib/chart-theme";
import { cn } from "@/lib/utils";

interface Contributor {
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
interface ContributorData {
  contributors: Contributor[];
  teamStats: {
    total_annotations: number;
    total_annotated_tests: number;
    total_failed_tests: number;
    coverage_percentage: number;
    active_contributors_week: number;
    active_contributors_month: number;
  };
  activity: {
    date: string;
    contributor_name: string;
    annotation_count: number;
  }[];
}
type SortField =
  | "contributor_name"
  | "total_annotations"
  | "unique_tests_annotated"
  | "percentage_of_tests"
  | "last_activity";
const number = (value: number) => value.toLocaleString();
const displayName = (name: string) =>
  name.includes("@")
    ? name
        .split("@")[0]
        .split(/[._-]/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : name;
const initials = (name: string) =>
  displayName(name)
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
const formatDate = (date: string) =>
  new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

function Section({
  index,
  title,
  description,
  children,
}: {
  index: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-card text-[11px] font-medium tabular-nums text-muted-foreground">
          {index}
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <Card className="gap-3 p-4 shadow-none sm:p-5">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span aria-hidden>{icon}</span>
      </div>
      <p
        className={cn(
          "text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl",
          tone,
        )}
      >
        {value}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </Card>
  );
}

export default function ContributorsPage() {
  const { resolvedTheme } = useTheme();
  const [data, setData] = useState<ContributorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [requestEpoch, setRequestEpoch] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("total_annotations");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    async function fetchData() {
      setLoading(true);
      setError(false);
      try {
        const response = await fetch("/api/contributors", {
          signal: abort.signal,
        });
        if (!response.ok) throw new Error("Failed to load contributors");
        const result: ContributorData = await response.json();
        if (!abort.signal.aborted) {
          setData(result);
          setUpdatedAt(new Date());
        }
      } catch (cause) {
        if (!abort.signal.aborted) {
          setError(true);
          console.error("Error fetching contributors:", cause);
        }
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    fetchData();
    return () => abort.abort();
  }, [requestEpoch]);

  const contributors = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...(data?.contributors ?? [])]
      .filter((person) =>
        `${person.contributor_name} ${displayName(person.contributor_name)}`
          .toLowerCase()
          .includes(query),
      )
      .sort((a, b) => {
        const left = a[sortField],
          right = b[sortField];
        const result =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right));
        return sortDirection === "asc" ? result : -result;
      });
  }, [data, search, sortField, sortDirection]);
  const selected =
    data?.contributors.find(
      (person) => person.contributor_name === selectedName,
    ) ?? data?.contributors[0];
  const colors = useMemo(
    () =>
      new Map(
        (data?.contributors ?? []).map((person, index) => [
          person.contributor_name,
          burninSeriesPalette[index % burninSeriesPalette.length],
        ]),
      ),
    [data],
  );
  const dark = resolvedTheme === "dark";
  const text = dark
    ? burninChartColors.text.dark
    : burninChartColors.text.light;
  const muted = dark
    ? burninChartColors.muted.dark
    : burninChartColors.muted.light;
  const grid = dark
    ? burninChartColors.grid.dark
    : burninChartColors.grid.light;
  const activityTotal =
    data?.activity.reduce((sum, row) => sum + row.annotation_count, 0) ?? 0;
  const annotationTotal =
    data?.contributors.reduce(
      (sum, person) => sum + person.total_annotations,
      0,
    ) ?? 0;

  const activityOption = useMemo(() => {
    const byDate = new Map<string, Map<string, number>>();
    for (const row of data?.activity ?? []) {
      if (!byDate.has(row.date)) byDate.set(row.date, new Map());
      const day = byDate.get(row.date)!;
      day.set(
        row.contributor_name,
        (day.get(row.contributor_name) ?? 0) + row.annotation_count,
      );
    }
    // Include quiet days rather than hiding gaps in activity.
    const today = new Date();
    const dates: string[] = [];
    for (
      let day = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - 30,
        ),
      );
      day <= today;
      day = new Date(day.getTime() + 86400000)
    )
      dates.push(day.toISOString().slice(0, 10));
    const names = [
      ...new Set((data?.activity ?? []).map((row) => row.contributor_name)),
    ];
    return {
      animationDurationUpdate: 0,
      grid: {
        left: 16,
        right: 20,
        top: 20,
        bottom: names.length ? 54 : 16,
        containLabel: true,
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "shadow" },
        backgroundColor: dark ? "#18181b" : "#ffffff",
        borderColor: grid,
        textStyle: { color: text },
        padding: [10, 14],
        extraCssText: "border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.15)",
        formatter: (
          points: {
            axisValue: string;
            value: number;
            marker: string;
            seriesName: string;
          }[],
        ) =>
          [
            `<strong>${escapeHtml(points[0]?.axisValue ?? "")}</strong>`,
            ...points
              .filter((point) => point.value > 0)
              .map(
                (point) =>
                  `${point.marker} ${escapeHtml(displayName(point.seriesName))}: <strong>${number(point.value)}</strong>`,
              ),
          ].join("<br/>"),
      },
      legend: {
        type: "scroll",
        bottom: 0,
        left: 16,
        right: 16,
        textStyle: { color: muted, fontSize: 11 },
        formatter: displayName,
        pageTextStyle: { color: muted },
        pageIconColor: muted,
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: muted,
          hideOverlap: true,
          fontSize: 10,
          formatter: (date: string) =>
            new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }),
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        axisLabel: { color: muted, fontSize: 10 },
        splitLine: { lineStyle: { color: grid, type: "dashed" } },
      },
      series: names.map((name) => ({
        name,
        type: "bar",
        stack: "annotations",
        barMaxWidth: 24,
        emphasis: { focus: "series" },
        itemStyle: {
          color: colors.get(name) ?? burninChartColors.accent.indigo,
        },
        data: dates.map((date) => byDate.get(date)?.get(name) ?? 0),
      })),
      graphic: names.length
        ? []
        : [
            {
              type: "text",
              left: "center",
              top: "middle",
              style: {
                text: "No annotation activity in the last 30 days",
                fill: muted,
                fontSize: 12,
              },
            },
          ],
    };
  }, [data, dark, grid, text, muted, colors]);

  function sort(field: SortField) {
    if (field === sortField)
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDirection(field === "contributor_name" ? "asc" : "desc");
    }
  }
  function sortHeading(label: string, field: SortField, alignRight = false) {
    const Icon = sortDirection === "asc" ? ArrowUp : ArrowDown;
    return (
      <th
        scope="col"
        aria-sort={
          sortField === field
            ? sortDirection === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        className={cn("px-4 py-3 font-medium", alignRight && "text-right")}
      >
        <button
          type="button"
          onClick={() => sort(field)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm text-[10px] uppercase tracking-wider hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            sortField === field && "text-foreground",
          )}
        >
          {label}
          {sortField === field && <Icon className="size-3" aria-hidden />}
        </button>
      </th>
    );
  }
  const stats = data?.teamStats;
  const remaining = stats
    ? Math.max(0, stats.total_failed_tests - stats.total_annotated_tests)
    : 0;
  const coverage = Math.min(100, Math.max(0, stats?.coverage_percentage ?? 0));
  const group = selected?.annotation_groups.find(
    (item) => item.group_name === selectedGroup,
  );
  const breakdown = (
    group
      ? group.categories.map((category) => ({
          name: category.category_name,
          count: category.count,
          color: group.group_color,
        }))
      : (selected?.annotation_groups.map((item) => ({
          name: item.group_name,
          count: item.count,
          color: item.group_color,
        })) ?? [])
  ).sort((a, b) => b.count - a.count);
  const maximum = Math.max(1, ...breakdown.map((item) => item.count));

  return (
    <div className="ml-10 flex h-dvh flex-col overflow-hidden">
      <SiteHeader title="Contributors" />
      <div className="flex-1 overflow-y-auto" aria-busy={loading}>
        <div className="mx-auto max-w-[1800px] space-y-6 px-4 py-5 lg:px-6 lg:py-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Annotation insights
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Team contributions
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Failure coverage, recent activity, and each contributor’s
                annotation breakdown.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {updatedAt && (
                <span className="text-xs text-muted-foreground">
                  Updated{" "}
                  {updatedAt.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => setRequestEpoch((epoch) => epoch + 1)}
              >
                <RefreshCw
                  className={cn("size-3.5", loading && "animate-spin")}
                />
                Refresh
              </Button>
            </div>
          </div>
          {error && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm"
            >
              <p>
                {data
                  ? "Couldn’t refresh contributors. Showing the last loaded results."
                  : "Couldn’t load contributors."}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRequestEpoch((epoch) => epoch + 1)}
              >
                Try again
              </Button>
            </div>
          )}
          {loading && !data ? (
            <div className="space-y-6" aria-label="Loading contributors">
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-36 rounded-xl" />
                ))}
              </div>
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <Skeleton className="h-[360px] rounded-xl" />
                <Skeleton className="h-[360px] rounded-xl" />
              </div>
              <Skeleton className="h-96 rounded-xl" />
            </div>
          ) : data && stats ? (
            <div
              className={cn(
                "space-y-7 transition-opacity",
                loading && "pointer-events-none opacity-50",
              )}
            >
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Metric
                  label="Failure coverage"
                  value={
                    stats.total_failed_tests ? `${coverage.toFixed(1)}%` : "—"
                  }
                  detail="Failed tests with at least one annotation"
                  icon={<CheckCheck className="size-4" />}
                  tone="text-emerald-600 dark:text-emerald-400"
                />
                <Metric
                  label="Failures annotated"
                  value={number(stats.total_annotated_tests)}
                  detail={`Of ${number(stats.total_failed_tests)} failed tests · all time`}
                  icon={<Target className="size-4" />}
                />
                <Metric
                  label="Annotations"
                  value={number(annotationTotal)}
                  detail="Across all contributors and linked tests · all time"
                  icon={<FileText className="size-4" />}
                />
                <Metric
                  label="Active this week"
                  value={number(stats.active_contributors_week)}
                  detail={`${number(stats.active_contributors_month)} contributors active in the last 30 days`}
                  icon={<Users className="size-4" />}
                />
              </div>
              <section className="space-y-3">
                <Section
                  index="01"
                  title="Team activity"
                  description="The last 30 days of annotations, alongside all-time failure coverage."
                />
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <Card className="gap-0 overflow-hidden py-0 shadow-none">
                    <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
                      <div>
                        <h3 className="text-sm font-semibold">
                          Annotation activity
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Daily contributions by team member
                        </p>
                      </div>
                      <span className="rounded-md border bg-muted/30 px-2 py-1 text-[11px] tabular-nums text-muted-foreground">
                        {number(activityTotal)} annotations · 30 days
                      </span>
                    </div>
                    <ReactECharts
                      option={activityOption}
                      notMerge
                      style={{ height: 290 }}
                    />
                  </Card>
                  <Card className="justify-between gap-6 p-4 shadow-none sm:p-5">
                    <div>
                      <h3 className="text-sm font-semibold">
                        Failure coverage
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        A test counts once, regardless of how many annotations
                        it has.
                      </p>
                    </div>
                    <div className="flex items-center gap-5">
                      <div className="relative size-28 shrink-0">
                        <svg
                          viewBox="0 0 100 100"
                          className="size-full -rotate-90"
                          aria-hidden
                        >
                          <circle
                            cx="50"
                            cy="50"
                            r="42"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="7"
                            className="text-muted"
                          />
                          <circle
                            cx="50"
                            cy="50"
                            r="42"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="7"
                            strokeLinecap="round"
                            strokeDasharray={`${(coverage / 100) * 264} 264`}
                            className="text-emerald-500"
                          />
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-xl font-semibold tabular-nums">
                          {stats.total_failed_tests
                            ? `${coverage.toFixed(1)}%`
                            : "—"}
                        </span>
                      </div>
                      <div className="space-y-3">
                        <p className="text-xl font-semibold tabular-nums">
                          {number(stats.total_annotated_tests)}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            annotated
                          </span>
                        </p>
                        <p className="text-xl font-semibold tabular-nums">
                          {number(remaining)}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            awaiting review
                          </span>
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      asChild
                      className="w-full justify-between"
                    >
                      <Link href="/todo">
                        {remaining
                          ? "Review unannotated failures"
                          : "Open annotation queue"}
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </Button>
                  </Card>
                </div>
              </section>
              <section className="space-y-3">
                <Section
                  index="02"
                  title="Contributors"
                  description="Select a contributor to explore their groups and annotation categories."
                >
                  <div className="relative w-full sm:w-64">
                    <Search
                      className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      aria-label="Search contributors"
                      placeholder="Search contributors…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="h-9 pl-9 text-xs"
                    />
                  </div>
                </Section>
                <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                  <Card className="gap-0 overflow-hidden py-0 shadow-none">
                    <div className="flex items-center justify-between border-b px-4 py-4 sm:px-5">
                      <h3 className="text-sm font-semibold">
                        Team contributions
                      </h3>
                      <span className="text-xs text-muted-foreground">
                        {number(contributors.length)}{" "}
                        {contributors.length === 1
                          ? "contributor"
                          : "contributors"}
                      </span>
                    </div>
                    <div className="max-h-[520px] overflow-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="sticky top-0 z-10 bg-card text-muted-foreground">
                          <tr>
                            {sortHeading("Contributor", "contributor_name")}
                            {sortHeading(
                              "Annotations",
                              "total_annotations",
                              true,
                            )}
                            {sortHeading(
                              "Tests",
                              "unique_tests_annotated",
                              true,
                            )}
                            {sortHeading(
                              "Share of tests",
                              "percentage_of_tests",
                              true,
                            )}
                            {sortHeading(
                              "Last active · UTC",
                              "last_activity",
                              true,
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {contributors.map((person) => (
                            <tr
                              key={person.contributor_name}
                              className={cn(
                                "border-t transition-colors hover:bg-muted/30",
                                selected?.contributor_name ===
                                  person.contributor_name && "bg-primary/5",
                              )}
                            >
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  aria-pressed={
                                    selected?.contributor_name ===
                                    person.contributor_name
                                  }
                                  onClick={() => {
                                    setSelectedName(person.contributor_name);
                                    setSelectedGroup(null);
                                  }}
                                  className="flex w-full items-center gap-2.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                  <span
                                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-semibold"
                                    style={{
                                      color: colors.get(
                                        person.contributor_name,
                                      ),
                                    }}
                                  >
                                    {initials(person.contributor_name)}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block whitespace-nowrap text-xs font-medium">
                                      {displayName(person.contributor_name)}
                                    </span>
                                    <span
                                      className="block max-w-52 truncate text-[10px] text-muted-foreground"
                                      title={person.contributor_name}
                                    >
                                      {person.contributor_name.includes("@")
                                        ? person.contributor_name
                                        : person.most_used_group}
                                    </span>
                                  </span>
                                </button>
                              </td>
                              <td className="px-4 py-3 text-right text-xs font-semibold tabular-nums">
                                {number(person.total_annotations)}
                              </td>
                              <td className="px-4 py-3 text-right text-xs tabular-nums">
                                {number(person.unique_tests_annotated)}
                              </td>
                              <td className="px-4 py-3 text-right text-xs tabular-nums text-muted-foreground">
                                {person.percentage_of_tests.toFixed(1)}%
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right text-[11px] text-muted-foreground">
                                {formatDate(person.last_activity)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!contributors.length && (
                        <div className="px-5 py-12 text-center text-sm text-muted-foreground">
                          {search.trim()
                            ? "No contributors match your search."
                            : "No contributions yet. Annotations will appear here as the team reviews tests."}
                        </div>
                      )}
                    </div>
                    <p className="border-t px-4 py-3 text-[10px] leading-relaxed text-muted-foreground sm:px-5">
                      Share of tests is based on all annotated tests.
                      Contributors can annotate the same test, so shares may
                      overlap.
                    </p>
                  </Card>
                  <Card className="gap-0 overflow-hidden py-0 shadow-none">
                    {selected ? (
                      <>
                        <div className="border-b p-4 sm:p-5">
                          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            Contributor detail
                          </p>
                          <div className="mt-3 flex items-center gap-3">
                            <span
                              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold"
                              style={{
                                color: colors.get(selected.contributor_name),
                              }}
                            >
                              {initials(selected.contributor_name)}
                            </span>
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-semibold">
                                {displayName(selected.contributor_name)}
                              </h3>
                              <p
                                className="truncate text-xs text-muted-foreground"
                                title={selected.contributor_name}
                              >
                                {selected.contributor_name}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-xl font-semibold tabular-nums">
                                {number(selected.total_annotations)}
                              </p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                Annotations
                              </p>
                            </div>
                            <div>
                              <p className="text-xl font-semibold tabular-nums">
                                {number(selected.unique_tests_annotated)}
                              </p>
                              <p className="mt-1 text-[10px] text-muted-foreground">
                                Unique tests annotated
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4 sm:px-5">
                          <h4 className="min-w-0 break-words text-xs font-semibold">
                            {group ? group.group_name : "Annotation groups"}
                          </h4>
                          {group && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 text-xs"
                              onClick={() => setSelectedGroup(null)}
                            >
                              <ArrowLeft className="size-3" />
                              Groups
                            </Button>
                          )}
                        </div>
                        <div className="max-h-80 overflow-y-auto px-4 pb-4 sm:px-5 sm:pb-5">
                          {breakdown.map((item, index) => {
                            const color =
                              item.color ??
                              burninSeriesPalette[
                                index % burninSeriesPalette.length
                              ];
                            const content = (
                              <>
                                <div className="flex items-start justify-between gap-3">
                                  <span className="flex items-start gap-2 text-xs leading-5">
                                    <span
                                      className="mt-1.5 size-2 shrink-0 rounded-full"
                                      style={{ backgroundColor: color }}
                                      aria-hidden
                                    />
                                    {item.name}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-2 text-xs font-semibold tabular-nums">
                                    {number(item.count)}
                                    {!group && (
                                      <ArrowUpRight
                                        className="size-3 text-muted-foreground"
                                        aria-hidden
                                      />
                                    )}
                                  </span>
                                </div>
                                <div className="ml-4 mt-2 h-1.5 overflow-hidden rounded-full bg-muted/70">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${(item.count / maximum) * 100}%`,
                                      backgroundColor: color,
                                    }}
                                  />
                                </div>
                              </>
                            );
                            return group ? (
                              <div
                                key={item.name}
                                className="border-b py-3 last:border-0"
                              >
                                {content}
                              </div>
                            ) : (
                              <button
                                key={item.name}
                                type="button"
                                onClick={() => setSelectedGroup(item.name)}
                                className="block w-full rounded-md px-1 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {content}
                              </button>
                            );
                          })}
                          {!breakdown.length && (
                            <p className="py-8 text-center text-xs text-muted-foreground">
                              No annotation breakdown available.
                            </p>
                          )}
                          {!group && breakdown.length > 0 && (
                            <p className="mt-3 text-[10px] text-muted-foreground">
                              Select a group to view its categories.
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        Contributor details will appear once annotations have
                        been added.
                      </div>
                    )}
                  </Card>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
