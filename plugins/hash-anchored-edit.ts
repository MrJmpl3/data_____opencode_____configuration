import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { type Plugin, tool } from "@opencode-ai/plugin"

const HASH_LENGTH = 5
const HASH_ALPHABET = "ZPMQVRWSNKTXJBYH"
const ANCHOR_PATTERN = new RegExp(`^(\\d+)#([${HASH_ALPHABET}]{${HASH_LENGTH}})$`)

type ParsedFile = {
  hasTrailingNewline: boolean
  lines: string[]
  newline: string
}

type ParsedAnchor = {
  hash: string
  line: number
  raw: string
}

type NormalizedEdit = {
  end?: ParsedAnchor
  lines: string[]
  op: "replace" | "append" | "prepend"
  pos?: ParsedAnchor
}

type LegacyEditArgs = {
  anchors?: string[]
  mode?: "replace" | "insert_before" | "insert_after"
  newText?: string
}

type RawEditArgs = LegacyEditArgs & {
  delete?: boolean
  edits?: Array<{
    end?: string
    lines: string | string[]
    op: "replace" | "append" | "prepend"
    pos?: string
  }>
  filePath: string
  rename?: string
}

const hashLine = (lineNumber: number, content: string) => {
  const digest = createHash("sha256").update(`${lineNumber}:${content}`).digest()
  let output = ""

  for (let index = 0; index < HASH_LENGTH; index += 1) {
    const byte = digest[Math.floor(index / 2)]
    const nibble = index % 2 === 0 ? byte >> 4 : byte & 0x0f
    output += HASH_ALPHABET[nibble]
  }

  return output
}

const formatAnchor = (lineNumber: number, content: string) => `${lineNumber}#${hashLine(lineNumber, content)}`

const formatAnchoredLine = (lineNumber: number, content: string) => `${formatAnchor(lineNumber, content)}| ${content}`

const isBinaryBuffer = (buffer: Buffer) => buffer.includes(0)

const resolveFilePath = (directory: string, filePath: string) => {
  if (path.isAbsolute(filePath)) return path.normalize(filePath)

  return path.resolve(directory, filePath)
}

const relativeLabel = (worktree: string, filePath: string) => {
  const relativePath = path.relative(worktree, filePath)

  if (!relativePath || relativePath.startsWith("..")) return filePath

  return relativePath
}

const parseText = (content: string): ParsedFile => {
  const newline = content.includes("\r\n") ? "\r\n" : "\n"
  const normalized = content.replace(/\r\n/g, "\n")

  if (normalized === "") {
    return {
      hasTrailingNewline: false,
      lines: [],
      newline,
    }
  }

  const hasTrailingNewline = normalized.endsWith("\n")
  const lines = normalized.split("\n")

  if (hasTrailingNewline) lines.pop()

  return {
    hasTrailingNewline,
    lines,
    newline,
  }
}

const serializeText = ({ hasTrailingNewline, lines, newline }: ParsedFile) => {
  const body = lines.join(newline)

  if (hasTrailingNewline && lines.length > 0) return `${body}${newline}`

  return body
}

const readTextFile = async (filePath: string) => {
  const buffer = await readFile(filePath)

  if (isBinaryBuffer(buffer)) {
    throw new Error(`Binary file: ${filePath}`)
  }

  return parseText(buffer.toString("utf8"))
}

const renderAnchoredLines = (lines: string[], startLine = 1) =>
  lines.map((line, index) => formatAnchoredLine(startLine + index, line)).join("\n")

const renderContextAroundLine = (file: ParsedFile, line: number, radius = 1) => {
  const start = Math.max(1, line - radius)
  const end = Math.min(file.lines.length, line + radius)

  return renderAnchoredLines(file.lines.slice(start - 1, end), start)
}

