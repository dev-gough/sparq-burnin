"use client";

import { useState } from "react";
import Image from "next/image";

export function ChangelogCompare({ caption, before, after }: {
  caption: string;
  before: string;
  after: string;
}) {
  const [position, setPosition] = useState(50);
  return (
    <figure className="mt-4">
      <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
        <Image src={after} alt={`${caption}, after`} fill className="object-contain object-top" sizes="768px" />
        <Image
          src={before}
          alt=""
          fill
          aria-hidden
          className="object-contain object-top"
          sizes="768px"
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />
        <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-background shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" style={{ left: `${position}%` }} />
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">Before</span>
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground">After</span>
        <input
          type="range"
          min={0}
          max={100}
          value={position}
          aria-label={`${caption}. Before on the left, after on the right.`}
          aria-valuetext={`${position}% before`}
          onChange={event => setPosition(Number(event.target.value))}
          className="absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
      <figcaption className="mt-2 text-xs leading-relaxed text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
