// Status-hydration public surface — re-exports from the split modules so
// existing consumers (hydrate-client.ts, orchestrator.ts, tests) keep
// importing from this file without churn.

export type { MessageActivity, MessageSummary } from './message-activity.ts';
export {
  analyzeMessages,
  createTuiMessageActivityCache,
  emptyMessageActivity,
  groupTargetRowsBySessionID,
  latestSessionActivityAt,
  sessionStatusEndedAt,
  summarizeMessages,
} from './message-activity.ts';

export type { HydrationContext, RunningEvidenceCollector, StatusHydrationOptions } from './hydrate-child.ts';
export {
  hydrateChildFromSessionActivity,
  hydrateChildTokensFromLogs,
  isRecoveryProtectedFromRunning,
} from './hydrate-child.ts';
