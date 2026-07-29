"use client";

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type RollingNumberProps = {
  /** Numeric value to show; null while waiting for first payload. */
  value: number | null;
  pending: boolean;
  /** Format the number into display characters (digits, commas, decimal). */
  format: (n: number) => string;
  /** Static suffix after the rolling digits (e.g. %). */
  suffix?: React.ReactNode;
  variant: "hero" | "secondary";
  className?: string;
};

/**
 * Odometer-style digit reel: each digit column slides vertically to the
 * target numeral. Non-digit characters (commas, decimals) stay fixed.
 */
export function RollingNumber({
  value,
  pending,
  format,
  suffix,
  variant,
  className,
}: RollingNumberProps) {
  const shell =
    variant === "hero"
      ? "flex h-12 shrink-0 items-center sm:h-[3.75rem]"
      : "flex h-[1.875rem] shrink-0 items-center sm:h-9";
  const bar =
    variant === "hero"
      ? "h-10 w-32 sm:h-12 sm:w-36"
      : "h-7 w-24 sm:h-8 sm:w-28";

  // Drive CSS transitions: first paint as zeros, then snap to target.
  const [display, setDisplay] = React.useState<string | null>(null);
  const prevFormatted = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (pending || value === null) {
      setDisplay(null);
      prevFormatted.current = null;
      return;
    }

    const next = format(value);
    const prev = prevFormatted.current;

    if (prev === null) {
      // Entrance: start on zeros of the same shape, then roll to value
      const zeros = next.replace(/\d/g, "0");
      setDisplay(zeros);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setDisplay(next);
          prevFormatted.current = next;
        });
      });
      return () => cancelAnimationFrame(id);
    }

    if (prev !== next) {
      setDisplay(next);
      prevFormatted.current = next;
    }
  }, [value, pending, format]);

  if (pending || value === null || display === null) {
    return (
      <div className={shell}>
        <Skeleton className={cn("rounded-md", bar)} aria-hidden />
      </div>
    );
  }

  const chars = display.split("");

  return (
    <div
      className={cn(shell, "tabular-nums", className)}
      aria-label={display}
    >
      <span className="inline-flex items-center leading-none" aria-hidden>
        {chars.map((ch, i) =>
          /\d/.test(ch) ? (
            <DigitReel
              key={`d-${i}-${chars.length}`}
              digit={Number(ch)}
              delayMs={i * 35}
            />
          ) : (
            <span
              key={`s-${i}-${ch}`}
              className="inline-block shrink-0 leading-none"
            >
              {ch}
            </span>
          ),
        )}
        {suffix}
      </span>
      {/* Accessible live value for screen readers */}
      <span className="sr-only">{display}</span>
    </div>
  );
}

function DigitReel({ digit, delayMs }: { digit: number; delayMs: number }) {
  // Slightly wider than a digit so 1 vs 0 don't reflow mid-roll
  return (
    <span
      className="relative inline-block h-[1em] w-[0.62em] shrink-0 overflow-hidden align-bottom leading-none"
    >
      <span
        className="absolute left-0 top-0 flex w-full flex-col will-change-transform"
        style={{
          transform: `translate3d(0, ${-digit}em, 0)`,
          transitionProperty: "transform",
          transitionDuration: "700ms",
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          transitionDelay: `${delayMs}ms`,
        }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span
            key={n}
            className="flex h-[1em] w-full items-center justify-center leading-none"
          >
            {n}
          </span>
        ))}
      </span>
    </span>
  );
}
