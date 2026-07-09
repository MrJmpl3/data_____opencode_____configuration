import type { OpenAIResetCreditsResult, OpenAIResult, QuotaDisplayMode } from '../../domain/types.ts';
import {
  formatOpenAIAdditionalRateLimitLabel,
  formatOpenAIRateLimitTone,
  formatOpenAILines,
} from '../../domain/format.ts';
import { formatUsedPercentQuota } from '../../domain/lines.ts';
import { parseAdditionalRateLimits, parseResetCreditsPayload, parseWindowFromAliases } from '../../domain/parse.ts';
import { OPENAI_RESET_CREDITS_URL, OPENAI_USAGE_URL } from './constants.ts';
import { readOauthAccessToken, readOpenAIAccountId } from './auth.ts';
import { fetchWithTimeout, httpErrorMessage, readJsonResponse } from './http.ts';
import { isRecord, readStringField } from '../../../../kit/coercion.ts';

const readOpenAIToken = (): string | null => {
  return readOauthAccessToken('openai');
};

const buildOpenAIHeaders = (token: string): Record<string, string> => {
  const accountId = readOpenAIAccountId(token);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'OpenCode-Quota-Toast/1.0',
  };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  return headers;
};

const fetchOpenAIResetCredits = async (
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<OpenAIResetCreditsResult> => {
  try {
    const resetHeaders: Record<string, string> = {
      ...headers,
      'OpenAI-Beta': 'codex-1',
      originator: 'Codex Desktop',
    };

    const response = await fetchWithTimeout(OPENAI_RESET_CREDITS_URL, { headers: resetHeaders }, undefined, signal);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        state: 'unavailable',
        availableCount: 0,
        credits: [],
        errorMessage: httpErrorMessage('OpenAI reset credits', response, text),
      };
    }

    const bodyResult = await readJsonResponse('OpenAI reset credits', response);
    if ('error' in bodyResult) {
      return {
        state: 'unavailable',
        availableCount: 0,
        credits: [],
        errorMessage: bodyResult.error,
      };
    }

    return parseResetCreditsPayload(bodyResult.data);
  } catch (error: unknown) {
    return {
      state: 'unavailable',
      availableCount: 0,
      credits: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
};

export interface FetchOpenAIQuotaOptions {
  experimentalResetCredits?: boolean;
}

export const fetchOpenAIQuota = async (
  options: FetchOpenAIQuotaOptions = {},
  signal?: AbortSignal,
): Promise<OpenAIResult | null | { error: string }> => {
  const token = readOpenAIToken();
  if (!token) return null;

  const headers = buildOpenAIHeaders(token);

  const usagePromise = fetchWithTimeout(OPENAI_USAGE_URL, { headers }, undefined, signal)
    .then(async (response): Promise<OpenAIResult | { error: string }> => {
      if (!response.ok) {
        const text = await response.text().catch((error: unknown) => {
          if (error instanceof Error) return error.message;
          return String(error);
        });
        return { error: httpErrorMessage('OpenAI', response, text) };
      }

      const bodyResult = await readJsonResponse('OpenAI', response);
      if ('error' in bodyResult) return bodyResult;

      const body: unknown = bodyResult.data;
      if (!isRecord(body)) {
        return { error: 'OpenAI did not return a valid usage payload' };
      }

      const rateLimit = isRecord(body.rate_limit) ? body.rate_limit : undefined;
      const additionalRateLimits = parseAdditionalRateLimits(body.additional_rate_limits);
      const codeReviewRateLimit = isRecord(body.code_review_rate_limit) ? body.code_review_rate_limit : undefined;
      const credits = isRecord(body.credits) ? body.credits : undefined;

      const result: OpenAIResult = {
        planType: readStringField(body, 'plan_type') || readStringField(body, 'planType'),
        hourly: parseWindowFromAliases(rateLimit, ['primary_window', 'primary', 'window', 'window_primary', 'hourly']),
        weekly: parseWindowFromAliases(rateLimit, ['secondary_window', 'secondary', 'window_secondary', 'weekly']),
        codeReview: parseWindowFromAliases(codeReviewRateLimit, [
          'primary_window',
          'primary',
          'window',
          'window_primary',
        ]),
        additionalRateLimits,
      };

      if (credits) {
        const unlimited = credits.unlimited === true;
        const hasCredits = credits.has_credits === true || unlimited;
        const balance =
          typeof credits.balance === 'number' && Number.isFinite(credits.balance) ? credits.balance : undefined;
        if (unlimited) {
          result.credits = 'Unlimited';
        } else if (hasCredits && balance !== undefined) {
          result.credits = `$${balance.toFixed(2)}`;
        }
      }

      if (
        !result.hourly &&
        !result.weekly &&
        !result.codeReview &&
        !result.credits &&
        !result.planType &&
        !(result.additionalRateLimits && result.additionalRateLimits.length > 0)
      ) {
        return { error: 'OpenAI did not return expected quota data' };
      }

      return result;
    })
    .catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    }));

  const resetCreditsPromise = options.experimentalResetCredits
    ? fetchOpenAIResetCredits(headers, signal)
    : Promise.resolve<OpenAIResetCreditsResult>({
        state: 'unavailable',
        availableCount: 0,
        credits: [],
        errorMessage:
          'Reset credits fetching is disabled by default (experimental). Set experimentalOpenAIResetCredits: true to enable.',
      });

  const [usageResult, resetCreditsResult] = await Promise.all([usagePromise, resetCreditsPromise]);

  if ('error' in usageResult) return usageResult;

  const result: OpenAIResult = usageResult;
  if (options.experimentalResetCredits) {
    result.resetCredits = resetCreditsResult;
  }

  return result;
};

// Re-export formatOpenAILines so the cross-provider switch in quota-section.tsx
// can keep importing from the provider file. Everything else is imported directly
// from domain modules.
export { formatOpenAILines };
