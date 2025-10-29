import os
import shutil
import time
import datetime
import re
import logging
import subprocess
import json
from logging.handlers import RotatingFileHandler

def load_config():
    """Load configuration from config.json file."""
    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.json')
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config file not found: {config_path}. Please copy config.template.json to config.json and update the paths.")
    
    with open(config_path, 'r') as f:
        config = json.load(f)
    
    return config

# Load configuration
config = load_config()

# Extract configuration values
source_directories = config['paths']['source_directories']
main_dir = config['paths']['local']['main_dir']
to_process_dir = os.path.join(main_dir, 'to_process')
processed_dir = os.path.join(main_dir, 'processed')
check_interval = config['settings']['check_interval']
dashboard_dir = config['paths']['local']['dashboard_dir']

# Define subdirectories for tests and results within to_process
to_process_tests_dir = os.path.join(to_process_dir, 'tests')
to_process_results_dir = os.path.join(to_process_dir, 'results')

# Ensure to_process subdirectories exist
os.makedirs(to_process_tests_dir, exist_ok=True)
os.makedirs(to_process_results_dir, exist_ok=True)

# Configure logging
log_dir = config['paths']['local']['log_dir']
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, config['settings']['log_file'])
max_bytes = config['settings']['max_log_size_mb'] * 1024 * 1024
backup_count = config['settings']['log_backup_count']
file_handler = RotatingFileHandler(log_file, maxBytes=max_bytes, backupCount=backup_count)
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))

console_handler = logging.StreamHandler()
console_handler.setFormatter(logging.Formatter('%(levelname)s - %(message)s'))

logger = logging.getLogger()
logger.setLevel(logging.INFO)
logger.addHandler(file_handler)
logger.addHandler(console_handler)  # Remove this line if you want file-only logging

def parse_results_file(filename):
    """Parse results file to extract inverter S/N and timestamp."""
    # Try with seconds first (newer format)
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

    # Try without seconds (older format)
    match = re.match(r'^(.+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.csv$', filename)
    if match:
        base = os.path.splitext(filename)[0]
        parts = base.split('_')
        sn = parts[0]
        date_str = parts[1]
        time_str = parts[2]
        dt_str = date_str + ' ' + time_str + ':00'
        try:
            T = datetime.datetime.strptime(dt_str, '%Y-%m-%d %H-%M:%S')
            return sn, T
        except ValueError:
            return None
    return None

def parse_test_file(filename):
    """Parse test file to extract inverter S/N and timestamp."""
    # Try with seconds first (newer format)
    match = re.match(r'^inverter_(.+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$', filename)
    if match:
        base = os.path.splitext(filename)[0]
        parts = base.split('_')
        sn = parts[1]
        date_str = parts[2]
        time_str = parts[3]
        dt_str = date_str + ' ' + time_str
        try:
            S = datetime.datetime.strptime(dt_str, '%Y-%m-%d %H-%M-%S')
            return sn, S
        except ValueError:
            return None

    # Try without seconds (older format)
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

def run_cleanup():
    """Run the cleanup script to remove debug firmware files."""
    try:
        logger.info("Running cleanup to remove debug firmware files...")
        
        # Use nvm's Node.js path explicitly
        nvm_path = os.path.expanduser(config['node']['nvm_path'])
        import glob
        node_dirs = glob.glob(nvm_path)
        
        if node_dirs:
            # Use the nvm Node.js version
            node_bin_path = node_dirs[0]  # Take the first match
            env = os.environ.copy()
            env['PATH'] = f"{node_bin_path}:{env['PATH']}"
            logger.info(f"Using Node.js from: {node_bin_path}")
        elif config['node']['fallback_to_system']:
            # Fallback to system PATH
            env = os.environ.copy()
            logger.warning("nvm Node.js not found, using system Node.js")
        else:
            raise RuntimeError("nvm Node.js not found and fallback disabled in config")
        
        result = subprocess.run(
            ['npm', 'run', 'clean'],
            cwd=dashboard_dir,
            capture_output=True,
            text=True,
            timeout=config['settings']['timeout']['cleanup'],
            env=env
        )
        
        if result.returncode == 0:
            logger.info("Cleanup completed successfully")
            if result.stdout.strip():
                logger.info(f"Cleanup output: {result.stdout.strip()}")
            return True
        else:
            logger.error(f"Cleanup failed with return code {result.returncode}")
            if result.stderr.strip():
                logger.error(f"Cleanup error: {result.stderr.strip()}")
            return False
            
    except subprocess.TimeoutExpired:
        logger.error(f"Cleanup process timed out after {config['settings']['timeout']['cleanup']} seconds")
        return False
    except Exception as e:
        logger.error(f"Error running cleanup: {e}")
        return False

