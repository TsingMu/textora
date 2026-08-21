/**
 * 代码文本语言识别契约（`docs/features/code-syntax-highlighting.md` 切片 1，
 * `docs/features/mermaid-local-preview.md` 语言识别切片）。
 *
 * 纯函数：根据活动文档的路径或显示名返回 {@link LanguageMode}，未识别退化为
 * `plain-text`。本模块不依赖 CodeMirror、不读取文件、不触及 UI；后续 CodeMirror
 * 高亮映射与状态栏语言展示都以其为单一来源。
 */

/** 首版支持的代码/配置语言，加上未识别时的普通文本退化模式。 */
export type LanguageMode =
  | "javascript"
  | "typescript"
  | "json"
  | "html"
  | "css"
  | "rust"
  | "python"
  | "java"
  | "shell"
  | "sql"
  | "toml"
  | "yaml"
  | "markdown"
  | "mermaid"
  | "plain-text";

/**
 * 受支持模式的固定清单（含 `Plain Text`），顺序即原生 `View > Syntax` 子菜单顺序；
 * 原生菜单事件载荷必须命中其中一项才被前端采用。
 */
export const LANGUAGE_MODES: readonly LanguageMode[] = [
  "plain-text",
  "javascript",
  "typescript",
  "json",
  "html",
  "css",
  "rust",
  "python",
  "java",
  "shell",
  "sql",
  "toml",
  "yaml",
  "markdown",
  "mermaid",
];

/** 校验未知来源的值（如原生菜单事件载荷）是否为受支持的 {@link LanguageMode}。 */
export function isLanguageMode(value: unknown): value is LanguageMode {
  return (
    typeof value === "string" &&
    (LANGUAGE_MODES as readonly string[]).includes(value)
  );
}

/** 完整文件名（小写）到语言模式的映射，优先于扩展名匹配。 */
const KNOWN_FILE_NAMES: Readonly<Record<string, LanguageMode>> = {
  "package.json": "json",
  "tsconfig.json": "json",
  "jsconfig.json": "json",
  "cargo.toml": "toml",
  "pyproject.toml": "toml",
};

/** 扩展名（小写、不含点）到语言模式的映射。 */
const KNOWN_EXTENSIONS: Readonly<Record<string, LanguageMode>> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  rs: "rust",
  py: "python",
  java: "java",
  sh: "shell",
  bash: "shell",
  sql: "sql",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  mmd: "mermaid",
  mermaid: "mermaid",
};

/** {@link LanguageMode} 的展示名，用于状态栏等 UI。 */
const DISPLAY_NAMES: Readonly<Record<LanguageMode, string>> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  json: "JSON",
  html: "HTML",
  css: "CSS",
  rust: "Rust",
  python: "Python",
  java: "Java",
  shell: "Shell",
  sql: "SQL",
  toml: "TOML",
  yaml: "YAML",
  markdown: "Markdown",
  mermaid: "Mermaid",
  "plain-text": "Plain Text",
};

/** 各非普通文本模式的首选后缀（不含点），只用于未保存标签首次保存的建议文件名。 */
const PREFERRED_SUFFIXES: Readonly<
  Record<Exclude<LanguageMode, "plain-text">, string>
> = {
  javascript: "js",
  typescript: "ts",
  json: "json",
  html: "html",
  css: "css",
  rust: "rs",
  python: "py",
  java: "java",
  shell: "sh",
  sql: "sql",
  toml: "toml",
  yaml: "yaml",
  markdown: "md",
  mermaid: "mmd",
};

/**
 * 未保存标签首次保存的建议文件名：非 `Plain Text` 模式在完整显示名（含 `Untitled 2`
 * 编号）后直接追加首选后缀；`Plain Text` 不追加，保持显示名原样。不替换或纠正显示名
 * 中的任何字符，用户最终输入始终优先。
 */
export function suggestedSaveFileName(
  displayName: string,
  mode: LanguageMode,
): string {
  if (mode === "plain-text") {
    return displayName;
  }
  return `${displayName}.${PREFERRED_SUFFIXES[mode]}`;
}

/** 取路径最后一段作为文件名；同时识别 `/` 与 `\` 以兼容 Windows 风格路径片段。 */
function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? normalized.slice(slash + 1) : normalized;
}

/**
 * 文件名的小写扩展名（不含点）。隐藏文件（如 `.gitignore`）与无扩展名文件返回空串，
 * 由调用方退化为普通文本。
 */
function lowerExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * 按活动文档的路径或显示名识别语言模式。`path` 非空时优先取其文件名，否则使用
 * `displayName`（Untitled 传入 `"Untitled"`）。完整文件名优先匹配，再回退扩展名；
 * 大小写不敏感；无法识别时返回 `plain-text`。
 */
export function detectLanguage(
  path: string | null,
  displayName: string,
): LanguageMode {
  const fileName = path !== null ? basename(path) : displayName;
  const lowerName = fileName.toLowerCase();
  if (KNOWN_FILE_NAMES[lowerName] !== undefined) {
    return KNOWN_FILE_NAMES[lowerName];
  }
  const ext = lowerExtension(fileName);
  return KNOWN_EXTENSIONS[ext] ?? "plain-text";
}

/** 返回语言模式对应的状态栏展示名（如 `TypeScript`、`Plain Text`）。 */
export function languageDisplayName(mode: LanguageMode): string {
  return DISPLAY_NAMES[mode];
}
