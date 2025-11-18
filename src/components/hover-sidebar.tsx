"use client";

import { useSession, signOut, signIn } from "next-auth/react";
import { User, LogOut, Users, LayoutDashboard, ListTodo, LogIn, BarChart3, Settings, Monitor, Moon, Sun } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TimezoneSelector } from "@/components/timezone-selector";
import { usePathname } from "next/navigation";
import { useSettings } from "@/contexts/settings-context";
import { useTheme } from "next-themes";

export function HoverSidebar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { settings } = useSettings();
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [todoCount, setTodoCount] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const userName = session?.user?.name || "User";
  const userEmail = session?.user?.email || "";

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/contributors", label: "Contributors", icon: Users },
    { href: "/failure-analytics", label: "Failure Analytics", icon: BarChart3 },
    { href: "/todo", label: "Todo", icon: ListTodo, badge: todoCount },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

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

  return (
    <div
      id="hover-sidebar"
      className="fixed left-0 top-0 h-screen z-50 transition-all duration-300 ease-in-out"
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
            width={isOpen ? 96 : 32}
            height={isOpen ? 96 : 32}
            className="object-contain transition-all duration-300"
          />
        </div>

        {/* Expanded content */}
        {isOpen && (
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
            <div className="flex-1 space-y-1">
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground">
                NAVIGATION
              </div>
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
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
        )}
      </div>
    </div>
  );
}
