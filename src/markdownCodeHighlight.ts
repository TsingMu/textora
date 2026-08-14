import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { Language, StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { classHighlighter, highlightTree } from "@lezer/highlight";

import type { LanguageMode } from "./languageRecognition";

/**
 * Markdown fenced code block 语言目录项，是代码高亮解析与 opening fence 语言候选提示共享的单一契约来源。
 *
 * - `canonical`：确认候选时写回源码的语言名称（小写），也是候选列表去重后唯一展示与插入的标识。
 * - `aliases`：仅用于检索的别名（小写），不进入候选列表、不写回源码，避免产生重复项。
 * - `previewTarget`：预览/高亮解析目标（{@link LanguageMode}）。`mermaid` 纳入目录以支持候选提示，
 *   但 {@link resolveMarkdownCodeBlockLanguage} 继续对其返回 `null`（由本地 Mermaid 图表渲染接管）。
 */
export type LanguageDirectoryEntry = {
  readonly canonical: string;
  readonly aliases: readonly string[];
  readonly previewTarget: LanguageMode;
};

/**
 * 首版语言目录。canonical 顺序即候选稳定展示顺序；`mermaid` 作为可推荐的本地预览语言纳入，
 * 但普通代码高亮解析仍返回 `null`。
 */
export const FENCE_LANGUAGE_DIRECTORY: readonly LanguageDirectoryEntry[] = [
  { canonical: "javascript", aliases: ["js", "jsx", "mjs", "cjs"], previewTarget: "javascript" },
  { canonical: "typescript", aliases: ["ts", "tsx", "mts", "cts"], previewTarget: "typescript" },
  { canonical: "json", aliases: [], previewTarget: "json" },
  { canonical: "html", aliases: ["htm"], previewTarget: "html" },
  { canonical: "css", aliases: [], previewTarget: "css" },
  { canonical: "rust", aliases: ["rs"], previewTarget: "rust" },
  { canonical: "python", aliases: ["py"], previewTarget: "python" },
  { canonical: "java", aliases: [], previewTarget: "java" },
  { canonical: "shell", aliases: ["sh", "bash"], previewTarget: "shell" },
  { canonical: "sql", aliases: [], previewTarget: "sql" },
  { canonical: "toml", aliases: [], previewTarget: "toml" },
  { canonical: "yaml", aliases: ["yml"], previewTarget: "yaml" },
  { canonical: "markdown", aliases: ["md"], previewTarget: "markdown" },
  { canonical: "mermaid", aliases: [], previewTarget: "mermaid" },
];

/**
 * 由目录派生 info token → 高亮语言模式映射。`mermaid` 也进入映射，但
 * {@link resolveMarkdownCodeBlockLanguage} 在查表前显式对 `mermaid` 返回 `null`。
 */
function buildInfoTokenToLanguage(
  directory: readonly LanguageDirectoryEntry[],
): Record<string, LanguageMode> {
  const map: Record<string, LanguageMode> = {};
  for (const entry of directory) {
    map[entry.canonical] = entry.previewTarget;
    for (const alias of entry.aliases) {
      map[alias] = entry.previewTarget;
    }
  }
  return map;
}

const INFO_TOKEN_TO_LANGUAGE: Readonly<Record<string, LanguageMode>> =
  buildInfoTokenToLanguage(FENCE_LANGUAGE_DIRECTORY);

type HighlightSpan = {
  from: number;
  to: number;
  className: string;
};

export function resolveMarkdownCodeBlockLanguage(
  infoString: string,
): LanguageMode | null {
  const token = infoString.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (token === "" || token === "mermaid") {
    return null;
  }
  return INFO_TOKEN_TO_LANGUAGE[token] ?? null;
}

export function renderHighlightedCodeBlock(
  code: string,
  infoString: string,
): string {
  const language = resolveMarkdownCodeBlockLanguage(infoString);
  if (language === null) {
    return escapeHtml(code);
  }

  try {
    const parserLanguage = codeMirrorLanguage(language);
    if (parserLanguage === null) {
      return escapeHtml(code);
    }

    const tree = parserLanguage.parser.parse(code);
    const spans: HighlightSpan[] = [];
    highlightTree(tree, classHighlighter, (from, to, className) => {
      if (from < to && className.trim() !== "") {
        spans.push({ from, to, className });
      }
    });

    if (spans.length === 0) {
      return escapeHtml(code);
    }

    return renderHighlightSpans(code, spans);
  } catch {
    return escapeHtml(code);
  }
}

function codeMirrorLanguage(mode: LanguageMode): Language | null {
  switch (mode) {
    case "javascript":
      return javascript({ jsx: true }).language;
    case "typescript":
      return javascript({ typescript: true, jsx: true }).language;
    case "json":
      return json().language;
    case "html":
      return html().language;
    case "css":
      return css().language;
    case "rust":
      return rust().language;
    case "python":
      return python().language;
    case "java":
      return java().language;
    case "shell":
      return StreamLanguage.define(shell);
    case "sql":
      return sql().language;
    case "toml":
      return StreamLanguage.define(toml);
    case "yaml":
      return yaml().language;
    case "markdown":
      return markdown().language;
    case "mermaid":
    case "plain-text":
      return null;
  }
}

function renderHighlightSpans(code: string, spans: HighlightSpan[]): string {
  let html = "";
  let cursor = 0;

  for (const span of spans) {
    if (span.from < cursor) {
      continue;
    }
    html += escapeHtml(code.slice(cursor, span.from));
    html += `<span class="${escapeAttribute(span.className)}">${escapeHtml(
      code.slice(span.from, span.to),
    )}</span>`;
    cursor = span.to;
  }

  html += escapeHtml(code.slice(cursor));
  return html;
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
