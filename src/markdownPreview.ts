import { renderHighlightedCodeBlock } from "./markdownCodeHighlight";

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

/** Markdown 顶层块类型，用于 Preview 同步滚动的块级映射。 */
export type MarkdownBlockKind =
  | "heading"
  | "paragraph"
  | "fence"
  | "list"
  | "table"
  | "blockquote"
  | "hr"
  | "mermaid";

/**
 * 一个顶层 Markdown 块在源码与预览之间的映射条目。`index` 为预览渲染顺序下的 0-based 序号，
 * 与预览容器顶层元素顺序一致（每个块都渲染为单一根元素），作为同步滚动的稳定 DOM 锚点；
 * `startLine`/`endLine` 为源码 0-based 半开行区间。
 */
export type MarkdownBlock = {
  index: number;
  kind: MarkdownBlockKind;
  startLine: number;
  endLine: number;
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
        }).html,
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

/**
 * 收集 Markdown 源码的顶层块映射（`docs/features/markdown-preview-sync-scroll.md` 切片 2）。
 * 纯函数：返回每个块在源码中的 0-based 半开行区间、块类型与预览渲染顺序下的 0-based 序号；
 * 序号与预览容器顶层元素顺序一致，供后续双向同步滚动作为稳定 DOM 锚点。不读取或写入 DOM、
 * 不依赖 Mermaid 异步预览结果。
 */
export function collectMarkdownBlockMap(source: string): MarkdownBlock[] {
  return renderMarkdownToSafeHtml(source).blockMap;
}

function renderMarkdownToSafeHtml(
  source: string,
  options: Pick<MarkdownPreviewOptions, "mermaidBlocks"> = {},
): { html: string; blockMap: MarkdownBlock[] } {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  const blockMap: MarkdownBlock[] = [];
  // 在每个分支消费完源码行后调用：先记录块映射（序号 = 当前 blocks 长度，endLine = 当前 index），
  // 再 push HTML。映射与 HTML 同源同序，保证序号 ↔ 预览顶层元素一一对应，且不改变渲染结果。
  const pushBlock = (kind: MarkdownBlockKind, startLine: number, html: string) => {
    blockMap.push({ index: blocks.length, kind, startLine, endLine: index });
    blocks.push(html);
  };
  let index = 0;
  let mermaidBlockIndex = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const startLine = index;

    const fence = line.match(/^ {0,3}```\s*([^\s`]*)?.*$/);
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
        pushBlock(
          "mermaid",
          startLine,
          renderMermaidCodeBlock(mermaidBlockIndex, preview),
        );
        mermaidBlockIndex += 1;
        continue;
      }
      const languageClass = language
        ? ` class="language-${escapeAttribute(language)}"`
        : "";
      pushBlock(
        "fence",
        startLine,
        `<pre><code${languageClass}>${renderHighlightedCodeBlock(
          codeLines.join("\n"),
          language,
        )}</code></pre>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      index += 1;
      pushBlock("heading", startLine, `<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      index += 1;
      pushBlock("hr", startLine, "<hr>");
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = collectTable(lines, index);
      index = table.nextIndex;
      pushBlock("table", startLine, renderTable(table.rows));
      continue;
    }

    if (/^ {0,3}>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^ {0,3}>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^ {0,3}>\s?/, ""));
        index += 1;
      }
      pushBlock(
        "blockquote",
        startLine,
        `<blockquote>${renderParagraphs(quoteLines)}</blockquote>`,
      );
      continue;
    }

    const list = collectList(lines, index);
    if (list) {
      index = list.nextIndex;
      pushBlock("list", startLine, renderList(list.items, list.ordered));
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
    pushBlock(
      "paragraph",
      startLine,
      `<p>${renderInline(paragraphLines.join(" "))}</p>`,
    );
  }

  return { html: blocks.join("\n"), blockMap };
}

export function collectMarkdownMermaidBlocks(source: string): string[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = line.match(/^ {0,3}```\s*([^\s`]*)?.*$/);
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
