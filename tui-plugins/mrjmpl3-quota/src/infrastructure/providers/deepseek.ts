import type { DeepSeekBalanceInfo, DeepSeekResult, QuotaDisplayMode } from '../../domain/types.ts';
import type { QuotaLine } from '../../domain/lines.ts';
import { detailTextLine } from '../../domain/lines.ts';
import { readAuthProviderApiKey } from './auth.ts';
import { DEEPSEEK_BALANCE_URL } from './constants.ts';
import { fetchWithTimeout, httpErrorMessage, readJsonResponse } from './http.ts';
import { isRecord, readBooleanField, readNumericField, readStringField } from './shared.ts';

const DEEPSEEK_AUTH_FIELDS = ['apiKey', 'api_key', 'token', 'access'] as const;

const readDeepSeekToken = (): string | null => {
  const key = process.env.DEEPSEEK_API_KEY?.trim();
  if (key) return key;

  return readAuthProviderApiKey(['deepseek'], DEEPSEEK_AUTH_FIELDS);
};

const currencySymbol = (currency: string): string => {
  if (currency.toUpperCase() === 'CNY') return '¥';
  return '$';
};

const formatCurrencyAmount = (currency: string, value: number): string => {
  return `${currencySymbol(currency)}${value.toFixed(2)}`;
};

const formatBalancePrefix = (balances: readonly DeepSeekBalanceInfo[], balance: DeepSeekBalanceInfo): string => {
  return balances.length > 1 ? `${balance.currency.toUpperCase()} Balance` : 'Balance';
};

export const formatDeepSeekLines = (data: DeepSeekResult, displayMode: QuotaDisplayMode): QuotaLine[] => {
  if (!data.isAvailable || data.balances.length === 0) return [];

  return data.balances.map((balance) => {
    const prefix = formatBalancePrefix(data.balances, balance);
    if (displayMode === 'used' && balance.grantedBalance !== undefined && balance.toppedUpBalance !== undefined) {
      const totalAdded = balance.grantedBalance + balance.toppedUpBalance;
      const used = Math.max(0, totalAdded - balance.totalBalance);
      return detailTextLine(
        `${prefix} ${formatCurrencyAmount(balance.currency, used)}/${formatCurrencyAmount(balance.currency, balance.totalBalance)}`,
      );
    }

    return detailTextLine(`${prefix} ${formatCurrencyAmount(balance.currency, balance.totalBalance)}`);
  });
};

const parseBalance = (value: unknown): DeepSeekBalanceInfo | null => {
  if (!isRecord(value)) return null;
  const currency = readStringField(value, 'currency')?.trim().toUpperCase();
  const totalBalance = readNumericField(value, 'total_balance');
  if (!currency || totalBalance === undefined) return null;

  return {
    currency,
    totalBalance,
    grantedBalance: readNumericField(value, 'granted_balance'),
    toppedUpBalance: readNumericField(value, 'topped_up_balance'),
  };
};

const parseDeepSeekPayload = (body: unknown): DeepSeekResult | { error: string } => {
  if (!isRecord(body)) return { error: 'DeepSeek did not return expected balance data' };
  const isAvailable = readBooleanField(body, 'is_available');
  const balanceInfos = body.balance_infos;
  if (isAvailable === undefined || !Array.isArray(balanceInfos)) {
    return { error: 'DeepSeek did not return expected balance data' };
  }

  const balances = balanceInfos.map(parseBalance).filter((balance): balance is DeepSeekBalanceInfo => balance !== null);
  if (isAvailable && balances.length === 0) return { error: 'DeepSeek did not return expected balance data' };

  return { isAvailable, balances };
};

export const fetchDeepSeekQuota = async (signal?: AbortSignal): Promise<DeepSeekResult | null | { error: string }> => {
  const token = readDeepSeekToken();
  if (!token) return null;

  const response = await fetchWithTimeout(
    DEEPSEEK_BALANCE_URL,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    },
    undefined,
    signal,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { error: httpErrorMessage('DeepSeek', response, text) };
  }

  const bodyResult = await readJsonResponse('DeepSeek', response);
  if ('error' in bodyResult) return bodyResult;

  return parseDeepSeekPayload(bodyResult.data);
};
