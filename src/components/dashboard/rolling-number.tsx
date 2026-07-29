"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type RollingNumberProps = {
  /** Numeric value to show; null while waiting for first payload. */
  value: number | null;
  /** While true, show a single 0; when false, roll to `value`. */
  pending: boolean;
  /** Format the number into display characters (digits, commas, decimal). */
  format: (n: number) => string;
  /** Static suffix after the rolling digits (e.g. %). */
  suffix?: React.ReactNode;
  variant: "hero" | "secondary";
  className?: string;
};

type DisplayPart =
  | { kind: "digit"; digit: number; place: number }
  | { kind: "sep"; char: string };

/**
 * Build display parts from a formatted string. Digit `place` is counted from
 * the right (ones=0) so columns stay stable as the number gains digits.
 */
function partsFromFormatted(formatted: string): DisplayPart[] {
  const chars = formatted.split("");
  let place = 0;
  const parts: DisplayPart[] = new Array(chars.length);
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i];
    if (/\d/.test(ch)) {
      parts[i] = { kind: "digit", digit: Number(ch), place };
      place += 1;
    } else {
      parts[i] = { kind: "sep", char: ch };
    }
  }
  return parts;
}

/**
 * Odometer-style digit reel without a padded "00000" intermediate frame.
 * Parks on format(0) while pending, then rolls place-by-place (ones first).
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
  const displayStr =
    pending || value === null ? zeroStr : format(value);
  const parts = partsFromFormatted(displayStr);

  return (
    <div
      className={cn(shell, "tabular-nums", className)}
      aria-label={displayStr}
    >
      <span className="inline-flex items-center leading-none" aria-hidden>
        {parts.map((part, i) =>
          part.kind === "digit" ? (
            <DigitReel
              key={`place-${part.place}`}
              digit={part.digit}
              delayMs={part.place * 35}
            />
          ) : (
            <span
              key={`sep-${i}-${part.char}`}
              className="inline-block shrink-0 leading-none"
            >
              {part.char}
            </span>
          ),
        )}
        {suffix}
      </span>
      <span className="sr-only">{displayStr}</span>
    </div>
  );
}

/**
 * Single digit column. Mounts / resets at 0 then transitions to `digit`
 * so we never need a full-string "00000" paint — new higher places simply
 * appear and roll from 0 to their value.
 */
function DigitReel({ digit, delayMs }: { digit: number; delayMs: number }) {
  const [pos, setPos] = React.useState(0);
  const prevDigit = React.useRef<number | null>(null);

  React.useEffect(() => {
    // First paint for this place column, or digit change: ensure we animate
    if (prevDigit.current === null) {
      // Mount at 0, then roll to target (double rAF so the 0 frame paints)
      setPos(0);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setPos(digit));
      });
      prevDigit.current = digit;
      return () => cancelAnimationFrame(id);
    }

    if (prevDigit.current !== digit) {
      prevDigit.current = digit;
      setPos(digit);
    }
  }, [digit]);

  return (
    <span className="relative inline-block h-[1em] w-[0.62em] shrink-0 overflow-hidden align-bottom leading-none">
      <span
        className="absolute left-0 top-0 flex w-full flex-col will-change-transform"
        style={{
          transform: `translate3d(0, ${-pos}em, 0)`,
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
