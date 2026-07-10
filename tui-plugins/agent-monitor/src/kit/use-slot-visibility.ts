import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { createSignal, onCleanup } from 'solid-js/dist/solid.js';
import type { Accessor, JSX } from 'solid-js';

/**
 * Solid reactive hook that tracks whether a sidebar slot is mounted.
 *
 * Returns `isVisible: Accessor<boolean>` (true while mounted, false otherwise)
 * and `SlotProvider: (ctx, slotInput) => JSX.Element` - a render function
 * intended to be returned by the host's `sidebar_content` slot registration.
 * `SlotProvider` sets visibility true on call and registers an `onCleanup` to
 * reset to false when the host unmounts the slot.
 */
export function useSlotVisibility(_api: TuiPluginApi): {
  isVisible: Accessor<boolean>;
  SlotProvider: (_ctx: unknown, _slotInput: unknown) => JSX.Element;
} {
  const [isVisible, setVisible] = createSignal(false);

  const SlotProvider = (_ctx: unknown, _slotInput: unknown): JSX.Element => {
    setVisible(true);
    onCleanup(() => setVisible(false));
    // SlotProvider is never actually rendered — it's a side-effect-only
    // render function that sets visibility on mount and cleans up on unmount.
    // Solid requires the return type to be JSX.Element, but there's no real DOM.
    return undefined as unknown as JSX.Element;
  };

  return { isVisible, SlotProvider };
}
