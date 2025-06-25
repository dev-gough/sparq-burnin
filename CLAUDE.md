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