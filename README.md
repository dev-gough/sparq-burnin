# Burnin Test Dashboard

A web-based dashboard for viewing and analyzing inverter burn-in test results. This dashboard provides real-time insights into test performance, failure tracking, and historical data analysis.

## What is this?

The Burnin Test Dashboard displays test results from inverter burn-in testing operations. It allows you to:
- View daily test pass/fail statistics
- Filter and search through test records
- Track specific inverters by serial number
- Analyze test trends over time
- Download detailed reports
- Add and manage test annotations

## How to Use the Dashboard

### Dashboard Overview

When you first open the dashboard, you'll see three main sections:

1. **Summary Cards** - Quick statistics showing total tests, pass rates, and failure counts
2. **Test Results Chart** - Visual graph showing daily pass/fail trends
3. **Test Data Table** - Detailed list of all test records with filtering options

### Using the Test Results Chart

The chart at the top displays daily test results over time:

- **Green area** = Passed tests
- **Red area** = Failed tests
- **Time range options**: Choose between "Last 7 days", "Last 30 days", "Last 3 months", or "All Time"
- **View modes**:
  - **All Tests** - Shows every test result
  - **Latest per S/N** - Shows only the most recent test for each serial number

**Clicking the chart**: Click on the chart line to filter the data table below to that specific date.

**Download Options**:
- **Generate Report** - Downloads a CSV file with daily test statistics
- **Failed Test Data** - Downloads a ZIP file containing data for all failed tests

### Filtering Test Data

The data table has several powerful filtering options:

#### Search by Serial Number
Type any part of an inverter serial number in the search box to find specific units.

#### Status Filter
- **Valid Only** (default) - Shows only PASS and FAIL tests
- **All** - Shows all tests including invalid ones
- **Pass** - Shows only passed tests
- **Fail** - Shows only failed tests
- **Invalid** - Shows only invalid tests

#### Annotation Filter
Filter tests by annotation tags. Annotations are custom labels that can be added to tests for categorization (e.g., "Channel Short", "Setup Issue - DC", etc.).

#### Firmware Version Filter
Filter tests by the firmware version that was running during the test.

#### Date Range Filters
- **From Date** - Show tests starting from this date
- **To Date** - Show tests up to this date
- Use both to create a custom date range

#### Latest Only Toggle
When enabled, shows only the most recent test for each inverter serial number. Useful for checking current status of all units.

#### Filter Linking
The link/unlink button controls whether filters affect both the chart and the table:
- **Linked** (default) - Filters apply to both chart and data table
- **Unlinked** - Filters only apply to the data table

#### Clear Filters
Resets all filters to their default values.

### Viewing Test Details

Click on any row in the data table to open the detailed test page. This shows:
- Complete test information
- Time-series charts of test parameters (voltage, power, temperature, etc.)
- Failure reasons (if applicable)
- Full test logs and data

### Understanding the Data Table Columns

- **Inverter Serial Number** - Unique identifier for each unit
- **Firmware Version** - Software version running during the test
- **Test Date** - When the test was started (displayed in your selected timezone)
- **Test Duration** - How long the test ran
- **Result** - PASS, FAIL, or INVALID status
- **Annotations** - Custom notes or categories assigned to the test

### Timezone Settings

Use the timezone selector in the top-right corner to view dates and times in:
- Your local timezone
- UTC (Coordinated Universal Time)
- Delhi/Kolkata time (IST)

### Filter Persistence

Your filter settings are automatically saved in your browser. When you navigate away and return to the dashboard, your filters will be restored exactly as you left them.

## For Developers

### Prerequisites

- Node.js 18+ installed
- PostgreSQL database
- Access to test data CSV files

### Quick Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd burnin
   ```

   Please reach out to `dgough@sparqsys.com` for access to the repository.

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure the database**
   - Create a PostgreSQL database
   - Update database credentials in your environment configuration
   - Run the schema setup:
     ```bash
     npm run setup-db
     ```

4. **Import test data**
   - Place CSV files in `data/to_process/`
   - Run the ingestion script:
     ```bash
     npm run ingest
     ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

6. **Open the dashboard**
   Navigate to [http://localhost:3000](http://localhost:3000)

### Useful Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Check code quality
- `npm run ingest` - Import new CSV files from data/to_process/
- `npm run reprocess` - Clear database and re-import all processed files
- `npm run db:schema` - Reset database schema

### Technology Stack

- **Framework**: Next.js 15 (React)
- **Database**: PostgreSQL
- **UI Components**: shadcn/ui with Radix UI
- **Charts**: Apache ECharts
- **Styling**: Tailwind CSS v4

## Support

For questions or issues, contact `dgough@sparqsys.com`
