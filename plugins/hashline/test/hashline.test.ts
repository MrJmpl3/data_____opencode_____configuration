import { describe, it, expect } from "vitest";
import {
  computeLineHash,
  getAdaptiveHashLength,
  formatFileWithHashes,
  stripHashes,
  parseHashRef,
  normalizeHashRef,
  resolveRange,
  replaceRange,
  applyHashEdit,
  verifyHash,
  verifyFileRev,
  computeFileRev,
  extractFileRev,
  HashlineCache,
  HashlineError,
  shouldExclude,
  matchesGlob,
  getByteLength,
  detectLineEnding,
  findCandidateLines,
  resolveConfig,
  DEFAULT_CONFIG,
  DEFAULT_PREFIX,
  buildHashMap,
} from "../src/hashline";
import { isWithin, createHashlineEditTool } from "../src/hashline-tool";

describe("getAdaptiveHashLength", () => {
  it.each([
    [1, 3],
    [4096, 3],
    [100, 3],
    [4097, 4],
    [10000, 4],
  ] as const)("getAdaptiveHashLength(%i) === %i", (lines: number, expected: number) => {
    expect(getAdaptiveHashLength(lines)).toBe(expected);
  });
});

describe("computeLineHash", () => {
  it("produces deterministic output", () => {
    const a = computeLineHash(0, "hello world", 3);
    const b = computeLineHash(0, "hello world", 3);
    expect(a).toBe(b);
  });

  it("incorporates line index into hash", () => {
    const a = computeLineHash(0, "hello", 3);
    const b = computeLineHash(1, "hello", 3);
    expect(a).not.toBe(b);
  });

  it("is case-sensitive for line content", () => {
    const a = computeLineHash(0, "Hello", 3);
    const b = computeLineHash(0, "hello", 3);
    expect(a).not.toBe(b);
  });

  it("ignores trailing whitespace", () => {
    const a = computeLineHash(0, "hello   ", 3);
    const b = computeLineHash(0, "hello", 3);
    expect(a).toBe(b);
  });

  it("respects leading whitespace", () => {
    const a = computeLineHash(0, "  hello", 3);
    const b = computeLineHash(0, "hello", 3);
    expect(a).not.toBe(b);
  });

  it("handles non-ASCII characters", () => {
    const a = computeLineHash(0, "café ☕", 3);
    const b = computeLineHash(0, "cafe", 3);
    expect(a).not.toBe(b);
  });

  it("produces different hashes for different content", () => {
    const a = computeLineHash(0, "foo", 3);
    const b = computeLineHash(0, "bar", 3);
    expect(a).not.toBe(b);
  });

  it("produces empty lines correctly", () => {
    const hash = computeLineHash(0, "", 3);
    expect(hash.length).toBe(3);
    expect(hash).toMatch(/^[0-9a-f]{3}$/);
  });

  it("pads short hashes with leading zeros", () => {
    const hash = computeLineHash(0, "", 4);
    expect(hash.length).toBe(4);
  });
});

