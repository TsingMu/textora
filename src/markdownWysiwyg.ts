import {
  replaceMarkdownSourceRange,
  scanMarkdownTable,
  type MarkdownSourceRange,
  type MarkdownTable,
} from "./markdownTable";

export type MarkdownTaskState = "checked" | "unchecked" | null;

export type MarkdownWysiwygBlock =
  | { type: "table"; table: MarkdownTable }
  | {
      type: "heading";
      level: 1 | 2 | 3 | 4 | 5 | 6;
      text: string;
    }
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "list";
      ordered: boolean;
      items: { text: string; taskState: MarkdownTaskState }[];
    }
  | {
      type: "blockquote";
      text: string;
    }
  | {
      type: "code";
      language: string;
      code: string;
    }
  | {
      type: "horizontal-rule";
    }
  | {
      type: "source";
      source: string;
      reason: "table" | "mermaid" | "html" | "unknown-fence" | "unknown";
    };

// Keep block-boundary detection consistent with the heading parser.
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

const KNOWN_EDITABLE_FENCE_LANGUAGES = new Set([
  "",
  "js",
  "javascript",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "typescript",
  "tsx",
  "mts",
  "cts",
  "json",
  "html",
  "css",
  "rs",
  "rust",
  "py",
  "python",
  "java",
  "sh",
  "bash",
  "shell",
  "sql",
  "toml",
  "yaml",
  "yml",
  "md",
  "markdown",
]);

export function parseMarkdownWysiwygBlocks(
  source: string,
): MarkdownWysiwygBlock[] {
  return parseMarkdownWysiwygDocument(source).blocks;
}

/** The legacy block API and located API share this single traversal. */
export function parseMarkdownWysiwygDocument(source: string): {
  blocks: MarkdownWysiwygBlock[];
  ranges: MarkdownSourceRange[];
} {
  const lines: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let lineStart = 0;
  const lineEndings = /\r\n|\r|\n/g;
  let match: RegExpExecArray | null;
  while ((match = lineEndings.exec(source)) !== null) {
    starts.push(lineStart);
    ends.push(match.index);
    lines.push(source.slice(lineStart, match.index));
    lineStart = match.index + match[0].length;
  }
  starts.push(lineStart);
  ends.push(source.length);
  lines.push(source.slice(lineStart));
  const blocks: MarkdownWysiwygBlock[] = [];
  const ranges: MarkdownSourceRange[] = [];
  let index = 0;
  // Keep indented list continuations outside the top-level table subset.
  let listContentIndent: number | null = null;

  const tableAtLine = (at: number) =>
    scanMarkdownTable(source, starts[at] ?? source.length);
  const isBlockStart = (at: number): boolean => {
    const line = lines[at] ?? "";
    return (
      /^ {0,3}```/.test(line) ||
      HEADING_PATTERN.test(line) ||
      /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
      /^ {0,3}>\s?/.test(line) ||
      parseListLine(line) !== null ||
      tableAtLine(at).kind !== "none" ||
      isRawHtmlStart(line)
    );
  };
  const rangeEnd = (nextIndex: number) => {
    const finalSplitLine =
      nextIndex === lines.length &&
      lines[nextIndex - 1] === "" &&
      starts[nextIndex - 1] === source.length;
    return ends[finalSplitLine ? nextIndex - 2 : nextIndex - 1];
  };
  const push = (block: MarkdownWysiwygBlock, nextIndex: number) => {
    ranges.push({ from: starts[index], to: rangeEnd(nextIndex) });
    blocks.push(block);
    index = nextIndex;
  };
  const raw = (nextIndex: number) =>
    source.slice(starts[index], rangeEnd(nextIndex));

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (
      listContentIndent !== null &&
      (line.match(/^ */)?.[0].length ?? 0) < listContentIndent
    )
      listContentIndent = null;
    const fence = line.match(/^ {0,3}```\s*([^\s`]*)?.*$/);
    if (fence) {
      const language = fence[1] ?? "";
      const codeLines: string[] = [];
      let nextIndex = index + 1;
      while (
        nextIndex < lines.length &&
        !/^ {0,3}```\s*$/.test(lines[nextIndex])
      ) {
        codeLines.push(lines[nextIndex]);
        nextIndex += 1;
      }
      if (nextIndex < lines.length) nextIndex += 1;
      const token = language.trim().toLowerCase();
      if (token === "mermaid") {
        push(
          { type: "source", reason: "mermaid", source: raw(nextIndex) },
          nextIndex,
        );
      } else if (KNOWN_EDITABLE_FENCE_LANGUAGES.has(token)) {
        push({ type: "code", language, code: codeLines.join("\n") }, nextIndex);
      } else {
        push(
          { type: "source", reason: "unknown-fence", source: raw(nextIndex) },
          nextIndex,
        );
      }
      continue;
    }
    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      push(
        {
          type: "heading",
          level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
          text: heading[2],
        },
        index + 1,
      );
      continue;
    }
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      push({ type: "horizontal-rule" }, index + 1);
      continue;
    }
    const table = tableAtLine(index);
    if (table.kind !== "none") {
      let nextIndex = index + 1;
      while (nextIndex < lines.length && starts[nextIndex] < table.nextOffset)
        nextIndex += 1;
      push(
        table.kind === "table" && listContentIndent === null
          ? { type: "table", table: table.table }
          : {
              type: "source",
              reason: "table",
              source: source.slice(table.from, table.to),
            },
        nextIndex,
      );
      continue;
    }
    if (isRawHtmlStart(line)) {
      const html = collectUntilBlankOrBlock(lines, index, isBlockStart);
      push(
        { type: "source", reason: "html", source: raw(html.nextIndex) },
        html.nextIndex,
      );
      continue;
    }
    if (/^ {0,3}>\s?/.test(line)) {
      const quoteLines: string[] = [];
      let nextIndex = index;
      while (nextIndex < lines.length && /^ {0,3}>\s?/.test(lines[nextIndex])) {
        quoteLines.push(lines[nextIndex].replace(/^ {0,3}>\s?/, ""));
        nextIndex += 1;
      }
      push({ type: "blockquote", text: quoteLines.join("\n") }, nextIndex);
      continue;
    }
    const list = collectList(lines, index);
    if (list !== null) {
      listContentIndent = lines[list.nextIndex - 1].match(/^ {0,3}(?:[-*+]|\d+\.)[ \t]+/)?.[0].length ?? null;
      push(
        { type: "list", ordered: list.ordered, items: list.items },
        list.nextIndex,
      );
      continue;
    }
    if (isIndentedCodeOrUnknown(line)) {
      const unknown = collectUntilBlankOrBlock(lines, index, isBlockStart);
      push(
        { type: "source", reason: "unknown", source: raw(unknown.nextIndex) },
        unknown.nextIndex,
      );
      continue;
    }
    const paragraphLines: string[] = [];
    let nextIndex = index;
    // Always consume the first line, even while syntax is incomplete.
    do {
      paragraphLines.push(lines[nextIndex].trim());
      nextIndex += 1;
    } while (
      nextIndex < lines.length &&
      lines[nextIndex].trim() !== "" &&
      !isBlockStart(nextIndex)
    );
    push({ type: "paragraph", text: paragraphLines.join(" ") }, nextIndex);
  }
  return { blocks, ranges };
}

