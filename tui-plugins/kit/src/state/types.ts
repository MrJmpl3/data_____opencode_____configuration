/**
 * Minimal structural types for SubagentState used by cloneState.
 *
 * These define only the shape that cloneState inspects.
 * Full domain types live in the subagent-status plugin and are
 * structurally compatible with these subsets.
 */

export interface SubagentTokens {
  input?: number;
  output?: number;
  total?: number;
  contextPercent?: number;
}

export interface SubagentChild {
  tokens?: SubagentTokens;
}

export interface SubagentState {
  children: Record<string, SubagentChild>;
  countedChildIDs: Record<string, true>;
}
