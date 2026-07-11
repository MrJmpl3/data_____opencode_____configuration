import type { SubagentState } from '../../domain/types.ts';
import type { RecoveryContext, RecoverySource } from '../recovery.ts';

import { hydrateStateFromRecoverySources, inferParentSessionID } from '../recovery.ts';

/**
 * Apply recovery sources to a freshly loaded state, retrying once with an
 * inferred parent session id when the initial pass leaves the state empty
 * and the configured parent differs from the inferred one.
 */
export const applyRecoveryIfNeeded = async (
  state: SubagentState,
  options: {
    recoveryContext?: RecoveryContext;
    recoverySources?: RecoverySource[];
  },
): Promise<boolean> => {
  if (!options.recoverySources || options.recoverySources.length === 0) return false;

  const contextParentID = options.recoveryContext?.parentSessionID;
  const inferredParentID = inferParentSessionID(state);
  // the second pass with the inferred parent is only useful when the state already
  // has children to anchor the inference — an empty state can't disambiguate a parent.
  const shouldRetryWithInferredParent =
    !!inferredParentID && inferredParentID !== contextParentID && Object.keys(state.children).length > 0;

  const directory = options.recoveryContext?.directory ?? process.cwd();

  await hydrateStateFromRecoverySources(
    state,
    { directory, parentSessionID: contextParentID },
    options.recoverySources,
  );

  if (shouldRetryWithInferredParent) {
    await hydrateStateFromRecoverySources(
      state,
      { directory, parentSessionID: inferredParentID },
      options.recoverySources,
    );
  }

  return true;
};
