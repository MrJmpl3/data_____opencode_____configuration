import type { OpencodeClient } from './types.ts';

export function createLogger(client: OpencodeClient) {
  const log = (level: 'debug' | 'info' | 'warn' | 'error', message: string) =>
    client.app.log({ body: { service: 'background-agents', level, message } }).catch(() => {});

  return {
    debug: (message: string) => log('debug', message),
    info: (message: string) => log('info', message),
    warn: (message: string) => log('warn', message),
    error: (message: string) => log('error', message),
  };
}

export type Logger = ReturnType<typeof createLogger>;
