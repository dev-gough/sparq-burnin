"use client";

import { useSession, signOut, signIn } from "next-auth/react";
import { Menu, User, LogOut, Users, LayoutDashboard, ListTodo, LogIn, BarChart3, Settings, Monitor, Moon, Sun, Server, ScrollText } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TimezoneSelector } from "@/components/timezone-selector";
import { usePathname } from "next/navigation";
import { useSettings } from "@/contexts/settings-context";
import { useTheme } from "next-themes";
import { SidebarDrawer } from "@/components/sidebar-drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { version } from "../../package.json";

export function HoverSidebar() {
  const { data: session, status: sessionStatus } = useSession();
  const pathname = usePathname();
  const { settings } = useSettings();
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [todoCount, setTodoCount] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [isStationAdmin, setIsStationAdmin] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const userName = session?.user?.name || "User";
  const userEmail = session?.user?.email || "";

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/contributors", label: "Contributors", icon: Users },
    { href: "/failure-analytics", label: "Failure Analytics", icon: BarChart3 },
    { href: "/todo", label: "Todo", icon: ListTodo, badge: todoCount },
    ...(isStationAdmin
      ? [{ href: "/stations", label: "Stations", icon: Server }]
      : []),
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  useEffect(() => {
    setMobileOpen(false);
    setIsOpen(false);
  }, [pathname, isMobile]);

  // Avoid hydration mismatch for theme
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch todo count
  useEffect(() => {
    const fetchTodoCount = async () => {
      try {
        const response = await fetch("/api/todo/count");
        const data = await response.json();
        setTodoCount(data.count);
      } catch (error) {
        console.error("Error fetching todo count:", error);
      }
    };

    fetchTodoCount();
    // Refresh count every 30 seconds
    const interval = setInterval(fetchTodoCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Station admin nav (hidden for non-allowlisted users).
  // Under SKIP_AUTH, admin-status returns true without a session — always ask the API.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/stations/admin-status");
        const data = await res.json();
        if (!cancelled) setIsStationAdmin(Boolean(data.isStationAdmin));
      } catch {
        if (!cancelled) setIsStationAdmin(false);
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.email, sessionStatus]);

  const handleMouseEnter = () => {
    // Only open on hover if the setting is "hover"
    if (settings.sidebarTrigger !== "hover") return;

    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    // Only close on mouse leave if the setting is "hover"
    if (settings.sidebarTrigger !== "hover") return;

    // Don't close if user is interacting with a dropdown or button
    if (isInteracting) return;

    // Add a small delay before closing
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 50);
  };

  const handleLogoClick = () => {
    // Only toggle on click if the setting is "click"
    if (settings.sidebarTrigger !== "click") return;
    setIsOpen(!isOpen);
  };

  const handleInteractionStart = () => {
    setIsInteracting(true);
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const handleInteractionEnd = () => {
    // Add delay before ending interaction to allow for dropdown clicks
    setTimeout(() => {
      setIsInteracting(false);
    }, 500);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  // Close sidebar when clicking outside in click mode
  useEffect(() => {
    if (settings.sidebarTrigger !== "click" || !isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const sidebar = document.getElementById("hover-sidebar");
      if (sidebar && !sidebar.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [settings.sidebarTrigger, isOpen]);

  const sidebarContent = (
    <div className="flex-1 flex flex-col p-4 space-y-4 animate-in fade-in duration-200">
      {/* User section */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{userName}</p>
          {userEmail && (
            <p className="text-xs text-muted-foreground truncate">
              {userEmail}
            </p>
          )}
        </div>
      </div>

      {/* Navigation items */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">
          NAVIGATION
        </div>
        <div className="space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 px-3 py-3 md:py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.badge !== null && item.badge !== undefined && item.badge > 0 && (
                <span className="bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
        </div>
        <Link
          href="/changelog"
          onClick={() => setMobileOpen(false)}
          className={`mt-auto flex items-center gap-2 px-3 pt-3 text-xs text-muted-foreground transition-colors hover:text-foreground ${
            pathname === "/changelog" ? "text-foreground" : ""
          }`}
        >
          <ScrollText className="size-3.5" />
          <span>Changelog</span>
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60" aria-label={`Version ${version}`}>v{version}</span>
        </Link>
      </div>

      {/* Bottom section - Theme, Timezone & Auth */}
      <div
        className="space-y-2 pt-4 border-t"
        onMouseEnter={handleInteractionStart}
        onMouseLeave={handleInteractionEnd}
        onClick={handleInteractionStart}
      >
        {/* Theme Toggle */}
        {mounted && (
          <div className="space-y-1">
            <div className="px-3 py-1 text-xs font-semibold text-muted-foreground">
              THEME
            </div>
            <div className="flex gap-1 px-3">
              <Button
                variant={theme === "light" ? "default" : "ghost"}
                size="sm"
                onClick={() => setTheme("light")}
                className="flex-1 h-8"
                title="Light mode"
              >
                <Sun className="h-4 w-4" />
              </Button>
              <Button
                variant={theme === "dark" ? "default" : "ghost"}
                size="sm"
                onClick={() => setTheme("dark")}
                className="flex-1 h-8"
                title="Dark mode"
              >
                <Moon className="h-4 w-4" />
              </Button>
              <Button
                variant={theme === "system" ? "default" : "ghost"}
                size="sm"
                onClick={() => setTheme("system")}
                className="flex-1 h-8"
                title="System theme"
              >
                <Monitor className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <TimezoneSelector />
        {session?.user ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
            className="w-full justify-start gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign Out</span>
          </Button>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={() => signIn("azure-ad")}
            className="w-full justify-start gap-2"
          >
            <LogIn className="h-4 w-4" />
            <span>Sign In</span>
          </Button>
        )}
      </div>
    </div>
  );

  // Auth pages (sign-in / error) should not show navigation — user is not in-app yet.
  if (pathname?.startsWith("/auth/")) {
    return null;
  }

  return (
    <>
      <div className="mobile-app-header sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
        <div className="flex items-center gap-2">
          <SidebarDrawer open={mobileOpen} onOpenChange={setMobileOpen}
            title="BurnIn" description="Navigation and preferences" className="mobile-navigation md:hidden"
            trigger={<Button variant="outline" size="icon" className="size-11" aria-label="Open navigation"><Menu className="size-5" /></Button>}>
              <div className="mobile-navigation-body drawer-body flex min-h-0 flex-1 flex-col gap-3 p-4">
                <nav aria-label="Main navigation" className="drawer-navigation grid gap-1">
                  {[...navItems, { href: "/changelog", label: "Changelog", icon: ScrollText }].map((item) => {
                    const Icon = item.icon;
                    const active = pathname === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 py-2 text-sm ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                        <Icon className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1">{item.label}</span>
                        {"badge" in item && item.badge != null && item.badge > 0 && (
                          <span className="rounded-full bg-orange-500 px-1.5 text-xs text-white">{item.badge}</span>
                        )}
                      </Link>
                    );
                  })}
                </nav>
                <div className="drawer-preferences mt-auto border-t">
                  <div className="drawer-icon-controls flex items-center justify-between">
                    <TimezoneSelector iconOnly />
                    {mounted && (
                      <div className="flex" role="group" aria-label="Color theme">
                        {([
                          { value: "light", title: "Light mode", icon: Sun },
                          { value: "dark", title: "Dark mode", icon: Moon },
                          { value: "system", title: "System theme", icon: Monitor },
                        ] as const).map(({ value, title, icon: Icon }) => (
                          <Button key={value} variant="ghost" size="icon"
                            className="drawer-icon theme-icon rounded-full" title={title} aria-label={title}
                            aria-pressed={theme === value} onClick={() => setTheme(value)}>
                            <Icon className="size-4" />
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="drawer-account flex items-center gap-1">
                    <span role="img" aria-label={`${userName}${userEmail ? ` (${userEmail})` : ""}`}
                      title={userEmail ? `${userName} · ${userEmail}` : userName}
                      className="drawer-avatar flex shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {session?.user ? userName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("") : <User className="size-4" />}
                    </span>
                    <Button variant="ghost" size="icon" className="drawer-icon rounded-full"
                      title={session?.user ? "Sign Out" : "Sign In"} aria-label={session?.user ? "Sign Out" : "Sign In"}
                      onClick={() => session?.user ? signOut({ callbackUrl: "/auth/signin" }) : signIn("azure-ad")}>
                      {session?.user ? <LogOut className="size-4" /> : <LogIn className="size-4" />}
                    </Button>
                    <span className="drawer-version ml-auto text-[10px] text-muted-foreground" aria-label={`Version ${version}`}>v{version}</span>
                  </div>
                </div>
              </div>
          </SidebarDrawer>
          <div id="mobile-header-actions" />
        </div>
        <div id="mobile-header-periods" className="flex min-w-0 flex-1 justify-center px-2" />
        <Link href="/" aria-label="BurnIn home" className="flex shrink-0 items-center">
          <Image src="/logo.png" alt="SPARQ" width={126} height={85} className="h-auto w-12" loading="eager" />
        </Link>
      </div>

    <div
      id="hover-sidebar"
      className="hidden md:block fixed left-0 top-0 h-screen z-50 transition-all duration-300 ease-in-out"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Collapsed state - thin bar */}
      <div
        className={`h-full bg-background border-r transition-all duration-300 ease-in-out flex flex-col ${
          isOpen ? "w-64" : "w-10"
        } ${settings.sidebarTrigger === "click" && !isOpen ? "cursor-pointer" : ""}`}
        onClick={() => {
          // Only handle click on the collapsed bar, not when expanded
          if (settings.sidebarTrigger === "click" && !isOpen) {
            handleLogoClick();
          }
        }}
      >
        {/* Logo at top */}
        <div
          className={`flex items-center justify-center border-b flex-shrink-0 transition-all duration-300 ${
            isOpen ? "h-28 py-2" : "h-16 py-3"
          }`}
        >
          <Image
            src="/logo.png"
            alt="Logo"
            // Intrinsic asset is 126×85 (not square). Match that aspect for
            // Next/Image layout attrs; scale with CSS width + height:auto.
            width={126}
            height={85}
            className={`object-contain transition-all duration-300 ${
              isOpen ? "w-24" : "w-8"
            }`}
            style={{ height: "auto" }}
            sizes={isOpen ? "96px" : "32px"}
          />
        </div>

        {/* Expanded content */}
        {isOpen && sidebarContent}
      </div>
    </div>
    </>
  );
}
