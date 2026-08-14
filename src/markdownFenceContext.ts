/**
 * Markdown fenced code block 上下文识别契约（`docs/features/markdown-fenced-code-editing.md` 切片 2）。
 *
 * 纯函数：根据 Markdown 源码与光标 offset，返回光标所在 fenced code block 的 opening/closing/content
 * 边界与语言 token；未处于代码块内容区（fence 标记行、普通文本或代码块外）时返回 null。本模块不依赖
 * CodeMirror、不读取文件、不修改源码；后续 opening fence 自动闭合与 fenced JSON 格式化都以其为单一来源，
 * 避免在 Editor、Preview 或 WYSIWYG 中复制不同 fence 正则。
 */

/** fence 标记字符，首版只支持反引号与波浪号。 */
export type FenceMarker = "`" | "~";

/** 半开区间 `[from, to)` 的源码 offset，`to` 不含行末换行。 */
export type FenceRange = {
  from: number;
  to: number;
};

/** 一行的 fence 词法分析结果，不区分 opening 与 closing（closing 还需调用方按规则复核）。 */
export type FenceLineInfo = {
  /** 行首缩进空格数（0–3）；超过 3 个前导空格不会被识别为 fence。 */
  indent: number;
  marker: FenceMarker;
  /** 连续标记字符数（≥3）。 */
  length: number;
  /** 标记字符之后的整行剩余文本（未 trim，可能为空或含 info string）。 */
  rest: string;
};

/** 光标所在 fenced code block 的上下文。 */
export type FenceContext = {
  marker: FenceMarker;
  /** opening fence 的标记长度（≥3）。 */
  openLength: number;
  indent: number;
  /** info string 去除首尾空白后的第一个 token，已按小写归一化；无 info 时为空串。 */
  infoToken: string;
  /** opening fence 行范围 `[from, to)`（整行文本，不含换行）。 */
  opening: FenceRange;
  /** closing fence 行范围；未闭合时为 `null`。 */
  closing: FenceRange | null;
  /** opening 与 closing 之间的内容范围 `[from, to)`；未闭合时延伸到源码末尾。 */
  content: FenceRange;
};

/** 行的 offset 边界：`[start, end)` 为行文本，`end` 为行末 `\n` 的 offset 或源码末尾。 */
type LineSpan = { start: number; end: number; text: string };

/** 按 `\n` 切分源码，保留每行 offset 边界；`\r` 视作行内字符以保持 offset 一致。 */
function splitLines(text: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      spans.push({ start, end: i, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  spans.push({ start, end: text.length, text: text.slice(start) });
  return spans;
}

/**
 * 判断一行文本是否符合 fenced code block 的标记前缀：0–3 个前导空格、至少 3 个连续反引号或波浪号。
 * 符合则返回结构化信息，否则返回 `null`。该函数只做行级词法判断，opening 与 closing 的区分由调用方
 * 按 `marker`、`length` 与 `rest` 是否全空白复核。
 */
export function classifyFenceLine(lineText: string): FenceLineInfo | null {
  let indent = 0;
  while (indent < lineText.length && lineText.charCodeAt(indent) === 32) {
    indent++;
  }
  if (indent > 3) return null;
  const markerChar = lineText[indent];
  if (markerChar !== "`" && markerChar !== "~") return null;
  let length = 0;
  let j = indent;
  while (j < lineText.length && lineText[j] === markerChar) {
    length++;
    j++;
  }
  if (length < 3) return null;
  return { indent, marker: markerChar, length, rest: lineText.slice(j) };
}

/** 取 info string 去除首尾空白后的第一个 token，并按小写归一化（无 token 时为空串）。 */
function infoTokenOf(rest: string): string {
  const match = rest.trim().match(/^\S+/);
  return match ? match[0].toLowerCase() : "";
}

/** closing fence 必须与 opening 同字符、长度不短于 opening，且标记之后不得有非空白内容。 */
function isClosingFor(
  candidate: FenceLineInfo,
  open: { marker: FenceMarker; length: number },
): boolean {
  return (
    candidate.marker === open.marker &&
    candidate.length >= open.length &&
    candidate.rest.trim() === ""
  );
}

/** 返回 `offset` 所在行的索引；行末换行位置归到本行。 */
function lineIndexOfOffset(lines: LineSpan[], offset: number): number {
  for (let i = 0; i < lines.length; i++) {
    if (offset <= lines[i].end) return i;
  }
  return lines.length - 1;
}

/**
 * 返回 `offset` 所在 fenced code block 的上下文。光标必须位于 opening 与 closing（或未闭合时的源码
 * 末尾）之间的内容区；位于 fence 标记行、普通文本或代码块外时返回 `null`。一旦进入一个代码块，只有
 * 与之同字符且长度足够的 closing 才能结束它；内容中较短的同类标记、另一种 fence 字符或带非空 info
 * 的候选 closing 行不结束当前代码块。引用/列表前缀中的嵌套 fence 超出首版范围。
 */
export function fenceContextAt(text: string, offset: number): FenceContext | null {
  if (offset < 0 || offset > text.length) return null;
  const lines = splitLines(text);
  const cursorLine = lineIndexOfOffset(lines, offset);

  let open:
    | {
        info: FenceLineInfo;
        lineIndex: number;
        contentFrom: number;
      }
    | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open === null) {
      const info = classifyFenceLine(line.text);
      if (info !== null) {
        open = {
          info,
          lineIndex: i,
          contentFrom: Math.min(line.end + 1, text.length),
        };
      }
      continue;
    }

    const candidate = classifyFenceLine(line.text);
    if (candidate !== null && isClosingFor(candidate, open.info)) {
      if (open.lineIndex < cursorLine && cursorLine < i) {
        return {
          marker: open.info.marker,
          openLength: open.info.length,
          indent: open.info.indent,
          infoToken: infoTokenOf(open.info.rest),
          opening: { from: lines[open.lineIndex].start, to: lines[open.lineIndex].end },
          closing: { from: line.start, to: line.end },
          content: { from: open.contentFrom, to: line.start },
        };
      }
      open = null;
    }
  }

  if (open !== null && open.lineIndex < cursorLine) {
    return {
      marker: open.info.marker,
      openLength: open.info.length,
      indent: open.info.indent,
      infoToken: infoTokenOf(open.info.rest),
      opening: { from: lines[open.lineIndex].start, to: lines[open.lineIndex].end },
      closing: null,
      content: { from: open.contentFrom, to: text.length },
    };
  }

  return null;
}

