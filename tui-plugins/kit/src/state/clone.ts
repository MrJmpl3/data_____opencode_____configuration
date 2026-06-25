/**
 * Shallow structural clone of SubagentState for hot-path mutation safety.
 *
 * Performs a shallow clone at the top level, shallow-copies each child
 * in `children` (including a shallow copy of `tokens`), and shallow-copies
 * `countedChildIDs`.  All other top-level fields are spread (structural
 * sharing for primitive-keyed Record<string, true>).
 *
 * This is ~2–4× faster than `structuredClone` for the SubagentState shape
 * and is the replacement for hot-path cloning in event merge, refresh, and
 * token backfill runners.
 *
 * `structuredClone` remains the safe choice at the persistence boundary
 * (serialized queue before disk writes).
 */
import type { SubagentState } from './types.js';

export { type SubagentChild, type SubagentState, type SubagentTokens } from './types.js';

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
});
