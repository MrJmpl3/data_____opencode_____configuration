import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

// ─── bridge: subscribe to OpenCode events ───────────────────────────────────

const RELEVANT_EVENTS = new Set([
  'tui.session.select',
  'session.created',
  'session.updated',
  'session.idle',
  'session.error',
  'session.status',
  'message.part.updated',
  'message.updated',
]);

export const installEventBridge = (
  api: Pick<TuiPluginApi, 'event' | 'lifecycle'>,
  refresh: () => Promise<void>,
  onEvent?: (event: unknown) => void,
): (() => void) => {
  const unsubs: Array<() => void> = [];
  const subscribe = api.event?.on;

  if (typeof subscribe !== 'function') {
    return () => undefined;
  }

  let disposed = false;

  for (const eventName of RELEVANT_EVENTS) {
    unsubs.push(
      subscribe(eventName as never, (event) => {
        onEvent?.(event);
        void refresh().catch((error) => {
          console.warn('[agent-monitor] Event refresh failed:', error instanceof Error ? error : String(error));
        });
      }),
    );
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;

    for (const unsub of unsubs) {
      try {
        unsub();
      } catch (e) {
        // Logged without a sessionId because the bridge spans every session
        // the plugin follows; the correlation lives in the caller's runtime.
        console.warn('[agent-monitor] Failed to unsubscribe event:', e instanceof Error ? e : String(e));
      }
    }
  };

  api.lifecycle.onDispose(dispose);
  return dispose;
};
