"use client";

import { useSession, signOut } from "next-auth/react";
import { User, LogOut, Users, LayoutDashboard, ListTodo } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TimezoneSelector } from "@/components/timezone-selector";
import { usePathname } from "next/navigation";

export function HoverSidebar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [isHovered, setIsHovered] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [todoCount, setTodoCount] = useState<number | null>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const userName = session?.user?.name || "User";
  const userEmail = session?.user?.email || "";

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/contributors", label: "Contributors", icon: Users },
    { href: "/todo", label: "Todo", icon: ListTodo, badge: todoCount },
  ];

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
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    // Don't close if user is interacting with a dropdown or button
    if (isInteracting) return;

    // Add a small delay before closing
    closeTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 50);
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

  return (
    <div
      className="fixed left-0 top-0 h-screen z-50 transition-all duration-300 ease-in-out"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Collapsed state - thin bar */}
      <div
        className={`h-full bg-background border-r transition-all duration-300 ease-in-out flex flex-col ${
          isHovered ? "w-64" : "w-10"
        }`}
      >
        {/* Logo at top */}
        <div className={`flex items-center justify-center border-b flex-shrink-0 transition-all duration-300 ${
          isHovered ? "h-28 py-2" : "h-16 py-3"
        }`}>
          <Image
            src="/logo.png"
            alt="Logo"
            width={isHovered ? 96 : 32}
            height={isHovered ? 96 : 32}
            className="object-contain transition-all duration-300"
          />
        </div>

        {/* Expanded content */}
        {isHovered && (
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

            {/* Bottom section - Timezone & Sign Out */}
            <div
              className="space-y-2 pt-4 border-t"
              onMouseEnter={handleInteractionStart}
              onMouseLeave={handleInteractionEnd}
              onClick={handleInteractionStart}
            >
              <TimezoneSelector />
              {session?.user && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                  className="w-full justify-start gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Sign Out</span>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
