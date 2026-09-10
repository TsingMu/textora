/**
 * Markdown fenced code block 通用格式化契约（`docs/features/markdown-fenced-code-formatting.md`）。
 *
 * 纯函数模块：根据 fence 上下文选择本地格式化器并把代码块内容替换为固定风格的确定性输出。语言别名与
 * 格式化器集中在本注册表，后续语言任务只追加条目，不复制入口或失败语义。所有失败路径都返回可区分的
 * 原因，由调用方转成非阻塞提示；本模块不触碰编辑器状态，零修改由调用方保证。
 */

import { fenceContextAt } from "./markdownFenceContext";

/** 单个代码块允许格式化的内容上限（字符数）；超出时直接失败，避免主线程被超大块阻塞。 */
export const FENCE_FORMAT_MAX_CHARS = 1024 * 1024;

/**
 * fence 内容格式化器：接收代码块原文，返回格式化结果。可为同步或异步；抛错或返回非字符串一律视为
 * 「内容无效」，不产生任何文档变更。
 */
export type FenceFormatter = (content: string) => string | Promise<string>;

/** 注册表条目；`displayName` 用于无效内容提示。 */
export type FenceFormatterEntry = {
  displayName: string;
  format: FenceFormatter;
};

function formatJsonContent(content: string): string {
  return `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
}

/** prettier 固定输出风格（规格「固定输出风格」章节）；不提供用户配置。 */
const PRETTIER_SHARED_OPTIONS = {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  endOfLine: "lf",
} as const;

/**
 * 构造 prettier standalone 格式化器。standalone 与各解析器插件均经动态导入按需加载，不进入应用启动
 * 路径；解析失败由 prettier 抛错，经 {@link executeFenceFormat} 统一归为 `invalid-content`。
 */
function prettierFormatter(
  parser: "babel" | "typescript" | "yaml",
): FenceFormatter {
  return async (content: string): Promise<string> => {
    const prettier = await import("prettier/standalone");
    const plugins =
      parser === "yaml"
        ? [await import("prettier/plugins/yaml")]
        : [
            await import(
              parser === "babel"
                ? "prettier/plugins/babel"
                : "prettier/plugins/typescript"
            ),
            await import("prettier/plugins/estree"),
          ];
    return prettier.format(content, {
      parser,
      plugins,
      ...PRETTIER_SHARED_OPTIONS,
    });
  };
}

function aliasEntries(
  displayName: string,
  format: FenceFormatter,
  aliases: readonly string[],
): Array<[string, FenceFormatterEntry]> {
  return aliases.map((alias) => [alias, { displayName, format }]);
}

/** sql-formatter 的语言标识；`sql` 即 StandardSQL。 */
type SqlLanguage =
  | "sql"
  | "mysql"
  | "postgresql"
  | "sqlite"
  | "transactsql"
  | "bigquery";

/** SQL 固定输出风格（规格「固定输出风格」章节）；不提供用户配置。 */
const SQL_FORMAT_OPTIONS = {
  tabWidth: 2,
  useTabs: false,
  keywordCase: "preserve",
  expressionWidth: 50,
} as const;

/** info 别名 → sql-formatter 方言映射；`mariadb` 按规格并入 mysql。 */
const SQL_ALIAS_TO_LANGUAGE: Readonly<Record<string, SqlLanguage>> = {
  sql: "sql",
  mysql: "mysql",
  mariadb: "mysql",
  postgres: "postgresql",
  postgresql: "postgresql",
  psql: "postgresql",
  sqlite: "sqlite",
  tsql: "transactsql",
  transactsql: "transactsql",
  bigquery: "bigquery",
};

/**
 * 构造 sql-formatter 格式化器，经动态导入按需加载。sql-formatter 输出不带尾随换行，这里补齐一个
 * `\n`，保证替换 fence 内容后 closing fence 仍独占一行（与 JSON、prettier 输出行为一致）。
 */
function sqlFormatter(language: SqlLanguage): FenceFormatter {
  return async (content: string): Promise<string> => {
    const { format } = await import("sql-formatter");
    const output = format(content, {
      language,
      ...SQL_FORMAT_OPTIONS,
    });
    return output.endsWith("\n") ? output : `${output}\n`;
  };
}

/** Shell 固定输出风格（规格「固定输出风格」章节）：2 空格缩进，全部改写类开关关闭，仅做排版。 */
const SHELL_FORMAT_OPTIONS = {
  indent: 2,
  binaryNextLine: false,
  switchCaseIndent: false,
  spaceRedirects: false,
  funcNextLine: false,
  minify: false,
  singleLine: false,
  simplify: false,
} as const;

/**
 * shfmt WASM 格式化器：经 `/vite` 入口动态导入（WASM 由 Vite 作为本地资源接线，无运行期网络请求），
 * 统一按 bash 变体解析。语法错误由 shfmt 抛错，经 {@link executeFenceFormat} 归为
 * `invalid-content`；输出恒以 `\n` 结尾，满足 fence 内容替换契约。
 */
async function formatShellContent(content: string): Promise<string> {
  const { default: init, format } = await import("@wasm-fmt/shfmt/vite");
  await init();
  return format(content, ".bash", SHELL_FORMAT_OPTIONS);
}

/** info 首 token（已小写归一化）→ 格式化器注册表；后续语言任务在此追加条目与别名。 */
const FORMATTERS: ReadonlyMap<string, FenceFormatterEntry> = new Map([
  ["json", { displayName: "JSON", format: formatJsonContent }],
  ...aliasEntries("JavaScript", prettierFormatter("babel"), [
    "js",
    "javascript",
    "jsx",
    "mjs",
    "cjs",
    "node",
  ]),
  ...aliasEntries("TypeScript", prettierFormatter("typescript"), [
    "ts",
    "typescript",
    "tsx",
  ]),
  ...aliasEntries("YAML", prettierFormatter("yaml"), ["yaml", "yml"]),
  ...aliasEntries("Shell", formatShellContent, [
    "sh",
    "bash",
    "zsh",
    "shell",
    "shellscript",
  ]),
  ...(Object.entries(SQL_ALIAS_TO_LANGUAGE) as Array<[string, SqlLanguage]>).map(
    ([alias, language]) =>
      [alias, { displayName: "SQL", format: sqlFormatter(language) }] as [
        string,
        FenceFormatterEntry,
      ],
  ),
]);

/** 光标所在闭合 fenced code block 的格式化前置检查结果。 */
export type FenceFormatTarget =
  | { kind: "no-context" }
  | { kind: "unsupported-language"; language: string }
  | { kind: "too-large"; language: string }
  | {
      kind: "target";
      language: string;
      displayName: string;
      content: string;
      contentFrom: number;
      contentTo: number;
    };

/**
 * 检查光标处是否可格式化：不在闭合代码块内容区返回 `no-context`；info 首 token 未注册返回
 * `unsupported-language`（含空 token 的无标记 fence）；内容超过 {@link FENCE_FORMAT_MAX_CHARS} 返回
 * `too-large`；否则返回待格式化目标。本函数不解析内容，也不修改任何状态。
 */
export function inspectFenceFormatTarget(
  text: string,
  cursor: number,
): FenceFormatTarget {
  const ctx = fenceContextAt(text, cursor);
  if (ctx === null || ctx.closing === null) {
    return { kind: "no-context" };
  }
  const entry = FORMATTERS.get(ctx.infoToken);
  if (entry === undefined) {
    return { kind: "unsupported-language", language: ctx.infoToken };
  }
  const content = text.slice(ctx.content.from, ctx.content.to);
  if (content.length > FENCE_FORMAT_MAX_CHARS) {
    return { kind: "too-large", language: ctx.infoToken };
  }
  return {
    kind: "target",
    language: ctx.infoToken,
    displayName: entry.displayName,
    content,
    contentFrom: ctx.content.from,
    contentTo: ctx.content.to,
  };
}

/** {@link FenceFormatTarget} 的目标分支，供 {@link executeFenceFormat} 引用。 */
export type FenceFormatTargetEntry = Extract<
  FenceFormatTarget,
  { kind: "target" }
>;

/** 格式化执行结果；`applied` 携带替换范围与内容，由调用方以单事务提交。 */
export type FenceFormatOutcome =
  | {
      kind: "applied";
      language: string;
      contentFrom: number;
      contentTo: number;
      formatted: string;
    }
  | { kind: "invalid-content"; language: string; displayName: string }
  | { kind: "changed-during-format" };

/**
 * 执行格式化并做并发保护：格式化器完成后经 `readCurrent` 重新读取当前文档与光标——文档完全未变时按
 * 原范围应用；文档已变时要求当前光标仍能定位到同一语言、同一内容的代码块，否则返回
 * `changed-during-format` 中止（用户格式化期间移动了光标且无法确认同一代码块时同样中止，宁可不做
 * 也不改错块）。格式化器抛错或返回非字符串返回 `invalid-content`。任一失败都不产生变更。
 */
export async function executeFenceFormat(
  target: FenceFormatTargetEntry,
  originalText: string,
  readCurrent: () => { text: string; cursor: number },
): Promise<FenceFormatOutcome> {
  let formatted: unknown;
  try {
    formatted = await FORMATTERS.get(target.language)?.format(target.content);
  } catch {
    return {
      kind: "invalid-content",
      language: target.language,
      displayName: target.displayName,
    };
  }
  if (typeof formatted !== "string") {
    return {
      kind: "invalid-content",
      language: target.language,
      displayName: target.displayName,
    };
  }

  const current = readCurrent();
  if (current.text !== originalText) {
    const ctx = fenceContextAt(current.text, current.cursor);
    if (
      ctx === null ||
      ctx.closing === null ||
      ctx.infoToken !== target.language ||
      current.text.slice(ctx.content.from, ctx.content.to) !== target.content
    ) {
      return { kind: "changed-during-format" };
    }
    return {
      kind: "applied",
      language: target.language,
      contentFrom: ctx.content.from,
      contentTo: ctx.content.to,
      formatted,
    };
  }

  return {
    kind: "applied",
    language: target.language,
    contentFrom: target.contentFrom,
    contentTo: target.contentTo,
    formatted,
  };
}

/** 通用格式化的全部失败原因；`unavailable` 仅由 Editor 句柄在非 Markdown 或无视图时返回。 */
export type FenceFormatFailure =
  | { kind: "no-context" }
  | { kind: "unsupported-language"; language: string }
  | { kind: "too-large"; language: string }
  | { kind: "invalid-content"; language: string; displayName: string }
  | { kind: "changed-during-format" };
