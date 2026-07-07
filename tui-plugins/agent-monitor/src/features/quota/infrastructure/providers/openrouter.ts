import type { QuotaDisplayMode, OpenRouterResult, QuotaLine } from '../../domain/types.ts';
import { formatCreditQuota } from '../../domain/lines.ts';
import { detailTextLine } from '../../domain/lines.ts';
import { readAuthProviderApiKey } from './auth.ts';
import { OPENROUTER_CREDITS_URL } from './constants.ts';
import { fetchWithTimeout, httpErrorMessage, readJsonResponse } from './http.ts';
import { isRecord } from '../../../../kit/coercion.ts';

const readOpenRouterKey = (): string | null => {
  return readAuthProviderApiKey('openrouter');
};

export const formatOpenRouterLines = (data: OpenRouterResult, displayMode: QuotaDisplayMode): QuotaLine[] => {
  return [detailTextLine(`Credits ${formatCreditQuota(data, displayMode)}`)];
};

export const fetchOpenRouterQuota = async (
  signal?: AbortSignal,
): Promise<OpenRouterResult | null | { error: string }> => {
  const key = readOpenRouterKey();
  if (!key) return null;

  const response = await fetchWithTimeout(
    OPENROUTER_CREDITS_URL,
    {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    },
    undefined,
    signal,
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { error: httpErrorMessage('OpenRouter', response, text) };
  }

  const bodyResult = await readJsonResponse('OpenRouter', response);
  if ('error' in bodyResult) return bodyResult;

  const body = bodyResult.data;
  const data = isRecord(body) && isRecord(body.data) ? body.data : body;
  if (!isRecord(data)) {
    return { error: 'OpenRouter did not return expected credit data' };
  }

  const totalCredits =
    typeof data.total_credits === 'number' && Number.isFinite(data.total_credits) ? data.total_credits : null;
  const totalUsage =
    typeof data.total_usage === 'number' && Number.isFinite(data.total_usage) ? data.total_usage : null;

  if (totalCredits !== null && totalCredits > 0) {
    const usage = totalUsage ?? 0;
    const remaining = Math.max(0, totalCredits - (totalUsage ?? 0));
    return {
      text: `$${remaining.toFixed(2)}`,
      remaining,
      total: totalCredits,
      usage,
    };
  }

  if (totalUsage !== null) {
    return {
      text: `$${totalUsage.toFixed(4)} used (no limit)`,
      usage: totalUsage,
    };
  }

  return { error: 'OpenRouter did not return expected credit data' };
};
