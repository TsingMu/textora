/**
 * {@link LanguageMode} 到 CodeMirror 语言扩展的映射（`docs/features/code-syntax-highlighting.md` 切片 2）。
 *
 * 集中映射便于随活动标签重配置；`plain-text` 返回 `null`（不挂任何语言扩展）。
 * 语言包加载或构造失败时不应阻止编辑——调用方在 `try` 中应用，失败回退到普通文本。
 */

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
import { StreamLanguage } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import type { Extension } from "@codemirror/state";

import type { LanguageMode } from "./languageRecognition";

/**
 * 返回 `mode` 对应的 CodeMirror 语言扩展；`plain-text` 返回 `null`（普通文本，无语言扩展）。
 * 任意语言包构造抛错时由调用方捕获并退化为 `null`。
 */
export function languageExtension(mode: LanguageMode): Extension | null {
  switch (mode) {
    case "javascript":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ typescript: true, jsx: true });
    case "json":
      return json();
    case "html":
      return html();
    case "css":
      return css();
    case "rust":
      return rust();
    case "python":
      return python();
    case "java":
      return java();
    case "shell":
      return StreamLanguage.define(shell);
    case "sql":
      return sql();
    case "toml":
      return StreamLanguage.define(toml);
    case "yaml":
      return yaml();
    case "markdown":
      return markdown();
    case "plain-text":
      return null;
  }
}

/**
 * 解析 `mode` 的语言扩展，失败时安全退化为 `null`（普通文本），不抛错。
 * 调用方据此用 `Compartment.reconfigure` 重配置编辑器。
 */
export function safeLanguageExtension(mode: LanguageMode): Extension | null {
  try {
    return languageExtension(mode);
  } catch {
    return null;
  }
}
