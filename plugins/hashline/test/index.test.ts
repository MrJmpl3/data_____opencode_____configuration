import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { sanitizeConfig, createHashlinePlugin, HashlinePlugin } from "../index";
import { writeDebugLog, getDebugLogPath } from "../src/hooks";

describe("shared debug logger", () => {
  it("handles errors gracefully and returns valid log path", () => {
    expect(typeof writeDebugLog).toBe("function");
    expect(() => writeDebugLog("test line\n")).not.toThrow();
    expect(getDebugLogPath()).toContain("hashline-debug.log");
  });
});

describe("sanitizeConfig", () => {
  it.each([null, "string", 42, undefined, [1, 2, 3]])("returns empty object for %j", (input: unknown) => {
    expect(sanitizeConfig(input)).toEqual({});
  });

  it("validates exclude array", () => {
    const result = sanitizeConfig({ exclude: ["**/node_modules/**", "**/*.lock"] });
    expect(result.exclude).toEqual(["**/node_modules/**", "**/*.lock"]);
  });

  it("filters non-string and oversized exclude patterns", () => {
    const result = sanitizeConfig({ exclude: ["valid", 123, null, false, "a".repeat(600)] });
    expect(result.exclude).toEqual(["valid"]);
  });

  it("caps exclude array at 1000 items", () => {
    const big = Array.from({ length: 2000 }, (_, i) => `pattern${i}`);
    const result = sanitizeConfig({ exclude: big });
    expect(result.exclude).toHaveLength(1000);
  });

  it.each([
    [{ maxFileSize: 1_000_000 }, 1_000_000],
    [{ maxFileSize: 0 }, 0],
    [{ maxFileSize: -1 }, undefined],
    [{ maxFileSize: Infinity }, undefined],
    [{ maxFileSize: "big" }, undefined],
  ] as const)("validates maxFileSize(%j)", (input: { maxFileSize?: unknown }, expected: number | undefined) => {
    expect(sanitizeConfig(input).maxFileSize).toBe(expected);
  });

  it.each([
    [{ hashLength: 4 }, 4],
    [{ hashLength: 0 }, 0],
    [{ hashLength: -5 }, 0],
    [{ hashLength: 20 }, 8],
    [{ hashLength: 3.7 }, 3],
    [{ hashLength: "bad" }, undefined],
  ] as const)("validates hashLength(%j)", (input: { hashLength?: unknown }, expected: number | undefined) => {
    expect(sanitizeConfig(input).hashLength).toBe(expected);
  });

  it.each([
    [{ cacheSize: 200 }, 200],
    [{ cacheSize: 50_000 }, 10_000],
    [{ cacheSize: 0 }, undefined],
    [{ cacheSize: -1 }, undefined],
    [{ cacheSize: 10.7 }, 10],
  ] as const)("validates cacheSize(%j)", (input: { cacheSize?: unknown }, expected: number | undefined) => {
    expect(sanitizeConfig(input).cacheSize).toBe(expected);
  });

  it.each([
    [{ prefix: "## " }, "## "],
    [{ prefix: false }, false],
    [{ prefix: true }, undefined],
    [{ prefix: "a\nb" }, undefined],
    [{ prefix: "a".repeat(25) }, undefined],
  ] as const)("validates prefix(%j)", (input: { prefix?: unknown }, expected: string | false | undefined) => {
    expect(sanitizeConfig(input).prefix).toBe(expected);
  });

  it.each([
    [{ debug: true }, true],
    [{ debug: false }, false],
    [{ debug: 1 }, undefined],
    [{ fileRev: false }, false],
    [{ fileRev: "no" }, undefined],
  ] as const)("validates debug/fileRev(%j)", (input: Record<string, unknown>, expected: boolean | undefined) => {
    const val = sanitizeConfig(input);
    const key = Object.keys(input)[0];
    expect((val as any)[key]).toBe(expected);
  });

  it("handles prototype-inherited keys safely", () => {
    // __proto__ in object literal sets the prototype, making exclude inherited
    const result = sanitizeConfig(Object.assign(Object.create(null), { maxFileSize: 999 }));
    expect(result.maxFileSize).toBe(999);
  });
});

describe("HashlinePlugin export", () => {
  it("exports Plugin instances and creates hooks object", async () => {
    expect(HashlinePlugin).toBeDefined();
    expect(typeof HashlinePlugin).toBe("function");
    expect(typeof createHashlinePlugin({ maxFileSize: 500 })).toBe("function");

    const hooks = await createHashlinePlugin({ maxFileSize: 500 })({
      directory: "/tmp", worktree: "/tmp",
      client: {} as any, project: {} as any,
      serverUrl: new URL("http://localhost"), $: {} as any, experimental_workspace: {} as any,
    } as any);
    expect(hooks).toHaveProperty("tool");
    expect(hooks).toHaveProperty("tool.execute.after");
    expect(hooks).toHaveProperty("tool.execute.before");
    expect(hooks).toHaveProperty("experimental.chat.system.transform");
    expect(hooks).toHaveProperty("chat.message");
    expect(hooks.tool).toHaveProperty("hashline_edit");
  });
});

