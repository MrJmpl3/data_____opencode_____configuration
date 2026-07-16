import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readSubagentStatusOptions } from '../../../../src/features/subagent-status/infrastructure/config.ts';
import {
  hydrateDoneChildTokens,
  readOpenCodeLogFileIfSmall,
  resetDoneTokenCache,
} from '../../../../src/features/subagent-status/infrastructure/logs.ts';
import {
  conciseText,
  debugLog,
  normalizeDisplayText,
  sameDisplayText,
  setDebugEnabled,
} from '../../../../src/features/subagent-status/shared/display.ts';
import {
  detectSystemLocale,
  getLocale,
  resetLocale,
  t,
} from '../../../../src/features/subagent-status/runtime/i18n.ts';

describe('infrastructure and display branches', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    resetLocale();
    resetDoneTokenCache();
    vi.restoreAllMocks();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('reads absent, malformed, and valid config files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-config-'));
    dirs.push(dir);
    process.env.OPENCODE_CONFIG_DIR = dir;
    expect(readSubagentStatusOptions()).toBeUndefined();
    await writeFile(join(dir, 'agent-monitor.json'), '{bad');
    expect(readSubagentStatusOptions()).toBeUndefined();
    await writeFile(
      join(dir, 'agent-monitor.json'),
      JSON.stringify({ sections: { 'subagent-status': { options: { debug: true } } } }),
    );
    expect(readSubagentStatusOptions()).toEqual({ debug: true });
  });

  it('handles small, missing, and oversized logs and extracts nested token hints', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-monitor-log-'));
    dirs.push(dir);
    const small = join(dir, 'small.log');
    await writeFile(small, `prefix ses_child {"usage":{"input_tokens":4,"output_tokens":6,"context_percent":0.5}}\n`);
    expect(await readOpenCodeLogFileIfSmall(small)).toContain('ses_child');
    await expect(readOpenCodeLogFileIfSmall(join(dir, 'missing.log'))).rejects.toThrow('ENOENT');
    await writeFile(join(dir, 'events.log'), await import('node:fs/promises').then(({ readFile }) => readFile(small)));
    await expect(hydrateDoneChildTokens('not-a-session', dir)).resolves.toBeUndefined();
    await expect(hydrateDoneChildTokens('ses_child', dir)).resolves.toMatchObject({
      input: 4,
      output: 6,
      contextPercent: 50,
    });
    expect(await hydrateDoneChildTokens('ses_child', dir)).toMatchObject({ input: 4 });
  });

  it('keeps display helpers safe and toggles debug output', () => {
    expect(conciseText(null)).toBeUndefined();
    expect(conciseText('  a\n b  ')).toBe('a b');
    expect(conciseText('x'.repeat(200))).toHaveLength(180);
    expect(normalizeDisplayText(' A\nB ')).toBe('a b');
    expect(sameDisplayText(' A', 'a')).toBe(true);
    expect(sameDisplayText('', 'a')).toBe(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    setDebugEnabled(false);
    debugLog('hidden');
    setDebugEnabled(true);
    debugLog('shown');
    expect(log).toHaveBeenCalledOnce();
  });

  it('detects Spanish locale and caches the selected translation', () => {
    const original = process.env.LANG;
    process.env.LANG = 'es_MX.UTF-8';
    resetLocale();
    expect(detectSystemLocale()).toBe('es');
    expect(getLocale()).toBe('es');
    expect(t('active')).toBe('Activos');
    process.env.LANG = original;
  });
});
