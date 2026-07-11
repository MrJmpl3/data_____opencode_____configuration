/**
 * GPT-5.6 Support Plugin
 *
 * Addresses three GPT-5.6 issues in OpenCode that are waiting on upstream PRs:
 *
 * 1. Issue #36140 — GPT-5.6 Luna "model not found" with ChatGPT OAuth
 *    Codex 0.144 requires specific originator + User-Agent headers to route
 *    Luna requests correctly. The built-in plugin sends "opencode" as originator,
 *    but Codex expects "codex_cli_rs". This override matches what Codex CLI sends.
 *
 * 2. Issue #36247 — GPT-5.6 Codex OAuth uses wrong context limits
 *    When OpenAI authentication uses Codex OAuth, GPT-5.6 variants inherit the
 *    direct API's 1.05M limits. The Codex backend uses context: 500000,
 *    input: 372000, output: 128000 for gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna.
 *    Without this override, OpenCode compacts too late and the session breaks.
 *
 * 3. Issue #36318 — GPT-5.6 prompt caching defaults
 *    GPT-5.6 uses `promptCacheOptions: { mode: "implicit", ttl: "30m" }` for
 *    more reliable cache matching. Older models do not receive this option.
 *
 * @see https://github.com/anomalyco/opencode/issues/36140
 * @see https://github.com/anomalyco/opencode/issues/36247
 * @see https://github.com/anomalyco/opencode/issues/36318
 */

import type { Plugin } from '@opencode-ai/plugin';

// Matches any GPT-5.6 variant: gpt-5.6, gpt-5.6-sol, gpt-5.6-terra,
// gpt-5.6-luna, gpt-5.6-fast, and provider-prefixed like openai/gpt-5.6-sol
const GPT56_RE = /(?:^|[/.])gpt-5\.6(?:$|[-_/.])/;

const GPT56_PROMPT_CACHE_OPTIONS = { mode: 'implicit', ttl: '30m' } as const;

const GPT56_CODEX_LIMITS = {
  context: 500_000,
  input: 372_000,
  output: 128_000,
} as const;

export default (async () => ({
  /**
   * Fix #36140: Send Codex CLI-compatible headers for GPT-5.6 Luna support.
   *
   * The Codex backend validates originator + User-Agent to route requests.
   * GPT-5.6 Luna requires matching what Codex CLI 0.144+ sends, or it
   * returns HTTP 404 "Model not found".
   *
   * We apply this to ALL OpenAI requests because the originator/UA header
   * combination is the standard Codex transport contract. The built-in
   * CodexAuthPlugin sends different values that don't work with Luna.
   */
  'chat.headers': async (input, output) => {
    if (input.model.providerID !== 'openai') return;

    output.headers.originator = 'codex_cli_rs';
    output.headers['User-Agent'] = 'codex_cli_rs/0.0.0 (OpenCode)';
  },

  /**
   * Fix #36318: Inject implicit prompt caching for GPT-5.6 family.
   *
   * GPT-5.6+ uses request-wide prompt_cache_options with implicit mode
   * and a 30-minute TTL. GPT-5.5 and older models keep their existing
   * prompt_cache_key behavior unchanged.
   */
  'chat.params': async (input, output) => {
    if (input.model.providerID !== 'openai') return;
    if (!GPT56_RE.test(input.model.api.id.toLowerCase())) return;

    output.options.promptCacheOptions = GPT56_PROMPT_CACHE_OPTIONS;
  },

  /**
   * Fix #36247: Override Codex OAuth context limits for GPT-5.6 variants.
   *
   * When OpenAI authentication uses ChatGPT OAuth, GPT-5.6 models currently
   * inherit the direct API limits (context: 1,050,000 / input: 922,000).
   * The actual Codex backend enforces lower budgets — notably input: 372,000.
   *
   * Without this override, OpenCode's proactive compaction runs too late,
   * the Codex endpoint rejects the request, and the session becomes unusable.
   *
   * This forwards every model unchanged except for GPT-5.6 variants, which
   * receive the correct Codex OAuth limits. API-key authentication is not
   * affected since the hook only applies to OAuth sessions.
   */
  provider: {
    id: 'openai',
    async models(provider, ctx) {
      if (ctx.auth?.type !== 'oauth') return provider.models;

      return Object.fromEntries(
        Object.entries(provider.models).map(([modelID, model]) => {
          const modelName = model.name?.toLowerCase() ?? modelID.toLowerCase();
          if (modelName.includes('gpt-5.6')) {
            return [
              modelID,
              {
                ...model,
                limit: { ...GPT56_CODEX_LIMITS },
              },
            ];
          }
          return [modelID, model];
        }),
      );
    },
  },
})) satisfies Plugin;
