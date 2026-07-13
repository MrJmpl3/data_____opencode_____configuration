import { matchesGlob as pathMatchesGlob } from "node:path";

export interface HashlineConfig {
  exclude?: string[];
  maxFileSize?: number;
  hashLength?: number;
  cacheSize?: number;
  prefix?: string | false;
  debug?: boolean;
  fileRev?: boolean;
}

export const MAX_HASH_LENGTH = 16;

export const DEFAULT_EXCLUDE_PATTERNS: string[] = [
  "**/node_modules/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.bundle.js",
  "**/*.map",
];

export const DEFAULT_PREFIX = "#HL ";

export const DEFAULT_CONFIG: Required<HashlineConfig> = {
  exclude: DEFAULT_EXCLUDE_PATTERNS,
  maxFileSize: 1_048_576,
  hashLength: 0,
  cacheSize: 100,
  prefix: DEFAULT_PREFIX,
  debug: false,
  fileRev: true,
};

export function resolveConfig(
  config?: HashlineConfig,
  pluginConfig?: HashlineConfig,
): Required<HashlineConfig> {
  const merged: HashlineConfig = {
    ...pluginConfig,
    ...config,
  };
  if (!merged || Object.keys(merged).length === 0) {
    return { ...DEFAULT_CONFIG, exclude: [...DEFAULT_CONFIG.exclude] } as Required<HashlineConfig>;
  }
  return {
    exclude: merged.exclude ?? [...DEFAULT_CONFIG.exclude],
    maxFileSize: merged.maxFileSize ?? DEFAULT_CONFIG.maxFileSize,
    hashLength: merged.hashLength ?? DEFAULT_CONFIG.hashLength,
    cacheSize: merged.cacheSize ?? DEFAULT_CONFIG.cacheSize,
    prefix: merged.prefix !== undefined ? merged.prefix : DEFAULT_CONFIG.prefix,
    debug: merged.debug ?? DEFAULT_CONFIG.debug,
    fileRev: merged.fileRev ?? DEFAULT_CONFIG.fileRev,
  };
}

export type HashlineErrorCode =
  | "HASH_MISMATCH"
  | "FILE_REV_MISMATCH"
  | "TARGET_OUT_OF_RANGE"
  | "INVALID_REF"
  | "INVALID_RANGE"
  | "MISSING_REPLACEMENT";

export interface CandidateLine {
  lineNumber: number;
  content: string;
}

export class HashlineError extends Error {
  readonly code: HashlineErrorCode;
  readonly expected?: string;
  readonly actual?: string;
  readonly candidates?: CandidateLine[];
  readonly hint?: string;
  readonly lineNumber?: number;
  readonly filePath?: string;

  constructor(opts: {
    code: HashlineErrorCode;
    message: string;
    expected?: string;
    actual?: string;
    candidates?: CandidateLine[];
    hint?: string;
    lineNumber?: number;
    filePath?: string;
  }) {
    super(opts.message);
    this.name = "HashlineError";
    this.code = opts.code;
    this.expected = opts.expected;
    this.actual = opts.actual;
    this.candidates = opts.candidates;
    this.hint = opts.hint;
    this.lineNumber = opts.lineNumber;
    this.filePath = opts.filePath;
  }

  toDiagnostic(): string {
    const parts: string[] = [`[${this.code}] ${this.message}`];
    if (this.filePath) {
      parts.push(`  File: ${this.filePath}`);
    }
    if (this.lineNumber !== undefined) {
      parts.push(`  Line: ${this.lineNumber}`);
    }
    if (this.expected !== undefined && this.actual !== undefined) {
      parts.push(`  Expected hash: ${this.expected}`);
      parts.push(`  Actual hash:   ${this.actual}`);
    }
    if (this.candidates && this.candidates.length > 0) {
      parts.push(`  Candidates (${this.candidates.length}):`);
      for (const c of this.candidates) {
        const preview = c.content.length > 60 ? `${c.content.slice(0, 60)}...` : c.content;
        parts.push(`    - line ${c.lineNumber}: ${preview}`);
      }
    }
    if (this.hint) {
      parts.push(`  Hint: ${this.hint}`);
    }
    return parts.join("\n");
  }
}

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

const MODULI = [1, 16, 256, 4096, 65536, 1048576, 16777216, 268435456, 4294967296];

function getModulus(hashLen: number): number {
  const clamped = Math.min(hashLen, 8);
  return MODULI[clamped] ?? 0;
}