/** {@link unclosedOpeningAtLineEnd} 返回的 opening fence 信息，供自动闭合构造 closing。 */
export type OpeningFence = {
  marker: FenceMarker;
  /** opening 标记长度（≥3），closing 应复制该长度。 */
  length: number;
  /** 行首缩进（0–3），closing 应复制该缩进。 */
  indent: number;
};

/**
 * 行末未闭合 opening 识别的共享核心，供纯函数 {@link unclosedOpeningAtLineEnd} 与编辑器（用 CodeMirror
 * 行 API 按需取行）共用。`getLineText(n)` 以 1-based 行号返回该行文本，`lineCount` 为总行数，
 * `cursorLine` 为光标所在行号（1-based，调用方已确认光标在该行末）。满足下列条件时返回 opening 的
 * 标记/长度/缩进，否则 `null`：
 * - 当前行符合 opening fence 词法（0–3 空格 + ≥3 同字符标记）；
 * - 当前行未被上方另一个未闭合 fence 包住（否则它是内容，不是 opening）；
 * - 该 opening 在下方尚无匹配 closing（同字符、长度不短于 opening、标记后无非空白内容）。
 *
 * 这是文本级正确实现（扫描上方所有行确定是否处于另一 fence 内、扫描下方至文档末尾确定是否已闭合），
 * 用作编辑器语法树判定不可用时的回退。编辑器热路径应优先用 Markdown 语法树以获得有界耗时。
 */
export function unclosedOpeningFromLineSource(
  lineCount: number,
  getLineText: (lineNumber: number) => string,
  cursorLine: number,
): OpeningFence | null {
  const info = classifyFenceLine(getLineText(cursorLine));
  if (info === null) return null;

  let openAbove: { marker: FenceMarker; length: number } | null = null;
  for (let n = 1; n < cursorLine; n++) {
    const above = classifyFenceLine(getLineText(n));
    if (above === null) continue;
    if (openAbove === null) {
      openAbove = { marker: above.marker, length: above.length };
    } else if (isClosingFor(above, openAbove)) {
      openAbove = null;
    }
  }
  if (openAbove !== null) return null;

  for (let n = cursorLine + 1; n <= lineCount; n++) {
    const candidate = classifyFenceLine(getLineText(n));
    if (candidate !== null && isClosingFor(candidate, info)) {
      return null;
    }
  }

  return { marker: info.marker, length: info.length, indent: info.indent };
}

/**
 * 判断 `offset` 是否位于一个「未闭合 opening fence 行」的行末，供 Enter 自动闭合使用。这是
 * {@link unclosedOpeningFromLineSource} 的整文本入口（用于纯函数测试与一次性调用）；编辑器热路径
 * 应直接调用 {@link unclosedOpeningFromLineSource} 并用 CodeMirror 行 API 按需取行。
 */
export function unclosedOpeningAtLineEnd(
  text: string,
  offset: number,
): OpeningFence | null {
  if (offset < 0 || offset > text.length) return null;
  const lines = splitLines(text);
  const lineIndex = lineIndexOfOffset(lines, offset);
  if (offset !== lines[lineIndex].end) return null;
  return unclosedOpeningFromLineSource(
    lines.length,
    (n) => lines[n - 1].text,
    lineIndex + 1,
  );
}

