import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isFileReadTool,
  createFileReadAfterHook,
  createFileEditBeforeHook,
  createSystemPromptHook,
  setDebug,
  getDebugLogPath,
} from "../src/hooks";
import { stripHashes, getByteLength } from "../src/hashline";

describe("isFileReadTool", () => {
  it.each([
    ["read", undefined, true],
    ["file_read", undefined, true],
    ["cat", undefined, true],
    ["view", undefined, true],
    ["mcp.read", undefined, true],
    ["custom.file_read", undefined, true],
    ["mcp.read_file", undefined, true],
    ["write", undefined, false],
    ["bash", undefined, false],
    ["execute", undefined, false],
    ["custom_tool", { path: "/some/file" }, true],
    ["write_file", { path: "/some/file" }, false],
    ["edit_file", { file: "/x" }, false],
  ] as const)("isFileReadTool(%j, %j) === %s", (name: string, args: Record<string, unknown> | undefined, expected: boolean) => {
    expect(isFileReadTool(name, args)).toBe(expected);
  });
});

describe("createFileReadAfterHook", () => {
  it("annotates string output for file read tools", async () => {
    const hook = createFileReadAfterHook();
    const input = { tool: "read", sessionID: "s1", callID: "c1", args: { path: "/test/file.ts" } };
    const output = { title: "Read", output: "const x = 1;\nconst y = 2;\n", metadata: {} };
    await hook(input as any, output as any);
    expect(output.output).toContain("#HL ");
    expect(output.output).toMatch(/#HL 1:[0-9a-f]{3}\|const x = 1;/);
  });

  it("skips non-read tools", async () => {
    const hook = createFileReadAfterHook();
    const input = { tool: "bash", sessionID: "s1", callID: "c1", args: {} };
    const output = { title: "", output: "const x = 1;", metadata: {} };
    await hook(input as any, output as any);
    expect(output.output).toBe("const x = 1;");
  });

  it("skips tools without string output", async () => {
    const hook = createFileReadAfterHook();
    const input = { tool: "read", sessionID: "s1", callID: "c1", args: {} };
    const output = { title: "", output: undefined, metadata: {} };
    await hook(input as any, output as any);
    expect(output.output).toBeUndefined();
  });

  it("executes only once per callID (deduplication)", async () => {
    const hook = createFileReadAfterHook();
    const input = { tool: "read", sessionID: "s1", callID: "dedup1", args: {} };
    const output = { title: "", output: "line1\nline2", metadata: {} };
    await hook(input as any, output as any);
    const firstOutput = output.output;
    await hook(input as any, output as any);
    expect(output.output).toBe(firstOutput);
  });

  it("skips excluded file paths", async () => {
    const hook = createFileReadAfterHook(undefined, {
      exclude: ["**/package-lock.json"],
      maxFileSize: 1_000_000,
      hashLength: 3,
      cacheSize: 100,
      prefix: "#HL ",
      debug: false,
      fileRev: false,
    });
    const input = { tool: "read", sessionID: "s1", callID: "c2", args: { path: "package-lock.json" } };
    const output = { title: "", output: "{}", metadata: {} };
    await hook(input as any, output as any);
    // Should not annotate excluded files
    expect(output.output).not.toContain("#HL ");
    expect(output.output).toBe("{}");
  });

  it("uses cache on repeated calls", async () => {
    const hook = createFileReadAfterHook();
    const content = "const x = 1;\nconst y = 2;\n";
    const input1 = { tool: "read", sessionID: "s1", callID: "c3", args: { path: "/cache-test.ts" } };
    const output1 = { title: "", output: content, metadata: {} };
    await hook(input1 as any, output1 as any);
    const annotated1 = output1.output;

    const input2 = { tool: "read", sessionID: "s1", callID: "c4", args: { path: "/cache-test.ts" } };
    const output2 = { title: "", output: content, metadata: {} };
    await hook(input2 as any, output2 as any);
    expect(output2.output).toBe(annotated1);
  });
});

describe("createFileEditBeforeHook", () => {
  it("strips hash annotations from content fields", async () => {
    const hook = createFileEditBeforeHook();
    const input = { tool: "write", sessionID: "s1", callID: "c1" };
    const output = { args: { content: "#HL 1:a3f|const x = 1;\n#HL 2:f1c|const y = 2;" } };
    await hook(input as any, output as any);
    expect(output.args.content).toBe("const x = 1;\nconst y = 2;");
  });

  it("strips hashes from batch/multiedit arrays", async () => {
    const hook = createFileEditBeforeHook();
    const input = { tool: "multiedit", sessionID: "s1", callID: "c1" };
    const output = {
      args: {
        edits: [
          { content: "#HL 1:a3f|line1\n#HL 2:f1c|line2" },
          { content: "#HL 3:0e7|line3" },
        ],
      },
    };
    await hook(input as any, output as any);
    expect(output.args.edits[0].content).toBe("line1\nline2");
    expect(output.args.edits[1].content).toBe("line3");
  });

  it("skips non-edit tools", async () => {
    const hook = createFileEditBeforeHook();
    const input = { tool: "read", sessionID: "s1", callID: "c1" };
    const output = { args: { content: "#HL 1:a3f|hello" } };
    await hook(input as any, output as any);
    expect(output.args.content).toBe("#HL 1:a3f|hello");
  });

  it("executes only once per callID", async () => {
    const hook = createFileEditBeforeHook();
    const input = { tool: "write", sessionID: "s1", callID: "dedup-edit" };
    const output = { args: { content: "#HL 1:a3f|hello\n#HL 2:f1c|world" } };
    await hook(input as any, output as any);
    const firstArgs = output.args.content;
    await hook(input as any, output as any);
    expect(output.args.content).toBe(firstArgs);
  });
});

describe("stripHashes with custom prefix", () => {
  it.each([
    ["%% 1:a3f|hello\n%% 2:f1c|world", "%% ", "hello\nworld"],
    ["## 1:a3f|hello\n## 2:f1c|world", "## ", "hello\nworld"],
  ] as const)("stripHashes(%j, %j)", (annotated: string, prefix: string, expected: string) => {
    expect(stripHashes(annotated, prefix)).toBe(expected);
  });
});

describe("debug logging bounded size", () => {
  it("handles errors gracefully and produces valid log path", () => {
    expect(() => { setDebug(true); setDebug(false); }).not.toThrow();
    expect(getDebugLogPath()).toContain("hashline-debug.log");
  });
});

describe("createSystemPromptHook", () => {
  it("adds hashline instructions and configured prefix to system prompt", async () => {
    const defaults = createSystemPromptHook();
    const input = {};
    const output1 = { system: [] as string[] };
    await defaults(input as any, output1 as any);
    expect(output1.system).toHaveLength(1);
    expect(output1.system[0]).toContain("Hashline");
    expect(output1.system[0]).toContain("#HL");
    expect(output1.system[0]).toContain("hashline_edit");

    const custom = createSystemPromptHook({
      exclude: [], maxFileSize: 999, hashLength: 3, cacheSize: 100, prefix: "%% ", debug: false, fileRev: true,
    });
    const output2 = { system: [] as string[] };
    await custom(input as any, output2 as any);
    expect(output2.system[0]).toContain("%%");
  });
});
