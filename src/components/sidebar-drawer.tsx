"use client";

import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type SidebarDrawerProps = ComponentProps<typeof Sheet> & {
  trigger: ReactElement;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
};

/** Shared left drawer for navigation and dashboard downloads. */
export function SidebarDrawer({ trigger, title, description, children, className, ...props }: SidebarDrawerProps) {
  return (
    <Sheet {...props}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="left" className={cn("sidebar-drawer gap-0", className)}>
        <SheetHeader className="drawer-header shrink-0 border-b pr-14">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}
