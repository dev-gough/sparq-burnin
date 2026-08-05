# Dashboard UI/UX Optimization Plan

| Field | Value |
|-------|-------|
| **Status** | Ready to execute |
| **Date** | 2026-07-29 |
| **Branch** | `grok/ui-refresh` |
| **Source** | Adversarial UI/UX review of main dashboard (`/`) |
| **Related** | Dashboard command-center redesign (shipped on `grok/ui-refresh`) |
| **Audience** | Implementers banging out items in priority order |

---

## Purpose

Turn the adversarial review into a **checklist of implementable optimizations**. Each item has severity, intent, concrete work, primary files, and acceptance criteria so we can ship one item (or a small batch) at a time without re-litigating scope.

**Constraint (product):** Dual Y-axes on Test volume are **required** (CEO + CTO request). We do **not** remove them. We improve how dual axes communicate the difference between:

- a **sparse high-risk day** (e.g. 50% fails on ~5 tests), and  
- a **typical high-volume day** (~1% fails on >100 tests).

---


## Guiding principles

1. **Trust first** — hero numbers, table rows, and exports must not quietly disagree.
2. **Executive glance, progressive disclosure** — methodology lives in help, not permanent captions.
3. **Dual axes stay** — make volume vs failures *legible*, not misleading.
4. **One timezone story** — plant-local or UTC everywhere, labeled.
5. **Bangable slices** — each work item should be reviewable in one PR-sized chunk when possible.

---

## Priority legend

| Priority | Meaning |
|----------|---------|
| **P0** | Trust / wrong-number risk / leadership glance failure |
| **P1** | High usability or hierarchy |
| **P2** | Consistency and craft |
| **P3** | Nit / polish |

---

## Execution order (recommended batches)

Bang these in order unless a later item is unblocked early.

| Batch | Items | Theme |
|-------|-------|--------|
| **A** | O1, O3 | Metric trust + prior-period clarity |
| **B** | O2 | Dual-axis clarity (keep dual axes) |
| **C** | O4, O9 | Failure-rate strip + sparse calendar honesty |
| **D** | O5, O6, O13 | Copy demotion + mode surfacing + Failures CTA |
| **E** | O7, O8, O11 | Failure causes empty, empty-state tone, sticky chrome |
| **F** | O10, O12, O14 | Skeleton honesty, mobile, timezone |
| **G** | O15–O30 | Medium craft |
| **H** | O31–O50 | Nits (pick opportunistically) |

---

# Work items

---

## Batch A — Metric trust

### O1 · Unify hero ↔ table ↔ export populations (or show dual counts)

| | |
|--|--|
| **Priority** | P0 |
| **Review ref** | P0 #1 |
| **Problem** | Hero showed **311** inverters; table footer **302** rows. Failures disclaimer is easy to miss. Operators trust the big number. |
| **Decision needed** | Prefer **align** (hero matches what “View fails” will show) **or** **dual-label** (both definitions visible). Recommend dual-label if latest-per-inverter must remain the executive metric. |

**Work**

1. Document in code comments (and one help popover) the three populations:
   - Hero summary (`chartMode`, annotation filter, period).
   - Table rows (status/date/latest/search filters).
   - Export endpoints (today: pill time window only).
2. **Either**:
   - **A1 (preferred for trust):** When Failures is clicked, table filters + counts reconcile with hero `failed` under the same definition; show table total that matches; **or**
   - **A2:** Keep dual semantics but promote secondary count: e.g. `311 latest · 302 in table` under Inverters tested; Failures: `4 latest · N table FAILs`.
3. Export: see O28 — disable or scope correctly so export ≠ surprise population.

**Primary files**

- `src/components/dashboard/hero-metrics.tsx`
- `src/components/data-table.tsx`
- `src/app/page.tsx`
- `src/app/api/test-stats/route.ts` (if new summary fields needed)

**Acceptance**

- [ ] No unexplained single big number that disagrees with the visible table total by >0 without a **first-class** secondary label.
- [ ] Failures click lands on a table whose FAIL count is labeled relative to the hero.
- [ ] Screenshot light + dark of hero + table footer after fix.

---

### O3 · Define “prior period” with dates and magnitude context

| | |
|--|--|
| **Priority** | P0 |
| **Review ref** | P0 #3 |
| **Problem** | `↓ -1948 vs prior period` looks like a plant collapse; “pp” is opaque; no date bounds. |

**Work**

