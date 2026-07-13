import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  applyHashEdit,
  getByteLength,
  type HashEditOperation,
  type HashlineCache,
  type HashlineConfig,
  HashlineError,
} from "./hashline";

export function isWithin(filePath: string, dir: string): boolean {
  if (dir === sep) return false;
  if (process.platform === "win32") {
    if (/^[A-Za-z]:\\$/.test(dir)) return false;
    if (/^\\\\[^\\]+\\[^\\]+$/.test(dir)) return false;
  }
  return filePath === dir || filePath.startsWith(dir + sep);
}

export function createHashlineEditTool(config: Required<HashlineConfig>, cache?: HashlineCache) {
  return {
    description:
      "Edit files using hashline references. Resolves refs like 5:a3f or '#HL 5:a3f|...' and applies replace/delete/insert without old_string matching.",
    args: {
      path: z.string().describe("Path to the file (absolute or relative to project directory)"),
      operation: z
        .enum(["replace", "delete", "insert_before", "insert_after"])
        .describe("Edit operation"),
      startRef: z
        .string()
        .describe('Start hash reference, e.g. "5:a3f" or "#HL 5:a3f|const x = 1;"'),
      endRef: z
        .string()
        .optional()
        .describe("End hash reference for range operations. Defaults to startRef when omitted."),
      replacement: z
        .string()
        .max(10_000_000)
        .optional()
        .describe("Replacement/inserted content. Required for replace/insert operations."),
      fileRev: z
        .string()
        .optional()
        .describe(
          "File revision hash (8-char hex from #HL REV:<hash>). When provided, verifies the file hasn't changed before editing.",
        ),
    },
    async execute(args: Record<string, unknown>, context: ToolContext) {
      const { path, operation, startRef, endRef, replacement, fileRev } = args as {
        path: string;
        operation: HashEditOperation;
        startRef: string;
        endRef?: string;
        replacement?: string;
        fileRev?: string;
      };
      const absPath = isAbsolute(path) ? path : resolve(context.directory, path);
      let realDirectory: string;
      let realWorktree: string;
      try {
        realDirectory = realpathSync(resolve(context.directory));
        realWorktree = realpathSync(resolve(context.worktree));
      } catch (err) {
        throw new Error(
          `Failed to resolve project directory for "${path}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      let realAbs: string;
      try {
        realAbs = realpathSync(absPath);
      } catch {
        const parentDir = dirname(absPath);
        let realParent: string;
        try {
          realParent = realpathSync(parentDir);
        } catch {
          throw new Error(`Access denied: cannot verify parent directory for "${path}"`);
        }
        if (!isWithin(realParent, realDirectory) && !isWithin(realParent, realWorktree)) {
          throw new Error(`Access denied: "${path}" resolves outside the project directory`);
        }
        realAbs = join(realParent, basename(absPath));
      }

      if (!isWithin(realAbs, realDirectory) && !isWithin(realAbs, realWorktree)) {
        throw new Error(`Access denied: "${path}" resolves outside the project directory`);
      }
      const displayPath = relative(context.worktree, absPath) || path;

      let current: string;
      try {
        current = readFileSync(realAbs, "utf-8");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read "${displayPath}": ${reason}`);
      }

      if (config.maxFileSize > 0 && getByteLength(current) > config.maxFileSize) {
        throw new Error(
          `File "${displayPath}" exceeds the configured maximum size (${config.maxFileSize} bytes)`,
        );
      }

      let nextContent: string;
      let startLine: number;
      let endLine: number;
      try {
        const result = applyHashEdit(
          {
            operation: operation,
            startRef: startRef,
            endRef: endRef,
            replacement: replacement,
            fileRev: fileRev,
          },
          current,
          config.hashLength || undefined,
        );
        nextContent = result.content;
        startLine = result.startLine;
        endLine = result.endLine;
      } catch (error) {
        if (error instanceof HashlineError) {
          throw new Error(`Hashline edit failed for "${displayPath}":\n${error.toDiagnostic()}`);
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Hashline edit failed for "${displayPath}": ${reason}`);
      }

      try {
        writeFileSync(realAbs, nextContent, "utf-8");
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to write "${displayPath}": ${reason}`);
      }

      if (cache) {
        cache.invalidate(realAbs);
      }

      context.metadata({
        title: `hashline_edit: ${operation} ${displayPath}`,
        metadata: {
          path: displayPath,
          operation: operation,
          startLine,
          endLine,
        },
      });

      return [
        `Applied ${operation} to ${displayPath}.`,
        `Resolved range: ${startLine}-${endLine}.`,
        "Re-read the file to get fresh hash references before the next edit.",
      ].join("\n");
    },
  };
}
