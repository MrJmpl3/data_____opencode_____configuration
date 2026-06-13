import { describe, expect, it } from 'vitest';

import { MONTH_SECONDS, WEEK_SECONDS } from '../src/domain/format.ts';
import { detailTextLine, headingLine, paceLine, windowLine } from '../src/domain/lines.ts';
import { formatCopilotLines } from '../src/infrastructure/providers/copilot.ts';
import { formatGoLines } from '../src/infrastructure/providers/go.ts';
import { formatOpenAILines } from '../src/infrastructure/providers/openai.ts';
import { formatOpenRouterLines } from '../src/infrastructure/providers/openrouter.ts';

const fetchedAtMs = 1_700_000_000_000;

describe('formatGoLines', () => {
  it('returns a detail line when no dashboard windows exist', () => {
    expect(
      formatGoLines(
        {
          rolling: null,
          weekly: null,
          monthly: null,
        },
        'remaining',
        fetchedAtMs,
      ),
    ).toEqual([detailTextLine('No windows')]);
  });

  it('formats all dashboard windows and the monthly pace line', () => {
    expect(
      formatGoLines(
        {
          rolling: { used: 0, remaining: 100, resetInSec: 300 },
          weekly: { used: 0, remaining: 100, resetInSec: 600 },
          monthly: { used: 0, remaining: 100, resetInSec: 900 },
        },
        'used',
        fetchedAtMs,
      ),
    ).toEqual([
      windowLine('5h window', '0%', 300, fetchedAtMs),
      windowLine('Weekly', '0%', 600, fetchedAtMs),
      windowLine('Monthly', '0%', 900, fetchedAtMs),
      paceLine({ usedPct: 0, resetSec: 900 }, MONTH_SECONDS, fetchedAtMs),
    ]);
  });

  it('formats a single monthly window in remaining mode', () => {
    expect(
      formatGoLines(
        {
          rolling: null,
          weekly: null,
          monthly: { used: 25, remaining: 75, resetInSec: 3600 },
        },
        'remaining',
        fetchedAtMs,
      ),
    ).toEqual([
      windowLine('Monthly', '75%', 3600, fetchedAtMs),
      paceLine({ usedPct: 25, resetSec: 3600 }, MONTH_SECONDS, fetchedAtMs),
    ]);
  });
});

describe('formatCopilotLines', () => {
  it('formats the monthly window and pace line when reset data exists', () => {
    expect(
      formatCopilotLines(
        {
          text: '70/100',
          used: 30,
          remaining: 70,
          total: 100,
          pctRemaining: 70,
          resetSec: 3600,
        },
        'remaining',
        fetchedAtMs,
      ),
    ).toEqual([
      windowLine('Monthly', '70 pts', 3600, fetchedAtMs),
      paceLine({ usedPct: 30, resetSec: 3600 }, MONTH_SECONDS, fetchedAtMs),
    ]);
  });

  it('omits the pace line when pctRemaining is unavailable', () => {
    expect(
      formatCopilotLines(
        {
          text: '15/100',
          remaining: 15,
          total: 100,
          resetSec: 7200,
        },
        'remaining',
        fetchedAtMs,
      ),
    ).toEqual([windowLine('Monthly', '15 pts', 7200, fetchedAtMs)]);
  });

  it('falls back to a detail line when reset data is missing', () => {
    expect(
      formatCopilotLines(
        {
          text: '5/100',
          remaining: 5,
          total: 100,
        },
        'remaining',
        fetchedAtMs,
      ),
    ).toEqual([detailTextLine('Monthly · 5 pts')]);
  });

  it('preserves unlimited text when no numeric quota is available', () => {
    expect(
      formatCopilotLines(
        {
          text: 'Unlimited',
          unlimited: true,
        },
        'used',
        fetchedAtMs,
      ),
    ).toEqual([detailTextLine('Monthly · Unlimited')]);
  });
});

describe('formatOpenRouterLines', () => {
  it('formats remaining credits using the provider text', () => {
    expect(
      formatOpenRouterLines(
        {
          text: '$7.50',
          remaining: 7.5,
          total: 10,
          usage: 2.5,
        },
        'remaining',
      ),
    ).toEqual([detailTextLine('Credits · $7.50')]);
  });

  it('formats used credits when the total is known', () => {
    expect(
      formatOpenRouterLines(
        {
          text: '$7.50',
          remaining: 7.5,
          total: 10,
          usage: 2.5,
        },
        'used',
      ),
    ).toEqual([detailTextLine('Credits · $2.50/$10.00')]);
  });

  it('falls back to the raw provider text when there is no total', () => {
    expect(
      formatOpenRouterLines(
        {
          text: '$1.2345 used (no limit)',
          usage: 1.2345,
        },
        'used',
      ),
    ).toEqual([detailTextLine('Credits · $1.2345 used (no limit)')]);
  });
});

describe('formatOpenAILines', () => {
  it('returns a detail line when the payload contains no windows', () => {
    expect(formatOpenAILines({}, 'remaining', fetchedAtMs)).toEqual([detailTextLine('No windows')]);
  });

  it('formats primary OpenAI windows, weekly pace, and credits', () => {
    expect(
      formatOpenAILines(
        {
          hourly: { usedPct: 20, resetSec: 300 },
          weekly: { usedPct: 30, resetSec: 600 },
          codeReview: { usedPct: 40, resetSec: 900 },
          credits: '$5.00',
        },
        'used',
        fetchedAtMs,
      ),
    ).toEqual([
      headingLine('OpenAI'),
      windowLine('5h', '20%', 300, fetchedAtMs),
      windowLine('Weekly', '30%', 600, fetchedAtMs),
      paceLine({ usedPct: 30, resetSec: 600 }, WEEK_SECONDS, fetchedAtMs),
      windowLine('Code Review', '40%', 900, fetchedAtMs),
      detailTextLine('Credits · $5.00'),
    ]);
  });

  it('formats spark rate limits under a dedicated heading', () => {
    expect(
      formatOpenAILines(
        {
          additionalRateLimits: [
            {
              label: 'Codex Spark',
              limitName: 'codex-spark',
              primary: { usedPct: 10, resetSec: 100 },
              secondary: { usedPct: 20, resetSec: 200, limitWindowSec: 1234 },
            },
          ],
        },
        'remaining',
        fetchedAtMs,
      ),
    ).toEqual([
      headingLine('OpenAI Spark'),
      windowLine('5h', '90%', 100, fetchedAtMs),
      windowLine('Weekly', '80%', 200, fetchedAtMs),
      paceLine({ usedPct: 20, resetSec: 200, limitWindowSec: 1234 }, 1234, fetchedAtMs),
    ]);
  });

  it('formats additional non-spark limits with provider-owned labels', () => {
    expect(
      formatOpenAILines(
        {
          additionalRateLimits: [
            {
              label: 'Vision',
              allowed: false,
              primary: { usedPct: 55, resetSec: 111 },
              secondary: { usedPct: 66, resetSec: 222 },
            },
            {
              label: 'Audio',
              limitReached: true,
              secondary: { usedPct: 70, resetSec: 333 },
            },
          ],
        },
        'used',
        fetchedAtMs,
      ),
    ).toEqual([
      headingLine('OpenAI'),
      windowLine('Vision · blocked', '55%', 111, fetchedAtMs),
      windowLine('Vision Secondary', '66%', 222, fetchedAtMs),
      windowLine('Audio · limit reached Secondary', '70%', 333, fetchedAtMs),
    ]);
  });
});
