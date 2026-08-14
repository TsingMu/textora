// 纯前端 Markdown 内联格式解析与源码往返契约。
// 节点模型只覆盖 WYSIWYG 首期需要的五类内联格式（粗体、斜体、删除线、行内代码、链接）
// 与普通文本。解析为确定性单遍扫描，遇到不完整、嵌套、交叉或边界不确定的输入时
// 保留字面源码，绝不丢字符或猜测修复；序列化优先逐字符保留原始标记，仅对已编辑
// 片段提供最小转义、code span 边界调整与空片段删除。

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; marker: "**" | "__"; text: string }
  | { type: "italic"; marker: "*" | "_"; text: string }
  | { type: "strike"; text: string }
  | { type: "code"; text: string; backticks: number }
  | { type: "link"; label: string; destination: string };

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

function isWordChar(value: string | undefined): boolean {
  return value !== undefined && WORD_CHAR.test(value);
}

function backtickRunLength(source: string, i: number): number {
  let n = 0;
  while (i + n < source.length && source[i + n] === "`") {
    n += 1;
  }
  return n;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      const run = backtickRunLength(text, i);
      if (run > longest) {
        longest = run;
      }
      i += run;
    } else {
      i += 1;
    }
  }
  return longest;
}

function isIntraword(source: string, pos: number, len: number): boolean {
  return isWordChar(source[pos - 1]) && isWordChar(source[pos + len]);
}

function findExact(source: string, from: number, marker: string): number {
  let i = from;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source.startsWith(marker, i)) {
      return i;
    }
    i += 1;
  }
  return -1;
}

function findBacktickRun(source: string, from: number, run: number): number {
  let i = from;
  while (i < source.length) {
    if (source[i] === "`") {
      const len = backtickRunLength(source, i);
      if (len === run) {
        return i;
      }
      i += len;
    } else {
      i += 1;
    }
  }
  return -1;
}

function findLone(source: string, from: number, ch: "*" | "_"): number {
  let i = from;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === ch) {
      if (source[i - 1] !== ch && source[i + 1] !== ch) {
        return i;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  return -1;
}

function containsNestedInlineSyntax(source: string): boolean {
  let i = 0;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += i + 1 < source.length ? 2 : 1;
      continue;
    }
    const c = source[i];
    if (c === "`") {
      const run = backtickRunLength(source, i);
      if (findBacktickRun(source, i + run, run) !== -1) {
        return true;
      }
      i += run;
      continue;
    }
    if (c === "[" && findSimpleLinkEnd(source, i) !== -1) {
      return true;
    }
    if (c === "~" && source[i + 1] === "~") {
      const close = findExact(source, i + 2, "~~");
      if (close > i + 2) {
        return true;
      }
      i += 2;
      continue;
    }
    const pair = source.slice(i, i + 2);
    if (pair === "**" || pair === "__") {
      if (!(pair === "__" && isIntraword(source, i, 2))) {
        const close = findExact(source, i + 2, pair);
        if (
          close > i + 2 &&
          !(pair === "__" && isIntraword(source, close, 2))
        ) {
          return true;
        }
      }
      i += 2;
      continue;
    }
    if (c === "*" || c === "_") {
      if (!(c === "_" && isIntraword(source, i, 1))) {
        const close = findLone(source, i + 1, c);
        if (
          close > i + 1 &&
          !(c === "_" && isIntraword(source, close, 1))
        ) {
          return true;
        }
      }
    }
    i += 1;
  }
  return false;
}

function findSimpleLinkEnd(source: string, i: number): number {
  let labelEnd = i + 1;
  while (labelEnd < source.length) {
    if (source[labelEnd] === "\\") {
      labelEnd += 2;
      continue;
    }
    if (source[labelEnd] === "]") {
      break;
    }
    labelEnd += 1;
  }
  if (source[labelEnd] !== "]" || source[labelEnd + 1] !== "(") {
    return -1;
  }
  let destinationEnd = labelEnd + 2;
  while (destinationEnd < source.length) {
    if (source[destinationEnd] === "\\") {
      destinationEnd += 2;
      continue;
    }
    if (source[destinationEnd] === "(") {
      return -1;
    }
    if (source[destinationEnd] === ")") {
      return destinationEnd;
    }
    destinationEnd += 1;
  }
  return -1;
}

function containsUnescapedWhitespace(source: string): boolean {
  let i = 0;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += i + 1 < source.length ? 2 : 1;
      continue;
    }
    if (/\s/.test(source[i] ?? "")) {
      return true;
    }
    i += 1;
  }
  return false;
}

