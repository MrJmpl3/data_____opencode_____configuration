import type { OpenAIAdditionalRateLimit, OpenAIResult, OpenAIWindow } from '../../domain/types.ts';
import { OPENAI_USAGE_URL } from './constants.ts';
import { readOauthAccessToken, readOpenAIAccountId } from './auth.ts';
import { fetchWithTimeout, httpErrorMessage, readJsonResponse } from './http.ts';
import { firstDefined, isRecord, readBooleanField, readNumericField, readStringField } from './shared.ts';

export const readOpenAIToken = (): string | null => {
  return readOauthAccessToken(['openai', 'chatgpt', 'codex', 'opencode']);
};

const normalizeUsedPercent = (value: number): number => Math.max(0, Math.min(100, value));

const readWindowResetSeconds = (record: Record<string, unknown>): number | undefined => {
  const resetAfterSeconds = firstDefined(
    readNumericField(record, 'reset_after_seconds'),
    readNumericField(record, 'reset_after'),
    readNumericField(record, 'resetAfter'),
    readNumericField(record, 'reset_in_seconds'),
    readNumericField(record, 'resetInSec'),
  );
  if (resetAfterSeconds !== undefined) {
    return Math.max(0, Math.floor(resetAfterSeconds));
  }

  const resetAt = readStringField(record, 'reset_at') || readStringField(record, 'resetAt');
  if (resetAt) {
    const date = Date.parse(resetAt);
    if (!Number.isNaN(date)) {
      return Math.max(0, Math.floor((date - Date.now()) / 1000));
    }
  }

  const resetAtEpoch = readNumericField(record, 'reset_at');
  if (resetAtEpoch !== undefined) {
    const ms = resetAtEpoch > 1_000_000_000_000 ? resetAtEpoch : resetAtEpoch * 1000;
    return Math.max(0, Math.floor((ms - Date.now()) / 1000));
  }

  return undefined;
};

const findFirstString = (record: Record<string, unknown>, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const found = readStringField(record, key);
    if (found) return found;
  }
  return undefined;
};

const cleanLimitLabel = (rawLabel: string): string => {
  const normalized = rawLabel.trim().replace(/\s+/g, ' ');
  if (normalized.toLowerCase().includes('codex-spark')) return 'Codex Spark';
  return normalized || 'Additional limit';
};

const parseOpenAIWindow = (value: unknown): OpenAIWindow | undefined => {
  if (!isRecord(value)) return undefined;
  const record = value;
  const usedPercentCandidate = firstDefined(
    readNumericField(record, 'used_percent'),
    readNumericField(record, 'used_pct'),
    readNumericField(record, 'usage_pct'),
    readNumericField(record, 'pct_used'),
  );

  const usedAmount = readNumericField(record, 'used');
  const remainingAmount = readNumericField(record, 'remaining');
  const limitAmount = firstDefined(
    readNumericField(record, 'limit'),
    readNumericField(record, 'total'),
    readNumericField(record, 'quota'),
  );
  const remainingPercent = firstDefined(
    readNumericField(record, 'remaining_percent'),
    readNumericField(record, 'remainingPct'),
    readNumericField(record, 'remaining_pct'),
  );

  let usedPct: number | undefined = usedPercentCandidate;

  if (usedPct === undefined && usedAmount !== undefined && limitAmount !== undefined && limitAmount > 0) {
    usedPct = (usedAmount / limitAmount) * 100;
  }

  if (usedPct === undefined && remainingAmount !== undefined && limitAmount !== undefined && limitAmount > 0) {
    usedPct = (1 - remainingAmount / limitAmount) * 100;
  }

  if (usedPct === undefined && remainingPercent !== undefined) {
    usedPct = 100 - remainingPercent;
  }

  if (usedPct === undefined || Number.isNaN(usedPct)) return undefined;

  const resetSec = readWindowResetSeconds(record);
  if (resetSec === undefined) return undefined;
  const limitWindowSec = firstDefined(
    readNumericField(record, 'limit_window_seconds'),
    readNumericField(record, 'limitWindowSeconds'),
    readNumericField(record, 'limitWindowSec'),
    readNumericField(record, 'window_seconds'),
  );

  return {
    usedPct: normalizeUsedPercent(usedPct),
    resetSec,
    limitWindowSec: limitWindowSec !== undefined ? Math.max(0, Math.floor(limitWindowSec)) : undefined,
  };
};