/** Reject stale/out-of-bounds patches instead of guessing a new block position. */
export function replaceWysiwygBlock(
  source: string,
  range: MarkdownSourceRange,
  expectedRaw: string,
  replacement: string,
): string | null {
  return replaceMarkdownSourceRange(source, range, expectedRaw, replacement);
}

export function serializeMarkdownWysiwygBlocks(
  blocks: readonly MarkdownWysiwygBlock[],
): string {
  return blocks.map(serializeMarkdownWysiwygBlock).join("\n\n");
}

export function serializeMarkdownWysiwygBlock(
  block: MarkdownWysiwygBlock,
): string {
  switch (block.type) {
    case "table":
      return block.table.rawSource;
    case "heading":
      return `${"#".repeat(block.level)} ${block.text}`;
    case "paragraph":
      return block.text;
    case "list":
      return block.items
        .map((item, index) => {
          const marker = block.ordered ? `${index + 1}.` : "-";
          const task =
            item.taskState === null
              ? ""
              : `${item.taskState === "checked" ? "[x]" : "[ ]"} `;
          return `${marker} ${task}${item.text}`;
        })
        .join("\n");
    case "blockquote":
      return block.text
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n");
    case "code":
      return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
    case "horizontal-rule":
      return "---";
    case "source":
      return block.source;
  }
}

function collectList(
  lines: readonly string[],
  startIndex: number,
): {
  ordered: boolean;
  items: { text: string; taskState: MarkdownTaskState }[];
  nextIndex: number;
} | null {
  const first = parseListLine(lines[startIndex] ?? "");
  if (first === null) {
    return null;
  }

  const items: { text: string; taskState: MarkdownTaskState }[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const parsed = parseListLine(lines[index] ?? "");
    if (parsed === null || parsed.ordered !== first.ordered) {
      break;
    }
    items.push({ text: parsed.text, taskState: parsed.taskState });
    index += 1;
  }

  return { ordered: first.ordered, items, nextIndex: index };
}

function parseListLine(line: string): {
  ordered: boolean;
  text: string;
  taskState: MarkdownTaskState;
} | null {
  const unordered = line.match(/^ {0,3}[-*+]\s+(?:(\[[ xX]\])\s+)?(.+)$/);
  if (unordered) {
    return {
      ordered: false,
      taskState: parseTaskState(unordered[1]),
      text: unordered[2],
    };
  }
  const ordered = line.match(/^ {0,3}\d+\.\s+(?:(\[[ xX]\])\s+)?(.+)$/);
  if (ordered) {
    return {
      ordered: true,
      taskState: parseTaskState(ordered[1]),
      text: ordered[2],
    };
  }
  return null;
}

function parseTaskState(value: string | undefined): MarkdownTaskState {
  if (value === undefined) {
    return null;
  }
  return value.toLowerCase() === "[x]" ? "checked" : "unchecked";
}

function isRawHtmlStart(line: string): boolean {
  return /^ {0,3}<\/?[A-Za-z][^>]*>/.test(line.trim());
}

function isIndentedCodeOrUnknown(line: string): boolean {
  return /^( {4}|\t)/.test(line);
}

function collectUntilBlankOrBlock(
  lines: readonly string[],
  startIndex: number,
  isBlockStart: (index: number) => boolean,
): { source: string; nextIndex: number } {
  const collected: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "" && collected.length > 0) {
      break;
    }
    if (collected.length > 0 && isBlockStart(index)) {
      break;
    }
    collected.push(line);
    index += 1;
  }
  return { source: collected.join("\n"), nextIndex: index };
}
