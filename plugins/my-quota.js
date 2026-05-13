// my-quota — Plugin de cuota para OpenCode
// Basado en: https://github.com/slkiser/opencode-quota
//
// Patron command.execute.before:
//   1. Procesar comando y generar respuesta
//   2. Inyectar via client.session.prompt({ noReply: true })
//   3. throw para cortar el flujo antes del LLM

const DASHBOARD_URL = (id) => `https://opencode.ai/workspace/${encodeURIComponent(id)}/go`;
const FETCH_TIMEOUT_MS = 10_000;
// User-Agent de Firefox real — necesario porque el CDN del dashboard
// bloquea peticiones con UA genericos o de herramientas (403/denegado).
// Es el mismo header que enviaria cualquier navegador al visitar la pagina.
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0";

// ─── Config ───────────────────────────────────────────────

function readConfig() {
  const ws = process.env.OPENCODE_GO_WORKSPACE_ID?.trim();
  const auth = process.env.OPENCODE_GO_AUTH_COOKIE?.trim();
  if (ws && auth) return { workspaceId: ws, authCookie: auth, source: "env" };
  if (!ws && !auth) return null;
  return {
    state: "incomplete",
    missing: ws ? "OPENCODE_GO_AUTH_COOKIE" : "OPENCODE_GO_WORKSPACE_ID",
  };
}

// ─── Dashboard scraping ───────────────────────────────────
// Los patrones exactos del plugin original opencode-quota.
// El HTML tiene formato SolidJS SSR como:
//   rollingUsage:$R[n]={...,usagePercent:15.2,resetInSec:3600,...}
// Los campos pueden aparecer en cualquier orden, por eso hay
// dos regex por ventana (usagePercent primero o resetInSec primero).

const NUM = String.raw`(-?\d+(?:\.\d+)?)`;

function reBothOrders(key) {
  const pctFirst = new RegExp(
    String.raw`${key}:\$R\[\d+\]=\{[^}]*usagePercent:${NUM}[^}]*resetInSec:${NUM}[^}]*\}`
  );
  const resetFirst = new RegExp(
    String.raw`${key}:\$R\[\d+\]=\{[^}]*resetInSec:${NUM}[^}]*usagePercent:${NUM}[^}]*\}`
  );
  return { pctFirst, resetFirst };
}

function extractWindow(html, key) {
  const { pctFirst, resetFirst } = reBothOrders(key);

  // Try usagePercent first
  const m1 = html.match(pctFirst);
  if (m1) {
    const usagePercent = Number(m1[1]);
    const resetInSec = Number(m1[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent: Math.max(0, usagePercent), resetInSec: Math.max(0, resetInSec) };
    }
  }

  // Try resetInSec first
  const m2 = html.match(resetFirst);
  if (m2) {
    const resetInSec = Number(m2[1]);
    const usagePercent = Number(m2[2]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent: Math.max(0, usagePercent), resetInSec: Math.max(0, resetInSec) };
    }
  }

  return null;
}

async function fetchDashboard(workspaceId, authCookie) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(DASHBOARD_URL(workspaceId), {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
        Cookie: `auth=${authCookie}`,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const html = await res.text();

    const data = {
      rolling: extractWindow(html, "rollingUsage"),
      weekly: extractWindow(html, "weeklyUsage"),
      monthly: extractWindow(html, "monthlyUsage"),
    };

    const found = [data.rolling, data.weekly, data.monthly].filter(Boolean);
    if (found.length === 0) {
      return { error: "No se encontraron datos de cuota en el dashboard" };
    }
    return { data };
  } catch (err) {
    return { error: err?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Formateo con barra de progreso ───────────────────────

function formatResetTime(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "reseteando...";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function progressBar(usedPct, width = 10) {
  const filled = Math.round((usedPct / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function labelWindow(name, data) {
  const bar = progressBar(data.usagePercent);
  const pct = data.usagePercent.toFixed(1);
  const reset = formatResetTime(
    new Date(Date.now() + data.resetInSec * 1000).toISOString()
  );
  return `${name.padEnd(20)} ${bar}  ${pct.padStart(5)}% used  (reset in ${reset})`;
}

function formatOutput(data) {
  const lines = [
    "━━━ OpenCode Go Quota ━━━",
    "",
    labelWindow("5h Rolling", data.rolling),
    data.weekly ? labelWindow("Weekly", data.weekly) : null,
    data.monthly ? labelWindow("Monthly", data.monthly) : null,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
  ].filter(Boolean);
  return lines.join("\n");
}

// ─── Plugin ────────────────────────────────────────────────

export const MyQuota = async ({ client }) => {
  console.error("[my-quota] Plugin cargado");

  return {
    config: async (cfg) => {
      if (!cfg.command) cfg.command = {};
      cfg.command["quota"] = {
        template: "Muestra informacion de cuota de OpenCode Go",
        description: "Muestra cuota actual de OpenCode Go con barra de progreso",
      };
    },

    "command.execute.before": async (input, _output) => {
      if (input.command !== "quota") return;

      // 1. Leer config
      const config = readConfig();

      let outputText;
      if (!config) {
        outputText = [
          "OpenCode Go no configurado.",
          "",
          "Variables de entorno necesarias:",
          "  OPENCODE_GO_WORKSPACE_ID",
          "  OPENCODE_GO_AUTH_COOKIE",
        ].join("\n");
      } else if (config.state === "incomplete") {
        outputText = `Config incompleta: falta ${config.missing}`;
      } else {
        // 2. Fetch dashboard
        const result = await fetchDashboard(config.workspaceId, config.authCookie);
        if (result.error) {
          outputText = `Error al consultar cuota:\n${result.error}`;
        } else {
          outputText = formatOutput(result.data);
        }
      }

      // 3. Inyectar sin LLM
      await client.session.prompt({
        path: { id: input.sessionID },
        body: {
          noReply: true,
          parts: [{ type: "text", text: outputText, ignored: true }],
        },
      });

      // 4. Toast
      try {
        await client.tui.showToast({
          body: { message: "/quota — consultado", variant: "info" },
        });
      } catch {}

      // 5. Cortar flujo
      throw new Error("__QUOTA_COMMAND_HANDLED__");
    },
  };
};
