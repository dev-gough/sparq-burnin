import os
import shutil
import time
import datetime
import re
import logging
import subprocess
import json
import psutil
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

# Lock file for preventing concurrent ingestion
LOCK_FILE = os.path.join(main_dir, '.ingestion.lock')
STALE_LOCK_TIMEOUT = 7200  # 2 hours - consider lock stale if older than this

# Ops status for Control Center (read by GET /api/health)
OPS_DIR = os.path.join(main_dir, '.ops')
WATCHDOG_STATUS_FILE = os.path.join(OPS_DIR, 'watchdog-status.json')
QUARANTINE_DIR = os.path.join(main_dir, 'quarantine')
RECOVERY_DIR = os.path.join(main_dir, 'recovery')


def load_tree_basenames(root, kind):
    """Basenames under root/{kind} or root/*/kind."""
    names = set()
    if not os.path.isdir(root):
        return names
    flat = os.path.join(root, kind)
    if os.path.isdir(flat):
        try:
            names.update(os.listdir(flat))
        except OSError:
            pass
    try:
        batches = os.listdir(root)
    except OSError:
        return names
    for batch in batches:
        batch_dir = os.path.join(root, batch, kind)
        if os.path.isdir(batch_dir):
            try:
                names.update(os.listdir(batch_dir))
            except OSError:
                continue
    return names


def load_parked_names(kind):
    """Basenames already parked under quarantine/ or recovery/."""
    names = load_tree_basenames(QUARANTINE_DIR, kind)
    names.update(load_tree_basenames(RECOVERY_DIR, kind))
    return names


def load_quarantine_names(kind):
    """Back-compat alias — includes recovery/ so leftovers stay parked."""
    return load_parked_names(kind)


def already_tracked(filename, kind, quarantine_names, ingested_names=None):
    """Where we already have this basename, if anywhere.

    to_process  — sitting in the live queue
    processed   — successfully ingested (files on disk)
    quarantine  — unmatched slush or recovery park, do not recopy from pCloud
    ingested    — Tests/TestData.source_file (survives a DB-only restore)
    """
    if os.path.exists(os.path.join(main_dir, 'to_process', kind, filename)):
        return 'to_process'
    if os.path.exists(os.path.join(main_dir, 'processed', kind, filename)):
        return 'processed'
    if filename in quarantine_names:
        return 'quarantine'
    if ingested_names and filename in ingested_names:
        return 'ingested'
    return None


