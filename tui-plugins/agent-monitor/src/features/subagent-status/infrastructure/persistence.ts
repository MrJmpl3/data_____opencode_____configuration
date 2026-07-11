// Public persistence API. The implementation is split into focused modules:
//   - io.ts:        path resolution + atomic local file I/O
//   - load.ts:      loadState + JSON parsing + child hydration
//   - recovery.ts:  applyRecoveryIfNeeded (recovery source plumbing)
//   - queue.ts:     persistSnapshot + createPersistQueue (debounced disk writes)
//
// Public API is re-exported here for backwards compatibility.

export { resolveStatePath, shouldPreserveStateOnStartup, saveState } from './persistence/io.ts';
export { loadState } from './persistence/load.ts';
export { persistSnapshot, createPersistQueue } from './persistence/queue.ts';
