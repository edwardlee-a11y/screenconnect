import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

interface Config {
  serverUrl: string;
  agentVersion: string;
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_SERVER = 'https://screenconnect-production.up.railway.app';

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Config;
    }
  } catch { /* ignore */ }
  return { serverUrl: DEFAULT_SERVER, agentVersion: '1.0.0' };
}

function saveConfig(cfg: Partial<Config>): void {
  const current = loadConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...cfg }, null, 2));
}

export const config = loadConfig();
export { saveConfig };