1. API already returns compare windows where possible — surface `labels.current` / `labels.previous` (or derive from `dashboardRange`) in UI.
2. Trend line format:
   - Primary: `−1,948 (−86%)` or similar.
   - Secondary / tooltip: `vs prior 30d (May 30 – Jun 28)`.
3. Replace bare `pp` with `pts` or `percentage points` on first use; tooltip always full phrase.
4. Optional: mute “good/bad” color for volume delta (already neutral); keep goodWhenDown for rate/fails.

**Primary files**

- `src/components/dashboard/hero-metrics.tsx`
- `src/app/api/test-stats/route.ts` / compare payload if labels incomplete

**Acceptance**

- [ ] Every non-zero delta has hover or visible prior date range.
- [ ] Rate deltas readable without knowing “pp”.
- [ ] `all` time still shows a single clean “No prior period” (see O16).

---

## Batch B — Dual axes (keep; improve)

### O2 · Dual-axis Test volume: communicate sparse risk vs high-volume norm

| | |
|--|--|
| **Priority** | P0 (clarity) — **not** “remove dual axes” |
| **Review ref** | P0 #2 (revised) |
| **Product lock** | CEO + CTO require dual Y-axes. Failures stay on a dedicated scale so small fail counts remain visible against large pass volume. |

**Problem (revised framing)**

Current dual-axis chart makes a red line + area look like “high failure share” when the right axis is only 0–2.5 counts. Leadership still wants dual axes so **low absolute fails are not crushed**, but the chart must also make it obvious that:

| Scenario | Volume (left) | Fails (right) | What user should *feel* |
|----------|---------------|---------------|-------------------------|
| 5 tests, 2–3 fail (~50%) | short bars | small absolute fails, **high rate risk** | Alarm: thin sample, bad yield |
| 100+ tests, ~1 fail (~1%) | tall bars | similar absolute fails possible | Normal ops noise |
| 0 fails, high volume | tall bars | line on zero | Healthy throughput |

**Work (implement as design package — pick combination, document in chart header)**

1. **Keep** left axis = pass (or total volume) counts; right axis = fail counts. Do not merge to single axis.
2. **Integer right-axis ticks** only (`minInterval: 1`, max at least 1).
3. **Tooltip is the source of truth** — every hover shows:
   - Passed / Failed / Total  
   - **Failure rate %** for that bucket  
   - Optional: “Low sample (n&lt;10)” badge when total is small  
4. **Encode rate without removing dual count axes** (choose ≥1):
   - **B1 — Point emphasis by rate:** fail markers scale or stroke-width by rate (or ring when rate &gt; threshold); absolute Y still = count.
   - **B2 — Sample-size cue on bars:** bar opacity or width cue when n is small; or hatch/outline when `total &lt; N`.
   - **B3 — Rate reference in tooltip + subtitle only** (minimum bar).
   - **B4 — Optional third encoding (not a third axis):** small % label above fail points when rate ≥ threshold **or** when n &lt; N (avoid clutter).
5. **Area fill:** reduce opacity or drop area under fail line when max fails is tiny so the line doesn’t dominate ink; keep line + symbols.
6. **Legend / title:** keep dual-scale callout but shorten: e.g. title badge `Fails →` with right-axis color; avoid repeating “Failed (right scale)” three times (title + legend + caption).
7. **Threshold defaults** (tunable constants in `chart-theme` or component):
   - `LOW_SAMPLE_N = 10` (or 5)
   - `HIGH_RATE_PCT = 5` (or 10)
8. Document in `info-tooltip` / help: “Left = pass volume; right = fail **count**. Hover for rate — a short bar with a high fail point is riskier than a tall bar with one fail.”

**Primary files**

- `src/components/chart-area-interactive.tsx`
- `src/lib/chart-theme.ts`
- `src/hooks/useBucketStats.ts` (if rate-per-bucket not already available client-side)

**Acceptance**

- [ ] Dual axes still present (left volume/pass, right fail count).
- [ ] Tooltip always shows failure **rate** and counts.
- [ ] Visual difference between low-n high-rate and high-n low-rate is obvious in side-by-side screenshot (construct fixture or use All-time Sep’25 peak vs quiet months).
- [ ] Right axis integer ticks; no half-fail scale like `2.5` for integer data.
- [ ] Light + dark screenshots of Test volume.

**Out of scope for O2**

- Removing dual axes or forcing stacked single-axis as the only view.
- A third permanent Y-axis for rate (optional later experiment only).

---

## Batch C — Rate strip & calendar

### O4 · Adaptive failure-rate strip Y-scale + sparse series markers

