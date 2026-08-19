import { basicSetup } from "codemirror";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  type ChangeSpec,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import {
  type Command,
  crosshairCursor,
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  rectangularSelection,
  type ViewUpdate,
  ViewPlugin,
} from "@codemirror/view";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { acceptCompletion, closeCompletion } from "@codemirror/autocomplete";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { safeLanguageExtension } from "./languageExtensions";
import type { LanguageMode } from "./languageRecognition";
import {
  cursorPositionFromFacts,
  graphemeDisplaySegments,
  type CursorPosition,
} from "./cursorPosition";
import {
  ColumnRuler,
  type ColumnRulerMetrics,
} from "./columnRuler";
import { unclosedOpeningFromLineSource, fenceContextAt, classifyFenceLine } from "./markdownFenceContext";
import { markdownFenceLanguageCompletion } from "./markdownFenceLanguageCompletion";

type EditorProps = {
  content: string;
  disabled?: boolean;
  language: LanguageMode;
  onChange: (content: string) => void;
  /** 源码区主动滚动时回调当前顶部可见源码行（0-based）；无法确定时为 `null`。 */
  onScroll?: (topLine: number | null) => void;
  /** 主选择 head 的 1-based 行列快照；挂载与选择/文档变化时通知，同值去重，卸载时为 `null`。 */
  onCursorPosition?: (position: CursorPosition | null) => void;
  /** 是否软换行；`false` 时每个逻辑行保持单行并允许横向滚动。只改变显示，不改文档。 */
  wordWrapEnabled?: boolean;
};

export type EditorHandle = {
  fillColumnBlockSequence: () => boolean;
  formatJsonFence: () => JsonFenceFormatResult | { kind: "unavailable" };
  /** 程序滚动源码编辑区到指定 0-based 行的起始位置（预览→源码同步滚动使用）。 */
  scrollToSourceLine: (line: number) => void;
};

type ColumnBlockDeleteDirection = "backward" | "forward";
type ColumnBlockPastePlan =
  | { kind: "apply"; spec: TransactionSpec }
  | { kind: "reject" };

/** fenced JSON 格式化计划结果；`unavailable` 仅由 Editor 句柄在非 Markdown 或无视图时返回。 */
export type JsonFenceFormatResult =
  | { kind: "apply"; spec: TransactionSpec }
  | { kind: "no-context" }
  | { kind: "invalid-json" };

function clipboardLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const withoutFinalLineBreak = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;
  return withoutFinalLineBreak.split("\n");
}

