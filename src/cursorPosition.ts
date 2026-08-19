/**
 * 状态栏光标行列位置：主选择 `head` 的 1-based 逻辑行与 Unicode 显示列。
 *
 * 显示列规则（见 docs/features/editor-column-ruler-and-cursor-position.md）：
 * - Tab 推进到下一个 `tabSize` 制表位（编辑器默认 4，行首 Tab 后为第 5 列）；
 * - East Asian Wide/Fullwidth 及 emoji 展示簇占 2 列，其余字素簇占 1 列；
 * - 组合标记、变体选择符与 ZWJ 属于所在字素簇，不单独增加列宽；
 * - 无法分类时安全按 1 列处理。emoji 默认呈现按「高位 emoji 区间（≥ U+1F000）与
 *   BMP `Emoji_Presentation` 展示集（⌚、♿ 等）为展示态」判定；其余低位符号 emoji
 *   （如 ☺）无 VS16 时按 1 列。
 */

/** 1-based 逻辑行与显示列。 */
export type CursorPosition = { line: number; column: number };

/** `Intl.Segmenter` 的最小结构（TS lib ES2020 未内置其类型）。 */
type GraphemeSegmenterLike = {
  segment(input: string): Iterable<{ segment: string; index: number }>;
};

const graphemeSegmenter: GraphemeSegmenterLike | null =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new (
        Intl as unknown as {
          Segmenter: new (
            locale: string,
            options: { granularity: "grapheme" },
          ) => GraphemeSegmenterLike;
        }
      ).Segmenter("en", { granularity: "grapheme" })
    : null;

// 组合标记（\p{M}）、零宽连接/非连接符、零宽空格与变体选择符不计列宽。
const zeroWidthPattern = /[\p{M}\u{200B}-\u{200D}\u{FE00}-\u{FE0F}]/u;

const wideCodePointRanges: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // 谚文字母
  [0x2e80, 0x303e], // CJK 部首、符号与注音
  [0x3041, 0x33ff], // 平假名、片假名与 CJK 兼容
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 统一表意
  [0xa000, 0xa4cf], // 彝文
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3], // 谚文音节
  [0xf900, 0xfaff], // CJK 兼容表意
  [0xfe10, 0xfe19], // 竖排形式
  [0xfe30, 0xfe6f], // CJK 兼容形式
  [0xff00, 0xff60], // 全角形式
  [0xffe0, 0xffe6],
  [0x1f000, 0x1faff], // 高位 emoji 区间（默认展示态）
  [0x20000, 0x3fffd], // CJK 扩展 B 及以后
  // BMP Emoji_Presentation 展示集（默认 emoji 呈现，无 VS16 也占 2 列）。
  [0x231a, 0x231b], // ⌚ ⌛
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f], // ♿
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
];

function isWideCodePoint(codePoint: number): boolean {
  return wideCodePointRanges.some(([low, high]) => codePoint >= low && codePoint <= high);
}

type GraphemeCluster = { segment: string; from: number; to: number };

function* graphemeClusters(text: string): Generator<GraphemeCluster> {
  if (graphemeSegmenter !== null) {
    for (const { segment, index } of graphemeSegmenter.segment(text)) {
      yield { segment, from: index, to: index + segment.length };
    }
    return;
  }
  // 无 Intl.Segmenter 环境的安全退化：按码点近似分簇。
  let offset = 0;
  for (const character of text) {
    yield { segment: character, from: offset, to: offset + character.length };
    offset += character.length;
  }
}

function clusterDisplayWidth(cluster: string): number {
  let forcedWidth: number | null = null;
  let hasWideBase = false;
  let sawBase = false;
  for (const character of cluster) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0xfe0e) {
      forcedWidth = 1; // VS15 强制文本呈现
      continue;
    }
    if (codePoint === 0xfe0f) {
      forcedWidth = 2; // VS16 强制 emoji 呈现
      continue;
    }
    if (zeroWidthPattern.test(character)) {
      continue;
    }
    sawBase = true;
    if (isWideCodePoint(codePoint)) {
      hasWideBase = true;
    }
  }
  if (!sawBase) {
    // 纯零宽字素（ZWSP、ZWJ/ZWNJ、孤立组合标记或变体选择符残段）不占列。
    return 0;
  }
  return forcedWidth ?? (hasWideBase ? 2 : 1);
}

/** 文本中的字素簇、UTF-16 范围及其显示列宽，供位置计算与编辑器视觉单元格共享。 */
export function* graphemeDisplaySegments(text: string): Generator<
  GraphemeCluster & { width: number }
> {
  for (const cluster of graphemeClusters(text)) {
    yield { ...cluster, width: clusterDisplayWidth(cluster.segment) };
  }
}

/** 计算 `prefix`（head 之前的行内文本）末尾所在的 1-based 显示列。 */
export function displayColumnBefore(prefix: string, tabSize: number): number {
  let column = 1;
  for (const cluster of graphemeDisplaySegments(prefix)) {
    if (cluster.segment === "\t") {
      column += tabSize - ((column - 1) % tabSize);
      continue;
    }
    column += cluster.width;
  }
  return column;
}

/** 由编辑器状态事实派生主选择 head 的 1-based 逻辑行与显示列。 */
export function cursorPositionFromFacts(options: {
  lineNumber: number;
  lineText: string;
  /** head 在该行内的 0-based UTF-16 偏移。 */
  headOffsetInLine: number;
  tabSize: number;
}): CursorPosition {
  return {
    line: options.lineNumber,
    column: displayColumnBefore(
      options.lineText.slice(0, options.headOffsetInLine),
      options.tabSize,
    ),
  };
}
