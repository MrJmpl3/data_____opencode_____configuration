/** @jsxImportSource @opentui/solid */
import type { JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

import { renderQuotaLine, formatPaceLineText } from '../../domain/format.ts';
import { remainingSeconds, usageColor } from '../../domain/lines.ts';
import type { QuotaLine, QuotaLineTone } from '../../domain/types.ts';

const toneColor = (tone: QuotaLineTone | undefined): string => {
  switch (tone) {
    case 'success':
      return 'green';
    case 'warning':
      return 'yellow';
    case 'error':
      return 'red';
    case 'neutral':
    default:
      return 'gray';
  }
};

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
      return line.usedPct !== undefined ? usageColor(line.usedPct) : toneColor(line.tone);
    case 'pace': {
      const resetSec = remainingSeconds(line.resetAtMs, nowMs);
      const { paceText } = formatPaceLineText({ usedPct: line.usedPct, resetSec }, line.windowSeconds);
      return paceText.startsWith('⚠') ? 'red' : 'green';
    }
    case 'detail':
      return toneColor(line.tone);
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
