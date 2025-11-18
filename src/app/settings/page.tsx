"use client";

import * as React from "react";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useSettings } from "@/contexts/settings-context";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun, MousePointer2, Hand } from "lucide-react";

export default function SettingsPage() {
  const { settings, updateSettings } = useSettings();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

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
          </div>
        </div>
      </div>
    </div>
  );
}
