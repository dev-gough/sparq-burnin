"use client";

import { useState } from "react";
import { useAnnotationCache } from "@/contexts/AnnotationCacheContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { annotationColour, annotationShortLabel, tableAnnotationItems, type AnnotationItem } from "@/lib/annotation-labels";

function AnnotationLabel({ item }: { item: AnnotationItem }) {
  const [open, setOpen] = useState(false);
  const colour = annotationColour(item);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={item.group_name ? `${item.name} (${item.group_name})` : item.name}
          className="inline-flex min-h-7 min-w-0 max-w-full items-center rounded-md border px-2 py-1 text-xs font-medium leading-tight transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          style={{ color: `color-mix(in srgb, ${colour} 80%, var(--foreground) 20%)`, backgroundColor: `${colour}14`, borderColor: `${colour}40` }}
          onClick={event => {
            // Tap/Enter reveals the full name without opening the test row.
            event.preventDefault();
            event.stopPropagation();
            setOpen(previous => !previous);
          }}
        >
          <span className="truncate">{annotationShortLabel(item.name)}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-72 px-3 py-2 text-left">
        <p className="font-medium">{item.name}</p>
        {item.group_name && <p className="mt-0.5 text-[11px] opacity-75">{item.group_name}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

export function AnnotationLabels({ items, text }: { items?: AnnotationItem[]; text: string | null }) {
  const { quickOptions } = useAnnotationCache();
  const annotations = tableAnnotationItems(items, text, quickOptions.map(option => ({
    name: option.option_text, group_name: option.group_name, group_color: option.group_color,
  })));
  if (!annotations.length) return <span className="text-sm text-muted-foreground/50" aria-hidden>—</span>;
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5 py-0.5">
      {annotations.map(item => <AnnotationLabel key={JSON.stringify([item.name, item.group_name])} item={item} />)}
    </div>
  );
}