def run_ingestion():
    """Run the npm ingest command to process new files."""
    try:
        logger.info("Starting ingestion process...")

        # Use nvm's Node.js path explicitly
        nvm_path = os.path.expanduser(config['node']['nvm_path'])
        import glob
        node_dirs = glob.glob(nvm_path)

        if node_dirs:
            # Use the nvm Node.js version
            node_bin_path = node_dirs[0]  # Take the first match
            env = os.environ.copy()
            env['PATH'] = f"{node_bin_path}:{env['PATH']}"
            logger.info(f"Using Node.js from: {node_bin_path}")
        elif config['node']['fallback_to_system']:
            # Fallback to system PATH
            env = os.environ.copy()
            logger.warning("nvm Node.js not found, using system Node.js")
        else:
            raise RuntimeError("nvm Node.js not found and fallback disabled in config")

        # Check Node.js version being used
        version_check = subprocess.run(
            ['node', '--version'],
            capture_output=True,
            text=True,
            env=env
        )
        logger.info(f"Using Node.js version: {version_check.stdout.strip()}")

        # Use Popen to stream output in real-time
        process = subprocess.Popen(
            ['npm', 'run', 'ingest'],
            cwd=dashboard_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,  # Line buffered
            env=env
        )

        # Stream output line by line
        if process.stdout:
            for line in process.stdout:
                logger.info(f"[ingest] {line.rstrip()}")
        else:
            logger.info('no process.stdout??')

        # Wait for completion with timeout
        try:
            process.wait(timeout=config['settings']['timeout']['ingestion'])
            if process.returncode == 0:
                logger.info("Ingestion completed successfully")
                return True
            else:
                logger.error(f"Ingestion failed with return code {process.returncode}")
                return False
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()  # Clean up the process
            logger.error(f"Ingestion process timed out after {config['settings']['timeout']['ingestion']} seconds")
            return False

    except Exception as e:
        logger.error(f"Error running ingestion: {e}")
        return False

def main():
    cycle_count = 0
    logger.info("Watchdog started - monitoring for new files...")
    while True:
        try:
            cycle_count += 1
            logger.debug(f"Starting cycle {cycle_count}")
            
            # Check and process each source directory
            files_copied = 0
            total_results_files = 0
            
            for source_dir in source_directories:
                results_dir = source_dir['results_dir']
                data_dir = source_dir['data_dir']
                source_name = source_dir['name']
                
                # Check if source directories exist
                if not os.path.exists(results_dir):
                    logger.debug(f"Results directory does not exist for {source_name}: {results_dir}")
                    continue

                if not os.path.exists(data_dir):
                    logger.debug(f"Data directory does not exist for {source_name}: {data_dir}")
                    continue

                results_files = os.listdir(results_dir)
                total_results_files += len(results_files)
                logger.debug(f"Found {len(results_files)} files in {source_name} results directory")

                for file in results_files:
                    results_path = os.path.join(results_dir, file)
                    processed_results_path = os.path.join(processed_dir, 'results', file)  # Check in processed/results/
                    to_process_results_path = os.path.join(to_process_results_dir, file)

                    # Check if results file is already in the processed or to_process folder
                    if os.path.exists(processed_results_path) or os.path.exists(to_process_results_path):
                        # Skip logging - file already exists (reduces log spam)
                        continue
                    else:
                        results_info = parse_results_file(file)
                        if results_info:
                            sn, T = results_info
                            # Calculate 3 days before the results file's timestamp
                            three_days_before_T = T - datetime.timedelta(days=3)

                            # Find matching test files in data_dir
                            test_candidates = []
                            for test_file in os.listdir(data_dir):
                                test_info = parse_test_file(test_file)
                                if (not test_info):
                                    logger.info(f'parse_test_file failed for file: {test_file}')
                                    continue
                                if test_info and test_info[0] == sn and test_info[1] <= T:
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
                                        logger.info(f"[{source_name}] Copied {test_file} to {to_process_tests_dir} and {file} to {to_process_results_dir}")
                                        files_copied += 1
                                    else:
                                        # Still copy the results file if test file already exists
                                        shutil.copy2(results_path, os.path.join(to_process_results_dir, file))
                                        logger.info(f"[{source_name}] Test file {test_file} already exists, copied only {file} to {to_process_results_dir}")
                                        files_copied += 1
                                else:
                                    logger.warning(f"[{source_name}] Test file {test_file} is more than 3 days before results file {file}; skipping")
                            else:
                                logger.warning(f"[{source_name}] No matching test file found for {file}; skipping")
            
            # Always log a summary (heartbeat every cycle, but less verbose when no files copied)
            if files_copied > 0:
                logger.info(f"Cycle {cycle_count}: Checked {total_results_files} files across {len(source_directories)} source directories, copied {files_copied} new files")
            elif cycle_count % 10 == 0:
                logger.info(f"Cycle {cycle_count}: Checked {total_results_files} files across {len(source_directories)} source directories, copied {files_copied} new files (heartbeat)")
            else:
                logger.debug(f"Cycle {cycle_count}: No new files to copy")
            
            # Run cleanup and ingestion if new files were copied
            if files_copied > 0:
                logger.info(f"New files detected, running cleanup and ingestion process...")
                
                # First run cleanup to remove debug firmware files
                cleanup_success = run_cleanup()
                if not cleanup_success:
                    logger.warning("Cleanup failed, but continuing with ingestion...")
                
                # Then run ingestion
                ingestion_success = run_ingestion()
                if ingestion_success:
                    logger.info(f"Successfully processed {files_copied} new files")
                else:
                    logger.error("Ingestion failed - files remain in to_process directory")
                
            time.sleep(check_interval)
        except Exception as e:
            logger.error(f"Error in cycle {cycle_count}: {e}")
            time.sleep(check_interval)

if __name__ == "__main__":
    main()