def load_ingested_names():
    """Basenames already stored in Tests.source_file.

    Lab often restores the prod DB without prod's processed/ tree. File-only
    tracking then recopies every historical pCloud pair. Tests.source_file is
    the results basename; we also add the matching inverter_* test name so
    leftover extra results still see the test as ingested.

    HTTPS rows use source_file 'https:…' and are ignored (they will not match
    a CSV basename). Does not scan TestData — that table is huge.
    """
    names = set()
    db = config.get('database') or {}
    host = str(db.get('host') or 'localhost')
    port = str(db.get('port') or 5432)
    name = db.get('name')
    user = db.get('user')
    if not name or not user:
        logger.warning("database.name/user missing in config; cannot skip already-ingested files")
        return names

    env = os.environ.copy()
    if db.get('password') is not None:
        env['PGPASSWORD'] = str(db['password'])

    sql = "SELECT source_file FROM Tests WHERE source_file IS NOT NULL"
    cmd = [
        'psql',
        '-h', host,
        '-p', port,
        '-U', str(user),
        '-d', str(name),
        '-tAc', sql,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
    except FileNotFoundError:
        logger.warning("psql not on PATH; cannot skip already-ingested pCloud files")
        return names
    except subprocess.TimeoutExpired:
        logger.warning("psql timed out loading ingested filenames")
        return names

    if result.returncode != 0:
        err = (result.stderr or result.stdout or '').strip().splitlines()
        logger.warning(
            "psql failed loading ingested filenames (exit %s): %s",
            result.returncode,
            err[-1] if err else 'no output',
        )
        return names

    for line in result.stdout.splitlines():
        raw = line.strip()
        if not raw or raw.startswith('https:'):
            continue
        base = os.path.basename(raw)
        names.add(base)
        if not base.startswith('inverter_'):
            names.add('inverter_' + base)

    logger.info(f"Loaded {len(names)} ingested filenames from database")
    return names


def index_test_files(data_dir):
    """Parse pCloud test names once per source, grouped by serial.

    Returns (by_serial, results_named_count). Results-shaped names in the
    test directory are leftover misfiles, not parse errors.
    """
    by_sn = {}
    results_named = 0
    try:
        names = os.listdir(data_dir)
    except OSError as e:
        logger.warning(f"Could not list test directory {data_dir}: {e}")
        return by_sn, results_named
    for test_file in names:
        test_info = parse_test_file(test_file)
        if not test_info:
            if parse_results_file(test_file):
                results_named += 1
                continue
            if "conflicted" not in test_file and "Copy" not in test_file:
                logger.info(f'parse_test_file failed for file: {test_file}')
            continue
        sn, started = test_info
        by_sn.setdefault(sn, []).append((test_file, started))
    return by_sn, results_named


def copy_action_for_test(test_where):
    """What to copy given where the matching test already lives.

    None            — new pair, copy test + results
    to_process      — test waiting in the queue, copy late-arriving results
    processed       — already ingested with its pair; extra pCloud results
                      cannot pair (ingest only looks in to_process/tests)
    ingested        — already in the DB (source_file), even if processed/ is empty
    quarantine      — parked slush; do not drop an orphan results file
    """
    if test_where is None:
        return 'both'
    if test_where == 'to_process':
        return 'results'
    return None


def write_watchdog_status(payload: dict) -> None:
    """Atomically write watchdog cycle status for Control Center health metrics."""
    try:
        os.makedirs(OPS_DIR, exist_ok=True)
        data = {
            **payload,
            'updatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
            'checkIntervalSec': check_interval,
            'pid': os.getpid(),
        }
        tmp = WATCHDOG_STATUS_FILE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, WATCHDOG_STATUS_FILE)
    except Exception as e:
        logger.warning(f"Failed to write watchdog status: {e}")

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

def is_process_running(pid):
    """Check if a process with the given PID is running."""
    try:
        return psutil.pid_exists(pid)
    except:
        return False

def acquire_lock():
    """
    Attempt to acquire the ingestion lock.
    Returns True if lock was acquired, False if another process holds it.
    """
    if os.path.exists(LOCK_FILE):
        # Check if lock is stale
        try:
            lock_age = time.time() - os.path.getmtime(LOCK_FILE)

            # Read PID from lock file
            with open(LOCK_FILE, 'r') as f:
                lock_data = json.load(f)
                lock_pid = lock_data.get('pid')
                lock_timestamp = lock_data.get('timestamp')

            # Check if process is still running
            if lock_pid and is_process_running(lock_pid):
                logger.warning(f"Ingestion already running (PID: {lock_pid}, started: {lock_timestamp}). Skipping this cycle.")
                return False
            else:
                # Lock file exists but process is dead - clean up stale lock
                logger.warning(f"Found stale lock file (PID {lock_pid} not running). Cleaning up and acquiring new lock.")
                os.remove(LOCK_FILE)
        except (json.JSONDecodeError, KeyError, FileNotFoundError) as e:
            # Corrupt or old format lock file
            if lock_age > STALE_LOCK_TIMEOUT:
                logger.warning(f"Found stale/corrupt lock file (age: {lock_age:.0f}s). Removing and acquiring new lock.")
                os.remove(LOCK_FILE)
            else:
                logger.warning(f"Lock file exists but couldn't read it. Waiting for timeout. Age: {lock_age:.0f}s")
                return False

    # Create new lock file
    try:
        lock_data = {
            'pid': os.getpid(),
            'timestamp': datetime.datetime.now().isoformat(),
            'hostname': os.uname().nodename
        }
        with open(LOCK_FILE, 'w') as f:
            json.dump(lock_data, f)
        logger.info(f"Acquired ingestion lock (PID: {os.getpid()})")
        return True
    except Exception as e:
        logger.error(f"Failed to create lock file: {e}")
        return False

