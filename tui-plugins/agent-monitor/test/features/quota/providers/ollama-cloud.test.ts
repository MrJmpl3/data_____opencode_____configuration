import { describe, expect, it } from 'vitest';

import { parseOllamaCloudHtml } from '../../../../src/features/quota/infrastructure/providers/ollama-cloud.ts';

const SETTINGS_HTML = `
<html>
  <body>
    <div data-usage-track aria-label="35% used">session</div>
    <div data-usage-track style="width: 62%">weekly</div>
    <time class="local-time" data-time="2026-07-03T12:00:00Z">reset 1</time>
    <time class="local-time" data-time="2026-07-07T00:00:00Z">reset 2</time>
  </body>
</html>
`;

describe('parseOllamaCloudHtml', () => {
  it('extracts session and weekly usage with reset times', () => {
    const nowMs = Date.parse('2026-07-02T00:00:00Z');
    const result = parseOllamaCloudHtml(SETTINGS_HTML, nowMs);

    expect('error' in result).toBe(false);
    if ('error' in result) return;

    expect(result.session).toEqual({
      usedPct: 35,
      remainingPct: 65,
      resetSec: Math.floor((Date.parse('2026-07-03T12:00:00Z') - nowMs) / 1000),
    });

    expect(result.weekly).toEqual({
      usedPct: 62,
      remainingPct: 38,
      resetSec: Math.floor((Date.parse('2026-07-07T00:00:00Z') - nowMs) / 1000),
    });
  });

  it('returns an error when no usage tracks are present', () => {
    const result = parseOllamaCloudHtml('<html><body>no tracks here</body></html>', Date.now());
    expect(result).toEqual({ error: 'Could not parse usage tracks from Ollama Cloud settings page' });
  });

  it('prefers aria-label over style width when both are present on the same track', () => {
    // Same track carries BOTH selectors. The parser must prefer the aria-label
    // so a future "fix" that just reads `style` won't silently change the number.
    const html = `<div data-usage-track aria-label="40% used" style="width: 99%">only</div>`;
    const result = parseOllamaCloudHtml(html, Date.now());
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.session?.usedPct).toBe(40);
    expect(result.weekly).toBeUndefined();
  });

  it('falls back to style width when a track has no aria-label', () => {
    const html = `<div data-usage-track style="width: 73%">only</div>`;
    const result = parseOllamaCloudHtml(html, Date.now());
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.session?.usedPct).toBe(73);
  });
});