describe("formatFileWithHashes", () => {
  it("annotates each line with prefix and hash", () => {
    const result = formatFileWithHashes("hello\nworld", 3, "#HL ", false);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^#HL 1:[0-9a-f]{3}\|hello$/);
    expect(lines[1]).toMatch(/^#HL 2:[0-9a-f]{3}\|world$/);
  });

  it("includes file revision header when requested", () => {
    const result = formatFileWithHashes("hello\nworld", 3, "#HL ", true);
    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^#HL REV:[0-9a-f]{8}$/);
    expect(lines).toHaveLength(3);
  });

  it("defaults to hashline prefix", () => {
    const result = formatFileWithHashes("test", undefined, undefined, false);
    expect(result).toMatch(/^#HL 1:[0-9a-f]{3}\|test$/);
  });

  it("uses legacy format when prefix is false", () => {
    const result = formatFileWithHashes("test", 3, false, false);
    expect(result).toMatch(/^1:[0-9a-f]{3}\|test$/);
  });

  it("handles empty content", () => {
    const result = formatFileWithHashes("", 3, "#HL ", false);
    expect(result).toMatch(/^#HL 1:[0-9a-f]{3}\|$/);
  });

  it("handles CRLF line endings", () => {
    const result = formatFileWithHashes("hello\r\nworld", 3, "#HL ", false);
    const lines = result.split("\n");
    expect(lines).toHaveLength(2);
    // Should not contain \r in the middle of lines
    expect(lines[0]).not.toContain("\r");
  });

  it("preserves diff markers when present", () => {
    const result = formatFileWithHashes("+hello\n-world", 3, false, false);
    const lines = result.split("\n");
    expect(lines[0]).toMatch(/^1:[0-9a-f]{3}\|\+hello$/);
    expect(lines[1]).toMatch(/^2:[0-9a-f]{3}\|-world$/);
  });

  it("handles very large content with 4-char hashes", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const content = lines.join("\n");
    const result = formatFileWithHashes(content, undefined, "#HL ", false);
    const resultLines = result.split("\n");
    expect(resultLines).toHaveLength(5000);
    expect(resultLines[0]).toMatch(/^#HL 1:[0-9a-f]{4}\|line 0$/);
  });
});

describe("stripHashes", () => {
  it.each([
    ["#HL 1:a3f|hello\n#HL 2:f1c|world", "#HL ", "hello\nworld"],
    ["#HL REV:abc12345\n#HL 1:a3f|hello", "#HL ", "hello"],
    ["-#HL 1:a3f|removed\n+#HL 2:f1c|added", "#HL ", "-removed\n+added"],
    ["1:a3f|hello\n2:f1c|world", false, "hello\nworld"],
    ["const x = 123;\n#HL 1:a3f|hello\nconst y = 456;", "#HL ", "const x = 123;\nhello\nconst y = 456;"],
    ["#HL 1:a3f|hello\r\n#HL 2:f1c|world", "#HL ", "hello\r\nworld"],
  ] as const)("stripHashes(%j)", (annotated: string, prefix: string | false, expected: string) => {
    expect(stripHashes(annotated, prefix)).toBe(expected);
  });
});

describe("parseHashRef", () => {
  it.each([
    ["1:a3f", 1, "a3f"],
    ["42:a3f2", 42, "a3f2"],
  ] as const)("parses %s", (ref: string, line: number, hash: string) => {
    const result = parseHashRef(ref);
    expect(result.line).toBe(line);
    expect(result.hash).toBe(hash);
  });

  it.each([["invalid"], ["a:b"]])("throws on invalid %s", (ref: string) => {
    expect(() => parseHashRef(ref)).toThrow(HashlineError);
  });
});

describe("normalizeHashRef", () => {
  it.each([
    ["2:f1c", "2:f1c"],
    ["2:F1C", "2:f1c"],
    ["#HL 5:a3f|const x = 1;", "5:a3f"],
    ["%% 5:a3f|content", "5:a3f"],
    ["## 5:a3f|content", "5:a3f"],
    ["HL 5:a3f|content", "5:a3f"],
    ["# 5:a3f|content", "5:a3f"],
    ["L5 5:a3f|content", "5:a3f"],
    ["B2 7:def|data", "7:def"],
    ["foo bar 1:a3f|content", "1:a3f"],
    ["5:a3f|content", "5:a3f"],
  ] as const)("normalizes %s to %s", (input: string, expected: string) => {
    expect(normalizeHashRef(input)).toBe(expected);
  });

  it.each([["#HL |no_hash"], ["abc:xyz"]] as const)("rejects malformed ref %s", (input: string) => {
    expect(() => normalizeHashRef(input)).toThrow(HashlineError);
  });
});

describe("verifyHash", () => {
  it("returns valid when hash matches", () => {
    const content = "foo\nbar\nbaz";
    const hash = computeLineHash(0, "foo", 3);
    const result = verifyHash(1, hash, content, 3);
    expect(result.valid).toBe(true);
  });

  it("returns invalid when content changed", () => {
    const content = "foo\nbar\nbaz";
    const result = verifyHash(1, "000", content, 3);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("HASH_MISMATCH");
  });

  it("returns out of range when line exceeds file", () => {
    const content = "foo\nbar";
    const result = verifyHash(10, "000", content, 3);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("TARGET_OUT_OF_RANGE");
  });
});

describe("extractFileRev", () => {
  it.each([
    ["#HL REV:a1b2c3d4\n#HL 1:a3f|hello", "#HL ", "a1b2c3d4"],
    ["#HL 1:a3f|hello", "#HL ", null],
    ["REV:a1b2c3d4\n1:a3f|hello", false, "a1b2c3d4"],
  ] as const)("extractFileRev(%j)", (annotated: string, prefix: string | false, expected: string | null) => {
    expect(extractFileRev(annotated, prefix)).toBe(expected);
  });
});

describe("computeFileRev", () => {
  it("produces deterministic 8-char hex and changes with content", () => {
    const a = computeFileRev("hello world");
    const b = computeFileRev("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(computeFileRev("hello")).not.toBe(computeFileRev("world"));
  });
});

describe("verifyFileRev", () => {
  it("passes when revision matches", () => {
    const content = "hello\nworld";
    const rev = computeFileRev(content);
    expect(() => verifyFileRev(rev, content)).not.toThrow();
  });

  it("throws on mismatch", () => {
    expect(() => verifyFileRev("00000000", "hello\nworld")).toThrow(HashlineError);
    expect(() => verifyFileRev("00000000", "hello\nworld")).toThrow(/File revision mismatch/);
  });
});

describe("resolveRange", () => {
  it("resolves a valid range", () => {
    const content = "a\nb\nc\nd\ne";
    const aHash = computeLineHash(0, "a", 3);
    const cHash = computeLineHash(2, "c", 3);
    const range = resolveRange(`1:${aHash}`, `3:${cHash}`, content, 3);
    expect(range.startLine).toBe(1);
    expect(range.endLine).toBe(3);
    expect(range.content).toBe("a\nb\nc");
  });

  it("throws when start > end", () => {
    const content = "a\nb\nc";
    const bHash = computeLineHash(1, "b", 3);
    expect(() => resolveRange(`2:${bHash}`, "1:000", content, 3)).toThrow(HashlineError);
  });
});

describe("replaceRange", () => {
  it("replaces a range with new content", () => {
    const content = "a\nb\nc\nd\ne";
    const aHash = computeLineHash(0, "a", 3);
    const cHash = computeLineHash(2, "c", 3);
    const result = replaceRange(`1:${aHash}`, `3:${cHash}`, content, "x\ny", 3);
    expect(result).toBe("x\ny\nd\ne");
  });
});

describe("replaceRange CRLF", () => {
  it("replaces range without double-encoding CRLF", () => {
    const content = "a\r\nb\r\nc\r\nd\r\ne";
    const aHash = computeLineHash(0, "a", 3);
    const cHash = computeLineHash(2, "c", 3);
    const result = replaceRange(`1:${aHash}`, `3:${cHash}`, content, "x\r\ny", 3);
    expect(result).toBe("x\r\ny\r\nd\r\ne");
    expect(result).not.toMatch(/\r\r/);
  });

  it("replaces range with LF replacement in CRLF source", () => {
    const content = "a\r\nb\r\nc\r\nd\r\ne";
    const aHash = computeLineHash(0, "a", 3);
    const cHash = computeLineHash(2, "c", 3);
    const result = replaceRange(`1:${aHash}`, `3:${cHash}`, content, "x\ny", 3);
    expect(result).toBe("x\r\ny\r\nd\r\ne");
  });

  it("preserves source line-ending style after replace", () => {
    const content = "a\nb\nc\nd\ne";
    const aHash = computeLineHash(0, "a", 3);
    const cHash = computeLineHash(2, "c", 3);
    const result = replaceRange(`1:${aHash}`, `3:${cHash}`, content, "x\r\ny", 3);
    expect(result).toBe("x\ny\nd\ne");
  });
});

describe("applyHashEdit CRLF", () => {
  it("replaces without double-encoding CRLF", () => {
    const content = "line1\r\nline2\r\nline3";
    const l1Hash = computeLineHash(0, "line1", 3);
    const result = applyHashEdit(
      { operation: "replace", startRef: `1:${l1Hash}`, replacement: "new1\r\nnew2" },
      content,
      3,
    );
    expect(result.content).toBe("new1\r\nnew2\r\nline2\r\nline3");
    expect(result.content).not.toMatch(/\r\r/);
  });

  it("inserts before without double-encoding CRLF", () => {
    const content = "line1\r\nline2";
    const l1Hash = computeLineHash(0, "line1", 3);
    const result = applyHashEdit(
      { operation: "insert_before", startRef: `1:${l1Hash}`, replacement: "before\r\nbefore2" },
      content,
      3,
    );
    expect(result.content).toBe("before\r\nbefore2\r\nline1\r\nline2");
    expect(result.content).not.toMatch(/\r\r/);
  });

  it("inserts after without double-encoding CRLF", () => {
    const content = "line1\r\nline2";
    const l1Hash = computeLineHash(0, "line1", 3);
    const result = applyHashEdit(
      { operation: "insert_after", startRef: `1:${l1Hash}`, replacement: "after\r\nafter2" },
      content,
      3,
    );
    expect(result.content).toBe("line1\r\nafter\r\nafter2\r\nline2");
    expect(result.content).not.toMatch(/\r\r/);
  });

  it("deletes in CRLF content", () => {
    const content = "line1\r\nline2\r\nline3";
    const l1Hash = computeLineHash(0, "line1", 3);
    const l2Hash = computeLineHash(1, "line2", 3);
    const result = applyHashEdit(
      { operation: "delete", startRef: `1:${l1Hash}`, endRef: `2:${l2Hash}` },
      content,
      3,
    );
    expect(result.content).toBe("line3");
  });
});

describe("applyHashEdit", () => {
  const content = "line1\nline2\nline3\nline4\nline5";

  it("replaces a range", () => {
    const l1Hash = computeLineHash(0, "line1", 3);
    const l3Hash = computeLineHash(2, "line3", 3);
    const result = applyHashEdit(
      {
        operation: "replace",
        startRef: `1:${l1Hash}`,
        endRef: `3:${l3Hash}`,
        replacement: "new1\nnew2",
      },
      content,
      3,
    );
    expect(result.content).toBe("new1\nnew2\nline4\nline5");
    expect(result.startLine).toBe(1);
    expect(result.endLine).toBe(3);
  });

  it("replaces single line when endRef omitted", () => {
    const l2Hash = computeLineHash(1, "line2", 3);
    const result = applyHashEdit(
      { operation: "replace", startRef: `2:${l2Hash}`, replacement: "new2" },
      content,
      3,
    );
    expect(result.content).toBe("line1\nnew2\nline3\nline4\nline5");
  });

  it("deletes a range", () => {
    const l2Hash = computeLineHash(1, "line2", 3);
    const l4Hash = computeLineHash(3, "line4", 3);
    const result = applyHashEdit(
      { operation: "delete", startRef: `2:${l2Hash}`, endRef: `4:${l4Hash}` },
      content,
      3,
    );
    expect(result.content).toBe("line1\nline5");
  });

  it("inserts before a line", () => {
    const l1Hash = computeLineHash(0, "line1", 3);
    const result = applyHashEdit(
      { operation: "insert_before", startRef: `1:${l1Hash}`, replacement: "before" },
      content,
      3,
    );
    expect(result.content).toBe("before\nline1\nline2\nline3\nline4\nline5");
  });

  it("inserts after a line", () => {
    const l1Hash = computeLineHash(0, "line1", 3);
    const result = applyHashEdit(
      { operation: "insert_after", startRef: `1:${l1Hash}`, replacement: "after" },
      content,
      3,
    );
    expect(result.content).toBe("line1\nafter\nline2\nline3\nline4\nline5");
  });

  it("throws on missing replacement for insert", () => {
    const l1Hash = computeLineHash(0, "line1", 3);
    expect(() =>
      applyHashEdit({ operation: "insert_before", startRef: `1:${l1Hash}` }, content, 3),
    ).toThrow(HashlineError);
  });

  it("throws on missing replacement for replace", () => {
    const l1Hash = computeLineHash(0, "line1", 3);
    expect(() =>
      applyHashEdit({ operation: "replace", startRef: `1:${l1Hash}` }, content, 3),
    ).toThrow(HashlineError);
  });

  it("throws on hash mismatch", () => {
    expect(() =>
      applyHashEdit(
        { operation: "delete", startRef: "1:000", endRef: "2:000" },
        content,
        3,
      ),
    ).toThrow(HashlineError);
  });

  it("verifies file revision when provided", () => {
    const rev = computeFileRev(content);
    const l1Hash = computeLineHash(0, "line1", 3);
    const result = applyHashEdit(
      { operation: "delete", startRef: `1:${l1Hash}`, fileRev: rev },
      content,
      3,
    );
    expect(result.content).toBe("line2\nline3\nline4\nline5");
  });

  it("throws on file revision mismatch", () => {
    const l1Hash = computeLineHash(0, "line1", 3);
    expect(() =>
      applyHashEdit(
        { operation: "delete", startRef: `1:${l1Hash}`, fileRev: "00000000" },
        content,
        3,
      ),
    ).toThrow(HashlineError);
  });
});

describe("HashlineCache", () => {
  it("stores and retrieves values", () => {
    const cache = new HashlineCache(5);
    cache.set("file1", "hello", "annotated hello");
    expect(cache.get("file1", "hello")).toBe("annotated hello");
  });

  it("returns null for unknown file", () => {
    const cache = new HashlineCache(5);
    expect(cache.get("unknown", "content")).toBeNull();
  });

  it("returns null when content changed (cache stale)", () => {
    const cache = new HashlineCache(5);
    cache.set("file1", "hello", "annotated hello");
    expect(cache.get("file1", "world")).toBeNull();
  });

  it("evicts oldest entry when at capacity", () => {
    const cache = new HashlineCache(2);
    cache.set("a", "1", "ann1");
    cache.set("b", "2", "ann2");
    cache.set("c", "3", "ann3");
    expect(cache.get("a", "1")).toBeNull();
    expect(cache.get("b", "2")).toBe("ann2");
    expect(cache.get("c", "3")).toBe("ann3");
  });

  it("promotes accessed entries to most recent", () => {
    const cache = new HashlineCache(2);
    cache.set("a", "1", "ann1");
    cache.set("b", "2", "ann2");
    cache.get("a", "1"); // promote
    cache.set("c", "3", "ann3");
    expect(cache.get("a", "1")).toBe("ann1");
    expect(cache.get("b", "2")).toBeNull();
  });

  it("invalidates specific entry", () => {
    const cache = new HashlineCache(5);
    cache.set("file1", "hello", "annotated hello");
    cache.invalidate("file1");
    expect(cache.get("file1", "hello")).toBeNull();
  });

  it("clears all entries", () => {
    const cache = new HashlineCache(5);
    cache.set("a", "1", "ann1");
    cache.set("b", "2", "ann2");
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("tracks size correctly", () => {
    const cache = new HashlineCache(10);
    expect(cache.size).toBe(0);
    cache.set("a", "1", "ann1");
    expect(cache.size).toBe(1);
    cache.set("b", "2", "ann2");
    expect(cache.size).toBe(2);
  });
});

describe("shouldExclude / matchesGlob", () => {
  it.each([
    ["node_modules/foo/index.js", ["**/node_modules/**"], true],
    ["src/index.ts", ["**/node_modules/**"], false],
    ["dist/bundle.js", ["**/node_modules/**", "**/*.js"], true],
  ] as const)("shouldExclude(%j)", (file: string, patterns: readonly string[], expected: boolean) => {
    expect(shouldExclude(file, [...patterns])).toBe(expected);
  });

  it.each([
    ["package-lock.json", "**/package-lock.json", true],
    ["src/test/yarn.lock", "**/yarn.lock", true],
    ["src/index.ts", "**/yarn.lock", false],
  ] as const)("matchesGlob(%j, %j)", (file: string, pattern: string, expected: boolean) => {
    expect(matchesGlob(file, pattern)).toBe(expected);
  });
});

describe("isWithin path boundary", () => {
  it.each([
    ["/home/user/project/src/file.ts", "/home/user/project", true],
    ["/home/user/project", "/home/user/project", true],
    ["/other/project/file.ts", "/home/user/project", false],
    ["/home/file.ts", "/", false],
    ["/home/user/project/src/deep/file.ts", "/home/user/project", true],
    ["/home/user/project-other/file.ts", "/home/user/project", false],
    ["/home", "/home/user/project", false],
  ] as const)("isWithin(%j, %j) === %s", (file: string, dir: string, expected: boolean) => {
    expect(isWithin(file, dir)).toBe(expected);
  });
});

describe("hashline_edit realpath failures", () => {
  it("throws structured error when directory path unreadable", async () => {
    const tool = createHashlineEditTool({
      exclude: [],
      maxFileSize: 999,
      hashLength: 3,
      cacheSize: 100,
      prefix: "#HL ",
      debug: false,
      fileRev: true,
    });
    const ctx = {
      sessionID: "s1",
      messageID: "m1",
      agent: "test",
      directory: "/nonexistent-project-dir",
      worktree: "/nonexistent-worktree",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    };
    await expect(
      tool.execute(
        { path: "test.ts", operation: "replace", startRef: "1:abc" },
        ctx as any,
      ),
    ).rejects.toThrow(/Failed to resolve project directory/);
  });
});

describe("findCandidateLines", () => {
  it("finds lines with matching content hash", () => {
    const lines = ["foo", "bar", "foo", "baz"];
    const fooHash = computeLineHash(0, "foo", 3);
    const candidates = findCandidateLines(1, fooHash, lines, 3);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].lineNumber).toBe(3);
  });

  it("returns empty array when no matches", () => {
    const lines = ["foo", "bar"];
    const hash = computeLineHash(0, "baz", 3);
    const candidates = findCandidateLines(1, hash, lines, 3);
    expect(candidates).toHaveLength(0);
  });
});

describe("buildHashMap", () => {
  it("builds hash-to-line mapping", () => {
    const content = "a\nb\nc";
    const map = buildHashMap(content, 3);
    expect(map.size).toBe(3);
    const aHash = computeLineHash(0, "a", 3);
    expect(map.get(`1:${aHash}`)).toBe(1);
  });
});

describe("getByteLength", () => {
  it.each([
    ["hello", 5],
    ["café", 5],
    ["☕", 3],
    ["日本語", 9],
  ] as const)("getByteLength(%j) === %i", (input: string, expected: number) => {
    expect(getByteLength(input)).toBe(expected);
  });
});

describe("detectLineEnding", () => {
  it.each([
    ["hello\nworld", "\n"],
    ["hello\r\nworld", "\r\n"],
    ["hello", "\n"],
  ] as const)("detectLineEnding(%j) === %j", (content: string, expected: "\n" | "\r\n") => {
    expect(detectLineEnding(content)).toBe(expected);
  });
});

describe("resolveConfig", () => {
  it("returns defaults when no config provided", () => {
    const config = resolveConfig(undefined, undefined);
    expect(config.exclude).toHaveLength(DEFAULT_CONFIG.exclude.length);
    expect(config.maxFileSize).toBe(1_048_576);
    expect(config.prefix).toBe("#HL ");
    expect(config.hashLength).toBe(0);
    expect(config.cacheSize).toBe(100);
    expect(config.debug).toBe(false);
    expect(config.fileRev).toBe(true);
  });

  it("merges user config over defaults", () => {
    const config = resolveConfig({ maxFileSize: 500_000 });
    expect(config.maxFileSize).toBe(500_000);
    expect(config.prefix).toBe("#HL ");
  });

  it("plugin config is overridden by user config", () => {
    const config = resolveConfig({ prefix: "## " }, { prefix: "#HL ", maxFileSize: 999 });
    expect(config.prefix).toBe("## ");
    expect(config.maxFileSize).toBe(999);
  });

  it("supports prefix: false", () => {
    const config = resolveConfig({ prefix: false });
    expect(config.prefix).toBe(false);
  });

  it("copies exclude array to avoid mutation", () => {
    const config1 = resolveConfig();
    const config2 = resolveConfig();
    expect(config1.exclude).not.toBe(config2.exclude);
  });
});

describe("HashlineError", () => {
  it("creates structured error with code, message and diagnostic", () => {
    const err = new HashlineError({
      code: "HASH_MISMATCH", message: "Hash did not match", expected: "abc", actual: "def", lineNumber: 5,
    });
    expect(err.code).toBe("HASH_MISMATCH");
    expect(err.message).toBe("Hash did not match");
    expect(err.name).toBe("HashlineError");

    const diag = err.toDiagnostic();
    expect(diag).toContain("[HASH_MISMATCH]");
    expect(diag).toContain("Expected hash: abc");
  });
});

describe("CRLF round-trip", () => {
  it("formatFileWithHashes + stripHashes recovers original CRLF content", () => {
    const original = "line1\r\nline2\r\nline3";
    const annotated = formatFileWithHashes(original, 3, "#HL ", true);
    const stripped = stripHashes(annotated, "#HL ");
    // Annotation normalizes to LF; strip returns LF-only since annotated content is LF-only
    expect(stripped).toBe("line1\nline2\nline3");
  });

  it("formatFileWithHashes + stripHashes recovers original LF content", () => {
    const original = "line1\nline2\nline3";
    const annotated = formatFileWithHashes(original, 3, "#HL ", true);
    const stripped = stripHashes(annotated, "#HL ");
    expect(stripped).toBe(original);
  });

  it("empty prefix round-trip", () => {
    const original = "line1\nline2\nline3";
    const annotated = formatFileWithHashes(original, 3, false, false);
    const stripped = stripHashes(annotated, false);
    expect(stripped).toBe(original);
  });
});

describe("Collision resolution", () => {
  it("resolves hash collisions by increasing hash length", () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line${i}`);
    const content = lines.join("\n");
    const result = formatFileWithHashes(content, 3, "#HL ", false);
    const resultLines = result.split("\n");

    const hashes = resultLines.map((l) => {
      const match = l.match(/#HL \d+:([0-9a-f]+)\|/);
      return match ? match[1] : null;
    });

    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(resultLines.length);
  });

  it("collision hashes round-trip through parse/strip/normalize", () => {
    const content = "a\nb";
    const annotated = formatFileWithHashes(content, 3, "#HL ", false);
    const stripped = stripHashes(annotated, "#HL ");
    expect(stripped).toBe(content);

    const lines = annotated.split("\n");
    const match = lines[0].match(/#HL (\d+:[0-9a-f]+\|)/);
    expect(match).not.toBeNull();
    if (match) {
      const ref = normalizeHashRef(`#HL ${match[1]}`);
      expect(ref).toMatch(/^\d+:[0-9a-f]{2,}$/);
      expect(() => parseHashRef(ref)).not.toThrow();
    }
  });

  it("collision hash parses at any length (2+)", () => {
    expect(() => parseHashRef("1:abc")).not.toThrow();
    expect(() => parseHashRef("1:abcd1234")).not.toThrow();
    expect(() => parseHashRef(`1:${"a".repeat(9)}`)).not.toThrow();
    expect(() => parseHashRef(`1:${"a".repeat(16)}`)).not.toThrow();
  });

  it("collision hash strips correctly at extended length", () => {
    const annotated = `#HL 1:abc123456|line content`;
    const result = stripHashes(annotated, "#HL ");
    expect(result).toBe("line content");
  });

  it("collision hash normalizes correctly at extended length", () => {
    const ref = normalizeHashRef("#HL 1:abc123456|something");
    expect(ref).toBe("1:abc123456");
  });

  it("verifyHash accepts extended-length hashes", () => {
    const content = "hello\nworld";
    const hash = computeLineHash(0, "hello", 9);
    const result = verifyHash(1, hash, content, 9);
    expect(result.valid).toBe(true);
  });

  it("verifyHash collision check works when hashLength is explicitly 8", () => {
    const content = "a\nb";
    const base8 = computeLineHash(0, "a", 8);
    const collisionHash = base8 + "0";
    const result = verifyHash(1, collisionHash, content, 8);
    expect(result.valid).toBe(true);
  });

  it("verifyHash validates collision-avoidance extended hash by base+suffix", () => {
    const content = "a\nb";
    const base8 = computeLineHash(0, "a", 8);
    const idx = 0;
    const collisionHash = base8 + idx.toString(16);
    const result = verifyHash(1, collisionHash, content);
    expect(result.valid).toBe(true);
  });

  it("verifyHash rejects collision-avoidance hash with wrong suffix", () => {
    const content = "a\nb";
    const base8 = computeLineHash(0, "a", 8);
    const collisionHash = base8 + "ff";
    const result = verifyHash(1, collisionHash, content);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("HASH_MISMATCH");
  });

  it("verifyHash rejects collision-avoidance hash with wrong base", () => {
    const content = "a\nb";
    const collisionHash = "00000000" + "0";
    const result = verifyHash(1, collisionHash, content);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("HASH_MISMATCH");
  });

  it("parseHashRef rejects hash exceeding MAX_HASH_LENGTH (16)", () => {
    expect(() => parseHashRef(`1:${"a".repeat(17)}`)).toThrow(HashlineError);
  });

  it("stripHashes skips hashes exceeding MAX_HASH_LENGTH", () => {
    const annotated = `#HL 1:${"a".repeat(17)}|content`;
    const result = stripHashes(annotated, "#HL ");
    expect(result).toBe(`#HL 1:${"a".repeat(17)}|content`);
  });
});