/** opening fence 首个 info token 的建议上下文，供语言候选提示切片直接消费。 */
export type OpeningFenceTokenContext = {
  marker: FenceMarker;
  /** 当前查询前缀：首个 info token 起点到光标（不含）的原文，未做大小写归一化。 */
  prefix: string;
  /** 首个 info token 在源码中的替换起点（token 首字符 offset；空 token 时等于 `to`）。 */
  from: number;
  /** 首个 info token 在源码中的替换终点（token 末字符之后的 offset）。 */
  to: number;
};

/**
 * 判断 `offset` 是否位于一个「有效 opening fence 行」的首个 info token 内或末尾，供语言候选提示使用。
 *
 * 有效 opening fence：当前行符合 fence 词法（0–3 个前导空格 + ≥3 个同字符标记），且其上方没有未闭合的
 * 外层 fence（否则当前行是内容而非 opening）。光标必须落在首个 info token 的字符范围内或其末尾
 * （`from <= offset <= to`）；标记内部、token 后空格、第二 token、closing fence、fence 内容、嵌套
 * fence、4+ 个前导空格与非 fence 行均返回 `null`。不要求 opening 在下方已闭合——已闭合 opening 仍可
 * 编辑其语言 token。
 *
 * 首个 token 的位置与 {@link fenceContextAt} 的 `infoToken` 归一化一致：跳过标记后的前导空白，取首个
 * 非空白 run；标记后无内容（空 token）时 `from === to`，位于标记后可输入首个语言字符的位置。
 */
export function openingFenceTokenContext(
  text: string,
  offset: number,
): OpeningFenceTokenContext | null {
  if (offset < 0 || offset > text.length) return null;
  const lines = splitLines(text);
  const cursorLine = lineIndexOfOffset(lines, offset);
  return openingFenceTokenContextFromLineSource(
    lines.length,
    (n) => lines[n - 1].text,
    (n) => lines[n - 1].start,
    cursorLine + 1,
    offset,
  );
}

/**
 * {@link openingFenceTokenContext} 的行源核心，供编辑器热路径用 CodeMirror `Text` 行 API 按需取行，
 * 避免全文 `toString()` 与 `splitLines()` 复制。`getLineText(n)`/`getLineStart(n)` 以 1-based 行号
 * 返回该行文本与绝对起始 offset，`cursorLine` 为 1-based，`cursorOffset` 为绝对 offset。
 *
 * 关键优化：先只读当前行做 fence 词法判定与光标 token 命中——非 fence 行（普通段落）与光标不在首个
 * token 内的行直接返回 `null`，不扫描上方，避免普通 Markdown 输入时触发 O(行数) 扫描。仅当前行确为
 * fence 行且光标在 token 内时，才需要确认未被外层未闭合 fence 包住。
 *
 * 嵌套确认优先交给可选的 `nestingOracle`：返回 `true`（处于上方未闭合 fence 内）直接拒绝，返回 `false`
 *（确认无外层 fence）直接放行，二者都避免 O(行数) 上方扫描；仅当 oracle 未提供或返回 `null`（无法判定，
 * 例如语法树尚未覆盖到光标）时，才回退到逐行扫描。判定语义与 {@link openingFenceTokenContext} 完全一致。
 */
export function openingFenceTokenContextFromLineSource(
  lineCount: number,
  getLineText: (lineNumber: number) => string,
  getLineStart: (lineNumber: number) => number,
  cursorLine: number,
  cursorOffset: number,
  nestingOracle?: (cursorLine: number) => boolean | null,
): OpeningFenceTokenContext | null {
  if (cursorLine < 1 || cursorLine > lineCount) return null;

  const cursorLineText = getLineText(cursorLine);
  const info = classifyFenceLine(cursorLineText);
  if (info === null) return null;

  const markerEnd = info.indent + info.length;
  const rest = cursorLineText.slice(markerEnd);
  const match = rest.match(/^(\s*)(\S*)/);
  const leadingWs = match ? match[1].length : 0;
  const tokenLen = match ? match[2].length : 0;
  const lineStart = getLineStart(cursorLine);
  const tokenFromInLine = markerEnd + leadingWs;
  const from = lineStart + tokenFromInLine;
  const to = from + tokenLen;

  if (cursorOffset < from || cursorOffset > to) return null;

  let nested: boolean | null = nestingOracle ? nestingOracle(cursorLine) : null;
  if (nested === null) {
    let openAbove: { marker: FenceMarker; length: number } | null = null;
    for (let n = 1; n < cursorLine; n++) {
      const above = classifyFenceLine(getLineText(n));
      if (above === null) continue;
      if (openAbove === null) {
        openAbove = { marker: above.marker, length: above.length };
      } else if (isClosingFor(above, openAbove)) {
        openAbove = null;
      }
    }
    nested = openAbove !== null;
  }
  if (nested) return null;

  const prefixLen = cursorOffset - from;
  const prefix = cursorLineText.slice(tokenFromInLine, tokenFromInLine + prefixLen);
  return { marker: info.marker, prefix, from, to };
}
