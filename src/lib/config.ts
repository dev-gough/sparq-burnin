import path from 'path';
import fs from 'fs';

export interface Config {
  paths: {
    source_directories: Array<{
      name: string;
      results_dir: string;
      data_dir: string;
    }>;
    local: {
      main_dir: string;
      dashboard_dir: string;
      log_dir: string;
    };
  };
  settings: {
    check_interval: number;
    cutoff_date: string;
    log_file: string;
    max_log_size_mb: number;
    log_backup_count: number;
    debug_firmware_version: string;
    timeout: {
      cleanup: number;
      ingestion: number;
    };
  };
  node: {
    nvm_path: string;
    fallback_to_system: boolean;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
  };
  api: {
    base_url: string;
  };
}

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  // For API routes running in Next.js, the config is in the project root
  // For scripts, it's relative to the script location
  const possiblePaths = [
    path.join(process.cwd(), 'config.json'), // Next.js app root
    path.join(__dirname, '..', '..', 'config.json'), // From src/lib
    path.join(__dirname, '..', '..', '..', 'config.json'), // From compiled dist
  ];

  let configPath: string | null = null;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      configPath = possiblePath;
      break;
    }
  }

  if (!configPath) {
    throw new Error(`Config file not found. Tried paths: ${possiblePaths.join(', ')}. Please copy config.template.json to config.json and update the settings.`);
  }

  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    cachedConfig = JSON.parse(configContent);
    return cachedConfig!;
  } catch (error) {
    throw new Error(`Failed to parse config file at ${configPath}: ${error}`);
  }
}

export function getDatabaseConfig() {
  const config = loadConfig();
  return {
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
  };
}