const readFileInfo = async (filePath: string) => {
  try {
    return await stat(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null

    throw error
  }
}

const ensureParentDirectory = async (filePath: string) => {
  await mkdir(path.dirname(filePath), { recursive: true })
}

const countLines = (lines: string[]) => Math.max(lines.length, 1)

const renderUnifiedDiff = (before: ParsedFile, after: ParsedFile) => {
  if (serializeText(before) === serializeText(after)) {
    return "(No content changes)"
  }

  const beforeLines = before.lines
  const afterLines = after.lines
  let prefix = 0

  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }

  let beforeSuffix = beforeLines.length - 1
  let afterSuffix = afterLines.length - 1

  while (beforeSuffix >= prefix && afterSuffix >= prefix && beforeLines[beforeSuffix] === afterLines[afterSuffix]) {
    beforeSuffix -= 1
    afterSuffix -= 1
  }

  const beforeChunk = beforeLines.slice(prefix, beforeSuffix + 1)
  const afterChunk = afterLines.slice(prefix, afterSuffix + 1)
  const beforeStart = prefix + 1
  const afterStart = prefix + 1
  const output = [`@@ -${beforeStart},${countLines(beforeChunk)} +${afterStart},${countLines(afterChunk)} @@`]

  for (const line of beforeChunk) {
    output.push(`- ${formatAnchoredLine(beforeStart + output.filter((entry) => entry.startsWith("- ")).length, line)}`)
  }

  for (const line of afterChunk) {
    output.push(`+ ${formatAnchoredLine(afterStart + output.filter((entry) => entry.startsWith("+ ")).length, line)}`)
  }

  return output.join("\n")
}

const renderCreateDiff = (file: ParsedFile) => {
  const output = [`@@ -0,0 +1,${countLines(file.lines)} @@`]

  for (let index = 0; index < file.lines.length; index += 1) {
    output.push(`+ ${formatAnchoredLine(index + 1, file.lines[index])}`)
  }

  return output.join("\n")
}

const renderDeleteDiff = (file: ParsedFile) => {
  const output = [`@@ -1,${countLines(file.lines)} +0,0 @@`]

  for (let index = 0; index < file.lines.length; index += 1) {
    output.push(`- ${formatAnchoredLine(index + 1, file.lines[index])}`)
  }

  return output.join("\n")
}

const parseAnchor = (anchor: string): ParsedAnchor => {
  const normalizedAnchor = anchor.trim().toUpperCase()
  const match = normalizedAnchor.match(ANCHOR_PATTERN)

  if (!match) {
    throw new Error(
      `Bad anchor \"${anchor}\". Need LINE#ID, e.g. 42#${HASH_ALPHABET[0].repeat(HASH_LENGTH)}.`,
    )
  }

  return {
    hash: match[2],
    line: Number(match[1]),
    raw: normalizedAnchor,
  }
}

const parseLinePayload = (lines: string | string[]) => {
  if (Array.isArray(lines)) return [...lines]

  return parseText(lines).lines
}

const validateAnchor = (file: ParsedFile, anchor: ParsedAnchor) => {
  if (anchor.line < 1 || anchor.line > file.lines.length) {
    const nearestLine = Math.min(Math.max(anchor.line, 1), Math.max(file.lines.length, 1))
    const context = file.lines.length > 0 ? `\n${renderContextAroundLine(file, nearestLine)}` : ""

    throw new Error(`Anchor ${anchor.raw} is out of range.${context}`)
  }

  const actualContent = file.lines[anchor.line - 1]
  const actualHash = hashLine(anchor.line, actualContent)

  if (actualHash !== anchor.hash) {
    throw new Error(
      `Stale ${anchor.raw}; now ${formatAnchor(anchor.line, actualContent)}.` + `\n${renderContextAroundLine(file, anchor.line)}`,
    )
  }
}

const validateEdit = (file: ParsedFile, edit: NormalizedEdit) => {
  if (edit.lines.length === 0) {
    throw new Error(`${edit.op} needs lines.`)
  }

  if (edit.op === "replace") {
    if (!edit.pos) throw new Error("replace needs pos.")

    validateAnchor(file, edit.pos)

    if (!edit.end) return

    validateAnchor(file, edit.end)

    if (edit.end.line < edit.pos.line) {
      throw new Error(`Bad range ${edit.pos.raw}..${edit.end.raw}.`)
    }

    return
  }

  if (edit.pos && edit.end) {
    throw new Error(`${edit.op} uses one anchor: pos or end.`)
  }

  const anchor = edit.pos ?? edit.end

  if (!anchor) {
    throw new Error(`${edit.op} needs pos or end.`)
  }

  validateAnchor(file, anchor)
}

