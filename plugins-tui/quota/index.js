/**
 * my-quota-tui — Sidebar panel for OpenCode TUI.
 *
 * Shows real-time quota from OpenCode Go, GitHub Copilot, and OpenRouter.
 * Refreshes automatically on LLM response and session changes.
 *
 * Data fetching lives in providers.js (in the same folder).
 */

import { createElement, insert, setProp } from "@opentui/solid";
import {
  readGoConfig,
  fetchGoDashboard,
  fetchCopilotQuota,
  fetchOpenRouterQuota,
  fmtDuration,
} from "./providers.js";
import { createRefreshScheduler } from "./refresh-scheduler.js";

// ═══════════════════════════════════════════════════════════
// TUI element helpers (pattern: oh-my-opencode-slim)
// ═══════════════════════════════════════════════════════════

function el(tag, props, children = []) {
  const node = createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) setProp(node, key, value);
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    insert(node, child);
  }
  return node;
}

function txt(props, children) {
  return el("text", props, children);
}

function box(props, children = []) {
  return el("box", props, children);
}

// ═══════════════════════════════════════════════════════════
// Sidebar render
// ═══════════════════════════════════════════════════════════

function renderSidebar(lines, theme) {
  const children = [txt({ fg: theme.text }, ["Quota"])];
  if (lines.length > 0) {
    for (const line of lines) {
      children.push(txt({ fg: theme.textMuted, wrapMode: "none" }, [line]));
    }
  } else {
    children.push(txt({ fg: theme.textMuted, wrapMode: "none" }, ["No data"]));
  }
  return box({ gap: 0 }, children);
}

// ═══════════════════════════════════════════════════════════
// Plugin
// ═══════════════════════════════════════════════════════════

const plugin = {
  id: "@my/quota-tui",

  tui: async (api) => {
    let lines = [];
    let inFlightVersion = 0;
    let disposed = false;
    let fallbackTimer = null;

    // Refresh immediately for UI transitions, and again later for LLM completion.
    const IMMEDIATE_REFRESH_EVENTS = ["session.updated", "session.status", "message.removed", "tui.session.select"];
    const COMPLETION_REFRESH_EVENTS = ["message.part.updated", "message.updated", "session.idle"];

    async function refresh() {
      if (disposed) return;
      const currentVersion = ++inFlightVersion;
      try {
        const items = [];

        // ── OpenCode Go ──
        const goConfig = readGoConfig();
        if (goConfig) {
          const result = await fetchGoDashboard(goConfig.workspaceId, goConfig.authCookie);
          if (result.data) {
            const d = result.data;
            items.push("OpenCode Go");
            for (const [name, key] of [["5h Rolling", "rolling"], ["Weekly", "weekly"], ["Monthly", "monthly"]]) {
              const w = d[key];
              if (w) items.push(`  ${name}  ${w.remaining.toFixed(0)}%  · ${fmtDuration(w.resetInSec)} left`);
            }
          }
        }

        // ── GitHub Copilot ──
        const cp = await fetchCopilotQuota();
        if (cp && !cp.error) {
          items.push("GitHub Copilot");
          const reset = cp.resetSec ? `  · ${fmtDuration(cp.resetSec)} left` : "";
          items.push(`  Monthly  ${cp.text}${reset}`);
        }

        // ── OpenRouter ──
        const or = await fetchOpenRouterQuota();
        if (or && !or.error) {
          items.push("OpenRouter");
          items.push(`  Credits  ${or.text}`);
        }
        if (currentVersion !== inFlightVersion) return;
        lines = items;
      } catch (e) {
        if (disposed || currentVersion !== inFlightVersion) return;
        lines = [`Error: ${e?.message ?? e}`];
      }

      api.renderer.requestRender();
    }
    const scheduler = createRefreshScheduler({
      api,
      onRefresh: refresh,
      immediateEvents: IMMEDIATE_REFRESH_EVENTS,
      completionEvents: COMPLETION_REFRESH_EVENTS,
    });

    api.lifecycle.onDispose(() => {
      disposed = true;
      scheduler.dispose();
      if (fallbackTimer) clearInterval(fallbackTimer);
    });

    // Initial data load
    await refresh();

    fallbackTimer = setInterval(() => refresh(), 120_000);

    api.slots.register({
      order: 250,
      slots: {
        sidebar_content() {
          return renderSidebar(lines, api.theme.current);
        },
      },
    });
  },
};

export default plugin;