| | |
|--|--|
| **Priority** | P0 |
| **Review ref** | P0 #4 |
| **Problem** | Fixed ~0–50% scale flattens real ~1–3% movement. |

**Work**

1. Adaptive `yMax = max(floorPct, ceil(1.2 × dataMax))` with sensible floor (e.g. 5%) and cap (e.g. 50% or 100%).
2. Show symbols on sparse series; optional target band if product has a SLA.
3. If period is very short / flat, consider sparkline treatment (height) without removing the strip.

**Primary files**

- `src/components/dashboard/failure-rate-strip.tsx`
- `src/lib/chart-theme.ts`

**Acceptance**

- [ ] 30d default shows visible movement when rate varies within 0–5%.
- [ ] Scale never clips data; never forces 50% when max is 2%.

---

### O9 · Sparse calendar axis honesty

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P1 #9 |
| **Problem** | Day axis jumps Jul 8 → Jul 16; unclear if plant stopped or axis omits zeros. |

**Work**

1. For continuous dashboard ranges + day bucket: include zero-volume days **or** explicitly label mode “Active test days only”.
2. Prefer continuous domain for executive windows (7d/30d/90d); “active only” only if labeled.
3. Align strip + volume to same bucket domain policy.

**Primary files**

- `src/hooks/useBucketStats.ts` / API bucketing
- `src/components/chart-area-interactive.tsx`
- `src/components/dashboard/failure-rate-strip.tsx`

**Acceptance**

- [ ] 30d day view either shows empty days at 0 or a clear “active days” subtitle.
- [ ] No silent multi-day jumps without explanation.

---

## Batch D — Copy, mode, CTAs

### O5 · Demote permanent methodology copy into one help surface

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P1 #6 |
| **Problem** | Every card and chart carries long definitions; power users pay a reading tax. |

**Work**

1. Keep labels + numbers + trends on cards by default.
2. Single `info-tooltip` (or “How metrics work” in More) covering: latest-per-inverter, prior period, dual axes, annotation filter, table link.
3. Truncate Failures card disclaimer; move dual-definition text into O1 labels + help.
4. Chart: one short subtitle line max; rest in tooltip.

**Primary files**

- `src/components/dashboard/hero-metrics.tsx`
- `src/components/chart-area-interactive.tsx`
- `src/components/dashboard/dashboard-header.tsx`
- `src/components/ui/info-tooltip.tsx`

**Acceptance**

- [ ] Default hero cards ≤1 short caption line each (no multi-clause footnotes).
- [ ] Help still explains all definitions.

---

### O6 · Surfaced result mode (Latest / All tests)

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P1 #13 |
| **Problem** | `chartMode` rewrites every metric but lives only under More. |

**Work**

1. Compact toggle next to period pills (or under header): **Latest** | **All tests**.
2. Persist existing prefs; show header badge when not default if needed: `Latest · 30d`.
3. Keep More for custom range + link sync + advanced copy.

**Primary files**

- `src/components/dashboard/dashboard-header.tsx`
- `src/app/page.tsx`
- `src/lib/dashboard-prefs.ts`

**Acceptance**

- [ ] Mode visible without opening More.
- [ ] Mode change updates captions/charts without full empty remount flash.

---

### O13 · Failures CTA affordance

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P1 #7 |
| **Problem** | “Click to view in table ↓” looks like a caption; ↓ implies content below, not a scroll jump. |

**Work**

1. Whole Failures value (or card) clearly clickable; button text like `View fails` / `View 4 fails`.
2. After click: status=FAIL + scroll; optional toast or `aria-live`.
3. Optional URL hash `#test-table` + filter state for shareability.

**Primary files**

- `src/components/dashboard/hero-metrics.tsx`
- `src/app/page.tsx`

**Acceptance**

- [ ] Obvious interactive affordance (hover, focus ring, cursor).
- [ ] Lands on FAIL-filtered table consistently with O1.

---

## Batch E — Causes, empty, chrome

### O7 · Failure causes empty / untagged-only state

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P1 #8 |
| **Problem** | Full card for `Untagged 4/4` with no taxonomy is weak. |

**Work**

1. If `totalFailed === 0`: compact “No failed tests” or hide card.
2. If fails but no tags: primary CTA **Tag N fails** → `/todo` period-scoped; caveat on destination, not 10px under chip.
3. When tags exist: optional relative bar / % on chips (counts already present).

**Primary files**

- `src/components/dashboard/annotation-insights.tsx`

**Acceptance**

