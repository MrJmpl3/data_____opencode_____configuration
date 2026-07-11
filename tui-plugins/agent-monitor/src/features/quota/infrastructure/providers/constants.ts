export { DEFAULT_FETCH_TIMEOUT_MS as FETCH_TIMEOUT_MS } from '../../domain/options.ts';
export const DASHBOARD_URL = (id: string) => `https://opencode.ai/workspace/${encodeURIComponent(id)}/go`;
export const GITHUB_API = 'https://api.github.com';
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
export const OPENAI_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
export const OPENAI_RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
export const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
export const OLLAMA_CLOUD_SETTINGS_URL = 'https://ollama.com/settings';
// Browser impersonation UA required because some provider APIs
// (OpenAI, OpenRouter) return different response shapes when accessed
// from non-browser contexts. This is a known, deliberate workaround.
// TODO(compliance-review): document browser-impersonation service-term risk
// and link the tracking issue once a ticket exists. Keep the placeholder
// `TODO(compliance-review)` greppable until a real ticket replaces it.
export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0';
