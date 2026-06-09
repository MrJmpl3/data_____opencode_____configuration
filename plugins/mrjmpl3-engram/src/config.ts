export const ENGRAM_PORT = parseInt(process.env.ENGRAM_PORT ?? '7437');
export const ENGRAM_URL = `http://127.0.0.1:${ENGRAM_PORT}`;
const runtime = globalThis as typeof globalThis & { Bun?: { which(command: string): string | null } };

export const ENGRAM_BIN = process.env.ENGRAM_BIN ?? runtime.Bun?.which('engram') ?? '/home/mrjmpl3/.local/bin/engram';

export const ENGRAM_TOOLS = new Set([
  'mem_search',
  'mem_save',
  'mem_update',
  'mem_delete',
  'mem_suggest_topic_key',
  'mem_save_prompt',
  'mem_session_summary',
  'mem_context',
  'mem_stats',
  'mem_timeline',
  'mem_get_observation',
  'mem_session_start',
  'mem_session_end',
]);