export function getAdaptiveHashLength(lineCount: number): number {
  if (lineCount <= 4096) return 3;
  return 4;
}

export function computeLineHash(idx: number, line: string, hashLen: number = 3): string {
  const safeLen = Math.min(hashLen, 8);
  const trimmed = line.trimEnd();
  const input = `${idx}:${trimmed}`;
  const raw = fnv1aHash(input);
  const modulus = getModulus(safeLen);
  const hash = raw % modulus;
  return hash.toString(16).padStart(hashLen, "0");
}

export function computeFileRev(content: string): string {
  const normalized = content.includes("\r\n") ? content.replace(/\r\n/g, "\n") : content;
  const hash = fnv1aHash(normalized);
  return hash.toString(16).padStart(8, "0");
}

export function extractFileRev(annotatedContent: string, prefix?: string | false): string | null {
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : prefix === false ? "" : prefix;
  const escapedPrefix = effectivePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escapedPrefix}REV:([0-9a-f]{8})$`);
  const firstLine = annotatedContent.split("\n")[0];
  const match = firstLine.match(pattern);
  return match ? match[1] : null;
}

export function verifyFileRev(expectedRev: string, currentContent: string): void {
  const actualRev = computeFileRev(currentContent);
  if (actualRev !== expectedRev) {
    throw new HashlineError({
      code: "FILE_REV_MISMATCH",
      message: `File revision mismatch: expected "${expectedRev}", got "${actualRev}". The file has changed since it was last read.`,
      expected: expectedRev,
      actual: actualRev,
      hint: "Re-read the file to get fresh hash references and a new file revision.",
    });
  }
}

export function findCandidateLines(
  originalLineNumber: number,
  expectedHash: string,
  lines: string[],
  hashLen?: number,
): CandidateLine[] {
  const effectiveLen = hashLen && hashLen >= 2 ? hashLen : expectedHash.length;
  const originalIdx = originalLineNumber - 1;
  const candidates: CandidateLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === originalIdx) continue;
    const candidateHash = computeLineHash(originalIdx, lines[i], effectiveLen);
    if (candidateHash === expectedHash) {
      candidates.push({
        lineNumber: i + 1,
        content: lines[i],
      });
    }
  }
  return candidates;
}

export function formatFileWithHashes(
  content: string,
  hashLen?: number,
  prefix?: string | false,
  includeFileRev?: boolean,
): string {
  const normalized = content.includes("\r\n") ? content.replace(/\r\n/g, "\n") : content;
  const lines = normalized.split("\n");
  const effectiveLen = hashLen && hashLen >= 3 ? hashLen : getAdaptiveHashLength(lines.length);
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : prefix === false ? "" : prefix;

  const hashLens: number[] = new Array(lines.length).fill(effectiveLen);
  const hashes: string[] = new Array(lines.length);

  for (let idx = 0; idx < lines.length; idx++) {
    hashes[idx] = computeLineHash(idx, lines[idx], effectiveLen);
  }

  let dirtyIndices: Set<number> | null = null;
  let hasCollisions = true;
  while (hasCollisions) {
    hasCollisions = false;
    const seen = new Map<string, number[]>();

    for (let idx = 0; idx < lines.length; idx++) {
      const h = hashes[idx];
      const group = seen.get(h);
      if (group) {
        group.push(idx);
      } else {
        seen.set(h, [idx]);
      }
    }

    const nextDirty = new Set<number>();
    for (const [, group] of seen) {
      if (group.length < 2) continue;
      if (dirtyIndices !== null && !group.some((idx) => dirtyIndices?.has(idx))) continue;
      for (const idx of group) {
        const newLen = Math.min(hashLens[idx] + 1, 8);
        if (newLen === hashLens[idx]) continue;
        hashLens[idx] = newLen;
        hashes[idx] = computeLineHash(idx, lines[idx], newLen);
        nextDirty.add(idx);
        hasCollisions = true;
      }
    }
    dirtyIndices = nextDirty;
  }

  const finalSeen = new Map<string, number>();
  for (let idx = 0; idx < lines.length; idx++) {
    const existing = finalSeen.get(hashes[idx]);
    if (existing !== undefined) {
      hashes[idx] = `${hashes[idx]}${idx.toString(16)}`;
    } else {
      finalSeen.set(hashes[idx], idx);
    }
  }

  const annotatedLines = lines.map((line, idx) => {
    return `${effectivePrefix}${idx + 1}:${hashes[idx]}|${line}`;
  });

  if (includeFileRev) {
    const rev = computeFileRev(content);
    annotatedLines.unshift(`${effectivePrefix}REV:${rev}`);
  }

  return annotatedLines.join("\n");
}

const STRIP_REGEX_CACHE_MAX = 100;
const stripRegexCache = new Map<string, { hashLine: RegExp; rev: RegExp }>();

export function stripHashes(content: string, prefix?: string | false): string {
  const effectivePrefix = prefix === undefined ? DEFAULT_PREFIX : prefix === false ? "" : prefix;
  const escapedPrefix = effectivePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let cached = stripRegexCache.get(escapedPrefix);
  if (!cached) {
    if (stripRegexCache.size >= STRIP_REGEX_CACHE_MAX) {
      const firstKey = stripRegexCache.keys().next().value;
      if (firstKey !== undefined) {
        stripRegexCache.delete(firstKey);
      }
    }
    cached = {
      hashLine: new RegExp(`^([+ \\-])?${escapedPrefix}\\d+:[0-9a-f]{2,${MAX_HASH_LENGTH}}\\|`),
      rev: new RegExp(`^${escapedPrefix}REV:[0-9a-f]{8}$`),
    };
    stripRegexCache.set(escapedPrefix, cached);
  }

  const hashLinePattern = cached.hashLine;
  const revPattern = cached.rev;

  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
  const result = normalized
    .split("\n")
    .filter((line) => !revPattern.test(line))
    .map((line) => {
      const match = line.match(hashLinePattern);
      if (match) {
        const patchMarker = match[1] || "";
        return patchMarker + line.slice(match[0].length);
      }
      return line;
    })
    .join("\n");
  return lineEnding === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

export function parseHashRef(ref: string): { line: number; hash: string } {
  const match = ref.match(/^(\d+):([0-9a-f]{2,16})$/);
  if (!match) {
    const display = ref.length > 100 ? `${ref.slice(0, 100)}...` : ref;
    throw new HashlineError({
      code: "INVALID_REF",
      message: `Invalid hash reference: "${display}". Expected format: "<line>:<2-8 char hex>"`,
    });
  }
  return {
    line: parseInt(match[1], 10),
    hash: match[2],
  };
}

export function normalizeHashRef(ref: string): string {
  const trimmed = ref.trim();

  const plain = trimmed.match(/^(\d+):([0-9a-f]{2,16})$/i);
  if (plain) {
    return `${parseInt(plain[1], 10)}:${plain[2].toLowerCase()}`;
  }

  const annotated = trimmed.match(/^(?:.*?\s+)?(\d+):([0-9a-f]{2,16})\|.*$/i);
  if (annotated) {
    return `${parseInt(annotated[1], 10)}:${annotated[2].toLowerCase()}`;
  }

  const display = ref.length > 100 ? `${ref.slice(0, 100)}...` : ref;
  throw new HashlineError({
    code: "INVALID_REF",
    message: `Invalid hash reference: "${display}". Expected "<line>:<hash>" or an annotated line like "#HL <line>:<hash>|..."`,
  });
}

export type HashEditOperation = "replace" | "delete" | "insert_before" | "insert_after";

export interface HashEditInput {
  operation: HashEditOperation;
  startRef: string;
  endRef?: string;
  replacement?: string;
  fileRev?: string;
}

export interface HashEditResult {
  operation: HashEditOperation;
  startLine: number;
  endLine: number;
  content: string;
}

export function buildHashMap(content: string, hashLen?: number): Map<string, number> {
  const lines = content.split("\n");
  const effectiveLen = hashLen && hashLen >= 3 ? hashLen : getAdaptiveHashLength(lines.length);
  const map = new Map<string, number>();
  for (let idx = 0; idx < lines.length; idx++) {
    const hash = computeLineHash(idx, lines[idx], effectiveLen);
    const lineNum = idx + 1;
    map.set(`${lineNum}:${hash}`, lineNum);
  }
  return map;
}

export interface VerifyHashResult {
  valid: boolean;
  expected?: string;
  actual?: string;
  message?: string;
  code?: HashlineErrorCode;
  candidates?: CandidateLine[];
}

export function verifyHash(
  lineNumber: number,
  hash: string,
  currentContent: string,
  hashLen?: number,
  lines?: string[],
): VerifyHashResult {
  const contentLines = lines ?? currentContent.split("\n");
  const effectiveLen = hashLen && hashLen >= 2 ? hashLen : hash.length;

  if (lineNumber < 1 || lineNumber > contentLines.length) {
    return {
      valid: false,
      code: "TARGET_OUT_OF_RANGE",
      message: `Line ${lineNumber} is out of range (file has ${contentLines.length} lines)`,
    };
  }

  const idx = lineNumber - 1;
  const actualHash = computeLineHash(idx, contentLines[idx], effectiveLen);

  if (actualHash !== hash) {
    if (hash.length > 8) {
      const base8 = computeLineHash(idx, contentLines[idx], 8);
      if (hash.startsWith(base8) && hash.endsWith(idx.toString(16))) {
        return { valid: true };
      }
    }

    const candidates = findCandidateLines(lineNumber, hash, contentLines, effectiveLen);
    return {
      valid: false,
      code: "HASH_MISMATCH",
      expected: hash,
      actual: actualHash,
      candidates,
      message: `Hash mismatch at line ${lineNumber}: expected "${hash}", got "${actualHash}". The file may have changed since it was read.`,
    };
  }

  return { valid: true };
}

export interface ResolvedRange {
  startLine: number;
  endLine: number;
  lines: string[];
  content: string;
}

export function resolveRange(
  startRef: string,
  endRef: string,
  content: string,
  hashLen?: number,
): ResolvedRange {
  const start = parseHashRef(startRef);
  const end = parseHashRef(endRef);

  if (start.line > end.line) {
    throw new HashlineError({
      code: "INVALID_RANGE",
      message: `Invalid range: start line ${start.line} is after end line ${end.line}`,
    });
  }

  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
  const lines = normalized.split("\n");

  const startVerify = verifyHash(start.line, start.hash, normalized, hashLen, lines);
  if (!startVerify.valid) {
    throw new HashlineError({
      code: startVerify.code ?? "HASH_MISMATCH",
      message: `Start reference invalid: ${startVerify.message}`,
      expected: startVerify.expected,
      actual: startVerify.actual,
      candidates: startVerify.candidates,
      lineNumber: start.line,
      hint:
        startVerify.candidates && startVerify.candidates.length > 0
          ? `Content may have moved. Candidates: ${startVerify.candidates.map((c) => `line ${c.lineNumber}`).join(", ")}`
          : "Re-read the file to get fresh hash references.",
    });
  }

  const endVerify = verifyHash(end.line, end.hash, normalized, hashLen, lines);
  if (!endVerify.valid) {
    throw new HashlineError({
      code: endVerify.code ?? "HASH_MISMATCH",
      message: `End reference invalid: ${endVerify.message}`,
      expected: endVerify.expected,
      actual: endVerify.actual,
      candidates: endVerify.candidates,
      lineNumber: end.line,
      hint:
        endVerify.candidates && endVerify.candidates.length > 0
          ? `Content may have moved. Candidates: ${endVerify.candidates.map((c) => `line ${c.lineNumber}`).join(", ")}`
          : "Re-read the file to get fresh hash references.",
    });
  }

  const rangeLines = lines.slice(start.line - 1, end.line);
  return {
    startLine: start.line,
    endLine: end.line,
    lines: rangeLines,
    content: rangeLines.join(lineEnding),
  };
}

export function replaceRange(
  startRef: string,
  endRef: string,
  content: string,
  replacement: string,
  hashLen?: number,
): string {
  const lineEnding = detectLineEnding(content);
  const normalized = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
  const range = resolveRange(startRef, endRef, normalized, hashLen);
  const lines = normalized.split("\n");
  const before = lines.slice(0, range.startLine - 1);
  const after = lines.slice(range.endLine);
  const normalizedReplacement = replacement.includes("\r\n") ? replacement.replace(/\r\n/g, "\n") : replacement;
  const replacementLines = normalizedReplacement.split("\n");
  const result = [...before, ...replacementLines, ...after].join("\n");
  return lineEnding === "\r\n" ? result.replace(/\n/g, "\r\n") : result;
}

export function applyHashEdit(
  input: HashEditInput,
  content: string,
  hashLen?: number,
): HashEditResult {
  const lineEnding = detectLineEnding(content);
  const workContent = lineEnding === "\r\n" ? content.replace(/\r\n/g, "\n") : content;

  if (input.fileRev) {
    verifyFileRev(input.fileRev, workContent);
  }

  const normalizedStart = normalizeHashRef(input.startRef);
  const start = parseHashRef(normalizedStart);
  const lines = workContent.split("\n");

  const startVerify = verifyHash(start.line, start.hash, workContent, hashLen, lines);
  if (!startVerify.valid) {
    throw new HashlineError({
      code: startVerify.code ?? "HASH_MISMATCH",
      message: `Start reference invalid: ${startVerify.message}`,
      expected: startVerify.expected,
      actual: startVerify.actual,
      candidates: startVerify.candidates,
      lineNumber: start.line,
      hint:
        startVerify.candidates && startVerify.candidates.length > 0
          ? `Content may have moved. Candidates: ${startVerify.candidates.map((c) => `line ${c.lineNumber}`).join(", ")}`
          : "Re-read the file to get fresh hash references.",
    });
  }

  if (input.operation === "insert_before" || input.operation === "insert_after") {
    if (input.replacement === undefined) {
      throw new HashlineError({
        code: "MISSING_REPLACEMENT",
        message: `Operation "${input.operation}" requires "replacement" content`,
      });
    }

    const normalizedInsert = input.replacement.includes("\r\n") ? input.replacement.replace(/\r\n/g, "\n") : input.replacement;
    const insertionLines = normalizedInsert.split("\n");
    const insertIndex = input.operation === "insert_before" ? start.line - 1 : start.line;
    const next = [
      ...lines.slice(0, insertIndex),
      ...insertionLines,
      ...lines.slice(insertIndex),
    ].join("\n");

    return {
      operation: input.operation,
      startLine: start.line,
      endLine: start.line,
      content: lineEnding === "\r\n" ? next.replace(/\n/g, "\r\n") : next,
    };
  }

  const normalizedEnd = normalizeHashRef(input.endRef ?? input.startRef);
  const end = parseHashRef(normalizedEnd);
  if (start.line > end.line) {
    throw new HashlineError({
      code: "INVALID_RANGE",
      message: `Invalid range: start line ${start.line} is after end line ${end.line}`,
    });
  }

  const endVerify = verifyHash(end.line, end.hash, workContent, hashLen, lines);
  if (!endVerify.valid) {
    throw new HashlineError({
      code: endVerify.code ?? "HASH_MISMATCH",
      message: `End reference invalid: ${endVerify.message}`,
      expected: endVerify.expected,
      actual: endVerify.actual,
      candidates: endVerify.candidates,
      lineNumber: end.line,
      hint:
        endVerify.candidates && endVerify.candidates.length > 0
          ? `Content may have moved. Candidates: ${endVerify.candidates.map((c) => `line ${c.lineNumber}`).join(", ")}`
          : "Re-read the file to get fresh hash references.",
    });
  }

  const replacement = input.operation === "delete" ? "" : input.replacement;
  if (replacement === undefined) {
    throw new HashlineError({
      code: "MISSING_REPLACEMENT",
      message: `Operation "${input.operation}" requires "replacement" content`,
    });
  }

  const before = lines.slice(0, start.line - 1);
  const after = lines.slice(end.line);
  const normalizedReplacement = replacement.includes("\r\n") ? replacement.replace(/\r\n/g, "\n") : replacement;
  const replacementLines = input.operation === "delete" ? [] : normalizedReplacement.split("\n");
  const next = [...before, ...replacementLines, ...after].join("\n");

  return {
    operation: input.operation,
    startLine: start.line,
    endLine: end.line,
    content: lineEnding === "\r\n" ? next.replace(/\n/g, "\r\n") : next,
  };
}

interface CacheEntry {
  contentHash: number;
  annotated: string;
}

export class HashlineCache {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(filePath: string, content: string): string | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;

    const currentHash = fnv1aHash(content);
    if (entry.contentHash !== currentHash) {
      this.cache.delete(filePath);
      return null;
    }

    this.cache.delete(filePath);
    this.cache.set(filePath, entry);
    return entry.annotated;
  }

  set(filePath: string, content: string, annotated: string): void {
    if (this.cache.has(filePath)) {
      this.cache.delete(filePath);
    }

    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(filePath, {
      contentHash: fnv1aHash(content),
      annotated,
    });
  }

  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export function matchesGlob(filePath: string, pattern: string): boolean {
  return pathMatchesGlob(filePath.replace(/\\/g, "/"), pattern.replace(/\\/g, "/"));
}

export function shouldExclude(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(filePath, pattern));
}

export function getByteLength(content: string): number {
  return Buffer.byteLength(content, "utf-8");
}

export function detectLineEnding(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}
