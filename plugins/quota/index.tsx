/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from "solid-js";
import type { TuiPluginModule, TuiPluginApi } from "@opencode-ai/plugin/tui";
import {
  readGoConfig,
  fetchGoDashboard,
  fetchCopilotQuota,
  fetchOpenRouterQuota,
  fmtDuration,
} from "./providers.js";
import { createRefreshScheduler } from "./refresh-scheduler.js";

function View(props: {
  getLines: () => string[];
  api: TuiPluginApi;
}) {
  const theme = () => props.api.theme.current;
  return (
    <box gap={0}>
      <text fg={theme().text}>Quota</text>
      <Show
        when={props.getLines().length > 0}
        fallback={
          <text fg={theme().textMuted} wrapMode="none">
            No data
          </text>
        }
      >
        {props.getLines().map((line) => (
          <text fg={theme().textMuted} wrapMode="none">
            {line}
          </text>
        ))}
      </Show>
    </box>
  );
}

const plugin: TuiPluginModule & { id: string } = {
  id: "quota",

  tui: async (api) => {
    const { slots, event: evt, lifecycle } = api;
    const [lines, setLines] = createSignal<string[]>([]);
    let inFlightVersion = 0;
    let disposed = false;
    const IMMEDIATE_REFRESH_EVENTS = ["tui.session.select"];
    const COMPLETION_REFRESH_EVENTS = ["session.idle"];

    async function refresh(source?: string) {
      if (disposed) return;
      const currentVersion = ++inFlightVersion;
      let firstError: string | undefined;

      const results = new Map<string, string[] | string>();

      function buildLines() {
        const items: string[] = [];
        for (const [tag, key] of [
          ["OpenCode Go", "go"],
          ["GitHub Copilot", "cp"],
          ["OpenRouter", "or"],
        ] as const) {
          const r = results.get(key);
          if (!r) {
            items.push(`${tag} ⏳`);
          } else if (typeof r === "string") {
            items.push(`${tag} ❌`);
            items.push(`  ${r}`);
          } else {
            items.push(tag);
            for (const line of r) items.push(`  ${line}`);
          }
        }
        return items;
      }

      setLines(buildLines());

      try {
        // ── OpenCode Go ──
        const goConfig = readGoConfig();
        if (goConfig) {
          const result = await fetchGoDashboard(
            goConfig.workspaceId,
            goConfig.authCookie,
          );
          if (currentVersion !== inFlightVersion) return;
          if ("data" in result) {
            const d = result.data;
            const dataLines: string[] = [];
            for (const [name, key] of [
              ["5h Rolling", "rolling"],
              ["Weekly", "weekly"],
              ["Monthly", "monthly"],
            ] as const) {
              const w = d[key];
              if (w)
                dataLines.push(
                  `${name}  ${w.remaining.toFixed(0)}%  · ${fmtDuration(w.resetInSec)} left`,
                );
            }
            results.set("go", dataLines.length ? dataLines : ["No windows"]);
          } else {
            results.set("go", result.error);
            firstError ??= result.error;
          }
          setLines(buildLines());
        } else {
          results.set("go", "No config");
          setLines(buildLines());
        }

        // ── GitHub Copilot ──
        const cp = await fetchCopilotQuota();
        if (currentVersion !== inFlightVersion) return;
        if (cp && !("error" in cp)) {
          const reset = cp.resetSec
            ? ` · ${fmtDuration(cp.resetSec)} left`
            : "";
          results.set("cp", [`Monthly  ${cp.text}${reset}`]);
        } else if (cp && "error" in cp) {
          results.set("cp", cp.error);
          firstError ??= cp.error;
        } else {
          results.set("cp", "No token configured");
          firstError ??= "No token configured";
        }
        setLines(buildLines());

        // ── OpenRouter ──
        const or = await fetchOpenRouterQuota();
        if (currentVersion !== inFlightVersion) return;
        if (or && !("error" in or)) {
          results.set("or", [`Credits  ${or.text}`]);
        } else if (or && "error" in or) {
          results.set("or", or.error);
          firstError ??= or.error;
        } else {
          results.set("or", "No API key configured");
          firstError ??= "No API key configured";
        }
        setLines(buildLines());

        // ── Toast ──
        const toastMsg = firstError
          ? `Quota: ${firstError}`
          : `Quota updated${source ? ` (${source})` : ""}`;
        try {
          (api as any).ui.toast(toastMsg);
        } catch {}
      } catch (e) {
        if (disposed || currentVersion !== inFlightVersion) return;
        const msg = `Error: ${e instanceof Error ? e.message : String(e)}`;
        setLines([msg]);
        try {
          (api as any).ui.toast(`Quota: ${msg}`);
        } catch {}
      }
    }
    const scheduler = createRefreshScheduler({
      subscribe: (eventName, handler) => evt.on(eventName as any, handler),
      onRefresh: refresh,
      immediateEvents: IMMEDIATE_REFRESH_EVENTS,
      completionEvents: COMPLETION_REFRESH_EVENTS,
    });
    lifecycle.onDispose(() => {
      disposed = true;
      scheduler.dispose();
    });

    await refresh();

    slots.register({
      order: 180,
      slots: {
        sidebar_content() {
          return <View getLines={lines} api={api} />;
        },
      },
    });
  },
};

export default plugin;
