/** @jsxImportSource @opentui/solid */
import type { JSX } from 'solid-js';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';

export type TuiPanelProps = {
  title: string;
  children: JSX.Element;
  api: TuiPluginApi;
};

export const TuiPanel = (props: TuiPanelProps): JSX.Element => {
  const theme = () => props.api.theme.current;

  return (
    <box gap={0}>
      <text fg={theme().text}>{props.title}</text>
      {props.children}
    </box>
  );
};
