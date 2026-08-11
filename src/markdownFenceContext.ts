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
