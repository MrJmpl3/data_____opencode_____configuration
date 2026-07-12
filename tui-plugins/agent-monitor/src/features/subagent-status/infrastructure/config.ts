import { existsSync, readFileSync } from 'fs';

import { isRecord } from '../../../kit/coercion.ts';
import { configFilePath } from '../../../kit/config-path.ts';

/**
 * Lee `sections.subagent-status.options` de `agent-monitor.json`.
 * Devuelve `undefined` si el archivo no existe, no es parseable, o la
 * sección no existe — el caller aplica defaults sobre el resultado.
 */
export const readSubagentStatusOptions = (): unknown => {
  const path = configFilePath();
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (!isRecord(parsed)) return undefined;

    const sectionsRecord = isRecord(parsed.sections) ? parsed.sections : {};
    const subagentSection = isRecord(sectionsRecord['subagent-status']) ? sectionsRecord['subagent-status'] : {};

    return isRecord(subagentSection.options) ? subagentSection.options : undefined;
  } catch (e) {
    console.warn('[agent-monitor] Failed to parse subagent-status config:', e instanceof Error ? e : String(e));
    return undefined;
  }
};