const firstWindow = (record: Record<string, unknown>): { primary?: OpenAIWindow; secondary?: OpenAIWindow } => {
  const primary =
    parseOpenAIWindow(record['primary_window']) ||
    parseOpenAIWindow(record['primary']) ||
    parseOpenAIWindow(record['window']) ||
    parseOpenAIWindow(record['window_primary']) ||
    undefined;

  const secondary =
    parseOpenAIWindow(record['secondary_window']) ||
    parseOpenAIWindow(record['secondary']) ||
    parseOpenAIWindow(record['window_secondary']) ||
    undefined;

  if (primary || secondary) {
    return { primary, secondary };
  }

  const directWindow = parseOpenAIWindow(record);
  return directWindow ? { primary: directWindow } : {};
};

const parseWindowFromAliases = (
  value: Record<string, unknown> | undefined,
  aliases: readonly string[],
): OpenAIWindow | undefined => {
  if (!value) return undefined;
  for (const alias of aliases) {
    const window = parseOpenAIWindow(value[alias]);
    if (window) return window;
  }
  return parseOpenAIWindow(value);
};

export const parseAdditionalRateLimits = (value: unknown): OpenAIAdditionalRateLimit[] => {
  if (!isRecord(value) && !Array.isArray(value)) return [];

  const parseEntry = (key: string, item: unknown): OpenAIAdditionalRateLimit | null => {
    if (!isRecord(item)) return null;
    const rateLimitRecord = isRecord(item.rate_limit) ? item.rate_limit : undefined;

    const label = cleanLimitLabel(
      findFirstString(item, [
        'limit_name',
        'limitName',
        'name',
        'metered_feature',
        'meteredFeature',
        'bucket',
        'id',
        'window_name',
      ]) || key,
    );

    const nestedWindows = rateLimitRecord ? firstWindow(rateLimitRecord) : {};
    const windows = nestedWindows.primary || nestedWindows.secondary ? nestedWindows : firstWindow(item);
    if (!windows.primary && !windows.secondary) return null;
    const stateRecord = rateLimitRecord ?? item;

    return {
      label,
      limitName: findFirstString(item, ['limit_name', 'limitName']),
      meteredFeature: findFirstString(item, ['metered_feature', 'meteredFeature']),
      allowed: readBooleanField(stateRecord, 'allowed'),
      limitReached: readBooleanField(stateRecord, 'limit_reached'),
      primary: windows.primary,
      secondary: windows.secondary,
    };
  };

  if (Array.isArray(value)) {
    return value
      .map((item, index) => parseEntry(`additional-${index}`, item))
      .filter((entry): entry is OpenAIAdditionalRateLimit => Boolean(entry));
  }

  if (!isRecord(value)) return [];

  return Object.entries(value)
    .map(([key, item]) => parseEntry(key, item))
    .filter((entry): entry is OpenAIAdditionalRateLimit => Boolean(entry));
};

export const fetchOpenAIQuota = async (): Promise<OpenAIResult | null | { error: string }> => {
  const token = readOpenAIToken();
  if (!token) return null;

  const accountId = readOpenAIAccountId(token);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'OpenCode-Quota-Toast/1.0',
  };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;

  const res = await fetchWithTimeout(OPENAI_USAGE_URL, { headers });
  if (!res.ok) {
    const text = await res.text().catch((error: unknown) => {
      if (error instanceof Error) return error.message;
      return String(error);
    });
    return { error: httpErrorMessage('OpenAI', res, text) };
  }

  const bodyResult = await readJsonResponse('OpenAI', res);
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
    codeReview: parseWindowFromAliases(codeReviewRateLimit, ['primary_window', 'primary', 'window', 'window_primary']),
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
};
