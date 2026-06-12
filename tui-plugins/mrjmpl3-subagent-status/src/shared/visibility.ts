export interface SubagentVisibilityPolicy {
  doneRetentionMs: number;
  staleRetentionMs: number;
}

export const DEFAULT_DONE_RETENTION_MS = 10 * 60 * 1000;
export const DEFAULT_STALE_RETENTION_MS = 20 * 60 * 1000;

export const DEFAULT_SUBAGENT_VISIBILITY_POLICY: SubagentVisibilityPolicy = {
  doneRetentionMs: DEFAULT_DONE_RETENTION_MS,
  staleRetentionMs: DEFAULT_STALE_RETENTION_MS,
};
