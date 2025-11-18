"use client";

import * as React from "react";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { AlertCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";

interface UnannotatedTest {
  test_id: number;
  serial_number: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  firmware_version: string;
  overall_status: string;
  failure_description: string;
}

interface TodoData {
  tests: UnannotatedTest[];
  total_count: number;
}

export default function TodoPage() {
  const router = useRouter();
  const [data, setData] = React.useState<TodoData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [sortField, setSortField] = React.useState<keyof UnannotatedTest>("start_time");
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("desc");

  // Filter states
  const [searchSerial, setSearchSerial] = React.useState("");
  const [filterFirmware, setFilterFirmware] = React.useState("all");
  const [filterDateFrom, setFilterDateFrom] = React.useState("");
  const [filterDateTo, setFilterDateTo] = React.useState("");

  React.useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch("/api/todo");
        const result = await response.json();
        setData(result);
      } catch (error) {
        console.error("Error fetching todo data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const handleSort = (field: keyof UnannotatedTest) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  // Get unique firmware versions for filter
  const firmwareVersions = React.useMemo(() => {
    if (!data?.tests) return [];
    const versions = new Set(data.tests.map(t => t.firmware_version));
    return Array.from(versions).sort();
  }, [data?.tests]);

  // Filter and sort tests
  const filteredAndSortedTests = React.useMemo(() => {
    if (!data?.tests) return [];

    let filtered = [...data.tests];

    // Apply search filter with wildcard support
    if (searchSerial) {
      // Convert wildcard pattern to regex
      const pattern = searchSerial
        .toLowerCase()
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
        .replace(/\*/g, '.*'); // Replace * with .*
      const regex = new RegExp(pattern);

      filtered = filtered.filter(test =>
        regex.test(test.serial_number.toLowerCase())
      );
    }

    // Apply firmware filter
    if (filterFirmware !== "all") {
      filtered = filtered.filter(test => test.firmware_version === filterFirmware);
    }

    // Apply date range filter
    if (filterDateFrom) {
      const fromDate = new Date(filterDateFrom);
      filtered = filtered.filter(test => new Date(test.start_time) >= fromDate);
    }
    if (filterDateTo) {
      const toDate = new Date(filterDateTo);
      toDate.setHours(23, 59, 59, 999); // End of day
      filtered = filtered.filter(test => new Date(test.start_time) <= toDate);
    }

    // Sort
    return filtered.sort((a, b) => {
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
  }, [data?.tests, sortField, sortDirection, searchSerial, filterFirmware, filterDateFrom, filterDateTo]);

  const hasActiveFilters = searchSerial || filterFirmware !== "all" || filterDateFrom || filterDateTo;

  const clearFilters = () => {
    setSearchSerial("");
    setFilterFirmware("all");
    setFilterDateFrom("");
    setFilterDateTo("");
  };

  if (loading) {
    return (
      <div className="ml-10">
        <SiteHeader title="Todo - Unannotated Tests" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 4xl:gap-8 5xl:gap-10 mx-auto w-full px-4 lg:px-6 4xl:px-8 5xl:px-12">
              {/* Skeleton for header */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="h-8 w-64 bg-muted animate-pulse rounded mb-2" />
                  <div className="h-4 w-96 bg-muted animate-pulse rounded" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-5 w-5 bg-muted animate-pulse rounded" />
                  <div className="h-8 w-12 bg-muted animate-pulse rounded" />
                  <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                </div>
              </div>

              {/* Skeleton for table */}
              <Card>
                <CardHeader>
                  <div className="h-6 w-48 bg-muted animate-pulse rounded mb-2" />
                  <div className="h-4 w-96 bg-muted animate-pulse rounded" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[...Array(10)].map((_, i) => (
                      <div key={i} className="h-16 bg-muted animate-pulse rounded" />
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
            <p className="text-destructive">Failed to load todo data</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-10">
      <SiteHeader title="Todo - Unannotated Tests" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 4xl:gap-8 5xl:gap-10 mx-auto w-full px-4 lg:px-6 4xl:px-8 5xl:px-12">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Todo - Unannotated Failed Tests</h1>
                <p className="text-muted-foreground mt-1">
                  Failed tests that need annotations to help track and resolve issues
                </p>
              </div>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-orange-500" />
                <span className="text-2xl font-bold">{filteredAndSortedTests.length}</span>
                <span className="text-muted-foreground dark:text-gray-300">
                  {hasActiveFilters ? "filtered" : "tests need annotation"}
                </span>
              </div>
            </div>

            {/* Filters */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Filters</CardTitle>
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      <X className="h-4 w-4 mr-1" />
                      Clear filters
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Search Serial Number</label>
                    <Input
                      placeholder="e.g. 19*265 or 1908254*"
                      value={searchSerial}
                      onChange={(e) => setSearchSerial(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Use * as wildcard</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Firmware Version</label>
                    <Select value={filterFirmware} onValueChange={setFilterFirmware}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All versions</SelectItem>
                        {firmwareVersions.map((version) => (
                          <SelectItem key={version} value={version}>
                            {version}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Date From</label>
                    <Input
                      type="date"
                      value={filterDateFrom}
                      onChange={(e) => setFilterDateFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Date To</label>
                    <Input
                      type="date"
                      value={filterDateTo}
                      onChange={(e) => setFilterDateTo(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {data.total_count === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <div className="text-6xl mb-4">🎉</div>
                  <h3 className="text-xl font-semibold mb-2">All caught up!</h3>
                  <p className="text-muted-foreground">
                    All failed tests have been annotated. Great work!
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Unannotated Failed Tests</CardTitle>
                  <CardDescription>
                    Click on a test ID to view details and add annotations
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th
                            className="text-left p-2 cursor-pointer hover:bg-muted"
                            onClick={() => handleSort("test_id")}
                          >
                            Test ID
                            {sortField === "test_id" && (
                              <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                            )}
                          </th>
                          <th
                            className="text-left p-2 cursor-pointer hover:bg-muted"
                            onClick={() => handleSort("serial_number")}
                          >
                            Serial Number
                            {sortField === "serial_number" && (
                              <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                            )}
                          </th>
                          <th
                            className="text-left p-2 cursor-pointer hover:bg-muted"
                            onClick={() => handleSort("start_time")}
                          >
                            Start Time
                            {sortField === "start_time" && (
                              <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                            )}
                          </th>
                          <th
                            className="text-right p-2 cursor-pointer hover:bg-muted"
                            onClick={() => handleSort("duration_hours")}
                          >
                            Duration (hrs)
                            {sortField === "duration_hours" && (
                              <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                            )}
                          </th>
                          <th
                            className="text-left p-2 cursor-pointer hover:bg-muted"
                            onClick={() => handleSort("firmware_version")}
                          >
                            Firmware
                            {sortField === "firmware_version" && (
                              <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>
                            )}
                          </th>
                          <th className="text-left p-2">Failure Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAndSortedTests.map((test) => (
                          <tr
                            key={test.test_id}
                            className="border-b hover:bg-muted/50 cursor-pointer"
                            onClick={() => router.push(`/test/${test.test_id}`)}
                          >
                            <td className="p-2 font-mono font-medium">{test.test_id}</td>
                            <td className="p-2">{test.serial_number}</td>
                            <td className="p-2">
                              {new Date(test.start_time).toLocaleString()}
                            </td>
                            <td className="p-2 text-right">
                              {test.duration_hours.toFixed(2)}
                            </td>
                            <td className="p-2 font-mono text-xs">{test.firmware_version}</td>
                            <td className="p-2 text-muted-foreground max-w-xs truncate">
                              {test.failure_description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