function matchLink(
  source: string,
  i: number,
):
  | { kind: "link"; label: string; destination: string; next: number }
  | { kind: "literal"; next: number }
  | null {
  let j = i + 1;
  while (j < source.length) {
    if (source[j] === "\\") {
      j += 2;
      continue;
    }
    if (source[j] === "[") {
      return null;
    }
    if (source[j] === "]") {
      break;
    }
    j += 1;
  }
  if (j >= source.length || source[j] !== "]") {
    return null;
  }
  const label = source.slice(i + 1, j);
  if (label === "") {
    return null;
  }
  if (source[j + 1] !== "(") {
    return null;
  }
  let k = j + 2;
  while (k < source.length) {
    if (source[k] === "\\") {
      k += 2;
      continue;
    }
    if (source[k] === "(") {
      return null;
    }
    if (source[k] === ")") {
      break;
    }
    k += 1;
  }
  if (k >= source.length || source[k] !== ")") {
    return null;
  }
  const destination = source.slice(j + 2, k);
  if (
    containsNestedInlineSyntax(label) ||
    containsUnescapedWhitespace(destination)
  ) {
    return { kind: "literal", next: k + 1 };
  }
  return { kind: "link", label, destination, next: k + 1 };
}

export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let textStart = 0;
  let i = 0;

  const flushText = (end: number) => {
    if (end > textStart) {
      nodes.push({ type: "text", text: source.slice(textStart, end) });
    }
  };

  while (i < source.length) {
    const c = source[i];

    if (c === "\\") {
      i += i + 1 < source.length ? 2 : 1;
      continue;
    }

    if (c === "`") {
      const run = backtickRunLength(source, i);
      const close = findBacktickRun(source, i + run, run);
      if (close !== -1) {
        flushText(i);
        nodes.push({
          type: "code",
          text: source.slice(i + run, close),
          backticks: run,
        });
        i = close + run;
        textStart = i;
        continue;
      }
      i += run;
      continue;
    }

    if (c === "[") {
      const link = matchLink(source, i);
      if (link !== null) {
        flushText(i);
        if (link.kind === "link") {
          nodes.push({
            type: "link",
            label: link.label,
            destination: link.destination,
          });
        } else {
          nodes.push({ type: "text", text: source.slice(i, link.next) });
        }
        i = link.next;
        textStart = i;
        continue;
      }
      i += 1;
      continue;
    }

    if (c === "~" && source[i + 1] === "~") {
      const close = findExact(source, i + 2, "~~");
      if (close !== -1 && close > i + 2) {
        flushText(i);
        const text = source.slice(i + 2, close);
        nodes.push(
          containsNestedInlineSyntax(text)
            ? { type: "text", text: source.slice(i, close + 2) }
            : { type: "strike", text },
        );
        i = close + 2;
        textStart = i;
        continue;
      }
      i += 2;
      continue;
    }

    const pair = source.slice(i, i + 2);
    if (pair === "**" || pair === "__") {
      if (!(pair === "__" && isIntraword(source, i, 2))) {
        const close = findExact(source, i + 2, pair);
        if (
          close !== -1 &&
          close > i + 2 &&
          !(pair === "__" && isIntraword(source, close, 2))
        ) {
          flushText(i);
          const text = source.slice(i + 2, close);
          nodes.push(
            containsNestedInlineSyntax(text)
              ? { type: "text", text: source.slice(i, close + 2) }
              : { type: "bold", marker: pair, text },
          );
          i = close + 2;
          textStart = i;
          continue;
        }
      }
      i += 2;
      continue;
    }

    if (c === "*" || c === "_") {
      if (!(c === "_" && isIntraword(source, i, 1))) {
        const close = findLone(source, i + 1, c);
        if (
          close !== -1 &&
          !(c === "_" && isIntraword(source, close, 1))
        ) {
          flushText(i);
          const text = source.slice(i + 1, close);
          nodes.push(
            containsNestedInlineSyntax(text)
              ? { type: "text", text: source.slice(i, close + 1) }
              : { type: "italic", marker: c, text },
          );
          i = close + 1;
          textStart = i;
          continue;
        }
      }
      i += 1;
      continue;
    }

    i += 1;
  }

  flushText(source.length);
  return nodes;
}

export function serializeInline(nodes: readonly InlineNode[]): string {
  return nodes.map(serializeNode).join("");
}

function serializeNode(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "bold":
      return node.text === "" ? "" : `${node.marker}${node.text}${node.marker}`;
    case "italic":
      return node.text === "" ? "" : `${node.marker}${node.text}${node.marker}`;
    case "strike":
      return node.text === "" ? "" : `~~${node.text}~~`;
    case "code": {
      if (node.text === "") {
        return "";
      }
      const required = longestBacktickRun(node.text) + 1;
      const fence = Math.max(node.backticks, required);
      const delimiter = "`".repeat(fence);
      return `${delimiter}${node.text}${delimiter}`;
    }
    case "link":
      return node.label === "" ? "" : `[${node.label}](${node.destination})`;
  }
}

// 把用户可见的纯文本转成可安全序列化回 Markdown 的原始片段：转义会启动内联构造的字符。
export function escapeInlineText(text: string): string {
  return text.replace(/[\\`*_~[]/g, (ch) => `\\${ch}`);
}

export function escapeLinkLabel(text: string): string {
  return escapeInlineText(text).replace(/\]/g, "\\]");
}
