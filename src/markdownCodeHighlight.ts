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

const INFO_TOKEN_TO_LANGUAGE: Readonly<Record<string, LanguageMode>> = {
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  typescript: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  rs: "rust",
  rust: "rust",
  py: "python",
  python: "python",
  java: "java",
  sh: "shell",
  bash: "shell",
  shell: "shell",
  sql: "sql",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
};

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
