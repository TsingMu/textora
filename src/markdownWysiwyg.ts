export type MarkdownTaskState = "checked" | "unchecked" | null;

export type MarkdownWysiwygBlock =
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
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const blocks: MarkdownWysiwygBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}```\s*([^\s`]*)?.*$/);
    if (fence) {
      const start = index;
      const language = fence[1] ?? "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }

      const token = language.trim().toLowerCase();
      if (token === "mermaid") {
        blocks.push({
          type: "source",
          reason: "mermaid",
          source: lines.slice(start, index).join("\n"),
        });
      } else if (KNOWN_EDITABLE_FENCE_LANGUAGES.has(token)) {
        blocks.push({ type: "code", language, code: codeLines.join("\n") });
      } else {
        blocks.push({
          type: "source",
          reason: "unknown-fence",
          source: lines.slice(start, index).join("\n"),
        });
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "horizontal-rule" });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = collectUntilBlankOrBlock(lines, index);
      blocks.push({ type: "source", reason: "table", source: table.source });
      index = table.nextIndex;
      continue;
    }

    if (isRawHtmlStart(line)) {
      const html = collectUntilBlankOrBlock(lines, index);
      blocks.push({ type: "source", reason: "html", source: html.source });
      index = html.nextIndex;
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^ {0,3}>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^ {0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    const list = collectList(lines, index);
    if (list !== null) {
      blocks.push({
        type: "list",
        ordered: list.ordered,
        items: list.items,
      });
      index = list.nextIndex;
      continue;
    }

    if (isIndentedCodeOrUnknown(line)) {
      const unknown = collectUntilBlankOrBlock(lines, index);
      blocks.push({ type: "source", reason: "unknown", source: unknown.source });
      index = unknown.nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() !== "" &&
      !isBlockStart(lines, index)
    ) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

export function serializeMarkdownWysiwygBlocks(
  blocks: readonly MarkdownWysiwygBlock[],
): string {
  return blocks.map(serializeBlock).join("\n\n");
}

function serializeBlock(block: MarkdownWysiwygBlock): string {
  switch (block.type) {
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

function parseListLine(line: string):
  | {
      ordered: boolean;
      text: string;
      taskState: MarkdownTaskState;
    }
  | null {
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

function isTableStart(lines: readonly string[], index: number): boolean {
  const header = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  return header.includes("|") && isTableSeparator(separator);
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = trimmed.split("|").map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
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
): { source: string; nextIndex: number } {
  const collected: string[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "" && collected.length > 0) {
      break;
    }
    if (collected.length > 0 && isBlockStart(lines, index)) {
      break;
    }
    collected.push(line);
    index += 1;
  }
  return { source: collected.join("\n"), nextIndex: index };
}

function isBlockStart(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    /^ {0,3}```/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    /^ {0,3}>\s?/.test(line) ||
    parseListLine(line) !== null ||
    isTableStart(lines, index) ||
    isRawHtmlStart(line)
  );
}
