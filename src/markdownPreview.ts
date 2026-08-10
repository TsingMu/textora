export type MarkdownPreviewResult =
  | {
      status: "ok";
      html: string;
    }
  | {
      status: "error";
      html: string;
      message: string;
    };

type MarkdownRenderer = (source: string) => string;
export type MarkdownMermaidBlockPreview = {
  status: "loading" | "ok" | "error";
  html: string;
};

interface MarkdownPreviewOptions {
  renderer?: MarkdownRenderer;
  mermaidBlocks?: Readonly<Record<number, MarkdownMermaidBlockPreview>>;
}

const TOKEN_PREFIX = "\uE000";
const TOKEN_SUFFIX = "\uE001";

export function renderMarkdownPreview(
  source: string,
  options: MarkdownPreviewOptions = {},
): MarkdownPreviewResult {
  try {
    return {
      status: "ok",
      html:
        options.renderer?.(source) ??
        renderMarkdownToSafeHtml(source, {
          mermaidBlocks: options.mermaidBlocks,
        }),
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Markdown preview failed.";
    return {
      status: "error",
      message,
      html: `<div class="markdown-preview-error" role="status">Markdown preview failed: ${escapeHtml(
        message,
      )}</div>`,
    };
  }
}

function renderMarkdownToSafeHtml(
  source: string,
  options: Pick<MarkdownPreviewOptions, "mermaidBlocks"> = {},
): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;
  let mermaidBlockIndex = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}```\s*([\w-]+)?\s*$/);
    if (fence) {
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
      if (language.trim().toLowerCase() === "mermaid") {
        const preview = options.mermaidBlocks?.[mermaidBlockIndex];
        blocks.push(renderMermaidCodeBlock(mermaidBlockIndex, preview));
        mermaidBlockIndex += 1;
        continue;
      }
      const languageClass = language
        ? ` class="language-${escapeAttribute(language)}"`
        : "";
      blocks.push(
        `<pre><code${languageClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = collectTable(lines, index);
      blocks.push(renderTable(table.rows));
      index = table.nextIndex;
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^ {0,3}>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^ {0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderParagraphs(quoteLines)}</blockquote>`);
      continue;
    }

    const list = collectList(lines, index);
    if (list) {
      blocks.push(renderList(list.items, list.ordered));
      index = list.nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      !isBlank(lines[index] ?? "") &&
      !isBlockStart(lines, index)
    ) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraphLines.join(" "))}</p>`);
  }

  return blocks.join("\n");
}

export function collectMarkdownMermaidBlocks(source: string): string[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = line.match(/^ {0,3}```\s*([\w-]+)?\s*$/);
    if (!fence) {
      index += 1;
      continue;
    }

    const language = (fence[1] ?? "").trim().toLowerCase();
    const codeLines: string[] = [];
    index += 1;
    while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index] ?? "")) {
      codeLines.push(lines[index] ?? "");
      index += 1;
    }
    if (index < lines.length) {
      index += 1;
    }
    if (language === "mermaid") {
      blocks.push(codeLines.join("\n"));
    }
  }

  return blocks;
}

function renderMermaidCodeBlock(
  index: number,
  preview: MarkdownMermaidBlockPreview | undefined,
): string {
  const content =
    preview?.html ??
    '<div class="mermaid-preview-loading" role="status">Rendering Mermaid preview…</div>';
  const status = preview?.status ?? "loading";
  return `<div class="markdown-mermaid-preview is-${escapeAttribute(
    status,
  )}" data-mermaid-index="${index}">${content}</div>`;
}

