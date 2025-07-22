import os
import shutil
import datetime
import re
import logging
import csv
from logging.handlers import RotatingFileHandler

# Configuration - same as watchdog
results_dir = '/home/devy/pCloudDrive/BurnInTest/results'  # Source directory for results files
data_dir = '/home/devy/pCloudDrive/BurnInTest/data'        # Source directory for test data files
main_dir = '/home/devy/Documents/burnin/data'            # Main directory containing the two subfolders
to_process_dir = os.path.join(main_dir, 'to_process')  # Destination for new files
processed_dir = os.path.join(main_dir, 'processed')    # Directory for processed files

# Define subdirectories for tests and results within to_process
to_process_tests_dir = os.path.join(to_process_dir, 'tests')
to_process_results_dir = os.path.join(to_process_dir, 'results')

# Ensure to_process subdirectories exist
os.makedirs(to_process_tests_dir, exist_ok=True)
os.makedirs(to_process_results_dir, exist_ok=True)

# Date filter: July 15, 2025
CUTOFF_DATE = datetime.datetime(2025, 7, 11)

# Firmware version to exclude
EXCLUDED_FIRMWARE = "1.11.11"

# Configure logging
log_file = '/home/devy/Documents/burnin/log/copy_filtered.log'  
os.makedirs(os.path.dirname(log_file), exist_ok=True)
file_handler = RotatingFileHandler(log_file, maxBytes=5*1024*1024, backupCount=5)
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))

console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter('%(levelname)s - %(message)s'))

logger = logging.getLogger()
logger.setLevel(logging.INFO)
logger.addHandler(file_handler)
logger.addHandler(console_handler)

def parse_results_file(filename):
    """Parse results file to extract inverter S/N and timestamp."""
    match = re.match(r'^(.+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$', filename)
    if match:
        base = os.path.splitext(filename)[0]
        parts = base.split('_')
        sn = parts[0]
        date_str = parts[1]
        time_str = parts[2]
        dt_str = date_str + ' ' + time_str
        try:
            T = datetime.datetime.strptime(dt_str, '%Y-%m-%d %H-%M-%S')
            return sn, T
        except ValueError:
            return None
    return None

def parse_test_file(filename):
    """Parse test file to extract inverter S/N and timestamp."""
    match = re.match(r'^inverter_(.+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.csv$', filename)
    if match:
        base = os.path.splitext(filename)[0]
        parts = base.split('_')
        sn = parts[1]
        date_str = parts[2]
        time_str = parts[3]
        dt_str = date_str + ' ' + time_str + ':00'
        try:
            S = datetime.datetime.strptime(dt_str, '%Y-%m-%d %H-%M:%S')
            return sn, S
        except ValueError:
            return None
    return None

def check_firmware_version(file_path):
    """Check if results file has excluded firmware version."""
    try:
        with open(file_path, 'r') as f:
            reader = csv.reader(f)
            headers = next(reader)  # Skip header row
            if len(headers) > 3:  # Make sure we have the firmware column
                for row in reader:
                    if len(row) > 3:
                        firmware_version = row[3].strip()  # Inverter Firmware column
                        if firmware_version == EXCLUDED_FIRMWARE:
                            return True  # Exclude this file
                        break  # Only check first data row
    except Exception as e:
        logger.warning(f"Could not check firmware version for {file_path}: {e}")
        return False  # If we can't read it, don't exclude it
    return False

def main():
    logger.info("Starting filtered file copy script...")
    
    # Check if source directories exist
    if not os.path.exists(results_dir):
        logger.error(f"Results directory does not exist: {results_dir}")
        return
        
    if not os.path.exists(data_dir):
        logger.error(f"Data directory does not exist: {data_dir}")
        return
    
    results_files = os.listdir(results_dir)
    files_copied = 0
    files_skipped_date = 0
    files_skipped_firmware = 0
    files_already_exist = 0
    
    logger.info(f"Found {len(results_files)} files in results directory")
    
    for file in results_files:
        if not file.endswith('.csv'):
            continue
            
        results_path = os.path.join(results_dir, file)
        processed_results_path = os.path.join(processed_dir, 'results', file)
        to_process_results_path = os.path.join(to_process_results_dir, file)
        
        # Check if results file is already in the processed or to_process folder
        if os.path.exists(processed_results_path) or os.path.exists(to_process_results_path):
            files_already_exist += 1
            continue
        
        results_info = parse_results_file(file)
        if not results_info:
            logger.warning(f"Could not parse results file: {file}")
            continue
            
        sn, T = results_info
        
        # Filter 1: Check if file is newer than July 15, 2025
        if T <= CUTOFF_DATE:
            files_skipped_date += 1
            logger.debug(f"Skipping {file} - date {T} is not newer than {CUTOFF_DATE}")
            continue
            
        # Filter 2: Check firmware version
        if check_firmware_version(results_path):
            files_skipped_firmware += 1
            logger.info(f"Skipping {file} - has excluded firmware version {EXCLUDED_FIRMWARE}")
            continue
        
        # Calculate 3 days before the results file's timestamp
        three_days_before_T = T - datetime.timedelta(days=3)
        
        # Find matching test files in data_dir
        test_candidates = []
        for test_file in os.listdir(data_dir):
            if not test_file.endswith('.csv'):
                continue
                
            test_info = parse_test_file(test_file)
            if test_info and test_info[0] == sn and test_info[1] < T:
                test_candidates.append((test_file, test_info[1]))
                
        if test_candidates:
            # Select the latest test file before T
            test_file, S = max(test_candidates, key=lambda x: x[1])
            if S >= three_days_before_T:
                # Check if test file already exists in to_process/tests or processed/tests
                to_process_test_path = os.path.join(to_process_tests_dir, test_file)
                processed_test_path = os.path.join(processed_dir, 'tests', test_file)
                
                test_file_exists = os.path.exists(to_process_test_path) or os.path.exists(processed_test_path)
                
                if not test_file_exists:
                    # Copy test file to to_process/tests and results file to to_process/results
                    test_path = os.path.join(data_dir, test_file)
                    shutil.copy2(test_path, to_process_test_path)
                    shutil.copy2(results_path, os.path.join(to_process_results_dir, file))
                    logger.info(f"Copied {test_file} to {to_process_tests_dir} and {file} to {to_process_results_dir}")
                    files_copied += 1
                else:
                    # Still copy the results file if test file already exists
                    shutil.copy2(results_path, os.path.join(to_process_results_dir, file))
                    logger.info(f"Test file {test_file} already exists, copied only {file} to {to_process_results_dir}")
                    files_copied += 1
            else:
                logger.warning(f"Test file {test_file} is more than 3 days before results file {file}; skipping")
        else:
            logger.warning(f"No matching test file found for {file}; skipping")
    
    # Final summary
    logger.info(f"Copy operation completed:")
    logger.info(f"  Total files checked: {len([f for f in results_files if f.endswith('.csv')])}")
    logger.info(f"  Files copied: {files_copied}")
    logger.info(f"  Files already exist: {files_already_exist}")
    logger.info(f"  Files skipped (date filter): {files_skipped_date}")
    logger.info(f"  Files skipped (firmware filter): {files_skipped_firmware}")

if __name__ == "__main__":
    main()