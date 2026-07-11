/** @jsxImportSource @opentui/solid */
import type { JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { renderQuotaLine, formatPaceLineText } from '../../domain/format.ts';
import { quotaColor } from '../../domain/lines.ts';
import type { QuotaLine } from '../../domain/types.ts';

const computeExhausted = (lines: readonly QuotaLine[]): readonly boolean[] => {
  const flags = new Array<boolean>(lines.length).fill(false);
  let groupStart = -1;
  let exhausted = false;
  const flushGroup = (end: number): void => {
    if (exhausted) for (let i = groupStart; i < end; i++) flags[i] = true;
    exhausted = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === 'heading') {
      flushGroup(i);
      groupStart = i;
    } else if (line.kind === 'window' && line.usedPct !== undefined && line.usedPct >= 100) exhausted = true;
  }
  flushGroup(lines.length);
  return flags;
};

const lineFg = (line: QuotaLine, nowMs: number, groupExhausted: boolean): string => {
  if (groupExhausted && line.kind !== 'heading') return 'red';
  switch (line.kind) {
    case 'heading':
      return 'white';
    case 'window':
      return quotaColor(line.usedPct, line.tone);
    case 'pace': {
      const resetSec = Math.max(0, Math.ceil((line.resetAtMs - nowMs) / 1000));
      const { paceText } = formatPaceLineText({ usedPct: line.usedPct, resetSec }, line.windowSeconds);
      return paceText.startsWith('⚠') ? 'red' : 'green';
    }
    case 'detail':
      return quotaColor(undefined, line.tone);
  }
};

export type QuotaViewProps = {
  lines: readonly QuotaLine[];
  nowMs: number;
  loading: boolean;
  api: TuiPluginApi;
};

export const QuotaView = (props: QuotaViewProps): JSX.Element => {
  const exhausted = createMemo(() => computeExhausted(props.lines));
  return (
    <box gap={0}>
      <Show
        when={!props.loading || props.lines.length > 0}
        fallback={
          <text fg="gray" wrapMode="none">
            Loading…
          </text>
        }
      >
        <Show
          when={props.lines.length > 0}
          fallback={
            <text fg="gray" wrapMode="none">
              No data
            </text>
          }
        >
          <For each={props.lines}>
            {(line, index) => (
              <text fg={lineFg(line, props.nowMs, exhausted()[index()])} wrapMode="none">
                {renderQuotaLine(line, props.nowMs)}
              </text>
            )}
          </For>
        </Show>
      </Show>
    </box>
  );
};
