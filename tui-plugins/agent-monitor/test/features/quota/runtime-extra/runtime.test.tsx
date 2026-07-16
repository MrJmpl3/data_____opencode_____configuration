import { afterEach, describe, expect, it, vi } from 'vitest';

const readQuotaConfig = vi.hoisted(() => vi.fn());
const register = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/features/quota/infrastructure/providers/config.ts', () => ({ readQuotaConfig }));
vi.mock('../../../../src/features/quota/ui/components/quota-section.tsx', () => ({
  QuotaSection: (props: Record<string, unknown>) => ({ type: 'quota-section', props }),
}));

import {
  readSessionIdFromEvent,
  registerSidebarTui,
  subscribeRefreshTriggers,
} from '../../../../src/features/quota/runtime.tsx';

describe('quota runtime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    readQuotaConfig.mockReset();
    register.mockReset();
  });

  it('extracts the first usable session id from supported event payload shapes', () => {
    expect(readSessionIdFromEvent(null)).toBeUndefined();
    expect(readSessionIdFromEvent({ sessionID: ' direct ' })).toBe(' direct ');
    expect(readSessionIdFromEvent({ sessionID: '', sessionId: 'id' })).toBe('id');
    expect(readSessionIdFromEvent({ properties: { sessionId: 'property-id' } })).toBe('property-id');
    expect(readSessionIdFromEvent({ info: { sessionID: 'info-id' } })).toBe('info-id');
    expect(readSessionIdFromEvent({ properties: {}, info: {} })).toBeUndefined();
  });

  it('registers the sidebar with merged options and warns about invalid providers', async () => {
    readQuotaConfig.mockReturnValue({ options: { displayMode: 'used', visibleProviders: ['openai', 'invalid'] } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const api = {
      slots: { register },
      event: { on: vi.fn() },
      lifecycle: { onDispose: vi.fn() },
    };

    await (registerSidebarTui as unknown as (value: unknown) => Promise<void>)(api);

    expect(register).toHaveBeenCalledWith({ order: 120, slots: { sidebar_content: expect.any(Function) } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignoring invalid visibleProviders entries'));
    const registration = register.mock.calls[0][0];
    expect(registration.slots.sidebar_content()).toMatchObject({
      type: 'quota-section',
      props: { options: expect.objectContaining({ displayMode: 'used', visibleProviders: ['openai', 'invalid'] }) },
    });
  });

  it('subscribes all refresh events and disposes every listener', () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const unsubscribers = [vi.fn(), vi.fn()];
    const onDispose = vi.fn();
    const onTrigger = vi.fn();
    subscribeRefreshTriggers({
      events: {
        on: (name: string, handler: (payload: unknown) => void) => {
          handlers.set(name, handler);
          return unsubscribers[handlers.size - 1];
        },
      },
      lifecycle: { onDispose },
      eventNames: ['session.idle', 'session.error'],
      onTrigger,
    } as never);

    handlers.get('session.error')?.({ sessionId: 'ses-error' });
    expect(onTrigger).toHaveBeenCalledWith('session.error', 'ses-error');
    expect(onDispose).toHaveBeenCalledWith(expect.any(Function));
    onDispose.mock.calls[0][0]();
    expect(unsubscribers[0]).toHaveBeenCalledOnce();
    expect(unsubscribers[1]).toHaveBeenCalledOnce();
  });
});
