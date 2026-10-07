# Mobile layout review

The mobile shell applies below 768px. The desktop navigation rail and page layouts keep their existing dimensions. Phone navigation uses a top sheet with route links, account controls, theme and timezone preferences. Dashboard and analytics headers give period controls their own row. Tests, todo items and contributors use mobile cards; test charts and annotations stack, with an annotations shortcut. Station controls wrap, chart labels thin out, and dialogs and popovers fit short viewports.

## Repeat the screenshot checks

Start a local development server with authentication bypassed:

```sh
SKIP_AUTH=true npm run dev -- --hostname 127.0.0.1 --port 3100
```

In another terminal:

```sh
npm run test:mobile
```

The script uses system Chromium if present; otherwise install Playwright's browser with `npx playwright install chromium`. Set `CHROMIUM_PATH` to choose a different Chromium executable. `BASE_URL`, `OUTPUT_DIR` and comma-separated `WIDTHS` can override the local URL, screenshot destination and viewport matrix. It only accepts loopback URLs and intercepts API calls with representative fixtures, including station administration; it does not modify a database.

The default matrix covers all 11 page routes at 320, 390, 768 and 1440 pixels. It checks page overflow, chart resizing and browser runtime errors, then exercises navigation, route dismissal, Escape, date selection controls, dashboard options, rolling chart controls, test fullscreen, annotations, status history, landscape scrolling, theme changes and resizing with navigation open. Screenshots include each route, scrolling sections and overlays. Output defaults to `/tmp/burnin-mobile-review`, including `layout-report.json` with geometry for desktop comparisons.

The initial review also compared the visible heading, card and chart geometry at 1440px against the unchanged checkout. All 11 routes matched. Screenshots use fixture data because the local database did not return usable data for several endpoints; production data and iOS Safari were not available to this automated check.