def release_lock():
    """Release the ingestion lock."""
    try:
        if os.path.exists(LOCK_FILE):
            os.remove(LOCK_FILE)
            logger.info("Released ingestion lock")
    except Exception as e:
        logger.error(f"Failed to remove lock file: {e}")

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
    finally:
        # Always release the lock when ingestion completes, fails, or times out
        release_lock()

def main():
    cycle_count = 0
    logger.info("Watchdog started - monitoring for new files...")
    write_watchdog_status({
        'cycleCount': 0,
        'lastCycleStartedAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
        'nextCycleAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
        'lastFilesCopied': 0,
        'lastIngestTriggered': False,
        'lastIngestSuccess': None,
    })
    while True:
        try:
            cycle_count += 1
            cycle_started = datetime.datetime.now(datetime.timezone.utc)
            logger.debug(f"Starting cycle {cycle_count}")
            
            # Check and process each source directory
            files_copied = 0
            skipped_processed_pair = 0
            skipped_ingested = 0
            skipped_no_match = 0
            skipped_results_named = 0
            total_results_files = 0
            ingest_triggered = False
            ingest_success = None
            quarantined_results = load_quarantine_names('results')
            quarantined_tests = load_quarantine_names('tests')
            ingested_names = load_ingested_names()
            
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
                tests_by_sn, results_named = index_test_files(data_dir)
                skipped_results_named += results_named

                for file in results_files:
                    results_path = os.path.join(results_dir, file)
                    results_where = already_tracked(
                        file, 'results', quarantined_results, ingested_names
                    )
                    if results_where:
                        if results_where == 'ingested':
                            skipped_ingested += 1
                        continue
                    results_info = parse_results_file(file)
                    if results_info:
                        sn, T = results_info
                        # Calculate 3 days before the results file's timestamp
                        three_days_before_T = T - datetime.timedelta(days=3)

                        test_candidates = [
                            (test_file, started)
                            for test_file, started in tests_by_sn.get(sn, [])
                            if started <= T
                        ]
                        if test_candidates:
                            # Select the latest test file before T
                            test_file, S = max(test_candidates, key=lambda x: x[1])
                            if S >= three_days_before_T:
                                test_where = already_tracked(
                                    test_file, 'tests', quarantined_tests, ingested_names
                                )
                                action = copy_action_for_test(test_where)

                                if action == 'both':
                                    test_path = os.path.join(data_dir, test_file)
                                    shutil.copy2(test_path, os.path.join(to_process_tests_dir, test_file))
                                    shutil.copy2(results_path, os.path.join(to_process_results_dir, file))
                                    logger.info(f"[{source_name}] Copied {test_file} to {to_process_tests_dir} and {file} to {to_process_results_dir}")
                                    files_copied += 1
                                elif action == 'results':
                                    # Test is waiting in to_process — late results
                                    shutil.copy2(results_path, os.path.join(to_process_results_dir, file))
                                    logger.info(f"[{source_name}] Test file {test_file} already exists (to_process), copied only {file} to {to_process_results_dir}")
                                    files_copied += 1
                                elif test_where in ('processed', 'ingested'):
                                    # Already ingested with its pair. Extra pCloud
                                    # results for this test would sit unmatched.
                                    skipped_processed_pair += 1
                                    logger.debug(
                                        f"[{source_name}] Test file {test_file} already "
                                        f"{test_where}; skipping leftover results {file}"
                                    )
                            else:
                                logger.warning(f"[{source_name}] Test file {test_file} is more than 3 days before results file {file}; skipping")
                        else:
                            skipped_no_match += 1
                            logger.debug(f"[{source_name}] No matching test file found for {file}; skipping")
            
            # Always log a summary (heartbeat every cycle, but less verbose when no files copied)
            skip_bits = []
            if skipped_ingested:
                skip_bits.append(f"{skipped_ingested} already ingested")
            if skipped_processed_pair:
                skip_bits.append(f"{skipped_processed_pair} leftover results (test already processed/ingested)")
            if skipped_no_match:
                skip_bits.append(f"{skipped_no_match} with no matching test")
            if skipped_results_named:
                skip_bits.append(f"{skipped_results_named} results-named files in data/")
            skip_note = f", skipped {', '.join(skip_bits)}" if skip_bits else ""
            if files_copied > 0:
                logger.info(f"Cycle {cycle_count}: Checked {total_results_files} files across {len(source_directories)} source directories, copied {files_copied} new files{skip_note}")
            elif skip_bits and (cycle_count == 1 or cycle_count % 10 == 0):
                logger.info(f"Cycle {cycle_count}: Checked {total_results_files} files across {len(source_directories)} source directories, copied 0 new files{skip_note}")
            elif cycle_count % 10 == 0:
                logger.info(f"Cycle {cycle_count}: Checked {total_results_files} files across {len(source_directories)} source directories, copied {files_copied} new files (heartbeat)")
            else:
                logger.debug(f"Cycle {cycle_count}: No new files to copy")
            
            # Run cleanup and ingestion if new files were copied
            if files_copied > 0:
                logger.info(f"New files detected, running cleanup and ingestion process...")

                # Attempt to acquire lock before running ingestion
                if not acquire_lock():
                    logger.warning(f"Skipping ingestion for {files_copied} new files - another ingestion process is already running")
                    logger.info("Files will be processed in the next cycle when the lock is released")
                else:
                    # First run cleanup to remove debug firmware files
                    cleanup_success = run_cleanup()
                    if not cleanup_success:
                        logger.warning("Cleanup failed, but continuing with ingestion...")

                    # Then run ingestion (lock will be released in finally block)
                    ingest_triggered = True
                    ingestion_success = run_ingestion()
                    ingest_success = bool(ingestion_success)
                    if ingestion_success:
                        logger.info(f"Successfully processed {files_copied} new files")
                    else:
                        logger.error("Ingestion failed - files remain in to_process directory")

            cycle_finished = datetime.datetime.now(datetime.timezone.utc)
            next_cycle = cycle_finished + datetime.timedelta(seconds=check_interval)
            write_watchdog_status({
                'cycleCount': cycle_count,
                'lastCycleStartedAt': cycle_started.isoformat().replace('+00:00', 'Z'),
                'lastCycleFinishedAt': cycle_finished.isoformat().replace('+00:00', 'Z'),
                'nextCycleAt': next_cycle.isoformat().replace('+00:00', 'Z'),
                'lastFilesCopied': files_copied,
                'lastSkippedProcessedPair': skipped_processed_pair,
                'lastSkippedIngested': skipped_ingested,
                'lastSkippedNoMatch': skipped_no_match,
                'lastIngestTriggered': ingest_triggered,
                'lastIngestSuccess': ingest_success,
            })
                
            time.sleep(check_interval)
        except Exception as e:
            logger.error(f"Error in cycle {cycle_count}: {e}")
            cycle_finished = datetime.datetime.now(datetime.timezone.utc)
            next_cycle = cycle_finished + datetime.timedelta(seconds=check_interval)
            write_watchdog_status({
                'cycleCount': cycle_count,
                'lastCycleFinishedAt': cycle_finished.isoformat().replace('+00:00', 'Z'),
                'nextCycleAt': next_cycle.isoformat().replace('+00:00', 'Z'),
                'lastFilesCopied': 0,
                'lastIngestTriggered': False,
                'lastIngestSuccess': None,
                'error': str(e),
            })
            time.sleep(check_interval)

if __name__ == "__main__":
    main()
