import { describe, expect, it } from 'vitest';
import { formatOpenAILines } from '../../../../src/features/quota/domain/format.ts';
import type { OpenAIResult } from '../../../../src/features/quota/domain/types.ts';
import { WEEK_SECONDS } from '../../../../src/features/quota/domain/types.ts';

describe('formatOpenAILines', () => {
  const nowMs = 1_700_000_000_000;
  const headingPattern = /^● /;

  it('renders a weekly window placed in data.hourly as Wk with 7-day pace', () => {
    const data: OpenAIResult = {
      hourly: { usedPct: 45, resetSec: 3600, limitWindowSec: WEEK_SECONDS },
    };
    const lines = formatOpenAILines(data, 'used', nowMs);
    const windowLines = lines.filter((l) => l.kind === 'window');
    const paceLines = lines.filter((l) => l.kind === 'pace');

    expect(windowLines[0]?.label).toBe('Wk');
    expect(paceLines[0]?.windowSeconds).toBe(WEEK_SECONDS);
  });

  it('renders a 5h window in data.hourly as 5h with 5-hour pace', () => {
    const data: OpenAIResult = {
      hourly: { usedPct: 30, resetSec: 1800, limitWindowSec: 5 * 3600 },
    };
    const lines = formatOpenAILines(data, 'used', nowMs);
    const windowLines = lines.filter((l) => l.kind === 'window');
    const paceLines = lines.filter((l) => l.kind === 'pace');

    expect(windowLines[0]?.label).toBe('5h');
    expect(paceLines[0]?.windowSeconds).toBe(5 * 3600);
  });

  it('falls back to hardcoded label when limitWindowSec is absent', () => {
    const data: OpenAIResult = {
      hourly: { usedPct: 50, resetSec: 3600 },
    };
    const lines = formatOpenAILines(data, 'used', nowMs);
    const windowLines = lines.filter((l) => l.kind === 'window');

    expect(windowLines[0]?.label).toBe('5h');
  });

  it('renders no-windows detail when result has no windows', () => {
    const data: OpenAIResult = {};
    const lines = formatOpenAILines(data, 'used', nowMs);
    const first = lines[0];
    expect(first?.kind).toBe('detail');
    if (first?.kind === 'detail') expect(first.text).toBe('No windows');
  });

  it('preserves weekly window label when limitWindowSec matches week', () => {
    const data: OpenAIResult = {
      weekly: { usedPct: 20, resetSec: 86400, limitWindowSec: WEEK_SECONDS },
    };
    const lines = formatOpenAILines(data, 'used', nowMs);
    const windowLines = lines.filter((l) => l.kind === 'window').filter((l) => l.label !== 'Code');

    expect(windowLines[0]?.label).toBe('Wk');
  });

  it('preserves code review window with Mo label', () => {
    const data: OpenAIResult = {
      codeReview: { usedPct: 10, resetSec: 86400 },
    };
    const lines = formatOpenAILines(data, 'used', nowMs);
    const windowLines = lines.filter((l) => l.kind === 'window');

    expect(windowLines[0]?.label).toBe('Code');
  });
});
