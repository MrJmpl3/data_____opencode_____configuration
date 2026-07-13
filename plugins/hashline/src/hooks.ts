import { appendFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Hooks } from "@opencode-ai/plugin";
import {
  formatFileWithHashes,
  getByteLength,
  type HashlineCache,
  type HashlineConfig,
  resolveConfig,
  shouldExclude,
  stripHashes,
} from "./hashline";

const DEBUG_LOG = join(homedir(), ".config", "opencode", "hashline-debug.log");
const DEBUG_LOG_MAX_BYTES = 1_048_576;

const MAX_PROCESSED_IDS = 10_000;

class BoundedSet<T> {
  private set = new Set<T>();
  constructor(private maxSize: number) {}

  has(value: T): boolean {
    return this.set.has(value);
  }

  add(value: T): void {
    this.set.add(value);
    if (this.set.size > this.maxSize * 2) {
      const entries = [...this.set];
      this.set = new Set(entries.slice(entries.length - this.maxSize));
    }
  }

  clear(): void {
    this.set.clear();
  }

  get size(): number {
    return this.set.size;
  }

  entries(): T[] {
    return [...this.set];
  }
}

let debugEnabled = false;

export function setDebug(enabled: boolean) {
  debugEnabled = enabled;
}

export function getDebugLogPath(): string {
  return DEBUG_LOG;
}

export function writeDebugLog(line: string): void {
  try {
    let size = 0;
    try {
      size = statSync(DEBUG_LOG).size;
    } catch {}
    if (size >= DEBUG_LOG_MAX_BYTES) {
      writeFileSync(DEBUG_LOG, `[${new Date().toISOString()}] (log truncated at ${(DEBUG_LOG_MAX_BYTES / 1024).toFixed(0)} KB)\n${line}`, "utf-8");
    } else {
      appendFileSync(DEBUG_LOG, line, "utf-8");
    }
  } catch {}
}

function debug(...args: unknown[]) {
  if (!debugEnabled) return;
  const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
  writeDebugLog(line);
}

const FILE_READ_TOOLS = ["read", "file_read", "read_file", "cat", "view"];
const FILE_EDIT_TOOLS = [
  "write",
  "file_write",
  "file_edit",
  "edit",
  "edit_file",
  "patch",
  "apply_patch",
  "multiedit",
  "batch",
];

export function isFileReadTool(toolName: string, args?: Record<string, unknown>): boolean {
  const lower = toolName.toLowerCase();
  const nameMatch = FILE_READ_TOOLS.some((name) => lower === name || lower.endsWith(`.${name}`));
  if (nameMatch) return true;

  if (args && typeof args === "object") {
    if (
      typeof args.path === "string" ||
      typeof args.filePath === "string" ||
      typeof args.file === "string"
    ) {
      const writeIndicators = [
        "write",
        "edit",
        "patch",
        "execute",
        "run",
        "command",
        "shell",
        "bash",
      ];
      const isWrite = writeIndicators.some((w) => lower.includes(w));
      if (!isWrite) return true;
    }
  }

  return false;
}

export function createFileReadAfterHook(
  cache?: HashlineCache,
  config?: Required<HashlineConfig>,
): NonNullable<Hooks["tool.execute.after"]> {
  const resolved = config ?? resolveConfig();
  const hashLen = resolved.hashLength || 0;
  const prefix = resolved.prefix;

  const processedCallIds = new BoundedSet<string>(MAX_PROCESSED_IDS);

  return async (input, output) => {
    debug("tool.execute.after:", input.tool, "args:", input.args);

    if (input.callID) {
      if (processedCallIds.has(input.callID)) {
        debug("skipped: duplicate callID", input.callID);
        return;
      }
      processedCallIds.add(input.callID);
    } else {
      debug("no callID — deduplication disabled for this call");
    }

    if (!isFileReadTool(input.tool, input.args as Record<string, unknown> | undefined)) {
      debug("skipped: not a file-read tool");
      return;
    }

    if (!output.output || typeof output.output !== "string") {
      debug("skipped: no string output, type:", typeof output.output, "keys:", Object.keys(output));
      return;
    }

    const content = output.output;

    if (resolved.maxFileSize > 0) {
      const byteLength = getByteLength(content);
      if (byteLength > resolved.maxFileSize) {
        return;
      }
    }

    const filePath = input.args?.path || input.args?.file || input.args?.filePath;
    if (typeof filePath === "string" && shouldExclude(filePath, resolved.exclude)) {
      return;
    }

    if (cache && typeof filePath === "string") {
      const cached = cache.get(filePath, content);
      if (cached) {
        output.output = cached;
        return;
      }
    }

    const annotated = formatFileWithHashes(content, hashLen || undefined, prefix, resolved.fileRev);
    output.output = annotated;
    debug(
      "annotated",
      typeof filePath === "string" ? filePath : input.tool,
      "lines:",
      content.split("\n").length,
    );

    if (cache && typeof filePath === "string") {
      cache.set(filePath, content, annotated);
    }
  };
}

