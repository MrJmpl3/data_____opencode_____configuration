import { firstDefined, isRecord, readBooleanField, readNumericField, readStringField } from '../../../kit/coercion.ts';
import type {
  OpenAIAdditionalRateLimit,
  OpenAIResetCredit,
  OpenAIResetCreditStatus,
  OpenAIResetCreditsResult,
  OpenAIResetCreditsState,
  OpenAIWindow,
} from './types.ts';

export const readWindowResetSeconds = (record: Record<string, unknown>): number | undefined => {
  const resetAfterSeconds = firstDefined(
    readNumericField(record, 'reset_after_seconds'),
    readNumericField(record, 'reset_after'),
    readNumericField(record, 'resetAfter'),
    readNumericField(record, 'reset_in_seconds'),
    readNumericField(record, 'resetInSec'),
  );
  if (resetAfterSeconds !== undefined) return Math.max(0, Math.floor(resetAfterSeconds));

  const resetAt = readStringField(record, 'reset_at') || readStringField(record, 'resetAt');
  if (resetAt) {
    const date = Date.parse(resetAt);
    if (!Number.isNaN(date)) return Math.max(0, Math.floor((date - Date.now()) / 1000));
  }

  const resetAtEpoch = readNumericField(record, 'reset_at');
  if (resetAtEpoch !== undefined) {
    const ms = resetAtEpoch > 1_000_000_000_000 ? resetAtEpoch : resetAtEpoch * 1000;
    return Math.max(0, Math.floor((ms - Date.now()) / 1000));
  }
  return undefined;
};

export const findFirstString = (record: Record<string, unknown>, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const found = readStringField(record, key);
    if (found) return found;
  }
  return undefined;
};

export const parseOpenAIWindow = (value: unknown): OpenAIWindow | undefined => {
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
  if (usedPct === undefined && usedAmount !== undefined && limitAmount !== undefined && limitAmount > 0)
    usedPct = (usedAmount / limitAmount) * 100;
  if (usedPct === undefined && remainingAmount !== undefined && limitAmount !== undefined && limitAmount > 0)
    usedPct = (1 - remainingAmount / limitAmount) * 100;
  if (usedPct === undefined && remainingPercent !== undefined) usedPct = 100 - remainingPercent;
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
    usedPct: Math.max(0, Math.min(100, usedPct)),
    resetSec,
    limitWindowSec: limitWindowSec !== undefined ? Math.max(0, Math.floor(limitWindowSec)) : undefined,
  };
};

export const firstWindow = (record: Record<string, unknown>): { primary?: OpenAIWindow; secondary?: OpenAIWindow } => {
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
  if (primary || secondary) return { primary, secondary };
  const directWindow = parseOpenAIWindow(record);
  return directWindow ? { primary: directWindow } : {};
};

export const parseWindowFromAliases = (
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
    const label =
      findFirstString(item, [
        'limit_name',
        'limitName',
        'name',
        'metered_feature',
        'meteredFeature',
        'bucket',
        'id',
        'window_name',
      ])?.trim() || key;
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

  if (Array.isArray(value))
    return value
      .map((item, index) => parseEntry(`additional-${index}`, item))
      .filter((entry): entry is OpenAIAdditionalRateLimit => Boolean(entry));

  if (!isRecord(value)) return [];
  return Object.entries(value)
    .map(([key, item]) => parseEntry(key, item))
    .filter((entry): entry is OpenAIAdditionalRateLimit => Boolean(entry));
};

const RESET_CREDIT_STATUS_VALUES: readonly OpenAIResetCreditStatus[] = [
  'available',
  'redeemed',
  'expired',
  'redeeming',
];

export const parseResetCreditStatus = (value: unknown): OpenAIResetCreditStatus | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return RESET_CREDIT_STATUS_VALUES.includes(normalized as OpenAIResetCreditStatus)
    ? (normalized as OpenAIResetCreditStatus)
    : undefined;
};

export const parseResetCreditEntry = (item: unknown): OpenAIResetCredit | null => {
  if (!isRecord(item)) return null;
  const grantedAtIso = readStringField(item, 'granted_at') ?? readStringField(item, 'grantedAt');
  const expiresAtIso = readStringField(item, 'expires_at') ?? readStringField(item, 'expiresAt');
  const status = parseResetCreditStatus(readStringField(item, 'status') ?? readStringField(item, 'state'));
  if (!grantedAtIso && !expiresAtIso && !status) return null;
  return { grantedAtIso, expiresAtIso, status };
};

export const parseResetCreditsPayload = (body: unknown, nowMs: number = Date.now()): OpenAIResetCreditsResult => {
  if (!isRecord(body))
    return { state: 'unavailable', availableCount: 0, credits: [], errorMessage: 'Invalid reset-credits payload' };
  const availableCountRaw = readNumericField(body, 'available_count') ?? readNumericField(body, 'availableCount');
  const availableCount = typeof availableCountRaw === 'number' ? Math.max(0, Math.floor(availableCountRaw)) : 0;
  const creditsRaw = body.credits;
  const credits: OpenAIResetCredit[] = [];
  if (Array.isArray(creditsRaw)) {
    for (const item of creditsRaw) {
      const credit = parseResetCreditEntry(item);
      if (credit) credits.push(credit);
    }
  }
  const futureExpiryTimestamps = credits
    .map((credit) => (credit.expiresAtIso ? Date.parse(credit.expiresAtIso) : Number.NaN))
    .filter((ms) => !Number.isNaN(ms) && ms > nowMs)
    .sort((a, b) => a - b);
  const nextExpiresAtMs = futureExpiryTimestamps.length > 0 ? futureExpiryTimestamps[0] : undefined;
  const state: OpenAIResetCreditsState = availableCount > 0 ? 'available' : 'none-available';
  return { state, availableCount, credits, nextExpiresAtMs };
};