const getEditLine = (edit: NormalizedEdit) => edit.pos?.line ?? edit.end?.line ?? 0

const getReplaceRange = (edit: NormalizedEdit) => {
  const start = edit.pos?.line ?? 0
  const end = edit.end?.line ?? start

  return { end, start }
}

const isLineInsideRange = (line: number, range: { end: number; start: number }) => line >= range.start && line <= range.end

const validateEditBatch = (file: ParsedFile, edits: NormalizedEdit[]) => {
  if (edits.length === 0) {
    throw new Error("Need at least one edit.")
  }

  for (const edit of edits) {
    validateEdit(file, edit)
  }

  const replacements = edits
    .filter((edit) => edit.op === "replace")
    .map((edit) => ({
      ...getReplaceRange(edit),
      raw: edit.pos?.raw ?? "",
    }))
    .sort((left, right) => left.start - right.start)

  for (let index = 1; index < replacements.length; index += 1) {
    const previous = replacements[index - 1]
    const current = replacements[index]

    if (current.start <= previous.end) {
      throw new Error("Overlapping replace ranges.")
    }
  }

  for (const edit of edits) {
    if (edit.op === "replace") continue

    const line = getEditLine(edit)
    const containingRange = replacements.find((range) => isLineInsideRange(line, range))

    if (!containingRange) continue

    if (line !== containingRange.start) {
      throw new Error(`${edit.op} on ${edit.pos?.raw ?? edit.end?.raw} conflicts with replace ${containingRange.raw}. Use its first line.`)
    }
  }
}

const normalizeLegacyArgs = (args: RawEditArgs): NormalizedEdit[] | null => {
  if (!args.mode) return null

  if (!args.anchors || args.anchors.length === 0) {
    throw new Error("Legacy needs anchors.")
  }

  if (typeof args.newText !== "string") {
    throw new Error("Legacy needs newText.")
  }

  if (args.mode === "replace") {
    if (args.anchors.length === 1) {
      return [
        {
          lines: parseLinePayload(args.newText),
          op: "replace",
          pos: parseAnchor(args.anchors[0]),
        },
      ]
    }

    return [
      {
        end: parseAnchor(args.anchors[args.anchors.length - 1]),
        lines: parseLinePayload(args.newText),
        op: "replace",
        pos: parseAnchor(args.anchors[0]),
      },
    ]
  }

  if (args.anchors.length !== 1) {
    throw new Error(`Legacy ${args.mode} needs one anchor.`)
  }

  return [
    {
      lines: parseLinePayload(args.newText),
      op: args.mode === "insert_after" ? "append" : "prepend",
      pos: parseAnchor(args.anchors[0]),
    },
  ]
}

const normalizeEditArgs = (args: RawEditArgs) => {
  if (args.edits && args.edits.length > 0) {
    return args.edits.map((edit) => ({
      end: edit.end ? parseAnchor(edit.end) : undefined,
      lines: parseLinePayload(edit.lines),
      op: edit.op,
      pos: edit.pos ? parseAnchor(edit.pos) : undefined,
    }))
  }

  const legacyEdits = normalizeLegacyArgs(args)

  if (legacyEdits) return legacyEdits

  throw new Error("Need edits[] or legacy mode+anchors+newText.")
}

const validateDeleteMode = (args: RawEditArgs) => {
  if (!args.delete) return

  if (args.rename) {
    throw new Error("delete + rename is invalid.")
  }

  if (args.mode || args.anchors || typeof args.newText === "string") {
    throw new Error("delete cannot use legacy fields.")
  }

  if (args.edits && args.edits.length > 0) {
    throw new Error("delete cannot include edits.")
  }
}

const validateCreateEdits = (edits: NormalizedEdit[]) => {
  if (edits.length === 0) {
    throw new Error("Create needs append/prepend.")
  }

  for (const edit of edits) {
    if (edit.op === "replace") {
      throw new Error("replace needs an existing file.")
    }

    if (edit.pos || edit.end) {
      throw new Error(`Create cannot anchor ${edit.op}.`)
    }

    if (edit.lines.length === 0) {
      throw new Error(`${edit.op} needs lines.`)
    }
  }
}

