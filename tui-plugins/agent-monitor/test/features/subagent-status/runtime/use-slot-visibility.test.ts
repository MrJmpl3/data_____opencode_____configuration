import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { useSlotVisibility } from '../../../../src/kit/use-slot-visibility.ts';

describe('useSlotVisibility', () => {
  it('starts hidden, becomes visible when the slot provider mounts, and cleans up', () => {
    let visibility: ReturnType<typeof useSlotVisibility> | undefined;
    let mountSlot: (() => unknown) | undefined;

    const dispose = createRoot((rootDispose) => {
      visibility = useSlotVisibility({} as never);
      mountSlot = () => visibility?.SlotProvider({}, {});
      expect(visibility.isVisible()).toBe(false);
      mountSlot();
      expect(visibility.isVisible()).toBe(true);
      return rootDispose;
    });

    dispose();
    expect(visibility?.isVisible()).toBe(false);
  });
});