export function createFileEditBeforeHook(
  config?: Required<HashlineConfig>,
): NonNullable<Hooks["tool.execute.before"]> {
  const resolved = config ?? resolveConfig();
  const prefix = resolved.prefix;

  const processedCallIds = new BoundedSet<string>(MAX_PROCESSED_IDS);

  return async (input, output) => {
    if (input.callID) {
      if (processedCallIds.has(input.callID)) {
        debug("skipped: duplicate callID (edit)", input.callID);
        return;
      }
      processedCallIds.add(input.callID);
    } else {
      debug("no callID — deduplication disabled for this edit call");
    }

    const toolName = input.tool.toLowerCase();

    const isFileEdit = FILE_EDIT_TOOLS.some(
      (name) => toolName === name || toolName.endsWith(`.${name}`),
    );
    if (!isFileEdit) return;

    if (!output.args || typeof output.args !== "object") return;

    const contentFields = new Set([
      "content",
      "new_content",
      "old_content",
      "old_string",
      "new_string",
      "replacement",
      "text",
      "diff",
      "patch",
      "patchText",
      "body",
    ]);

    function stripFields(obj: Record<string, unknown>): void {
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (typeof val === "string" && contentFields.has(key)) {
          obj[key] = stripHashes(val, prefix);
        }
      }
      for (const val of Object.values(obj)) {
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === "object" && !Array.isArray(item)) {
              stripFields(item as Record<string, unknown>);
            }
          }
        }
      }
    }

    stripFields(output.args as Record<string, unknown>);
  };
}

export function createSystemPromptHook(
  config?: Required<HashlineConfig>,
): NonNullable<Hooks["experimental.chat.system.transform"]> {
  const resolved = config ?? resolveConfig();
  const prefix = resolved.prefix === false ? "" : resolved.prefix;

  return async (_input, output) => {
    output.system.push(
      [
        "## Hashline — Line Reference System",
        "",
        `File contents are annotated with hashline prefixes in the format \`${prefix}<line>:<hash>|<content>\`.`,
        "The hash length adapts to file size: 3 chars for files ≤4096 lines, 4 chars for larger files.",
        "",
        "### Example (small file, 3-char hashes):",
        "```",
        `${prefix}1:a3f|function hello() {`,
        `${prefix}2:f1c|  return "world";`,
        `${prefix}3:0e7|}`,
        "```",
        "",
        "### Example (large file, 4-char hashes):",
        "```",
        `${prefix}1:a3f2|import { useState } from 'react';`,
        `${prefix}2:f12c|`,
        `${prefix}3:0e7a|export function App() {`,
        "```",
        "",
        "### How to reference lines:",
        "You can reference specific lines using their hash tags (e.g., `2:f1c` or `2:f12c`).",
        "When editing files, you may include or omit the hash prefixes — they will be stripped automatically.",
        "",
        "### Edit operations using hash references:",
        "",
        "**Preferred tool-based edit (hash-aware):**",
        '- Use the `hashline_edit` tool with refs like `startRef: "2:f1c"` and optional `endRef`.',
        "- This avoids fragile old_string matching because edits are resolved by hash references.",
        "",
        "**Replace a single line:**",
        '- "Replace line 2:f1c" — target a specific line unambiguously',
        "",
        "**Replace a block of lines:**",
        '- "Replace block from 1:a3f to 3:0e7" — replace a range of lines',
        "- Example: replace lines 1:a3f through 3:0e7 with new content",
        "",
        "**Insert content:**",
        '- "Insert after 3:0e7" — insert new lines after a specific line',
        '- "Insert before 1:a3f" — insert new lines before a specific line',
        "",
        "**Delete lines:**",
        '- "Delete lines from 2:f1c to 3:0e7" — remove a range of lines',
        "",
        "### Hash verification rules:",
        "- **Always verify** that the hash reference matches the current line content before editing.",
        "- If a hash doesn't match, the file may have changed since you last read it — re-read the file first.",
        '- Hash references include both the line number AND the content hash, so `2:f1c` means "line 2 with hash f1c".',
        "- If you see a mismatch, do NOT proceed with the edit — re-read the file to get fresh references.",
        "",
        "### File revision (`#HL REV:<hash>`):",
        "- When files are read, the first line may contain a file revision header: `" +
          prefix +
          "REV:<8-char-hex>`.",
        "- This is a hash of the entire file content. Pass it as the `fileRev` parameter to `hashline_edit` to verify the file hasn't changed.",
        "- If the file was modified between read and edit, the revision check fails with `FILE_REV_MISMATCH` — re-read the file.",
        "",
        "### Structured error codes:",
        "- `HASH_MISMATCH` — line content changed since last read",
        "- `FILE_REV_MISMATCH` — file was modified since last read",
        "- `TARGET_OUT_OF_RANGE` — line number exceeds file length",
        "- `INVALID_REF` — malformed hash reference",
        "- `INVALID_RANGE` — start line is after end line",
        "- `MISSING_REPLACEMENT` — replace/insert operation without replacement content",
        "",
        "### Best practices:",
        "- Use hash references for all edit operations to ensure precision.",
        "- When making multiple edits, work from bottom to top to avoid line number shifts.",
        "- For large replacements, use range references (e.g., `1:a3f to 10:b2c`) instead of individual lines.",
        "- Use `fileRev` to guard against stale edits on critical files.",
      ].join("\n"),
    );
  };
}