- [ ] Untagged-only state has a clear action, not only a lonely chip.
- [ ] Caveat about latest-per-inverter vs todo list not crowding the chip row.

---

### O8 · Empty-state tone (ops-default, optional wit)

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P1 #12 |
| **Problem** | “0° of drama” may not fit escalations. |

**Work**

1. Default copy: factual (“No tests in the last 7 days”) + short reasons + CTAs.
2. Keep “Show all time” / “Pick another range”.
3. Optional playful line behind flag or only in dev — product choice; default professional.

**Primary files**

- `src/components/dashboard/dashboard-empty-state.tsx`

**Acceptance**

- [ ] Empty state remains full-viewport recovery UX.
- [ ] Primary CTA still widens range; copy acceptable in an outage review.

---

### O11 · Sticky period / command chrome

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P1 #11 |
| **Problem** | Long table; period pills scroll away. |

**Work**

1. Sticky header (`top-0 z-20`) with backdrop blur: title + period + mode + More/Export.
2. Optional slim context: active dates · active annotation chip.

**Primary files**

- `src/components/dashboard/dashboard-header.tsx`
- `src/app/page.tsx` / layout wrappers
- `src/app/globals.css` if needed

**Acceptance**

- [ ] Period controls usable while scrolled mid-table.
- [ ] Does not cover table sticky header incorrectly (z-index order verified).

---

## Batch F — Loading, mobile, timezone

### O10 · Skeleton honesty (no fake bar geometry)

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P1 #10 |
| **Problem** | Ghost bars look like empty volume data while KPIs are 0. |

**Work**

1. Replace chart skeletons that mimic bar charts with non-data shimmer blocks.
2. Never show synthetic series shapes as placeholders.

**Primary files**

- `src/components/chart-area-interactive.tsx`
- `src/components/dashboard/failure-rate-strip.tsx`
- related skeleton CSS

**Acceptance**

- [ ] Loading state not confusable with zero-volume data.
- [ ] Soft refresh still freezes last series (existing behavior).

---

### O12 · Mobile progressive disclosure

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P1 #14 |
| **Problem** | Truncated Failures copy; dual-axis hard on 390px. |

**Work**

1. Short mobile captions; no mid-word truncation of definitions.
2. Dual axes kept; ensure tooltip + legend usable; consider slightly taller chart on mobile.
3. Touch targets ≥32px for chips / pills.

**Primary files**

- `src/components/dashboard/hero-metrics.tsx`
- `src/components/chart-area-interactive.tsx`
- `src/components/dashboard/annotation-insights.tsx`

**Acceptance**

- [ ] 390×844 screenshot: no critical truncation; charts readable.
- [ ] Period + mode reachable.

---

### O14 · Single timezone story

| | |
|--|--|
| **Priority** | P1 |
| **Review ref** | P0 #5 / P1 |
| **Problem** | More sheet “UTC” custom range vs table `EDT` timestamps. |

**Work**

1. Decide plant-local vs UTC (product). Recommend **one labeled TZ** everywhere.
2. Custom range, table filters, bucket keys, export windows use same clock.
3. Label controls: `Custom range (America/Toronto)` or whatever is chosen.

**Primary files**

- `src/components/dashboard/dashboard-header.tsx`
- `src/contexts/TimezoneContext.tsx` / `timezone-selector.tsx`
- `src/lib/dashboard-range.ts`
- stats window helpers

**Acceptance**

- [ ] No unlabeled UTC vs local contradiction on the main dashboard.
- [ ] Boundary-day drill matches table day for a known fixture.

---

## Batch G — Medium craft (P2)

### O15 · Pill label consistency (`90d` vs “3 months”)

- Align visual, aria, and mobile dropdown labels.
- Files: `dashboard-header.tsx`

### O16 · `all` time: one “No prior period”, not three

- Shared compare footer or hide trend row for `kind === "all"`.
- Files: `hero-metrics.tsx`

### O17 · Table filter bar grouping

- Group scope (dates, latest) vs attributes (status, annotation, FW).
- Active filter chips row.
- Files: `data-table.tsx`

### O18 · Semantic tint for elevated failure rate

- Threshold-based mild color + non-color cue.
- Files: `hero-metrics.tsx`

### O19 · Trend a11y

- Icons already present; verify contrast and not color-only meaning.
- Files: `hero-metrics.tsx`

### O20 · Disable nonsensical Group-by options

- Dim Quarter/Year on short ranges with tooltip.
- Files: `chart-area-interactive.tsx`, `dashboard-range` / bucket helpers

