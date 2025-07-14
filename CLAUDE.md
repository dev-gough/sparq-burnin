# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run setup-db` - Setup PostgreSQL database and schema
- `npm run ingest` - Ingest CSV files from data/to_process/ into database
- `npm run reprocess` - Clear database and re-ingest all files from data/processed/ (use when ingestion logic changes)
- `npm run db:schema` - Re-run database schema setup
- Dont ever call `npm run build`, `npm run lint` is enough to troubleshoot any errors you may find.

## Project Architecture

This is a Next.js 15 application using the App Router with a dashboard-style interface built on modern React patterns.

### Key Dependencies & Stack
- **UI Framework**: shadcn/ui components with Radix UI primitives
- **Styling**: Tailwind CSS v4 with CSS variables
- **Icons**: Tabler Icons and Lucide React
- **Data Visualization**: Recharts for charts
- **Tables**: TanStack Table for data tables
- **Theming**: next-themes for dark/light mode
- **Drag & Drop**: @dnd-kit suite
- **Validation**: Zod for schema validation

### Project Structure
- Uses TypeScript with strict mode
- Path alias `@/*` maps to `./src/*`
- Components follow shadcn/ui patterns in `src/components/ui/`
- Main application components in `src/components/`
- Data files stored as JSON in app directories

### Component Architecture
- Main layout uses a sidebar pattern (AppSidebar) with collapsible navigation
- Dashboard-style interface with charts, data tables, and cards
- Uses Geist font family (sans and mono variants)
- Component composition follows compound component patterns

### Data Patterns
- JSON data files co-located with pages
- Data table implementation uses TanStack Table
- Chart components built with Recharts
- Form validation with Zod schemas

### UI Patterns
- Uses CSS variables for theming
- Responsive design with container queries (@container)
- Consistent spacing with gap utilities
- Component variants using class-variance-authority

## Full-Screen Chart Feature

### Implemented Features (Completed)
- **Full-screen modal system** - Portal-based overlay with dark background
- **State inheritance** - Transfers selected columns, zoom level, and decimation settings from source chart
- **Adaptive decimation** - Intelligently decimates zoomed data slices to maintain ~1000 points at any zoom level
- **Decimation toggle** - Button to enable/disable decimation with cookie persistence
- **Enhanced column grouping** - 6 logical groups in ultra-compact single-row layout:
  - Power Generation (VPV, PPV)
  - Energy & Efficiency (EPV, active/reactive energy)
  - Grid Connection (grid voltages, power, frequency)
  - Current Latch (instantaneous current latch readings)
  - Voltage Latch (instantaneous voltage latch readings)
  - System Status (temperature, status flags, diagnostics)
- **Quick presets** - One-click selections for common column combinations
- **Keyboard shortcuts** - ESC to close fullscreen
- **All zoom/pan functionality** - Inherited from original charts

### Future Enhancements (To Be Implemented)

#### 1. Enhanced Responsive Design
**Priority:** Medium | **Effort:** Medium

**Why:** Current fullscreen is desktop-optimized, mobile experience could be improved

**Implementation Strategy:**
- Responsive breakpoints with adaptive layouts
- Touch-friendly interactions (larger buttons, gesture support)
- Mobile-specific column selector (bottom sheet UI)
- Adaptive modal sizing based on screen size

**Technical Details:**
```typescript
// Dynamic sizing based on screen
const getModalSize = (screenSize: string) => {
  switch (screenSize) {
    case 'mobile': return 'fixed inset-2'
    case 'tablet': return 'w-[90vw] h-[90vh] max-w-4xl'
    case 'desktop': return 'w-[95vw] h-[95vh] max-w-7xl'
  }
}
```

#### 2. Export Functionality
**Priority:** High | **Effort:** High

**Why:** Users need to export visible data and screenshots for analysis/reporting

**Implementation Strategy:**
- Multi-format export (PNG, SVG, CSV, JSON, Excel, PDF)
- Smart data export (only visible/selected columns)
- High-quality screenshots with html2canvas
- Metadata inclusion (chart title, zoom level, timestamp)

**Technical Details:**
```typescript
const exportOptions = {
  screenshot: { formats: ["png", "jpeg", "svg"] },
  data: { formats: ["csv", "json", "xlsx"] },
  report: { formats: ["pdf"] }
}
```

**UI Integration:**
- Export dropdown in fullscreen header
- Custom naming with templates
- Quality/resolution options
- Batch export (all 3 charts at once)

#### 3. Advanced Chart Interactions
**Priority:** Low | **Effort:** Medium

**Why:** Enhanced user experience for data exploration

**Implementation Strategy:**
- Mouse wheel zoom support
- Drag-to-pan on chart area
- Crosshair cursor with value display
- Chart annotation tools
- Data point selection and highlighting

**Technical Details:**
- Integrate with Recharts event handlers
- Custom zoom/pan logic beyond current button controls
- Overlay components for annotations