function renderParagraphs(lines: string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (isBlank(line)) {
      if (current.length > 0) {
        paragraphs.push(`<p>${renderInline(current.join(" "))}</p>`);
        current = [];
      }
    } else {
      current.push(line.trim());
    }
  }

  if (current.length > 0) {
    paragraphs.push(`<p>${renderInline(current.join(" "))}</p>`);
  }

  return paragraphs.join("\n");
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    /^ {0,3}```/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    /^ {0,3}>\s?/.test(line) ||
    listLine(line) !== null ||
    isTableStart(lines, index)
  );
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

interface ListItem {
  content: string;
  taskState: "checked" | "unchecked" | null;
}

function collectList(
  lines: string[],
  startIndex: number,
): { ordered: boolean; items: ListItem[]; nextIndex: number } | null {
  const first = listLine(lines[startIndex] ?? "");
  if (!first) {
    return null;
  }

  const items: ListItem[] = [];
  let index = startIndex;
  while (index < lines.length) {
    const parsed = listLine(lines[index] ?? "");
    if (!parsed || parsed.ordered !== first.ordered) {
      break;
    }
    items.push({
      content: parsed.content,
      taskState: parsed.taskState,
    });
    index += 1;
  }

  return {
    ordered: first.ordered,
    items,
    nextIndex: index,
  };
}

function listLine(line: string):
  | {
      ordered: boolean;
      content: string;
      taskState: "checked" | "unchecked" | null;
    }
  | null {
  const unordered = line.match(/^ {0,3}[-*+]\s+(?:(\[[ xX]\])\s+)?(.+)$/);
  if (unordered) {
    return {
      ordered: false,
      taskState: parseTaskState(unordered[1]),
      content: unordered[2],
    };
  }

  const ordered = line.match(/^ {0,3}\d+\.\s+(?:(\[[ xX]\])\s+)?(.+)$/);
  if (ordered) {
    return {
      ordered: true,
      taskState: parseTaskState(ordered[1]),
      content: ordered[2],
    };
  }

  return null;
}

function parseTaskState(value: string | undefined): "checked" | "unchecked" | null {
  if (!value) {
    return null;
  }
  return value.toLowerCase() === "[x]" ? "checked" : "unchecked";
}

function renderList(items: ListItem[], ordered: boolean): string {
  const tag = ordered ? "ol" : "ul";
  const renderedItems = items
    .map((item) => {
      const checkbox =
        item.taskState === null
          ? ""
          : `<input type="checkbox" disabled${
              item.taskState === "checked" ? " checked" : ""
            }> `;
      return `<li>${checkbox}${renderInline(item.content)}</li>`;
    })
    .join("");
  return `<${tag}>${renderedItems}</${tag}>`;
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index] ?? "";
  const separator = lines[index + 1] ?? "";
  return isTableRow(header) && isTableSeparator(separator);
}

function collectTable(
  lines: string[],
  startIndex: number,
): { rows: string[][]; nextIndex: number } {
  const rows: string[][] = [splitTableRow(lines[startIndex] ?? "")];
  let index = startIndex + 2;
  while (index < lines.length && isTableRow(lines[index] ?? "")) {
    rows.push(splitTableRow(lines[index] ?? ""));
    index += 1;
  }
  return { rows, nextIndex: index };
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function renderTable(rows: string[][]): string {
  const [header, ...body] = rows;
  const head = `<thead><tr>${header
    .map((cell) => `<th>${renderInline(cell)}</th>`)
    .join("")}</tr></thead>`;
  const bodyRows = body
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table>${head}<tbody>${bodyRows}</tbody></table>`;
}

function renderInline(source: string): string {
  const tokens: string[] = [];
  let remaining = source;

  remaining = remaining.replace(/`([^`]+)`/g, (_, code: string) =>
    pushToken(tokens, `<code>${escapeHtml(code)}</code>`),
  );
  remaining = remaining.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, url: string) =>
    pushToken(
      tokens,
      `<span class="markdown-preview-image-placeholder" data-url="${escapeAttribute(
        url,
      )}">Image: ${escapeHtml(alt || "Untitled image")} (${escapeHtml(
        url,
      )})</span>`,
    ),
  );
  remaining = remaining.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text: string, url: string) =>
    pushToken(
      tokens,
      `<span class="markdown-preview-link" data-url="${escapeAttribute(
        url,
      )}">${renderInline(text)} <span class="markdown-preview-link-url">(${escapeHtml(
        url,
      )})</span></span>`,
    ),
  );

  let html = escapeHtml(remaining);
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");

  return tokens.reduce(
    (result, token, index) =>
      result.replace(`${TOKEN_PREFIX}${index}${TOKEN_SUFFIX}`, token),
    html,
  );
}

function pushToken(tokens: string[], html: string): string {
  const index = tokens.push(html) - 1;
  return `${TOKEN_PREFIX}${index}${TOKEN_SUFFIX}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