### O21 · Chart drill affordance

- Cursor + tooltip “Filter table to …”; dismissible filter chip after click.
- Files: `chart-area-interactive.tsx`, `page.tsx`

### O22 · Chip touch targets

- Min 32px hit area on touch for failure-cause chips.
- Files: `annotation-insights.tsx`

### O23 · Theme control discoverability

- Theme in More or user menu (sidebar-only is easy to miss).
- Files: `dashboard-header.tsx`, `hover-sidebar.tsx`

### O24 · Floating `N` control

- Identify product vs third-party; clarify avatar menu or remove from product surface.
- Files: layout / user menu components

### O25 · Header context dates

- Subtitle `Jun 29 – Jul 29` next to period when useful.
- Files: `dashboard-header.tsx`

### O26 · Annotations column density

- Reduce min-width or collapse when all empty for filter.
- Files: `data-table.tsx`

### O27 · Selection chrome

- Hide “0 of N selected” until ≥1; sticky bulk bar when selected.
- Files: `data-table.tsx`

### O28 · Export respects user filters (or hard-disable)

- Prefer filter-aware export; else disable with clear reason when custom/annotation active.
- Files: `dashboard-header.tsx`, export API routes

### O29 · Dark mode contrast pass

- Borders, inactive pills, chart gridlines one step up.
- Files: `globals.css`, chart theme, header toggles

### O30 · Untagged caveat placement

- Move latest-vs-todo caveat to `/todo` banner.
- Files: `annotation-insights.tsx`, todo page

---

## Batch H — Nits (P3, opportunistic)

| ID | Item | Notes |
|----|------|--------|
| O31 | “Data as of” / last refresh | Near header |
| O32 | Keyboard / chart legend help | `?` or footer |
| O33 | Segmented control visual system | Period vs More outline |
| O34 | RollingNumber layout stability | Verify mid-anim; `aria-busy` + announce final |
| O35 | Locale consistency dates | Chart mon-day vs table numeric |
| O36 | “FW” column abbrev | `title` full name |
| O37 | Duration near-complete tint | Optional |
| O38 | Empty always offers custom range | Wire `onWidenRange` |
| O39 | Prefs-load: skeleton pills not faded live control | Header |
| O40 | Hero gradients commit or remove | Cards |
| O41 | Integer right-axis ticks | Part of O2 |
| O42 | Legend vs tall bars collision | Pin to header |
| O43 | Title Case vs ALL CAPS labels | Design tokens |
| O44 | Section title voice (strip vs volume) | Consistency |
| O45 | Mobile “30 days” vs desktop “30d” | Same tokens as O15 |
| O46 | Sidebar first-visit peek | Nav discoverability |
| O47 | Focus ring keyboard pass | Pills, chips, CTA |
| O48 | RollingNumber SR intermediate digits | `aria-live` policy |
| O49 | Empty mono joke line | Covered by O8 |
| O50 | Collapsible charts when table-primary | Optional later |

---

## Explicit non-goals

- Removing dual Y-axes on Test volume.
- Full redesign of test detail page (separate from this plan).
- Auth / schema changes.
- Building a third permanent rate Y-axis unless explicitly greenlit later.

---

## Definition of done (per item)

1. Code change + `npm run lint` clean on touched files.
2. Manual check of affected period states (at least 30d + one empty or All if relevant).
3. **Screenshots** of changed UI (light + dark when visual) per project UI verification rule.
4. Check off acceptance boxes in this file (or PR description referencing item ID).

---

## Progress tracker

