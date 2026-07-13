import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";
import {
  formatFileWithHashes,
  getByteLength,
  HashlineCache,
  type HashlineConfig,
  resolveConfig,
  shouldExclude,
} from "./src/hashline";
import { createHashlineEditTool, isWithin } from "./src/hashline-tool";
import {
  createFileEditBeforeHook,
  createFileReadAfterHook,
  createSystemPromptHook,
  setDebug,
  writeDebugLog,
} from "./src/hooks";

const CONFIG_FILENAME = "hashline.json";

const tempDirs = new Set<string>();
let exitListenerRegistered = false;

function registerTempDir(dir: string): void {
  if (!dir) return;
  tempDirs.add(dir);
  if (!exitListenerRegistered) {
    exitListenerRegistered = true;
    process.on("exit", () => {
      for (const d of tempDirs) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {}
      }
    });
  }
}

function writeTempFile(tempDir: string, content: string): string {
  const name = `hl-${randomBytes(16).toString("hex")}.txt`;
  const tmpPath = join(tempDir, name);
  writeFileSync(tmpPath, content, { mode: 0o600, encoding: "utf-8" });
  return tmpPath;
}

export function sanitizeConfig(raw: unknown): HashlineConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const result: HashlineConfig = {};

  if (Array.isArray(r.exclude)) {
    result.exclude = r.exclude
      .filter((p): p is string => typeof p === "string" && p.length <= 512)
      .slice(0, 1000);
  }
  if (typeof r.maxFileSize === "number" && Number.isFinite(r.maxFileSize) && r.maxFileSize >= 0) {
    result.maxFileSize = r.maxFileSize;
  }
  if (typeof r.hashLength === "number" && Number.isFinite(r.hashLength)) {
    result.hashLength = Math.max(0, Math.min(8, Math.floor(r.hashLength)));
  }
  if (typeof r.cacheSize === "number" && Number.isFinite(r.cacheSize) && r.cacheSize > 0) {
    result.cacheSize = Math.min(Math.floor(r.cacheSize), 10_000);
  }
  if (r.prefix === false) {
    result.prefix = false;
  } else if (typeof r.prefix === "string") {
    if (/^[\x20-\x7E]{0,20}$/.test(r.prefix)) {
      result.prefix = r.prefix;
    }
  }
  if (typeof r.debug === "boolean") {
    result.debug = r.debug;
  }
  if (typeof r.fileRev === "boolean") {
    result.fileRev = r.fileRev;
  }

  return result;
}

function loadConfigFile(filePath: string): HashlineConfig | undefined {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return sanitizeConfig(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function loadConfig(projectDir?: string, userConfig?: HashlineConfig): HashlineConfig {
  const globalPath = join(homedir(), ".config", "opencode", CONFIG_FILENAME);
  const globalConfig = loadConfigFile(globalPath);

  let projectConfig: HashlineConfig | undefined;
  if (projectDir) {
    projectConfig = loadConfigFile(join(projectDir, CONFIG_FILENAME));
  }

  return {
    ...globalConfig,
    ...projectConfig,
    ...userConfig,
  };
}

interface PluginInput {
  directory?: string;
  worktree?: string;
}

export function createHashlinePlugin(userConfig?: HashlineConfig): Plugin {
  return async (input) => {
    const { directory: projectDir, worktree } = input as PluginInput;
    const fileConfig = loadConfig(projectDir, userConfig);
    const config = resolveConfig(fileConfig);
    const cache = new HashlineCache(config.cacheSize);

    setDebug(config.debug);
    if (config.debug) {
      writeDebugLog(
        `[${new Date().toISOString()}] plugin loaded, prefix: ${JSON.stringify(config.prefix)}, maxFileSize: ${config.maxFileSize}, projectDir: ${projectDir}\n`,
      );
    }

    let instanceTmpDir: string | null;
    try {
      instanceTmpDir = mkdtempSync(join(tmpdir(), "hashline-"));
      registerTempDir(instanceTmpDir!);
    } catch {
      instanceTmpDir = null;
    }

    return {
      tool: {
        hashline_edit: createHashlineEditTool(config, cache),
      },
      "tool.execute.after": createFileReadAfterHook(cache, config),
      "tool.execute.before": createFileEditBeforeHook(config),
      "experimental.chat.system.transform": createSystemPromptHook(config),
      "chat.message": async (_input: unknown, output: unknown) => {
        try {
          const out = output as {
            message?: unknown;
            parts?: { type?: string; url?: string; mime?: string }[];
          };
          const hashLen = config.hashLength || 0;
          const prefix = config.prefix;

          const resolvedBoundary: string | null = (() => {
            try {
              const candidate = worktree || (input as PluginInput).directory;
              if (!candidate) return null;
              return realpathSync(resolve(candidate));
            } catch {
              return null;
            }
          })();

          for (const p of out.parts ?? []) {
            try {
              if (p.type !== "file") continue;
              if (!p.url || !p.mime?.startsWith("text/")) continue;

              let filePath: string | undefined;
              if (typeof p.url === "string" && p.url.startsWith("file://")) {
                filePath = fileURLToPath(p.url);
              }
              if (!filePath) continue;

              if (!resolvedBoundary) continue;

              let realFile: string;
              try {
                realFile = realpathSync(filePath);
                if (!isWithin(realFile, resolvedBoundary)) continue;
              } catch {
                continue;
              }

              if (shouldExclude(filePath, config.exclude)) continue;

              let content: string;
              try {
                content = readFileSync(filePath, "utf-8");
              } catch {
                continue;
              }

              if (config.maxFileSize > 0 && getByteLength(content) > config.maxFileSize) continue;

              if (!instanceTmpDir) continue;

              const cached = cache.get(filePath, content);
              if (cached) {
                const tmpPath = writeTempFile(instanceTmpDir!, cached);
                p.url = `file://${tmpPath}`;
                if (config.debug) {
                  writeDebugLog(
                    `[${new Date().toISOString()}] chat.message annotated (cached): ${filePath}\n`,
                  );
                }
                continue;
              }

              const annotated = formatFileWithHashes(
                content,
                hashLen || undefined,
                prefix,
                config.fileRev,
              );
              cache.set(filePath, content, annotated);

              const tmpPath = writeTempFile(instanceTmpDir!, annotated);
              p.url = `file://${tmpPath}`;

              if (config.debug) {
                writeDebugLog(
                  `[${new Date().toISOString()}] chat.message annotated: ${filePath} lines=${content.split("\n").length}\n`,
                );
              }
            } catch (e) {
              if (config.debug) {
                writeDebugLog(`[${new Date().toISOString()}] chat.message part error: ${e}\n`);
              }
            }
          }
        } catch (e) {
          if (config.debug) {
            writeDebugLog(`[${new Date().toISOString()}] chat.message error: ${e}\n`);
          }
        }
      },
    };
  };
}

export const HashlinePlugin: Plugin = createHashlinePlugin();

export default HashlinePlugin;

export type {
  CandidateLine,
  HashEditInput,
  HashEditOperation,
  HashEditResult,
  HashlineConfig,
  HashlineErrorCode,
  ResolvedRange,
  VerifyHashResult,
} from "./src/hashline";
