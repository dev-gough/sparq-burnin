"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type RollingNumberProps = {
  /** Numeric value to show; null while waiting for first payload. */
  value: number | null;
  /** While true, reels sit on zeros; when false, they roll to `value`. */
  pending: boolean;
  /** Format the number into display characters (digits, commas, decimal). */
  format: (n: number) => string;
  /** Static suffix after the rolling digits (e.g. %). */
  suffix?: React.ReactNode;
  variant: "hero" | "secondary";
  className?: string;
};

/**
 * Odometer-style digit reel: always shows digits (starting at zeros — no
 * skeleton bar). When data arrives or the period changes, columns roll
 * to the new value with a light left-to-right cascade.
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

  const zeroStr = format(0);

  // What the reels currently show (drives CSS transform)
  const [display, setDisplay] = React.useState(zeroStr);
  const prevTarget = React.useRef<string | null>(null);

  React.useEffect(() => {
    // Pending / no value → park on zeros
    if (pending || value === null) {
      setDisplay(zeroStr);
      prevTarget.current = zeroStr;
      return;
    }

    const next = format(value);

    // First real value, or width/shape change: zeros of new shape → roll
    if (
      prevTarget.current === null ||
      prevTarget.current === zeroStr ||
      prevTarget.current.replace(/\d/g, "0") !== next.replace(/\d/g, "0")
    ) {
      const zeros = next.replace(/\d/g, "0");
      setDisplay(zeros);
      prevTarget.current = next;
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setDisplay(next));
      });
      return () => cancelAnimationFrame(id);
    }

    // Same digit width — roll in place
    if (prevTarget.current !== next) {
      prevTarget.current = next;
      setDisplay(next);
    }
  }, [value, pending, format, zeroStr]);

  const chars = display.split("");
  const a11y = pending || value === null ? zeroStr : format(value);

  // Cascade ones → tens → hundreds (right-to-left), matching odometer feel.
  // Only digit columns count toward stagger; commas/decimals stay fixed.
  let digitIndexFromRight = 0;
  const digitDelays: number[] = new Array(chars.length).fill(0);
  for (let i = chars.length - 1; i >= 0; i--) {
    if (/\d/.test(chars[i])) {
      digitDelays[i] = digitIndexFromRight * 35;
      digitIndexFromRight += 1;
    }
  }

  return (
    <div className={cn(shell, "tabular-nums", className)} aria-label={a11y}>
      <span className="inline-flex items-center leading-none" aria-hidden>
        {chars.map((ch, i) =>
          /\d/.test(ch) ? (
            <DigitReel
              key={`col-${i}-${chars.length}`}
              digit={Number(ch)}
              delayMs={digitDelays[i]}
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
      <span className="sr-only">{a11y}</span>
    </div>
  );
}

function DigitReel({ digit, delayMs }: { digit: number; delayMs: number }) {
  return (
    <span className="relative inline-block h-[1em] w-[0.62em] shrink-0 overflow-hidden align-bottom leading-none">
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
