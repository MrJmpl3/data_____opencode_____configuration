import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TuiPluginApi, TuiPluginMeta } from '@opencode-ai/plugin/tui';

import plugin from '../index.tsx';
import { readSessionIdFromEvent, subscribeRefreshTriggers } from '../src/features/quota/runtime.tsx';

type EventHandler = (payload?: unknown) => void;
type MockApi = TuiPluginApi & {
  handlers: Map<string, EventHandler>;
};

// ponytail: only the surface this file asserts on is mocked explicitly
// (slots.register calls, event.on bus, the `handlers` lookup map used in
// `subscribeRefreshTriggers` tests). The runtime walks a few other members
// to register features, so those are stubbed with no-ops. Everything else
// is satisfied via `as unknown as TuiPluginApi` — adding new TuiPluginApi
// members won't require a parallel change here.
const createMockApi = (): MockApi => {
  const handlers = new Map<string, EventHandler>();
  const api = {
    client: { session: {} },
    slots: { register: vi.fn() },
    event: {
      on: (eventName: string, handler: EventHandler) => {
        handlers.set(eventName, handler);
        return () => handlers.delete(eventName);
      },
    },
    lifecycle: { onDispose: () => {} },
    state: { path: { directory: process.cwd() }, session: {} },
    handlers,
  };
  return api as unknown as MockApi;
};

describe('agent-monitor runtime (quota-only)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exposes the unified plugin contract', () => {
    expect(plugin.id).toBe('agent-monitor');
    expect(typeof plugin.tui).toBe('function');
  });

  it('registers sidebar_content slots for both features (subagent-status at 110, quota at 120)', async () => {
    const api = createMockApi();

    await plugin.tui(api, undefined, {} as TuiPluginMeta);

    expect(api.slots.register).toHaveBeenCalledTimes(2);
    const calls = (api.slots.register as ReturnType<typeof vi.fn>).mock.calls;
    const orders = calls.map((call) => call[0].order);
    expect(orders).toContain(110);
    expect(orders).toContain(120);
    for (const call of calls) {
      expect(typeof call[0].slots.sidebar_content).toBe('function');
    }
  });
});

describe('readSessionIdFromEvent', () => {
  it('returns undefined for non-objects', () => {
    expect(readSessionIdFromEvent(undefined)).toBeUndefined();
    expect(readSessionIdFromEvent(null)).toBeUndefined();
    expect(readSessionIdFromEvent('abc')).toBeUndefined();
    expect(readSessionIdFromEvent(42)).toBeUndefined();
  });

  it('returns the top-level sessionID when present', () => {
    expect(readSessionIdFromEvent({ sessionID: 'sess-1' })).toBe('sess-1');
  });

  it('falls back to properties.sessionID when the top level is missing', () => {
    expect(readSessionIdFromEvent({ properties: { sessionID: 'sess-2' } })).toBe('sess-2');
  });

  it('falls back to info.sessionID when neither is present', () => {
    expect(readSessionIdFromEvent({ info: { sessionID: 'sess-3' } })).toBe('sess-3');
  });

  it('returns undefined for empty or non-string ids', () => {
    expect(readSessionIdFromEvent({ sessionID: '' })).toBeUndefined();
    expect(readSessionIdFromEvent({ sessionID: '   ' })).toBeUndefined();
    expect(readSessionIdFromEvent({ sessionID: 123 })).toBeUndefined();
  });
});

describe('subscribeRefreshTriggers', () => {
  it('calls onTrigger with the event name and the session id when fired', () => {
    const api = createMockApi();
    const onTrigger = vi.fn();
    const { unsubscribe } = subscribeRefreshTriggers({
      events: api.event,
      lifecycle: api.lifecycle,
      eventNames: ['tui.session.select', 'session.idle'],
      onTrigger,
    });

    const handler = api.handlers.get('tui.session.select');
    expect(handler).toBeDefined();
    handler?.({ sessionID: 'sess-x' });

    expect(onTrigger).toHaveBeenCalledWith('tui.session.select', 'sess-x');
    unsubscribe();
  });

  it('unsubscribes so subsequent fires do not call onTrigger', () => {
    const api = createMockApi();
    const onTrigger = vi.fn();
    const { unsubscribe } = subscribeRefreshTriggers({
      events: api.event,
      lifecycle: api.lifecycle,
      eventNames: ['session.error'],
      onTrigger,
    });

    const handler = api.handlers.get('session.error');
    handler?.({ sessionID: 'sess-1' });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    unsubscribe();
    // After unsubscribe the mock removes the handler from the bus, so a
    // fresh lookup returns undefined. Firing the old captured reference
    // would bypass the unsubscribe; the bus-level check is the contract.
    expect(api.handlers.has('session.error')).toBe(false);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('passes undefined as sessionId when the payload has no session id', () => {
    const api = createMockApi();
    const onTrigger = vi.fn();
    subscribeRefreshTriggers({
      events: api.event,
      lifecycle: api.lifecycle,
      eventNames: ['session.idle'],
      onTrigger,
    });

    api.handlers.get('session.idle')?.({ unrelated: true });
    expect(onTrigger).toHaveBeenCalledWith('session.idle', undefined);
  });
});
