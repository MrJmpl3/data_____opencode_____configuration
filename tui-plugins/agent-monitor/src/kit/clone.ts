/**
 * Shallow structural clone of SubagentState for hot-path mutation safety.
 *
 * Performs a shallow clone at the top level, shallow-copies each child
 * in `children` (including a shallow copy of `tokens`), and shallow-copies
 * `countedChildIDs`.  All other top-level fields are spread (structural
 * sharing for primitive-keyed Record<string, true>).
 *
 * This is ~2-4x faster than `structuredClone` for the SubagentState shape
 * and is the replacement for hot-path cloning in event merge, refresh, and
 * token backfill runners.
 *
 * `structuredClone` remains the safe choice at the persistence boundary
 * (serialized queue before disk writes).
 */

/** Minimal SubagentTokens shape that cloneState inspects. */
interface SubagentTokens {
  input?: number;
  output?: number;
  total?: number;
  contextPercent?: number;
}

/** Minimal SubagentChild shape that cloneState inspects. */
interface SubagentChild {
  tokens?: SubagentTokens;
}

/** Minimal SubagentState shape that cloneState inspects. */
export interface SubagentState {
  children: Record<string, SubagentChild>;
  countedChildIDs: Record<string, true>;
  purgedSessionIDs?: Record<string, true>;
}

export const cloneState = <S extends SubagentState>(state: S): S => ({
  ...state,
  children: Object.fromEntries(
    Object.entries(state.children).map(([id, child]) => [
      id,
      {
        ...child,
        tokens: child.tokens ? { ...child.tokens } : undefined,
      },
    ]),
  ),
  countedChildIDs: { ...state.countedChildIDs },
  ...(state.purgedSessionIDs && { purgedSessionIDs: { ...state.purgedSessionIDs } }),
});
