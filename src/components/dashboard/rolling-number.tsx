"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type RollingNumberProps = {
  value: number | null;
  /** True only when we have never had a value yet (first load). */
  pending: boolean;
  format: (n: number) => string;
  suffix?: React.ReactNode;
  variant: "hero" | "secondary";
  className?: string;
};

type DisplayPart =
  | {
      kind: "digit";
      place: number;
      /** Integer wheel index: floor(scaled / 10^place). Always whole — no mid-glyph rest. */
      unwrapped: number;
    }
  | { kind: "sep"; char: string; afterPlace: number };

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Snap a lerped value so `format()` stays stable.
 * - Integer formatters (format(2) === format(2.9)): Math.round
 * - Decimal formatters: quantize to the fraction digits they emit
 */
function quantizeForFormat(n: number, format: (x: number) => string): number {
  if (format(2) === format(2.9) || format(2) === format(2.1)) {
    return Math.round(n);
  }
  const sample = format(1.25);
  if (sample.includes(".")) {
    const decimals = (sample.split(".")[1] || "").replace(/\D/g, "").length;
    const f = 10 ** Math.max(decimals, 1);
    return Math.round(n * f) / f;
  }
  return Math.round(n);
}

function fractionDigitsOf(format: (x: number) => string): number {
  if (format(2) === format(2.9) || format(2) === format(2.1)) return 0;
  const sample = format(1.25);
  if (!sample.includes(".")) return 0;
  return (sample.split(".")[1] || "").replace(/\D/g, "").length;
}

/**
 * Always derive layout + wheel positions from the *quantized* display value.
 * That way every reel sits on a whole digit for the entire count (no
 * fractional higher places that look like overshoot, then snap on settle).
 * Digit width still follows the live count (drops at 10000→9999, etc.).
 */
function partsForValue(
  display: number,
  format: (n: number) => string,
): DisplayPart[] {
  const formatted = format(display);
  const chars = formatted.split("");
  const scale = 10 ** fractionDigitsOf(format);
  // Integer scaled magnitude — wheel indices are pure integers
  const scaled = Math.round(Math.abs(display) * scale);

  let place = 0;
  const parts: DisplayPart[] = new Array(chars.length);
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i];
    if (/\d/.test(ch)) {
      parts[i] = {
        kind: "digit",
        place,
        unwrapped: Math.floor(scaled / 10 ** place),
      };
      place += 1;
    } else {
      parts[i] = { kind: "sep", char: ch, afterPlace: place };
    }
  }
  return parts;
}

function spinDurationMs(from: number, to: number): number {
  const delta = Math.abs(to - from);
  if (delta < 1) return 450;
  if (delta < 20) return 600;
  if (delta < 200) return 750;
  if (delta < 2000) return 900;
  return 1100;
}

/**
 * Odometer via quantized value interpolation:
 * - rAF eases from → to, each frame snaps to a displayable number
 * - reels always show whole digits of that number (no mid-glyph, no end snap)
 * - digit width grows/shrinks as the count crosses powers of ten
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
      ? "flex h-12 w-fit shrink-0 items-center sm:h-[3.75rem]"
      : "flex h-[1.875rem] w-fit shrink-0 items-center sm:h-9";

  const settledRef = React.useRef<number | null>(null);
  const [settled, setSettled] = React.useState<number | null>(null);

  // Quantized live display during a spin; null when idle at `settled`
  const [live, setLive] = React.useState<number | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const spinGenRef = React.useRef(0);

  const stopRaf = React.useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const runSpin = React.useCallback(
    (from: number, to: number) => {
      stopRaf();
      const gen = ++spinGenRef.current;
      const duration = spinDurationMs(from, to);
      const start = performance.now();
      const fromQ = quantizeForFormat(from, format);
      const toQ = quantizeForFormat(to, format);

      setLive(fromQ);

      const tick = (now: number) => {
        if (gen !== spinGenRef.current) return;
        const t = Math.min(1, (now - start) / duration);

        if (t >= 1) {
          rafRef.current = null;
          // Land exactly on the target — never a rounded neighbor
          settledRef.current = toQ;
          setSettled(toQ);
          setLive(null);
          return;
        }

        const raw = from + (to - from) * easeOutCubic(t);
        // Clamp so rounding cannot step past the endpoint mid-flight
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        const clamped = Math.min(hi, Math.max(lo, raw));
        let next = quantizeForFormat(clamped, format);

        // When counting up, never display above toQ; down, never below toQ
        if (to >= from) {
          next = Math.min(next, toQ);
        } else {
          next = Math.max(next, toQ);
        }
        // And never reverse past the start
        if (to >= from) {
          next = Math.max(next, fromQ);
        } else {
          next = Math.min(next, fromQ);
        }

        setLive(next);
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [format, stopRaf],
  );

  React.useEffect(() => () => stopRaf(), [stopRaf]);

  React.useEffect(() => {
    if (value === null || Number.isNaN(value)) return;

    const prev = settledRef.current;

    if (pending && prev === null) return;

    if (prev === null) {
      runSpin(0, value);
      return;
    }

    if (prev === value) return;

    runSpin(prev, value);
  }, [value, pending, runSpin]);

  const firstLoadHold = pending && settled === null && live === null;
  const spinning = live !== null;
  const current = spinning ? live : firstLoadHold ? 0 : (settled ?? 0);

  const parts = partsForValue(current, format);
  // O34/O48: announce settled value only — not intermediate odometer ticks
  const ariaStr = format(
    spinning && settledRef.current != null ? settledRef.current : current,
  );

  return (
    <div
      className={cn(shell, "tabular-nums", className)}
      aria-label={ariaStr}
      aria-busy={spinning || firstLoadHold}
      aria-live={spinning ? "off" : "polite"}
    >
      <span className="inline-flex items-center leading-none" aria-hidden>
        {parts.map((part, i) => {
          if (part.kind === "sep") {
            return (
              <span
                key={`sep-${i}-${part.afterPlace}`}
                className="inline-block w-[0.35em] shrink-0 leading-none"
              >
                {part.char}
              </span>
            );
          }

          return (
            <DigitReel
              key={`place-${part.place}`}
              unwrapped={part.unwrapped}
            />
          );
        })}
        {suffix}
      </span>
    </div>
  );
}

/**
 * Odometer wheel at an integer index. When `unwrapped` steps by 1 the strip
 * moves one cell — always flush on a single glyph.
 */
function DigitReel({ unwrapped }: { unwrapped: number }) {
  const lo = unwrapped - 1;
  const hi = unwrapped + 1;

  return (
    <span
      className="relative inline-block w-[0.62em] shrink-0 overflow-hidden align-bottom"
      style={{ height: "1em", lineHeight: 1 }}
    >
      <span
        className="absolute left-0 top-0 w-full will-change-transform"
        style={{
          // No CSS transition: rAF already steps the integer count. Interpolating
          // large unwrapped jumps would visually overshoot then snap.
          transform: `translate3d(0, ${-unwrapped}em, 0)`,
        }}
      >
        {[lo, unwrapped, hi].map((idx) => (
          <span
            key={idx}
            className="absolute left-0 flex w-full items-center justify-center"
            style={{
              top: `${idx}em`,
              height: "1em",
              lineHeight: 1,
            }}
          >
            {((idx % 10) + 10) % 10}
          </span>
        ))}
      </span>
    </span>
  );
}