export function columnBlockDeleteSpec(
  state: EditorState,
  direction: ColumnBlockDeleteDirection,
): TransactionSpec | null {
  const ranges = state.selection.ranges;
  if (ranges.length < 2) {
    return null;
  }

  const edits: { change: ChangeSpec; cursor: number }[] = [];
  const seen = new Set<string>();
  for (const range of ranges) {
    let from = range.from;
    let to = range.to;

    if (range.empty) {
      const line = state.doc.lineAt(range.from);
      if (direction === "backward") {
        if (range.from <= line.from) {
          continue;
        }
        from = range.from - 1;
        to = range.from;
      } else {
        if (range.from >= line.to) {
          continue;
        }
        from = range.from;
        to = range.from + 1;
      }
    }

    if (from === to) {
      continue;
    }

    const key = `${from}:${to}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    edits.push({ change: { from, to }, cursor: from });
  }

  if (edits.length === 0) {
    return null;
  }

  const changes = edits.map((edit) => edit.change);
  const changeSet = state.changes(changes);
  return {
    changes,
    selection: EditorSelection.create(
      edits.map((edit) =>
        EditorSelection.cursor(changeSet.mapPos(edit.cursor, -1)),
      ),
    ),
    scrollIntoView: true,
    userEvent: direction === "backward" ? "delete.backward" : "delete.forward",
  };
}

export function columnBlockDeleteCommand(
  direction: ColumnBlockDeleteDirection,
): Command {
  return (view) => {
    const spec = columnBlockDeleteSpec(view.state, direction);
    if (spec === null) {
      return false;
    }
    view.dispatch(spec);
    return true;
  };
}

export function columnBlockPastePlan(
  state: EditorState,
  text: string,
): ColumnBlockPastePlan | null {
  const ranges = state.selection.ranges;
  if (ranges.length < 2 || text.length === 0) {
    return null;
  }

  const hasLineBreak = /\r|\n/.test(text);
  const inserts = hasLineBreak
    ? clipboardLines(text)
    : Array.from({ length: ranges.length }, () => text);
  if (inserts.length !== ranges.length) {
    return { kind: "reject" };
  }

  const changes = ranges.map((range, index) => ({
    from: range.from,
    to: range.to,
    insert: inserts[index],
  }));
  const changeSet = state.changes(changes);
  return {
    kind: "apply",
    spec: {
      changes,
      selection: EditorSelection.create(
        ranges.map((range, index) =>
          EditorSelection.cursor(
            changeSet.mapPos(range.from, -1) + inserts[index].length,
          ),
        ),
      ),
      scrollIntoView: true,
      userEvent: "input.paste",
    },
  };
}

export function columnBlockPasteCommand(view: EditorView, text: string): boolean {
  const plan = columnBlockPastePlan(view.state, text);
  if (plan === null) {
    return false;
  }
  if (plan.kind === "reject") {
    return true;
  }
  view.dispatch(plan.spec);
  return true;
}

export function columnBlockSequenceSpec(
  state: EditorState,
): TransactionSpec | null {
  const ranges = state.selection.ranges;
  if (ranges.length < 2) {
    return null;
  }

  const width = String(ranges.length).length;
  const inserts = ranges.map((_range, index) =>
    String(index + 1).padStart(width, "0"),
  );
  const changes = ranges.map((range, index) => ({
    from: range.from,
    to: range.to,
    insert: inserts[index],
  }));
  const changeSet = state.changes(changes);
  return {
    changes,
    selection: EditorSelection.create(
      ranges.map((range, index) =>
        EditorSelection.cursor(
          changeSet.mapPos(range.from, -1) + inserts[index].length,
        ),
      ),
    ),
    scrollIntoView: true,
    userEvent: "input.sequence",
  };
}

export const columnBlockSequenceCommand: Command = (view) => {
  const spec = columnBlockSequenceSpec(view.state);
  if (spec === null) {
    return false;
  }
  view.dispatch(spec);
  return true;
};

/**
 * 用 Markdown 语法树判定当前行是否应触发 opening fence 自动闭合。返回三态：
 * - `true`：当前行是一个未闭合 opening（树节点 `FencedCode` 起于本行且只有一个 `CodeMark`），应自动闭合；
 * - `false`：当前行处于既有代码块内容中，或本行 opening 已有 closing（两个 `CodeMark`），不应自动闭合；
 * - `null`：光标区尚未解析或树中无 `FencedCode`（如未加载 Markdown 语言），调用方应回退到文本扫描。
 *
 * 利用 lezer-markdown 的结构：闭合的 fenced block 为 `FencedCode(CodeMark, CodeInfo, CodeText, CodeMark)`，
 * 未闭合为 `FencedCode(CodeMark, CodeInfo, CodeText)`（只有一个 `CodeMark`）；外层代码块内的 fence-like 行
 * 属于其 `CodeText`，对应 `FencedCode.from` 落在当前行之前。查询是 O(树深)，不随文档大小增长。
 */
export function fenceAutoCloseDecisionFromTree(
  state: EditorState,
  line: { from: number; to: number },
): boolean | null {
  const tree = syntaxTree(state);
  // 光标区尚未解析时无法信任树判定，交回退路径处理。
  if (tree.length < line.to) return null;
  // 光标在行末，向左解析才能取到以该位置结束的 CodeInfo/CodeMark；
  // 向右 bias 在 EOF 会落到 Document，使文末 opening 被误判为无树上下文。
  let node = tree.resolveInner(line.to, -1);
  while (node.name !== "FencedCode" && node.parent !== null) {
    node = node.parent;
  }
  if (node.name !== "FencedCode") return null;
  // 若 FencedCode 起点不在当前行，说明当前行是外层代码块的内容。
  if (node.from < line.from) return false;
  let marks = 0;
  const cursor = node.cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.name === "CodeMark") marks++;
    } while (cursor.nextSibling());
  }
  // 两个 CodeMark = 已闭合 → 不重复闭合。
  if (marks >= 2) return false;
  // 只有当树已覆盖文档末尾，才能由「只有一个 CodeMark」推断下方确实无 closing。
  // 否则树可能只是尚未解析到较远的 closing，必须交回退路径处理。
  return tree.length >= state.doc.length ? true : null;
}

/**
 * 构造 Markdown opening fence 自动闭合事务：单一空光标位于未闭合 opening fence 行末时，插入
 * 空内容行和匹配 closing（复制 opening 的字符/长度/缩进），光标停在空内容行。其他情况返回 null，
 * 由调用方交回默认 Enter；自动闭合通过单次事务提交，可一次撤销。
 *
 * 性能：优先用 Markdown 语法树（`FencedCode`/`CodeMark`）在有界耗时内判定，避免遍历整篇大文档；
 * 当光标区尚未解析或未加载 Markdown 语言时，回退到基于 `doc.line(n)` 的文本扫描（无界但始终正确）。
 * 光标不在行末或当前行非 fence 时仅取当前行即提前返回。
 */
export function markdownFenceAutoCloseSpec(state: EditorState): TransactionSpec | null {
  const ranges = state.selection.ranges;
  if (ranges.length !== 1 || !ranges[0].empty) {
    return null;
  }
  const offset = ranges[0].from;
  const line = state.doc.lineAt(offset);
  // `line.to` 是该行换行前的偏移（末行等于文档长度），光标必须恰在其上才算「行末」。
  if (offset !== line.to) {
    return null;
  }
  const info = classifyFenceLine(line.text);
  if (info === null) {
    return null;
  }

  const fromTree = fenceAutoCloseDecisionFromTree(state, line);
  if (fromTree === false) {
    return null;
  }
  if (fromTree !== true) {
    // 树未给出结论（光标区未解析或无 Markdown 语言）：回退到文本扫描，保证语义正确。
    const opening = unclosedOpeningFromLineSource(
      state.doc.lines,
      (n) => state.doc.line(n).text,
      line.number,
    );
    if (opening === null) {
      return null;
    }
  }

  const closingLine = " ".repeat(info.indent) + info.marker.repeat(info.length);
  return {
    changes: { from: offset, to: offset, insert: "\n\n" + closingLine },
    selection: EditorSelection.cursor(offset + 1),
    scrollIntoView: true,
    userEvent: "input.newline",
  };
}

/**
 * Enter 自动闭合命令。命中 Markdown opening fence 自动闭合条件则提交事务并返回 true，否则返回 false
 * 让默认 Enter 接管，保留列块多选与普通编辑的既有换行行为。命令不按文件语言提前退出：
 * 即使当前标签被识别为 Plain Text、JSON 或其他源码语言，只要用户明确输入了 Markdown fence，也按写作辅助补齐。
 */
export function markdownFenceAutoCloseCommand(_language: () => LanguageMode): Command {
  return (view) => {
    const spec = markdownFenceAutoCloseSpec(view.state);
    if (spec === null) {
      return false;
    }
    view.dispatch(spec);
    return true;
  };
}

/**
 * 兜底拦截普通换行事务：真实 WebView/Markdown 语言扩展路径中，Enter 有时会先走默认换行而不是命中
 * 高优先级 keymap。只要换行前状态已经位于未闭合 opening fence 行末，就把该默认换行改写成与命令路径相同
 * 的自动闭合事务，保证 Markdown 文档、Plain Text 和其他源码语言表现一致。
 */
export const markdownFenceAutoCloseFallbackExtension = EditorState.transactionFilter.of(
  (transaction) => {
    if (!transaction.isUserEvent("input.newline")) {
      return transaction;
    }
    const spec = markdownFenceAutoCloseSpec(transaction.startState);
    return spec ?? transaction;
  },
);

/**
 * 构造 fenced JSON 显式格式化计划：光标位于闭合 `json` fenced code block 内容区时，用浏览器内建
 * `JSON.parse`/`JSON.stringify(value, null, 2)` 把整个代码块内容替换为 2 空格缩进的标准 JSON，
 * 单次事务可一次撤销，光标映射到内容区起始。光标不在闭合 json 内容区返回 `no-context`；解析失败
 * 返回 `invalid-json`；二者都不改源码、选择或撤销历史。`jsonc`、`application/json` 与未知 token 不匹配。
 */
export function formatJsonFencePlan(state: EditorState): JsonFenceFormatResult {
  const offset = state.selection.main.from;
  const text = state.doc.toString();
  const ctx = fenceContextAt(text, offset);
  if (ctx === null || ctx.closing === null || ctx.infoToken !== "json") {
    return { kind: "no-context" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text.slice(ctx.content.from, ctx.content.to));
  } catch {
    return { kind: "invalid-json" };
  }
  const formatted = `${JSON.stringify(value, null, 2)}\n`;
  return {
    kind: "apply",
    spec: {
      changes: { from: ctx.content.from, to: ctx.content.to, insert: formatted },
      selection: EditorSelection.cursor(ctx.content.from),
      scrollIntoView: true,
      userEvent: "format.json",
    },
  };
}

export const columnBlockSelectionExtensions: Extension = [
  EditorState.allowMultipleSelections.of(true),
  rectangularSelection(),
  crosshairCursor(),
  EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData("text/plain");
      if (text === undefined) {
        return false;
      }
      const handled = columnBlockPasteCommand(view, text);
      if (handled) {
        event.preventDefault();
      }
      return handled;
    },
  }),
  Prec.high(
    keymap.of([
      { key: "Backspace", run: columnBlockDeleteCommand("backward") },
      { key: "Delete", run: columnBlockDeleteCommand("forward") },
      { key: "Mod-Alt-n", run: columnBlockSequenceCommand },
    ]),
  ),
];

/**
 * Markdown opening fence 候选确认的 Tab 绑定。`acceptCompletion` 在无活动候选时返回 false，自然落回默认 Tab
 * 行为；候选打开时与 Enter（由 `basicSetup` 的 `completionKeymapExt` 在 `Prec.highest` 绑定）一致确认候选。
 */
const markdownFenceLanguageAcceptKeymap: Extension = Prec.high(
  keymap.of([{ key: "Tab", run: acceptCompletion }]),
);

/**
 * 按活动标签的 {@link LanguageMode} 派生 language compartment 内容：挂对应 CodeMirror 语言扩展；Markdown
 * 额外挂 opening fence 语言候选 completion 与 Tab 确认键。非 Markdown 不挂候选，保证只在 Markdown 源码
 * （含 Preview 左侧）启用，WYSIWYG 使用独立编辑器组件不受影响。
 */
function editorExtensionsForLanguage(language: LanguageMode): Extension {
  const languageExtension = safeLanguageExtension(language);
  const extensions: Extension[] = [];
  if (languageExtension !== null) {
    extensions.push(languageExtension);
  }
  if (language === "markdown") {
    extensions.push(markdownFenceLanguageCompletion, markdownFenceLanguageAcceptKeymap);
  }
  return extensions;
}

/** 软换行扩展内容：开启装 `EditorView.lineWrapping`，关闭装空扩展（横向滚动）。 */
function wordWrapExtensionFor(enabled: boolean): Extension {
  return enabled ? EditorView.lineWrapping : [];
}

const wideDisplayClusterMark = Decoration.mark({
  class: "cm-wide-display-cluster",
});

/**
 * 将逻辑宽度为 2 的完整字素簇放进两个 `ch` 的视觉单元格。macOS 的 CJK/emoji
 * 回退字体通常不是主等宽字体 advance 的精确两倍；只靠字体栈会使逻辑列与标尺漂移。
 */
function wideDisplayClusterDecorations(view: EditorView): DecorationSet {
  const ranges: ReturnType<typeof wideDisplayClusterMark.range>[] = [];
  for (const visibleRange of view.visibleRanges) {
    const text = view.state.doc.sliceString(visibleRange.from, visibleRange.to);
    for (const cluster of graphemeDisplaySegments(text)) {
      if (cluster.width === 2) {
        ranges.push(
          wideDisplayClusterMark.range(
            visibleRange.from + cluster.from,
            visibleRange.from + cluster.to,
          ),
        );
      }
    }
  }
  return Decoration.set(ranges, true);
}

const wideDisplayClusterCells = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = wideDisplayClusterDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = wideDisplayClusterDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * 从 CodeMirror 实际布局测量列标尺度量：字符宽取编辑器默认字符宽度，第 1 列位置由
 * 当前可见逻辑行的实际行首插入坐标与滚动容器矩形差 + 当前 `scrollLeft` 得出（含
 * gutter、内容及行元素左内边距）。
 * 不可测量（零字符宽或零可视宽，如无布局环境）时返回 `null`。
 */
function measureColumnRulerMetrics(view: EditorView): ColumnRulerMetrics | null {
  const scrollerRect = view.scrollDOM.getBoundingClientRect();
  const charWidth = view.defaultCharacterWidth;
  if (!(charWidth > 0) || !(scrollerRect.width > 0)) {
    return null;
  }
  const visibleLineStart = view.state.doc.lineAt(view.viewport.from).from;
  const insertionCoords = view.coordsAtPos(visibleLineStart);
  if (insertionCoords === null) {
    return null;
  }
  return {
    charWidth,
    originLeft:
      insertionCoords.left - scrollerRect.left + view.scrollDOM.scrollLeft,
    scrollLeft: view.scrollDOM.scrollLeft,
    visibleWidth: scrollerRect.width,
  };
}

export const textoraSyntaxHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syntax-keyword)" },
  { tag: [tags.atom, tags.bool, tags.number], color: "var(--syntax-atom)" },
  { tag: [tags.string, tags.inserted], color: "var(--syntax-string)" },
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  {
    tag: [
      tags.variableName,
      tags.definition(tags.variableName),
      tags.propertyName,
      tags.typeName,
      tags.labelName,
    ],
    color: "var(--syntax-variable)",
  },
  { tag: [tags.function(tags.variableName), tags.className], color: "var(--syntax-function)" },
  {
    tag: [tags.operator, tags.punctuation, tags.meta],
    color: "var(--syntax-punctuation)",
  },
  { tag: [tags.invalid, tags.deleted], color: "var(--syntax-invalid)" },
]);

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { content, disabled = false, language, onChange, onScroll, onCursorPosition, wordWrapEnabled = true },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onScrollRef = useRef(onScroll);
  const onCursorPositionRef = useRef(onCursorPosition);
  const viewRef = useRef<EditorView | null>(null);
  const isSyncingContentRef = useRef(false);
  const lastPositionKeyRef = useRef<string | null>(null);
  const [rulerMetrics, setRulerMetrics] = useState<ColumnRulerMetrics | null>(
    null,
  );
  const availabilityRef = useRef(new Compartment());
  const languageCompartmentRef = useRef(new Compartment());
  const wordWrapCompartmentRef = useRef(new Compartment());
  const languageRef = useRef(language);
  const wordWrapAppliedRef = useRef(wordWrapEnabled);

  onChangeRef.current = onChange;
  onScrollRef.current = onScroll;
  onCursorPositionRef.current = onCursorPosition;
  languageRef.current = language;

  // 状态栏行列快照：只从当前编辑器状态派生；同值不重复通知，避免无关更新触发 React 状态写入。
  function reportCursorPosition(state: EditorState) {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    const position = cursorPositionFromFacts({
      lineNumber: line.number,
      lineText: line.text,
      headOffsetInLine: head - line.from,
      tabSize: state.tabSize,
    });
    const key = `${position.line}:${position.column}`;
    if (lastPositionKeyRef.current === key) {
      return;
    }
    lastPositionKeyRef.current = key;
    onCursorPositionRef.current?.(position);
  }

  useImperativeHandle(ref, () => ({
    fillColumnBlockSequence() {
      const view = viewRef.current;
      if (view === null) {
        return false;
      }
      return columnBlockSequenceCommand(view);
    },
    formatJsonFence() {
      const view = viewRef.current;
      if (view === null || languageRef.current !== "markdown") {
        return { kind: "unavailable" as const };
      }
      const result = formatJsonFencePlan(view.state);
      if (result.kind === "apply") {
        view.dispatch(result.spec);
      }
      return result;
    },
    scrollToSourceLine(line: number) {
      const view = viewRef.current;
      if (view === null) {
        return;
      }
      const doc = view.state.doc;
      const lineNumber = Math.max(1, Math.min(doc.lines, line + 1));
      const pos = doc.line(lineNumber).from;
      view.dispatch({
        effects: EditorView.scrollIntoView(pos, { y: "start" }),
      });
    },
  }));

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        syntaxHighlighting(textoraSyntaxHighlightStyle),
        wideDisplayClusterCells,
        columnBlockSelectionExtensions,
        markdownFenceAutoCloseFallbackExtension,
        Prec.high(
          keymap.of([
            { key: "Enter", run: markdownFenceAutoCloseCommand(() => languageRef.current) },
          ]),
        ),
        languageCompartmentRef.current.of(editorExtensionsForLanguage(language)),
        availabilityRef.current.of([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        wordWrapCompartmentRef.current.of(wordWrapExtensionFor(wordWrapEnabled)),
        EditorView.contentAttributes.of({
          "aria-label": "Text editor",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isSyncingContentRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            reportCursorPosition(update.state);
          }
          if (update.viewportChanged) {
            const topLine = update.state.doc.lineAt(update.view.viewport.from).number - 1;
            onScrollRef.current?.(topLine);
          }
        }),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": {
            fontFamily:
              '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
            fontSize: "13px",
            lineHeight: "1.65",
          },
          ".cm-content": { padding: "20px 4px 40px" },
          ".cm-gutters": {
            backgroundColor: "transparent",
            borderRight: "1px solid var(--border-subtle)",
          },
          "&.cm-focused": { outline: "none" },
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    // 挂载即报告初始位置，供状态栏直接显示当前选择。
    reportCursorPosition(view.state);

    // 源码区主动滚动时计算顶部可见源码行（0-based）并回调；节流交给调用方（App 的 rAF）。
    const handleScroll = () => {
      let topLine: number | null = null;
      try {
        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
        const line = view.state.doc.lineAt(Math.max(0, block.from));
        topLine = line.number - 1;
      } catch {
        topLine = null;
      }
      onScrollRef.current?.(topLine);
    };
    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      viewRef.current = null;
      view.destroy();
      // 卸载时清除调用方持有的陈旧位置（如进入 WYSIWYG）。
      lastPositionKeyRef.current = null;
      onCursorPositionRef.current?.(null);
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: availabilityRef.current.reconfigure([
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled),
      ]),
    });
    // 转入只读/忙碌时关闭活动候选，防止已打开的弹层被（鼠标）确认写入只读文档。
    if (disabled) {
      closeCompletion(view);
    }
  }, [disabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) {
      return;
    }

    isSyncingContentRef.current = true;
    try {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: content,
        },
      });
      view.focus();
    } finally {
      isSyncingContentRef.current = false;
    }
  }, [content]);

  // 语言扩展随活动标签的 LanguageMode 重配置；普通文本/加载失败时不挂任何语言扩展。
  // Markdown 额外挂 opening fence 语言候选 completion 与 Tab 确认键。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: languageCompartmentRef.current.reconfigure(
        editorExtensionsForLanguage(language),
      ),
    });
  }, [language]);

  // 软换行偏好只通过 compartment 重配生效：不重建编辑器、不改内容/撤销/选区；同值跳过，
  // 避免挂载后与初值相同的重复重配事务。
  useEffect(() => {
    const view = viewRef.current;
    if (!view || wordWrapAppliedRef.current === wordWrapEnabled) {
      return;
    }
    wordWrapAppliedRef.current = wordWrapEnabled;
    view.dispatch({
      effects: wordWrapCompartmentRef.current.reconfigure(
        wordWrapExtensionFor(wordWrapEnabled),
      ),
    });
  }, [wordWrapEnabled]);

  // 列标尺：只在关闭软换行时测量并显示；水平滚动与容器尺寸变化（窗口缩放、分栏、字体
  // 度量）后重新对齐。gutter 固定，`originLeft` 只随布局变化，不随滚动漂移。
  useEffect(() => {
    const view = viewRef.current;
    if (!view || wordWrapEnabled) {
      return;
    }
    const remeasure = () => {
      setRulerMetrics(measureColumnRulerMetrics(view));
    };
    remeasure();
    view.scrollDOM.addEventListener("scroll", remeasure, { passive: true });
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(remeasure) : null;
    observer?.observe(view.scrollDOM);
    // 行号 gutter 在行数位数变化（9→10、99→100 行）时改变宽度：gutter 在 scroller
    // 内部，不改变 scroller 尺寸，必须单独观察才能重算第 1 列的 `originLeft`。
    const gutterElement = view.scrollDOM.querySelector(".cm-gutters");
    if (gutterElement !== null) {
      observer?.observe(gutterElement);
    }
    return () => {
      view.scrollDOM.removeEventListener("scroll", remeasure);
      observer?.disconnect();
      setRulerMetrics(null);
    };
  }, [wordWrapEnabled]);

  return (
    <div
      className={`editor-with-ruler${wordWrapEnabled ? "" : " has-column-ruler"}`}
    >
      {!wordWrapEnabled && <ColumnRuler metrics={rulerMetrics} />}
      <div className="editor-host" ref={hostRef} />
    </div>
  );
});
