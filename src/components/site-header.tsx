"use client";

import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { TimezoneSelector } from "@/components/timezone-selector";
import { LogOut, User } from "lucide-react";

export function SiteHeader() {
  const { data: session } = useSession();

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <h1 className="text-base font-medium">Burn-in Report Dashboard</h1>
        <div className="ml-auto flex items-center gap-2">
          {session?.user && (
            <div className="hidden items-center gap-2 rounded-md border px-3 py-1.5 text-sm lg:flex">
              <User className="h-4 w-4" />
              <span className="font-medium">{session.user.name || session.user.email}</span>
            </div>
          )}
          <TimezoneSelector />
          <Button variant="ghost" asChild size="sm" className="hidden sm:flex">
            <a
              href="https://github.com/dev-gough/sparq-burnin"
              rel="noopener noreferrer"
              target="_blank"
              className="dark:text-foreground"
            >
              Git
            </a>
          </Button>
          {session?.user && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="gap-2"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
