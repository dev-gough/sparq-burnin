"use client";

import { createElement, useState } from "react";
import { useAnnotationCache } from "@/contexts/AnnotationCacheContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { annotationColour, annotationIcon, tableAnnotationItems, type AnnotationItem } from "@/lib/annotation-icons";

function AnnotationSymbol({ item }: { item: AnnotationItem }) {
  const [open, setOpen] = useState(false);
  const colour = annotationColour(item);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={item.group_name ? `${item.name} (${item.group_name})` : item.name}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border transition-shadow hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          style={{ color: colour, backgroundColor: `${colour}14`, borderColor: `${colour}40` }}
          onClick={event => {
            // Tap/Enter reveals the name without opening the test row.
            event.preventDefault();
            event.stopPropagation();
            setOpen(previous => !previous);
          }}
        >
          {createElement(annotationIcon(item.name), { className: "size-[18px]", strokeWidth: 1.8, "aria-hidden": true })}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-72 px-3 py-2 text-left">
        <p className="font-medium">{item.name}</p>
        {item.group_name && <p className="mt-0.5 text-[11px] opacity-75">{item.group_name}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

export function AnnotationIcons({ items, text }: { items?: AnnotationItem[]; text: string | null }) {
  const { quickOptions } = useAnnotationCache();
  const annotations = tableAnnotationItems(items, text, quickOptions.map(option => ({
    name: option.option_text, group_name: option.group_name, group_color: option.group_color,
  })));
  if (!annotations.length) return <span className="text-sm text-muted-foreground/50" aria-hidden>—</span>;
  return (
    <div className="flex max-w-60 flex-wrap gap-1.5 py-0.5">
      {annotations.map(item => <AnnotationSymbol key={JSON.stringify([item.name, item.group_name])} item={item} />)}
    </div>
  );
}
