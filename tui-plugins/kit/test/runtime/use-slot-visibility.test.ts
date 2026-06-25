/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest';
import { createRoot } from 'solid-js/dist/solid.js';

import { useSlotVisibility } from '../../src/runtime/use-slot-visibility.js';

// Minimal TuiPluginApi stub — useSlotVisibility only needs the API shape, not its methods.
const stubApi = () => ({}) as unknown as import('@opencode-ai/plugin/tui').TuiPluginApi;

describe('useSlotVisibility', () => {
  // Spec scenario: Slot returns false before mount, true after mount, false after unmount.
  it('returns isVisible=false before SlotProvider, true after, false on cleanup', () => {
    const { isVisible, SlotProvider } = useSlotVisibility(stubApi());

    // Before SlotProvider call — nothing mounted yet.
    expect(isVisible()).toBe(false);

    // Mount SlotProvider inside a createRoot to provide the reactive context
    // that onCleanup requires.
    const dispose = createRoot((disposeRoot) => {
      SlotProvider(undefined, undefined);
      return disposeRoot;
    });

    // After synchronous mount, isVisible must be true.
    expect(isVisible()).toBe(true);

    // Dispose the root — this triggers onCleanup registered by SlotProvider.
    dispose();

    // After cleanup, isVisible must be false again.
    expect(isVisible()).toBe(false);
  });

  // Spec scenario: Multiple SlotProvider calls each set up independent cleanup.
  it('handles sequential SlotProvider invocations with independent cleanup', () => {
    const { isVisible, SlotProvider } = useSlotVisibility(stubApi());

    // First mount.
    const dispose1 = createRoot((disposeRoot) => {
      SlotProvider(undefined, undefined);
      return disposeRoot;
    });
    expect(isVisible()).toBe(true);

    // First cleanup.
    dispose1();
    expect(isVisible()).toBe(false);

    // Second mount — must register new cleanup independently.
    const dispose2 = createRoot((disposeRoot) => {
      SlotProvider(undefined, undefined);
      return disposeRoot;
    });
    expect(isVisible()).toBe(true);

    // Second cleanup.
    dispose2();
    expect(isVisible()).toBe(false);
  });
});