const buildCreatedFile = (edits: NormalizedEdit[]): ParsedFile => {
  const prepends = edits.filter((edit) => edit.op === "prepend").flatMap((edit) => edit.lines)
  const appends = edits.filter((edit) => edit.op === "append").flatMap((edit) => edit.lines)

  return {
    hasTrailingNewline: false,
    lines: [...prepends, ...appends],
    newline: "\n",
  }
}

const collectLinesByOperation = (edits: NormalizedEdit[], op: "append" | "prepend") => {
  const grouped = new Map<number, string[]>()

  for (const edit of edits) {
    if (edit.op !== op) continue

    const line = getEditLine(edit)
    const existing = grouped.get(line) ?? []

    existing.push(...edit.lines)
    grouped.set(line, existing)
  }

  return grouped
}

const collectReplacementStarts = (edits: NormalizedEdit[]) => {
  const replacements = new Map<number, { end: number; lines: string[] }>()

  for (const edit of edits) {
    if (edit.op !== "replace") continue

    const { end, start } = getReplaceRange(edit)

    replacements.set(start, {
      end,
      lines: edit.lines,
    })
  }

  return replacements
}

const applyEdits = (file: ParsedFile, edits: NormalizedEdit[]) => {
  const prepends = collectLinesByOperation(edits, "prepend")
  const appends = collectLinesByOperation(edits, "append")
  const replacements = collectReplacementStarts(edits)
  const nextLines: string[] = []

  for (let lineNumber = 1; lineNumber <= file.lines.length; ) {
    const prependLines = prepends.get(lineNumber) ?? []
    const appendLines = appends.get(lineNumber) ?? []
    const replacement = replacements.get(lineNumber)

    if (prependLines.length > 0) {
      nextLines.push(...prependLines)
    }

    if (replacement) {
      nextLines.push(...replacement.lines)

      if (appendLines.length > 0) {
        nextLines.push(...appendLines)
      }

      lineNumber = replacement.end + 1
      continue
    }

    nextLines.push(file.lines[lineNumber - 1])

    if (appendLines.length > 0) {
      nextLines.push(...appendLines)
    }

    lineNumber += 1
  }

  return {
    ...file,
    lines: nextLines,
  }
}

const renderAnchoredSlice = (file: ParsedFile, offset: number, limit: number) => {
  const start = Math.max(offset, 1)
  const end = Math.min(file.lines.length, start + limit - 1)

  if (start > end) return ""

  const output: string[] = []

  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    output.push(formatAnchoredLine(lineNumber, file.lines[lineNumber - 1]))
  }

  return output.join("\n")
}

const renderDirectory = async (filePath: string) => {
  const entries = await readdir(filePath, { withFileTypes: true })

  return entries
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .join("\n")
}