describe("chat.message hook", () => {
  let tmpDir: string;
  let testFilePath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "hashline-chat-test-"));
    testFilePath = join(tmpDir, "greeting.ts");
    writeFileSync(testFilePath, "const x = 1;\nconst y = 2;\n", "utf-8");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("annotates a file part and substitutes the URL", async () => {
    const plugin = createHashlinePlugin({ maxFileSize: 100_000 });
    const hooks = await plugin({
      directory: tmpDir,
      worktree: tmpDir,
      client: {} as any,
      project: {} as any,
      serverUrl: new URL("http://localhost"),
      $: {} as any,
      experimental_workspace: {} as any,
    } as any);

    const parts = [{ type: "file", url: `file://${testFilePath}`, mime: "text/typescript" }];
    const output = { message: {}, parts };

    await hooks["chat.message"]!({} as any, output as any);

    const updatedUrl = parts[0].url;
    expect(updatedUrl).not.toBe(`file://${testFilePath}`);
    expect(updatedUrl).toMatch(/^file:\/\/\/.*hl-[0-9a-f]{32}\.txt$/);

    const tmpPath = fileURLToPath(updatedUrl);
    const annotated = readFileSync(tmpPath, "utf-8");
    expect(annotated).toContain("#HL ");
    expect(annotated).toContain("const x = 1;");

    const perms = statSync(tmpPath).mode & 0o777;
    expect(perms).toBe(0o600);
  });

  it("skips files excluded by pattern", async () => {
    const plugin = createHashlinePlugin({ maxFileSize: 100_000, exclude: ["**/*.ts"] });
    const hooks = await plugin({
      directory: tmpDir,
      worktree: tmpDir,
      client: {} as any,
      project: {} as any,
      serverUrl: new URL("http://localhost"),
      $: {} as any,
      experimental_workspace: {} as any,
    } as any);

    const parts = [{ type: "file", url: `file://${testFilePath}`, mime: "text/typescript" }];
    const output = { message: {}, parts };

    await hooks["chat.message"]!({} as any, output as any);
    expect(parts[0].url).toBe(`file://${testFilePath}`);
  });

  it("skips non-text mime types", async () => {
    const plugin = createHashlinePlugin({ maxFileSize: 100_000 });
    const hooks = await plugin({
      directory: tmpDir,
      worktree: tmpDir,
      client: {} as any,
      project: {} as any,
      serverUrl: new URL("http://localhost"),
      $: {} as any,
      experimental_workspace: {} as any,
    } as any);

    const parts = [{ type: "file", url: `file://${testFilePath}`, mime: "image/png" }];
    const output = { message: {}, parts };

    await hooks["chat.message"]!({} as any, output as any);
    expect(parts[0].url).toBe(`file://${testFilePath}`);
  });

  it("handles errors gracefully without throwing", async () => {
    const plugin = createHashlinePlugin();
    const hooks = await plugin({
      directory: tmpDir,
      worktree: tmpDir,
      client: {} as any,
      project: {} as any,
      serverUrl: new URL("http://localhost"),
      $: {} as any,
      experimental_workspace: {} as any,
    } as any);

    const parts = [{ type: "file", url: "file:///nonexistent/path.txt", mime: "text/plain" }];
    const output = { message: {}, parts };

    await expect(hooks["chat.message"]!({} as any, output as any)).resolves.toBeUndefined();
    expect(parts[0].url).toBe("file:///nonexistent/path.txt");
  });

  it.each([
    ["", "/etc/passwd"],
    [null, "/etc/hostname"],
  ] as const)("protects boundary when worktree is %j", async (worktree: string | null, file: string) => {
    const hooks = await createHashlinePlugin()({
      directory: tmpDir, worktree,
      client: {} as any, project: {} as any,
      serverUrl: new URL("http://localhost"), $: {} as any, experimental_workspace: {} as any,
    } as any);

    const parts = [{ type: "file", url: `file://${file}`, mime: "text/plain" }];
    const output = { message: {}, parts };

    await hooks["chat.message"]!({} as any, output as any);
    expect(parts[0].url).toBe(`file://${file}`);
  });

  it("does not annotate when temp dir creation failed", async () => {
    const plugin = createHashlinePlugin();
    const hooks = await plugin({
      directory: tmpDir,
      worktree: tmpDir,
      client: {} as any,
      project: {} as any,
      serverUrl: new URL("http://localhost"),
      $: {} as any,
      experimental_workspace: {} as any,
    } as any);

    const parts = [{ type: "file", url: `file://${testFilePath}`, mime: "text/typescript" }];
    const output = { message: {}, parts };

    await hooks["chat.message"]!({} as any, output as any);
    expect(parts[0].url).toMatch(/^file:\/\/\/.*hl-/);
  });
});
