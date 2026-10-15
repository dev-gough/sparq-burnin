Unreleased

Changed
- Rework Yield & Retest around burn-in throughput. Lead with units entering burn-in per day (or week for long periods) alongside repeat runs, the average daily rate, and the previous period. Follow with first-pass yield, units cleared, the share of test capacity spent on repeats, and units held up without a passing result.
- Show why units ran again by their first result, highlighting units that had already passed, and how long units take to reach a passing result. The unit list is now a compact table that opens on held-up units.

Fixed
- Center the Yield & Retest period selector in the header, matching the other pages.
- Show first-run and run dates on Yield & Retest instead of “Invalid Date”. Timestamps that carry their own UTC offset are now read correctly everywhere times are formatted.
- Fit mobile navigation on short screens with the added FT3 link by sizing rows from the actual number of links.
