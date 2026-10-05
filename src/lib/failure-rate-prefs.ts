import { z } from "zod";

export const failureRatePrefsSchema = z.object({
  view: z.enum(["rate", "tests"]),
  window: z.number().int().min(10).max(2000),
}).strict();

export type FailureRatePrefs = z.infer<typeof failureRatePrefsSchema>;
export const DEFAULT_FAILURE_RATE_PREFS: FailureRatePrefs = { view: "rate", window: 100 };