export const HashAnchoredEditPlugin: Plugin = async () => {
  return {
    tool: {
      read: tool({
        description:
          "Read files or directories. Text files are returned with hash anchors in the form LINE#ID| content. Reuse the exact LINE#ID tokens with the edit tool to avoid stale-line edits.",
        args: {
          filePath: tool.schema.string(),
          offset: tool.schema.number().int().positive().optional(),
          limit: tool.schema.number().int().positive().optional(),
        },
        async execute(args, context) {
          const filePath = resolveFilePath(context.directory, args.filePath)
          const info = await stat(filePath)
          const label = relativeLabel(context.worktree, filePath)

          if (info.isDirectory()) {
            return {
              title: label,
              output: await renderDirectory(filePath),
            }
          }

          const file = await readTextFile(filePath)

          return {
            title: label,
            output: renderAnchoredSlice(file, args.offset ?? 1, args.limit ?? 2000),
          }
        },
      }),
      edit: tool({
        description:
          "Edit a text file using LINE#ID anchors from read. Prefer edits[] with { op, pos, end, lines } where op is replace, append, or prepend. Supports create with unanchored append or prepend, plus safe rename and delete.",
        args: {
          anchors: tool.schema.array(tool.schema.string()).optional(),
          delete: tool.schema.boolean().optional(),
          edits: tool.schema
            .array(
              tool.schema.object({
                end: tool.schema.string().optional(),
                lines: tool.schema.union([tool.schema.string(), tool.schema.array(tool.schema.string())]),
                op: tool.schema.enum(["replace", "append", "prepend"]),
                pos: tool.schema.string().optional(),
              }),
            )
            .optional(),
          filePath: tool.schema.string(),
          mode: tool.schema.enum(["replace", "insert_before", "insert_after"]).optional(),
          newText: tool.schema.string().optional(),
          rename: tool.schema.string().optional(),
        },
        async execute(rawArgs, context) {
          const args = rawArgs as RawEditArgs
          const filePath = resolveFilePath(context.directory, args.filePath)
          const label = relativeLabel(context.worktree, filePath)
          const renamePath = args.rename ? resolveFilePath(context.directory, args.rename) : undefined
          const renameLabel = renamePath ? relativeLabel(context.worktree, renamePath) : undefined
          const pureRename =
            Boolean(renamePath && renamePath !== filePath) &&
            !args.delete &&
            !args.mode &&
            !args.anchors &&
            typeof args.newText !== "string" &&
            (!args.edits || args.edits.length === 0)

          validateDeleteMode(args)

          const info = await readFileInfo(filePath)

          if (args.delete) {
            if (!info) {
              throw new Error(`No file: ${label}`)
            }

            if (!info.isFile()) {
              throw new Error(`Not a file: ${label}`)
            }

            const deletedFile = await readTextFile(filePath)

            await unlink(filePath)

            return {
              title: label,
              output: [`Deleted ${label}`, renderDeleteDiff(deletedFile)].join("\n"),
            }
          }

          if (pureRename) {
            if (!info) {
              throw new Error(`No file: ${label}`)
            }

            if (!info.isFile()) {
              throw new Error(`Not a file: ${label}`)
            }

            const renameInfo = await readFileInfo(renamePath!)

            if (renameInfo) {
              throw new Error(`Rename target exists: ${renameLabel}`)
            }

            await ensureParentDirectory(renamePath!)
            await rename(filePath, renamePath!)

            return {
              title: renameLabel ?? label,
              output: [`Moved ${label} -> ${renameLabel}`, "(No content changes)"].join("\n"),
            }
          }

          const edits = normalizeEditArgs(args)

          if (!info) {
            validateCreateEdits(edits)

            if (renamePath) {
              throw new Error("rename needs an existing file.")
            }

            const nextFile = buildCreatedFile(edits)
            const nextContent = serializeText(nextFile)

            await ensureParentDirectory(filePath)
            await writeFile(filePath, nextContent, "utf8")

            return {
              title: label,
              output: [`Created ${label}`, renderCreateDiff(nextFile)].join("\n"),
            }
          }

          if (!info.isFile()) {
            throw new Error(`Not a file: ${label}`)
          }

          const file = await readTextFile(filePath)

          validateEditBatch(file, edits)

          const nextFile = applyEdits(file, edits)

          const nextContent = serializeText(nextFile)
          const previousContent = serializeText(file)

          const renameRequested = Boolean(renamePath && renamePath !== filePath)

          if (nextContent === previousContent && !renameRequested) {
            return {
              title: label,
              output: "No changes.",
            }
          }

          if (renamePath && renamePath !== filePath) {
            const renameInfo = await readFileInfo(renamePath)

            if (renameInfo) {
              throw new Error(`Rename target exists: ${renameLabel}`)
            }

            await ensureParentDirectory(renamePath)
            await writeFile(renamePath, nextContent, "utf8")
            await unlink(filePath)

            return {
              title: renameLabel ?? label,
              output: [`Moved ${label} -> ${renameLabel}`, renderUnifiedDiff(file, nextFile)].join("\n"),
            }
          }

          await writeFile(filePath, nextContent, "utf8")

          return {
            title: label,
            output: [`Updated ${label}`, renderUnifiedDiff(file, nextFile)].join("\n"),
          }
        },
      }),
    },
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        "Hash-anchored editing is enabled. Read existing files before editing. Lines come back as LINE#ID| content. Prefer edit with edits[] and { op, pos, end, lines }. edit validates anchors, supports create via unanchored append or prepend, plus rename and delete, and rejects stale edits.",
      )
    },
    "tool.definition": async (input, output) => {
      if (input.toolID === "apply_patch") {
        output.description = `${output.description} Prefer edit for normal existing-file changes because edit validates LINE#ID anchors against the current file content and rejects stale edits.`
      }
    },
  }
}

export default HashAnchoredEditPlugin
