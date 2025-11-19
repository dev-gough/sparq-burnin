# Configuration Setup Guide

This project uses a centralized configuration system to make it portable across different machines. All machine-specific paths and settings are stored in a `config.json` file that is ignored by git.

## Setup Instructions

### 1. Copy the Template
```bash
cp config.template.json config.json
```

### 2. Update the Configuration
Edit `config.json` and update the following sections for your machine:

#### Paths Section
```json
{
  "paths": {
    "source": {
      "results_dir": "/path/to/your/pCloudDrive/BurnInTest/results",
      "data_dir": "/path/to/your/pCloudDrive/BurnInTest/data"
    },
    "local": {
      "main_dir": "/path/to/your/burnin/data",
      "dashboard_dir": "/path/to/your/burnin",
      "log_dir": "/path/to/your/burnin/log"
    }
  }
}
```

#### Database Section
```json
{
  "database": {
    "host": "localhost",
    "port": 5432,
    "name": "burnin_dashboard",
    "user": "postgres",
    "password": "your_database_password"
  }
}
```

#### Node.js Section (if needed)
```json
{
  "node": {
    "nvm_path": "~/.nvm/versions/node/v22.*/bin",
    "fallback_to_system": true
  }
}
```

### 3. Scripts Using Configuration

The following scripts now use the centralized configuration:

- **watchdog.py** - File monitoring and ingestion automation
- **cleanup-debug-firmware.ts** - Debug firmware file cleanup
- **ingest.ts** - CSV data ingestion with database connection
- **copy_filtered_files.py** - Historical data migration

### 4. Benefits

- **Portability**: Easy to move between development machines
- **No Git Conflicts**: Machine-specific config is git-ignored
- **Centralized Settings**: Single place to update all configuration
- **Database Integration**: No more .env file issues with scripts

### 5. Configuration Options

#### Settings Section
- `check_interval`: Watchdog monitoring interval (seconds)
- `cutoff_date`: Date filter for file processing (YYYY-MM-DD)
- `debug_firmware_version`: Firmware version to exclude/mark invalid
- `max_log_size_mb`: Maximum log file size before rotation
- `log_backup_count`: Number of backup log files to keep
- `timeout.cleanup`: Cleanup script timeout (seconds)
- `timeout.ingestion`: Ingestion script timeout (seconds)

#### API Section
- `base_url`: Base URL for API endpoints

### 6. Troubleshooting

If you get a "Config file not found" error:
1. Make sure `config.json` exists in the project root
2. Verify the file is properly formatted JSON
3. Check that all required sections are present
4. Compare with `config.template.json` for reference

### 7. Security Note

The `config.json` file contains sensitive information (database passwords) and is automatically ignored by git. Never commit this file to version control.