| ID | Status | Notes |
|----|--------|-------|
| O1 | **done** (partial A2) | Dual-definition labels + clearer Failures CTA; full table reconcile deferred |
| O2 | **done** | Dual axes kept; tooltip rate, low-sample cues, integer right axis, risk markers |
| O3 | **done** | Absolute + % deltas; tooltip prior window; `pts` not `pp` |
| O4 | **done** | Percentage-friendly niceRateMax (peak~20 → 25 not 50); skeleton non-bars |
| O5 | **done** | Header help tooltip; hero ≤1 caption line; chart single subtitle |
| O6 | **done** | Latest / All tests toggle on header (mobile select) |
| O7 | **done** | Untagged-only callout + Tag N fails; no failures compact; caveat → /todo |
| O8 | **done** | Ops-default empty copy; Show all time + Custom range wired |
| O9 | **done** | Continuous day fill (≤120d); strip + volume aligned; “all calendar days” |
| O10 | **done** | Chart + strip skeletons are plain pulse (not fake bars) |
| O11 | **done** | Sticky header z-20 + backdrop blur |
| O12 | **done** | Mobile captions wrap; taller chart; touch targets; compact header |
| O13 | **done** | View N fails CTA; toast + aria-live; #test-table hash |
| O14 | **done** | UTC calendar days labeled; table display TZ separate; filter uses UTC |
| O15 | **done** | 90d / 90 days aligned (not “3 months”) |
| O16 | **done** | Single all-time “no prior period” note |
| O17 | skipped | Table filter regroup deferred |
| O18 | **done** | Watch / Elevated failure-rate tint + badge |
| O19 | **done** | Trend aria-label with direction/quality |
| O20 | **done** | Disable invalid Group-by + soft clamp |
| O21 | **done** | Tooltip drill hint + clearer filter chips |
| O22 | **done** | Chip min-h earlier in Batch E |
| O23 | **done** | Theme Light/Dark/System in More |
| O24 | n/a | Floating N = Next.js/dev overlay (not product) |
| O25 | **done** | UTC span label in header (lg+) |
| O26 | **done** | Narrow empty annotations column |
| O27 | **done** | Selection count only when selected |
| O28 | **done** | Export disabled messaging for custom |
| O29 | **done** | Dark muted/border/grid contrast bump |
| O30 | **done** | Todo banner earlier in Batch E |
| O31 | **done** | “Updated HH:MM” next to header date span |
| O32 | **done** (light) | Drill hint on volume chart (prior batches) |
| O33 | **done** (light) | Period + mode share outline toggle system |
| O34 | **done** | RollingNumber aria-busy; no mid-tick SR spam |
| O35 | **done** | Table timestamps mon-day style (match charts) |
| O36 | **done** | FW column abbrev + title |
| O37 | **done** | Duration ≥15.5h emerald tint |
| O38 | **done** | Empty custom range earlier (Batch E) |
| O39 | **done** | Prefs-load pulse mute on pills/mode |
| O40 | **done** (commit) | Hero gradients kept (semantic tints O18) |
| O41 | **done** | Integer right-axis ticks (O2) |
| O42 | **done** | Legend pinned top-left |
| O43 | **done** | Failure-rate strip Title Case |
| O44 | **done** | Section voice aligned with Test volume |
| O45 | **done** | O15 tokens |
| O46 | skipped | Sidebar first-visit peek (nav polish later) |
| O47 | **done** | Focus rings on pills, mode, cause chips |
| O48 | **done** | RollingNumber aria-live off while spinning |
| O49 | **done** | Empty joke removed (O8) |
| O50 | skipped | Collapsible charts — optional later |

---

## Appendix A — Review mapping

| Review | Plan ID | Disposition |
|--------|---------|-------------|
| P0 #1 Hero vs table | O1 | Keep |
| P0 #2 Dual axes remove | O2 | **Rejected** — keep dual axes; improve clarity |
| P0 #3 Prior period | O3 | Keep |
| P0 #4 Rate strip scale | O4 | Keep |
| P0 #5 Timezone | O14 | Keep |
| P1 #6 Copy tax | O5 | Keep |
| P1 #7 Failures CTA | O13 | Keep |
| P1 #8 Failure causes | O7 | Keep |
| P1 #9 Sparse days | O9 | Keep |
| P1 #10 Skeletons | O10 | Keep |
| P1 #11 Sticky chrome | O11 | Keep |
| P1 #12 Empty tone | O8 | Keep |
| P1 #13 Result mode | O6 | Keep |
| P1 #14 Mobile | O12 | Keep |
| P2 #15–#30 | O15–O30 | Keep |
| P3 #31–#50 | O31–O50 | Keep |

---

## Appendix B — Dual-axis design intent (for implementers)

```
Left axis:  pass (or volume) count — "how busy was the line?"
Right axis: fail count — "how many failed units?" (CEO/CTO: must stay visible)

Rate is NOT a third axis by default. Rate is:
  - always in tooltip
  - optionally encoded via marker emphasis / low-sample cues
  - the bridge that explains why 2 fails on 4 tests is worse than 2 fails on 200 tests
```

Canonical scenarios to screenshot after O2:

1. High volume, ~1% fails (tall green, small right-axis value).  
2. Low volume, high % fails (short green, fail point emphasized + tooltip rate).  
3. Zero fails (line on baseline, no dramatic area fill).

---

*End of plan. Start with Batch A (O1 → O3), then O2 dual-axis clarity.*
