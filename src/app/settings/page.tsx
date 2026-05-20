"use client";

import * as React from "react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSettings } from "@/contexts/settings-context";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun, MousePointer2, Hand, Download, Upload, Loader2 } from "lucide-react";

interface RestoreResult {
  success?: boolean;
  totals?: {
    rows_in_file: number;
    inserted: number;
    skipped_duplicate: number;
    skipped_invalid: number;
    skipped_no_test: number;
    errors: number;
  };
  skipped?: Array<{
    row: number;
    serial_number: string;
    start_time: string;
    annotation_type: string;
    annotation_text: string;
    reason: string;
  }>;
  error?: string;
}

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // Annotation backup/restore state
  const [backupBusy, setBackupBusy] = React.useState(false);
  const [restoreBusy, setRestoreBusy] = React.useState(false);
  const [restoreResult, setRestoreResult] = React.useState<RestoreResult | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleBackup = async () => {
    setBackupBusy(true);
    try {
      const res = await fetch("/api/annotations/backup");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error || `Backup failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] || `testannotations-backup-${new Date().toISOString()}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Backup failed");
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreFile = async (file: File) => {
    if (!confirm(
      `Restore annotations from "${file.name}"?\n\n` +
      "This will INSERT any rows that don't already exist in the database. " +
      "Existing annotations (same serial+start_time+type) will be skipped, not overwritten."
    )) {
      return;
    }
    setRestoreBusy(true);
    setRestoreResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/annotations/restore", {
        method: "POST",
        body: form,
      });
      const body: RestoreResult = await res.json().catch(() => ({ error: "Invalid response" }));
      setRestoreResult(body);
    } catch (err) {
      console.error(err);
      setRestoreResult({ error: "Restore request failed" });
    } finally {
      setRestoreBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="ml-10">
        <SiteHeader title="Settings" />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 4xl:gap-8 5xl:gap-10 mx-auto w-full px-4 lg:px-6 4xl:px-8 5xl:px-12 max-w-4xl">
              <div className="h-8 w-32 bg-muted animate-pulse rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-10">
      <SiteHeader title="Settings" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 4xl:gap-8 5xl:gap-10 mx-auto w-full px-4 lg:px-6 4xl:px-8 5xl:px-12 max-w-4xl">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold">Settings</h1>
            </div>

            {/* Appearance Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>
                  Customize how the application looks and feels
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Theme Setting */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Theme</Label>
                  <RadioGroup value={theme} onValueChange={setTheme}>
                    <div className="flex items-center space-x-3 space-y-0">
                      <RadioGroupItem value="light" id="theme-light" />
                      <Label
                        htmlFor="theme-light"
                        className="font-normal cursor-pointer flex items-center gap-2"
                      >
                        <Sun className="h-4 w-4" />
                        Light
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 space-y-0">
                      <RadioGroupItem value="dark" id="theme-dark" />
                      <Label
                        htmlFor="theme-dark"
                        className="font-normal cursor-pointer flex items-center gap-2"
                      >
                        <Moon className="h-4 w-4" />
                        Dark
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 space-y-0">
                      <RadioGroupItem value="system" id="theme-system" />
                      <Label
                        htmlFor="theme-system"
                        className="font-normal cursor-pointer flex items-center gap-2"
                      >
                        <Monitor className="h-4 w-4" />
                        System
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </CardContent>
            </Card>

            {/* Navigation Settings */}
            <Card>
              <CardHeader>
                <CardTitle>Navigation</CardTitle>
                <CardDescription>
                  Configure how the sidebar navigation behaves
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Sidebar Trigger Setting */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Sidebar Trigger</Label>
                  <p className="text-sm text-muted-foreground">
                    Choose how you want to open the sidebar
                  </p>
                  <RadioGroup
                    value={settings.sidebarTrigger}
                    onValueChange={(value) =>
                      updateSettings({ sidebarTrigger: value as "hover" | "click" })
                    }
                  >
                    <div className="flex items-center space-x-3 space-y-0">
                      <RadioGroupItem value="hover" id="trigger-hover" />
                      <Label
                        htmlFor="trigger-hover"
                        className="font-normal cursor-pointer flex items-center gap-2"
                      >
                        <Hand className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span>Hover</span>
                          <span className="text-xs text-muted-foreground">
                            Sidebar opens when you hover over the logo
                          </span>
                        </div>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 space-y-0">
                      <RadioGroupItem value="click" id="trigger-click" />
                      <Label
                        htmlFor="trigger-click"
                        className="font-normal cursor-pointer flex items-center gap-2"
                      >
                        <MousePointer2 className="h-4 w-4" />
                        <div className="flex flex-col">
                          <span>Click</span>
                          <span className="text-xs text-muted-foreground">
                            Sidebar opens when you click the logo
                          </span>
                        </div>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </CardContent>
            </Card>

            {/* Annotation Backup / Restore */}
            <Card>
              <CardHeader>
                <CardTitle>Annotation Backup</CardTitle>
                <CardDescription>
                  Download a CSV snapshot of all TestAnnotations, or restore from a previous backup.
                  Restore is additive: existing rows (matched by serial + start_time + type) are
                  skipped, never overwritten.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-base font-medium">Download backup</Label>
                  <p className="text-sm text-muted-foreground">
                    Streams the full TestAnnotations table as a CSV file.
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleBackup}
                    disabled={backupBusy}
                  >
                    {backupBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    {backupBusy ? "Preparing..." : "Download CSV"}
                  </Button>
                </div>

                <div className="space-y-3 pt-2 border-t">
                  <Label className="text-base font-medium">Restore from backup</Label>
                  <p className="text-sm text-muted-foreground">
                    Upload a previously downloaded CSV. Only accounts on the restore allowlist
                    can perform this action.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleRestoreFile(file);
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={restoreBusy}
                  >
                    {restoreBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {restoreBusy ? "Restoring..." : "Upload CSV..."}
                  </Button>

                  {restoreResult && (
                    <div className="rounded-md border p-3 text-sm space-y-2">
                      {restoreResult.error ? (
                        <p className="text-destructive font-medium">
                          {restoreResult.error}
                        </p>
                      ) : (
                        <>
                          <p className="font-medium">Restore complete</p>
                          {restoreResult.totals && (
                            <ul className="text-muted-foreground space-y-0.5">
                              <li>Rows in file: {restoreResult.totals.rows_in_file}</li>
                              <li>Inserted: {restoreResult.totals.inserted}</li>
                              <li>Skipped (duplicates): {restoreResult.totals.skipped_duplicate}</li>
                              <li>Skipped (invalid): {restoreResult.totals.skipped_invalid}</li>
                              <li>Inserted without matching test: {restoreResult.totals.skipped_no_test}</li>
                              <li>Errors: {restoreResult.totals.errors}</li>
                            </ul>
                          )}
                          {restoreResult.skipped && restoreResult.skipped.length > 0 && (
                            <details>
                              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                Show details ({restoreResult.skipped.length})
                              </summary>
                              <div className="max-h-64 overflow-auto mt-2 text-xs font-mono">
                                {restoreResult.skipped.map((s, i) => (
                                  <div key={i} className="py-1 border-b last:border-b-0">
                                    <span className="text-muted-foreground">row {s.row}:</span>{" "}
                                    {s.serial_number} @ {s.start_time} — {s.annotation_text}
                                    <div className="text-muted-foreground">{s.reason}</div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
