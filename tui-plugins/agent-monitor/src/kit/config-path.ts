import { homedir } from 'os';
import { join } from 'path';

export const configFilePath = (): string => {
  const configDir = process.env.OPENCODE_CONFIG_DIR;
  if (configDir) return join(configDir, 'agent-monitor.json');
  return join(homedir(), '.config', 'opencode', 'agent-monitor.json');
};
