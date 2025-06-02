# Database Setup and CSV Ingestion

This document describes the PostgreSQL database setup and CSV ingestion process for the burnin dashboard application.

## Database Schema

The database consists of three main tables:

### Inverters
- `inv_id` (SERIAL PRIMARY KEY) - Unique inverter identifier
- `serial_number` (VARCHAR(50) UNIQUE) - Inverter serial number extracted from CSV files
- `created_at` (TIMESTAMP) - Record creation timestamp

### Tests
- `test_id` (SERIAL PRIMARY KEY) - Unique test identifier
- `inv_id` (INTEGER) - Foreign key to Inverters table
- `start_time` (TIMESTAMP) - Test start time
- `end_time` (TIMESTAMP) - Test end time
- `firmware_version` (VARCHAR(20)) - Inverter firmware version
- `overall_status` (VARCHAR(10)) - Overall test status (PASS/FAIL)
- `ac_status`, `ch1_status`, `ch2_status`, `ch3_status`, `ch4_status` (VARCHAR(10)) - Channel status
- `status_flags` (TEXT) - Status flags from test
- `failure_description` (TEXT) - Description of any failures
- `source_file` (VARCHAR(255)) - Original CSV filename
- `created_at` (TIMESTAMP) - Record creation timestamp

### TestData
- `data_id` (SERIAL PRIMARY KEY) - Unique data point identifier
- `test_id` (INTEGER) - Foreign key to Tests table
- `timestamp` (TIMESTAMP) - Data point timestamp
- Multiple measurement columns (vgrid, pgrid, qgrid, vpv1-4, ppv1-4, etc.)
- `source_file` (VARCHAR(255)) - Original CSV filename
- `created_at` (TIMESTAMP) - Record creation timestamp

## Quick Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Setup PostgreSQL database:**
   ```bash
   npm run setup-db
   ```

3. **Configure environment (optional):**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

4. **Ingest CSV files:**
   ```bash
   npm run ingest
   ```

## Detailed Setup

### Prerequisites
- PostgreSQL installed and running
- Node.js and npm installed

### Database Setup

1. **Create database and schema:**
   ```bash
   ./scripts/setup.sh
   ```
   
   Or manually:
   ```bash
   createdb burnin_dashboard
   psql -d burnin_dashboard -f scripts/setup-database.sql
   ```

2. **Verify setup:**
   ```bash
   psql -d burnin_dashboard -c "\\dt"
   ```

### CSV File Structure

#### Results Files (`/data/to_process/results/`)
CSV files containing test metadata with columns:
- Start Time
- End Time  
- Serial Number
- Inverter Firmware
- Overall, AC, CH1, CH2, CH3, CH4 (status columns)
- Status Flags
- Failure Description

#### Test Data Files (`/data/to_process/tests/`)
CSV files containing time-series measurement data with columns:
- Timestamp
- Vgrid, Pgrid, Qgrid (grid measurements)
- Vpv1-4, Ppv1-4 (PV measurements)
- Frequency, Vbus, Temperature
- Various status and latch values

### Ingestion Process

The ingestion script (`scripts/ingest-csv.ts`):

1. **Processes Results CSV files:**
   - Creates inverter records if they don't exist
   - Inserts test metadata into Tests table
   - Maps CSV columns to database fields

2. **Processes Test Data CSV files:**
   - Links data to existing test records by inverter serial number
   - Inserts time-series data in batches for performance
   - Handles missing/null values gracefully

3. **File Management:**
   - Moves processed files to `/data/processed/` directories
   - Preserves original filenames for audit trail

### Running Ingestion

```bash
# Process all CSV files in /data/to_process/
npm run ingest

# The script will:
# 1. Process all files in data/to_process/results/
# 2. Process all files in data/to_process/tests/
# 3. Move processed files to data/processed/
```

### Environment Variables

Create `.env` file with:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=burnin_dashboard
DB_USER=postgres
DB_PASSWORD=postgres
```

### Database Queries

#### View test summary:
```sql
SELECT * FROM test_summary ORDER BY start_time DESC;
```

#### Get test data for specific test:
```sql
SELECT * FROM TestData WHERE test_id = 1 ORDER BY timestamp;
```

#### Find tests by inverter:
```sql
SELECT t.*, i.serial_number 
FROM Tests t 
JOIN Inverters i ON t.inv_id = i.inv_id 
WHERE i.serial_number = '190825180351';
```

### Troubleshooting

1. **Connection issues:**
   - Verify PostgreSQL is running: `pg_isready`
   - Check credentials in `.env` file

2. **Schema issues:**
   - Re-run schema setup: `npm run db:schema`

3. **File processing errors:**
   - Check CSV file format matches expected structure
   - Verify file permissions in data directories

4. **Performance:**
   - Large CSV files are processed in batches of 1000 rows
   - Monitor PostgreSQL logs for slow queries