let enabled = false;

/**
 * Enables or disables debug logging for the subagent status plugin.
 * When enabled, `debugLog` calls `console.log` with the provided arguments.
 */
export const setDebugEnabled = (value: boolean): void => {
  enabled = value;
};

/**
 * Logs the provided arguments via `console.log` only when debug mode is
 * enabled. No-ops when debug is disabled, so callers can leave calls in
 * production code without side effects.
 */
export const debugLog = (...args: unknown[]): void => {
  if (enabled) {
    console.log(...args);
  }
};
