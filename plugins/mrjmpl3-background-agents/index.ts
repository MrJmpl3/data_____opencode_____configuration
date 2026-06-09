import { BackgroundAgents } from './src/plugin.ts';

export { BackgroundAgents } from './src/plugin.ts';
export { formatDelegationContext, DELEGATION_RULES } from './src/context.ts';
export { generateReadableId } from './src/ids.ts';
export { generateMetadata } from './src/metadata.ts';
export { TimeoutError, getProjectId, withTimeout } from './src/primitives.ts';
export type { Delegation, DelegationForContext, DelegationListItem, OpencodeClient } from './src/types.ts';

export default BackgroundAgents;
