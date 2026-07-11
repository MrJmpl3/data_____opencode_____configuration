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
  timeoutMs?: number,
): Promise<OpenAIResetCreditsResult> => {
  try {
    const resetHeaders: Record<string, string> = {
      ...headers,
      'OpenAI-Beta': 'codex-1',
      originator: 'Codex Desktop',
    };

    const response = await fetchWithTimeout(OPENAI_RESET_CREDITS_URL, { headers: resetHeaders }, timeoutMs, signal);
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
  timeoutMs?: number;
}

type OpenAIUsageFields = {
  planType: string | undefined;
  hourly: ReturnType<typeof parseWindowFromAliases>;
  weekly: ReturnType<typeof parseWindowFromAliases>;
  codeReview: ReturnType<typeof parseWindowFromAliases>;
  additionalRateLimits: ReturnType<typeof parseAdditionalRateLimits>;
  credits: Record<string, unknown> | undefined;
};

// Pure helper: pull the relevant typed fields out of an unknown body without
// computing derived values. Keeping the field extraction separate from the
// credits-decision logic makes each step auditable in isolation.
const extractOpenAIUsageFields = (body: Record<string, unknown>): OpenAIUsageFields => ({
  planType: readStringField(body, 'plan_type') || readStringField(body, 'planType'),
  hourly: parseWindowFromAliases(isRecord(body.rate_limit) ? body.rate_limit : undefined, [
    'primary_window',
    'primary',
    'window',
    'window_primary',
    'hourly',
  ]),
  weekly: parseWindowFromAliases(isRecord(body.rate_limit) ? body.rate_limit : undefined, [
    'secondary_window',
    'secondary',
    'window_secondary',
    'weekly',
  ]),
  codeReview: parseWindowFromAliases(isRecord(body.code_review_rate_limit) ? body.code_review_rate_limit : undefined, [
    'primary_window',
    'primary',
    'window',
    'window_primary',
  ]),
  additionalRateLimits: parseAdditionalRateLimits(body.additional_rate_limits),
  credits: isRecord(body.credits) ? body.credits : undefined,
});

// Pure helper: turn the raw `credits` blob into a display label, or
// undefined when there is nothing to show.
const resolveOpenAICreditsLabel = (credits: Record<string, unknown> | undefined): string | undefined => {
  if (!credits) return undefined;

  const unlimited = credits.unlimited === true;
  const hasCredits = credits.has_credits === true || unlimited;
  if (unlimited) return 'Unlimited';

  if (!hasCredits) return undefined;
  if (typeof credits.balance !== 'number' || !Number.isFinite(credits.balance)) return undefined;
  return `$${credits.balance.toFixed(2)}`;
};

// Pure helper: tell whether a populated result actually carries any data
// the UI can render. If not, callers should surface an error instead.
const hasOpenAIUsagePayload = (result: OpenAIResult): boolean =>
  Boolean(
    result.hourly ||
    result.weekly ||
    result.codeReview ||
    result.credits ||
    result.planType ||
    (result.additionalRateLimits && result.additionalRateLimits.length > 0),
  );

const parseOpenAIUsageResponse = (body: unknown): OpenAIResult | { error: string } => {
  if (!isRecord(body)) {
    return { error: 'OpenAI did not return a valid usage payload' };
  }

  const fields = extractOpenAIUsageFields(body);
  const result: OpenAIResult = {
    planType: fields.planType,
    hourly: fields.hourly,
    weekly: fields.weekly,
    codeReview: fields.codeReview,
    additionalRateLimits: fields.additionalRateLimits,
  };

  const creditsLabel = resolveOpenAICreditsLabel(fields.credits);
  if (creditsLabel) result.credits = creditsLabel;

  if (!hasOpenAIUsagePayload(result)) {
    return { error: 'OpenAI did not return expected quota data' };
  }

  return result;
};

const fetchOpenAIUsage = async (
  headers: Record<string, string>,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<OpenAIResult | { error: string }> => {
  const response = await fetchWithTimeout(OPENAI_USAGE_URL, { headers }, timeoutMs, signal).catch(
    (error: unknown) => undefined, // will be caught below
  );
  if (!response) {
    return { error: 'OpenAI usage endpoint unreachable' };
  }

  if (!response.ok) {
    const text = await response.text().catch((error: unknown) => {
      if (error instanceof Error) return error.message;
      return String(error);
    });
    return { error: httpErrorMessage('OpenAI', response, text) };
  }

  const bodyResult = await readJsonResponse('OpenAI', response);
  if ('error' in bodyResult) return bodyResult;

  return parseOpenAIUsageResponse(bodyResult.data);
};

export const fetchOpenAIQuota = async (
  options: FetchOpenAIQuotaOptions = {},
  signal?: AbortSignal,
): Promise<OpenAIResult | null | { error: string }> => {
  const token = readOpenAIToken();
  if (!token) return null;

  const headers = buildOpenAIHeaders(token);

  const [usageResult, resetCreditsResult] = await Promise.all([
    fetchOpenAIUsage(headers, signal, options.timeoutMs).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : String(error),
    })),
    options.experimentalResetCredits
      ? fetchOpenAIResetCredits(headers, signal, options.timeoutMs)
      : Promise.resolve<OpenAIResetCreditsResult>({
          state: 'unavailable',
          availableCount: 0,
          credits: [],
          errorMessage:
            'Reset credits fetching is disabled by default (experimental). Set experimentalOpenAIResetCredits: true to enable.',
        }),
  ]);

  if ('error' in usageResult) return usageResult;

  const result: OpenAIResult = usageResult;
  if (options.experimentalResetCredits) {
    result.resetCredits = resetCreditsResult;
  }

  return result;
};

// Re-exported for quota-section.tsx switch.
export { formatOpenAILines };
