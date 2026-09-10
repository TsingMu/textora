// @vitest-environment jsdom

import { basicSetup } from "codemirror";
import { Compartment, EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  columnBlockDeleteCommand,
  columnBlockDeleteSpec,
  columnBlockPasteCommand,
  columnBlockPastePlan,
  columnBlockSequenceCommand,
  columnBlockSequenceSpec,
  columnBlockSelectionExtensions,
  fenceAutoCloseDecisionFromTree,
  formatFenceInEditorView,
  markdownFenceAutoCloseCommand,
  markdownFenceAutoCloseFallbackExtension,
  markdownFenceAutoCloseSpec,
} from "./Editor";
import {
  executeFenceFormat,
  FENCE_FORMAT_MAX_CHARS,
  inspectFenceFormatTarget,
} from "./fenceFormatting";
import { languageExtension } from "./languageExtensions";

if (!("getClientRects" in Range.prototype)) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

describe("column block selection editor extensions", () => {
  it("allows multiple selection ranges for rectangular column blocks", () => {
    const state = EditorState.create({
      doc: "alpha\nbravo\ncharlie",
      extensions: columnBlockSelectionExtensions,
    });

    const next = state.update({
      selection: EditorSelection.create([
        EditorSelection.range(1, 3),
        EditorSelection.range(7, 9),
      ]),
    }).state;

    expect(next.selection.ranges).toHaveLength(2);
    expect(next.selection.ranges.map((range) => [range.from, range.to])).toEqual(
      [
        [1, 3],
        [7, 9],
      ],
    );
  });

  it("deletes every non-empty column block range", () => {
    const state = EditorState.create({
      doc: "abcde\nABCDE\n12345",
      selection: EditorSelection.create([
        EditorSelection.range(1, 3),
        EditorSelection.range(7, 9),
      ]),
      extensions: columnBlockSelectionExtensions,
    });

    const spec = columnBlockDeleteSpec(state, "forward");
    expect(spec).not.toBeNull();
    const next = state.update(spec!).state;

    expect(next.doc.toString()).toBe("ade\nADE\n12345");
    expect(next.selection.ranges.map((range) => range.from)).toEqual([1, 5]);
  });

  it("deletes characters at every column block cursor without merging lines", () => {
    const state = EditorState.create({
      doc: "abc\nxy\nz",
      selection: EditorSelection.create([
        EditorSelection.cursor(1),
        EditorSelection.cursor(5),
        EditorSelection.cursor(8),
      ]),
      extensions: columnBlockSelectionExtensions,
    });

    const spec = columnBlockDeleteSpec(state, "forward");
    expect(spec).not.toBeNull();
    const next = state.update(spec!).state;

    expect(next.doc.toString()).toBe("ac\nx\nz");
    expect(next.selection.ranges.map((range) => range.from)).toEqual([1, 4]);
  });

  it("keeps column block deletion undoable", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "abcde\nABCDE",
        selection: EditorSelection.create([
          EditorSelection.range(1, 3),
          EditorSelection.range(7, 9),
        ]),
        extensions: [history(), columnBlockSelectionExtensions],
      }),
    });

    try {
      expect(columnBlockDeleteCommand("forward")(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("ade\nADE");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("abcde\nABCDE");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("pastes a single clipboard line into every column block range", () => {
    const state = EditorState.create({
      doc: "abef\nABEF",
      selection: EditorSelection.create([
        EditorSelection.range(2, 2),
        EditorSelection.range(7, 7),
      ]),
      extensions: columnBlockSelectionExtensions,
    });

    const plan = columnBlockPastePlan(state, "cd");
    if (plan?.kind !== "apply") {
      throw new Error("expected column block paste to apply");
    }
    const next = state.update(plan.spec).state;

    expect(next.doc.toString()).toBe("abcdef\nABcdEF");
    expect(next.selection.ranges.map((range) => range.from)).toEqual([4, 11]);
  });

  it("pastes matching clipboard lines into matching column block ranges", () => {
    const state = EditorState.create({
      doc: "abXXef\nABXXEF",
      selection: EditorSelection.create([
        EditorSelection.range(2, 4),
        EditorSelection.range(9, 11),
      ]),
      extensions: columnBlockSelectionExtensions,
    });

    const plan = columnBlockPastePlan(state, "cd\nCD\n");
    if (plan?.kind !== "apply") {
      throw new Error("expected column block paste to apply");
    }
    const next = state.update(plan.spec).state;

    expect(next.doc.toString()).toBe("abcdef\nABCDEF");
    expect(next.selection.ranges.map((range) => range.from)).toEqual([4, 11]);
  });

  it("rejects mismatched multiline column block paste without changing the document", () => {
    const state = EditorState.create({
      doc: "abXXef\nABXXEF\n12XX56",
      selection: EditorSelection.create([
        EditorSelection.range(2, 4),
        EditorSelection.range(9, 11),
        EditorSelection.range(16, 18),
      ]),
      extensions: columnBlockSelectionExtensions,
    });

    const plan = columnBlockPastePlan(state, "cd\nCD");

    expect(plan).toEqual({ kind: "reject" });
    expect(state.doc.toString()).toBe("abXXef\nABXXEF\n12XX56");
  });

  it("keeps column block paste undoable", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "abef\nABEF",
        selection: EditorSelection.create([
          EditorSelection.range(2, 2),
          EditorSelection.range(7, 7),
        ]),
        extensions: [history(), columnBlockSelectionExtensions],
      }),
    });

    try {
      expect(columnBlockPasteCommand(view, "cd")).toBe(true);
      expect(view.state.doc.toString()).toBe("abcdef\nABcdEF");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("abef\nABEF");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("fills a column block cursor selection with a decimal sequence", () => {
    const state = EditorState.create({
      doc: "row\nrow\nrow",
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(4),
        EditorSelection.cursor(8),
      ]),
      extensions: columnBlockSelectionExtensions,
    });

    const spec = columnBlockSequenceSpec(state);
    expect(spec).not.toBeNull();
    const next = state.update(spec!).state;

    expect(next.doc.toString()).toBe("1row\n2row\n3row");
    expect(next.selection.ranges.map((range) => range.from)).toEqual([1, 6, 11]);
  });

  it("replaces every selected column block range with a decimal sequence", () => {
    const state = EditorState.create({
      doc: "xx-item\nxx-item\nxx-item",
      selection: EditorSelection.create([
        EditorSelection.range(0, 2),
        EditorSelection.range(8, 10),
        EditorSelection.range(16, 18),
      ]),
      extensions: columnBlockSelectionExtensions,
    });

    const spec = columnBlockSequenceSpec(state);
    expect(spec).not.toBeNull();
    const next = state.update(spec!).state;

    expect(next.doc.toString()).toBe("1-item\n2-item\n3-item");
    expect(next.selection.ranges.map((range) => range.from)).toEqual([1, 8, 15]);
  });

  it("pads a decimal sequence to the width of the final value", () => {
    const doc = Array.from({ length: 10 }, () => "xx").join("\n");
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create(
        Array.from({ length: 10 }, (_value, index) =>
          EditorSelection.range(index * 3, index * 3 + 2),
        ),
      ),
      extensions: columnBlockSelectionExtensions,
    });

    const spec = columnBlockSequenceSpec(state);
    expect(spec).not.toBeNull();
    const next = state.update(spec!).state;

    expect(next.doc.toString()).toBe("01\n02\n03\n04\n05\n06\n07\n08\n09\n10");
  });

  it("keeps column block sequence fill undoable", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "row\nrow\nrow",
        selection: EditorSelection.create([
          EditorSelection.cursor(0),
          EditorSelection.cursor(4),
          EditorSelection.cursor(8),
        ]),
        extensions: [history(), columnBlockSelectionExtensions],
      }),
    });

    try {
      expect(columnBlockSequenceCommand(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("1row\n2row\n3row");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("row\nrow\nrow");
    } finally {
      view.destroy();
      host.remove();
    }
  });
});

// 语法高亮与列块编辑同时启用时的回归保护：语言扩展不得破坏多选区、列块删除/粘贴/
// 数字序列，也不得让撤销栈在高亮重配置后失效（docs/features/code-syntax-highlighting.md
// 切片 4）。
describe("column block editing under syntax highlighting", () => {
  const highlightedExtensions: Extension[] = [
    languageExtension("typescript")!,
    columnBlockSelectionExtensions,
  ];

  it("keeps multiple selection ranges with a language extension active", () => {
    const state = EditorState.create({
      doc: "alpha\nbravo\ncharlie",
      extensions: highlightedExtensions,
    });

    const next = state.update({
      selection: EditorSelection.create([
        EditorSelection.range(1, 3),
        EditorSelection.range(7, 9),
      ]),
    }).state;

    expect(next.selection.ranges).toHaveLength(2);
    expect(next.selection.ranges.map((range) => [range.from, range.to])).toEqual([
      [1, 3],
      [7, 9],
    ]);
  });

  it("deletes every column block range with a language extension active", () => {
    const state = EditorState.create({
      doc: "abcde\nABCDE\n12345",
      selection: EditorSelection.create([
        EditorSelection.range(1, 3),
        EditorSelection.range(7, 9),
      ]),
      extensions: highlightedExtensions,
    });

    const spec = columnBlockDeleteSpec(state, "forward");
    expect(spec).not.toBeNull();
    const next = state.update(spec!).state;

    expect(next.doc.toString()).toBe("ade\nADE\n12345");
    expect(next.selection.ranges.map((range) => range.from)).toEqual([1, 5]);
  });

  it("pastes into every column block range with a language extension active", () => {
    const state = EditorState.create({
      doc: "abef\nABEF",
      selection: EditorSelection.create([
        EditorSelection.range(2, 2),
        EditorSelection.range(7, 7),
      ]),
      extensions: highlightedExtensions,
    });

    const plan = columnBlockPastePlan(state, "cd");
    if (plan?.kind !== "apply") {
      throw new Error("expected column block paste to apply");
    }
    const next = state.update(plan.spec).state;

    expect(next.doc.toString()).toBe("abcdef\nABcdEF");
    expect(next.selection.ranges.map((range) => range.from)).toEqual([4, 11]);
  });

  it("fills and undoes a decimal sequence with a language extension active", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "row\nrow\nrow",
        selection: EditorSelection.create([
          EditorSelection.cursor(0),
          EditorSelection.cursor(4),
          EditorSelection.cursor(8),
        ]),
        extensions: [history(), ...highlightedExtensions],
      }),
    });

    try {
      expect(columnBlockSequenceCommand(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("1row\n2row\n3row");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("row\nrow\nrow");
    } finally {
      view.destroy();
      host.remove();
    }
  });
});

describe("markdown fence auto-close", () => {
  it("inserts an empty content line and a matching closing fence at an unclosed opening", () => {
    const state = EditorState.create({
      doc: "```json",
      selection: EditorSelection.cursor(7),
    });

    const spec = markdownFenceAutoCloseSpec(state);
    expect(spec).not.toBeNull();
    const next = state.update(spec!).state;

    expect(next.doc.toString()).toBe("```json\n\n```");
    expect(next.selection.main.from).toBe(8);
  });

  it("replicates the opening marker, length and indent in the closing fence", () => {
    const state = EditorState.create({
      doc: "  ~~~~ts",
      selection: EditorSelection.cursor(8),
    });

    const spec = markdownFenceAutoCloseSpec(state);
    expect(spec).not.toBeNull();
    const next = state.update(spec!).state;

    expect(next.doc.toString()).toBe("  ~~~~ts\n\n  ~~~~");
    expect(next.selection.main.from).toBe(9);
  });

  it("returns null when the opening already has a matching closing", () => {
    const state = EditorState.create({
      doc: "```json\n{}\n```",
      selection: EditorSelection.cursor(7),
    });
    expect(markdownFenceAutoCloseSpec(state)).toBeNull();
  });

  it("returns null for a non-empty selection, multiple cursors or a non-line-end cursor", () => {
    const ranged = EditorState.create({
      doc: "```json",
      selection: EditorSelection.range(0, 3),
    });
    expect(markdownFenceAutoCloseSpec(ranged)).toBeNull();

    const multi = EditorState.create({
      doc: "```json",
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.cursor(7),
      ]),
    });
    expect(markdownFenceAutoCloseSpec(multi)).toBeNull();

    const midLine = EditorState.create({
      doc: "```json",
      selection: EditorSelection.cursor(3),
    });
    expect(markdownFenceAutoCloseSpec(midLine)).toBeNull();
  });

  it("commits as a single undoable transaction via the markdown command", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "```json",
        selection: EditorSelection.cursor(7),
        extensions: [history()],
      }),
    });

    try {
      expect(markdownFenceAutoCloseCommand(() => "markdown")(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("```json\n\n```");
      expect(view.state.selection.main.from).toBe(8);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("```json");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("also auto-closes markdown-like fences in plain text documents", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "```json",
        selection: EditorSelection.cursor(7),
        extensions: [history()],
      }),
    });

    try {
      expect(markdownFenceAutoCloseCommand(() => "plain-text")(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("```json\n\n```");
      expect(view.state.selection.main.from).toBe(8);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("```json");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("handles a real Enter key event after a markdown opening fence with an info string", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "```json",
        selection: EditorSelection.cursor(7),
        extensions: [
          basicSetup,
          Prec.high(
            keymap.of([
              { key: "Enter", run: markdownFenceAutoCloseCommand(() => "markdown") },
            ]),
          ),
          new Compartment().of(languageExtension("markdown") ?? []),
          keymap.of([...defaultKeymap, ...historyKeymap]),
        ],
      }),
    });

    try {
      const event = new KeyboardEvent("keydown", { key: "Enter" });
      expect(runScopeHandlers(view, event, "editor")).toBe(true);
      expect(view.state.doc.toString()).toBe("```json\n\n```");
      expect(view.state.selection.main.from).toBe(8);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("```json");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("rewrites a default newline transaction after an opening fence in markdown mode", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "```json",
        selection: EditorSelection.cursor(7),
        extensions: [
          history(),
          markdownFenceAutoCloseFallbackExtension,
          languageExtension("markdown") ?? [],
        ],
      }),
    });

    try {
      view.dispatch({
        changes: { from: 7, insert: "\n" },
        selection: EditorSelection.cursor(8),
        userEvent: "input.newline",
      });
      expect(view.state.doc.toString()).toBe("```json\n\n```");
      expect(view.state.selection.main.from).toBe(8);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("```json");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("also auto-closes markdown-like fences in code language documents", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "```json",
        selection: EditorSelection.cursor(7),
        extensions: [history()],
      }),
    });

    try {
      expect(markdownFenceAutoCloseCommand(() => "json")(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("```json\n\n```");
      expect(view.state.selection.main.from).toBe(8);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("```json");
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("does not auto-close on a normal line in a large document", () => {
    const lineText = "the quick brown fox jumps";
    const lineLength = lineText.length;
    const doc = Array.from({ length: 2000 }, () => lineText).join("\n");
    // 光标在第 1000 行（0-based 999）行末：偏移 = 999*(L+1)+L。
    const offset = 999 * (lineLength + 1) + lineLength;
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(offset),
    });

    // 普通行：classifyFenceLine 当前行即返回 null，不应触发自动闭合，也不应因文档大而异常。
    expect(markdownFenceAutoCloseSpec(state)).toBeNull();
    expect(state.doc.toString()).toBe(doc);
  });

  it("does not auto-close when the opening-like line is inside another unclosed fence", () => {
    // 第 1 行 ```` 打开未闭合代码块；第 2 行 ```json 是其内容，不是新 opening。
    const doc = "```\n```json";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
    });

    expect(markdownFenceAutoCloseSpec(state)).toBeNull();
    expect(state.doc.toString()).toBe(doc);
  });

  it("still auto-closes when a shorter same-marker line below is not a valid closing", () => {
    // opening 4 个反引号；下方 3 个反引号短于 opening，不是 closing。
    const doc = "````\n```";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(4),
    });

    const spec = markdownFenceAutoCloseSpec(state);
    expect(spec).not.toBeNull();
    if (spec === null) return;
    const next = state.update(spec).state;
    expect(next.doc.toString()).toBe("````\n\n````\n```");
    expect(next.selection.main.from).toBe(5);
  });

  it("auto-closes an opening fence at the end of a large document via the syntax tree", () => {
    const normal = "plain text line";
    const above = 5000;
    const doc =
      Array.from({ length: above }, () => normal).join("\n") + "\n```json";
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.length),
        extensions: [markdown()],
      }),
    });

    try {
      // forceParsing 会把解析结果提交回 EditorView.state；ensureSyntaxTree 只返回一棵树，
      // 无法证明 markdownFenceAutoCloseSpec 真的走了语法树路径。
      expect(forceParsing(view, doc.length, 5000)).toBe(true);
      const line = view.state.doc.lineAt(doc.length);
      // 直接锁定 EOF 语法树路径：旧实现会因要求 doc.length + 1 而返回 null。
      expect(fenceAutoCloseDecisionFromTree(view.state, line)).toBe(true);

      const spec = markdownFenceAutoCloseSpec(view.state);
      expect(spec).not.toBeNull();
      if (spec === null) return;
      const next = view.state.update(spec).state;
      expect(next.doc.toString().endsWith("```json\n\n```")).toBe(true);
      expect(next.selection.main.from).toBe(doc.length + 1);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("auto-closes immediately after typing an opening fence at EOF", () => {
    const initialDoc = Array.from({ length: 5000 }, () => "plain text line").join("\n");
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialDoc,
        selection: EditorSelection.cursor(initialDoc.length),
        extensions: [markdown()],
      }),
    });

    try {
      expect(forceParsing(view, initialDoc.length, 5000)).toBe(true);
      view.dispatch({
        changes: { from: initialDoc.length, insert: "\n```json" },
        selection: EditorSelection.cursor(initialDoc.length + "\n```json".length),
      });
      // 增量解析是否在同一调度片内追上 EOF 受 CodeMirror 解析预算影响；这里锁定真实
      // 用户行为。树已追上时走语法树路径，尚未追上时按契约回退文本扫描，均应闭合。
      expect(markdownFenceAutoCloseSpec(view.state)).not.toBeNull();
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("does not auto-close a fence-like line that sits inside an existing unclosed fence", () => {
    // 外层 ``` 打开未闭合代码块；第 2 行 ```json 是其内容，不是新 opening。
    const doc = "```\n```json\n";
    const cursor = doc.indexOf("```json") + "```json".length;
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(cursor),
        extensions: [markdown()],
      }),
    });

    try {
      expect(forceParsing(view, doc.length, 1000)).toBe(true);
      expect(
        fenceAutoCloseDecisionFromTree(view.state, view.state.doc.lineAt(cursor)),
      ).toBe(false);
      expect(markdownFenceAutoCloseSpec(view.state)).toBeNull();
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("does not duplicate a closing fence when one already exists below the opening", () => {
    const doc = "```json\n{}\n```";
    const cursor = doc.indexOf("\n");
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(cursor),
        extensions: [markdown()],
      }),
    });

    try {
      expect(forceParsing(view, doc.length, 1000)).toBe(true);
      expect(
        fenceAutoCloseDecisionFromTree(view.state, view.state.doc.lineAt(cursor)),
      ).toBe(false);
      expect(markdownFenceAutoCloseSpec(view.state)).toBeNull();
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
      host.remove();
    }
  });
});

describe("inspectFenceFormatTarget", () => {
  it("returns a json target for a closed json fence content", () => {
    const doc = '```json\n{"a": 1}\n```';
    const cursor = doc.indexOf("\n") + 1;
    const result = inspectFenceFormatTarget(doc, cursor);

    expect(result).toEqual({
      kind: "target",
      language: "json",
      displayName: "JSON",
      content: '{"a": 1}\n',
      contentFrom: cursor,
      contentTo: doc.lastIndexOf("```"),
    });
  });

  it("recognizes an uppercase JSON info token", () => {
    const doc = '```JSON\n{}\n```';
    expect(inspectFenceFormatTarget(doc, doc.indexOf("{}")).kind).toBe("target");
  });

  it("returns unsupported-language for jsonc, other languages and empty info", () => {
    const jsonc = '```jsonc\n{}\n```';
    expect(inspectFenceFormatTarget(jsonc, jsonc.indexOf("{}"))).toEqual({
      kind: "unsupported-language",
      language: "jsonc",
    });

    const rust = '```rust\nfn main() {}\n```';
    expect(inspectFenceFormatTarget(rust, rust.indexOf("fn"))).toEqual({
      kind: "unsupported-language",
      language: "rust",
    });

    const unlabeled = '```\n{}\n```';
    expect(inspectFenceFormatTarget(unlabeled, unlabeled.indexOf("{}"))).toEqual({
      kind: "unsupported-language",
      language: "",
    });
  });

  it("returns no-context for an unclosed fence, fence marker lines and plain text", () => {
    const unclosed = '```json\n{}';
    expect(inspectFenceFormatTarget(unclosed, unclosed.indexOf("{}")).kind).toBe(
      "no-context",
    );

    const closed = '```json\n{}\n```';
    expect(inspectFenceFormatTarget(closed, 0).kind).toBe("no-context");
    expect(inspectFenceFormatTarget(closed, closed.lastIndexOf("```")).kind).toBe(
      "no-context",
    );

    expect(inspectFenceFormatTarget("just text", 2).kind).toBe("no-context");
  });

  it("returns too-large when the block content exceeds the character cap", () => {
    const doc = '```json\n{"a":"' + "x".repeat(FENCE_FORMAT_MAX_CHARS) + '"}\n```';
    expect(inspectFenceFormatTarget(doc, doc.indexOf("{"))).toEqual({
      kind: "too-large",
      language: "json",
    });
  });
});

describe("executeFenceFormat", () => {
  function jsonTarget(doc: string, cursor: number) {
    const target = inspectFenceFormatTarget(doc, cursor);
    expect(target.kind).toBe("target");
    return target as Extract<typeof target, { kind: "target" }>;
  }

  it("formats compact json to canonical 2-space form at the original range", async () => {
    const doc = '```json\n{"b":[1,2,3]}\n```';
    const target = jsonTarget(doc, doc.indexOf("["));
    const outcome = await executeFenceFormat(target, doc, () => ({
      text: doc,
      cursor: doc.indexOf("["),
    }));

    expect(outcome.kind).toBe("applied");
    if (outcome.kind !== "applied") return;
    expect(outcome.formatted).toBe('{\n  "b": [\n    1,\n    2,\n    3\n  ]\n}\n');
    expect(outcome.contentFrom).toBe(target.contentFrom);
    expect(outcome.contentTo).toBe(target.contentTo);
    expect(outcome.language).toBe("json");
  });

  it("returns invalid-content without changes when the json does not parse", async () => {
    const doc = '```json\n{bad}\n```';
    const target = jsonTarget(doc, doc.indexOf("{bad"));
    const outcome = await executeFenceFormat(target, doc, () => ({
      text: doc,
      cursor: doc.indexOf("{bad"),
    }));

    expect(outcome).toEqual({
      kind: "invalid-content",
      language: "json",
      displayName: "JSON",
    });
  });

  it("applies at the shifted range when text was inserted above an unchanged block", async () => {
    const doc = '```json\n{"a": 1}\n```';
    const target = jsonTarget(doc, doc.indexOf("\n") + 1);
    const currentText = `# title\n\n${doc}`;
    const cursor = currentText.indexOf('{"a": 1}');
    const outcome = await executeFenceFormat(target, doc, () => ({
      text: currentText,
      cursor,
    }));

    expect(outcome.kind).toBe("applied");
    if (outcome.kind !== "applied") return;
    expect(outcome.contentFrom).toBe(currentText.indexOf('{"a": 1}'));
    expect(outcome.contentTo).toBe(outcome.contentFrom + '{"a": 1}\n'.length);
  });

  it("aborts with changed-during-format when the cursor lands in a different or invalid context", async () => {
    const doc = '```json\n{"a": 1}\n```';
    const target = jsonTarget(doc, doc.indexOf("\n") + 1);

    const edited = '```json\n{"a": 2}\n```';
    expect(
      await executeFenceFormat(target, doc, () => ({ text: edited, cursor: edited.indexOf("{") })),
    ).toEqual({ kind: "changed-during-format" });

    const outside = `text\n\n${doc}`;
    expect(
      await executeFenceFormat(target, doc, () => ({ text: outside, cursor: 0 })),
    ).toEqual({ kind: "changed-during-format" });
  });
});

describe("prettier fence formatting (JavaScript, TypeScript, YAML)", () => {
  function fenceTarget(doc: string, contentProbe: string) {
    const target = inspectFenceFormatTarget(doc, doc.indexOf(contentProbe));
    expect(target.kind).toBe("target");
    return target as Extract<typeof target, { kind: "target" }>;
  }

  async function formattedOf(doc: string, contentProbe: string) {
    const target = fenceTarget(doc, contentProbe);
    const outcome = await executeFenceFormat(target, doc, () => ({
      text: doc,
      cursor: doc.indexOf(contentProbe),
    }));
    expect(outcome.kind).toBe("applied");
    if (outcome.kind !== "applied") throw new Error("unreachable");
    expect(outcome.contentFrom).toBe(target.contentFrom);
    expect(outcome.contentTo).toBe(target.contentTo);
    return { language: outcome.language, formatted: outcome.formatted };
  }

  it("maps every registered prettier alias to its language family entry", () => {
    const aliasCases: Array<[alias: string, displayName: string]> = [
      ...(["js", "javascript", "jsx", "mjs", "cjs", "node"] as const).map(
        (alias): [string, string] => [alias, "JavaScript"],
      ),
      ...(["ts", "typescript", "tsx"] as const).map(
        (alias): [string, string] => [alias, "TypeScript"],
      ),
      ...(["yaml", "yml"] as const).map((alias): [string, string] => [alias, "YAML"]),
    ];
    for (const [alias, displayName] of aliasCases) {
      const doc = `\`\`\`${alias}\nplaceholder\n\`\`\``;
      expect(inspectFenceFormatTarget(doc, doc.indexOf("placeholder"))).toMatchObject({
        kind: "target",
        language: alias,
        displayName,
      });
    }

    const upper = "```YAML\nkey: value\n```";
    expect(
      inspectFenceFormatTarget(upper, upper.indexOf("key")),
    ).toMatchObject({ kind: "target", language: "yaml" });
  });

  it("formats JavaScript fences deterministically with the pinned style", async () => {
    await expect(
      formattedOf("```js\nfunction f( a,b ){return a+b}\n```", "function"),
    ).resolves.toEqual({
      language: "js",
      formatted: "function f(a, b) {\n  return a + b;\n}\n",
    });

    await expect(
      formattedOf("```jsx\nconst el=<div  className='x'>{a}</div>\n```", "const el"),
    ).resolves.toEqual({
      language: "jsx",
      formatted: 'const el = <div className="x">{a}</div>;\n',
    });
  });

  it("formats TypeScript fences deterministically with the pinned style", async () => {
    await expect(
      formattedOf("```ts\ninterface  Point {x:number;y:number}\n```", "interface"),
    ).resolves.toEqual({
      language: "ts",
      formatted: "interface Point {\n  x: number;\n  y: number;\n}\n",
    });
  });

  it("formats YAML fences deterministically with the pinned style", async () => {
    await expect(formattedOf("```yaml\na:   1\nb:\n- 2\n```", "a:")).resolves.toEqual({
      language: "yaml",
      formatted: "a: 1\nb:\n  - 2\n",
    });

    await expect(
      formattedOf(
        "```yml\nserver:\n    host: localhost\n    port:   8080\n```",
        "server:",
      ),
    ).resolves.toEqual({
      language: "yml",
      formatted: "server:\n  host: localhost\n  port: 8080\n",
    });
  });

  it("returns invalid-content for syntax errors in each prettier language", async () => {
    const cases: Array<[doc: string, probe: string, language: string, displayName: string]> = [
      ["```js\nconst a={\n```", "const a", "js", "JavaScript"],
      ["```ts\nlet x: = 1\n```", "let x", "ts", "TypeScript"],
      ["```yaml\nkey: [1, 2\n```", "key", "yaml", "YAML"],
    ];
    for (const [doc, probe, language, displayName] of cases) {
      const target = fenceTarget(doc, probe);
      await expect(
        executeFenceFormat(target, doc, () => ({ text: doc, cursor: doc.indexOf(probe) })),
      ).resolves.toEqual({ kind: "invalid-content", language, displayName });
    }
  });
});

describe("sql-formatter fence formatting (SQL dialects)", () => {
  function fenceTarget(doc: string, contentProbe: string) {
    const target = inspectFenceFormatTarget(doc, doc.indexOf(contentProbe));
    expect(target.kind).toBe("target");
    return target as Extract<typeof target, { kind: "target" }>;
  }

  async function formattedOf(doc: string, contentProbe: string) {
    const target = fenceTarget(doc, contentProbe);
    const outcome = await executeFenceFormat(target, doc, () => ({
      text: doc,
      cursor: doc.indexOf(contentProbe),
    }));
    expect(outcome.kind).toBe("applied");
    if (outcome.kind !== "applied") throw new Error("unreachable");
    expect(outcome.contentFrom).toBe(target.contentFrom);
    expect(outcome.contentTo).toBe(target.contentTo);
    return { language: outcome.language, formatted: outcome.formatted };
  }

  it("maps every registered sql alias to the SQL registry entry", () => {
    const aliases = [
      "sql",
      "mysql",
      "mariadb",
      "postgres",
      "postgresql",
      "psql",
      "sqlite",
      "tsql",
      "transactsql",
      "bigquery",
    ];
    for (const alias of aliases) {
      const doc = `\`\`\`${alias}\nSELECT 1\n\`\`\``;
      expect(inspectFenceFormatTarget(doc, doc.indexOf("SELECT"))).toMatchObject({
        kind: "target",
        language: alias,
        displayName: "SQL",
      });
    }

    const upper = "```SQL\nSELECT 1\n```";
    expect(
      inspectFenceFormatTarget(upper, upper.indexOf("SELECT")),
    ).toMatchObject({ kind: "target", language: "sql" });
  });

  it("formats standard SQL fences deterministically with a trailing newline", async () => {
    await expect(
      formattedOf("```sql\nSELECT id,name FROM users\n```", "SELECT"),
    ).resolves.toEqual({
      language: "sql",
      formatted: "SELECT\n  id,\n  name\nFROM\n  users\n",
    });
  });

  it("formats dialect fences with dialect-specific token handling", async () => {
    await expect(
      formattedOf("```mysql\nSELECT `id`,`name` FROM `users`\n```", "SELECT"),
    ).resolves.toEqual({
      language: "mysql",
      formatted: "SELECT\n  `id`,\n  `name`\nFROM\n  `users`\n",
    });

    await expect(
      formattedOf(
        "```postgres\nSELECT id::text,age FROM users WHERE name='x'\n```",
        "SELECT",
      ),
    ).resolves.toEqual({
      language: "postgres",
      formatted:
        "SELECT\n  id::text,\n  age\nFROM\n  users\nWHERE\n  name = 'x'\n",
    });
  });

  it("returns invalid-content for unterminated literals without changing anything", async () => {
    const cases: Array<[doc: string, probe: string, language: string]> = [
      ["```sql\nSELECT 'abc\n```", "SELECT", "sql"],
      ['```postgresql\nSELECT "abc\n```', "SELECT", "postgresql"],
    ];
    for (const [doc, probe, language] of cases) {
      const target = fenceTarget(doc, probe);
      await expect(
        executeFenceFormat(target, doc, () => ({ text: doc, cursor: doc.indexOf(probe) })),
      ).resolves.toEqual({ kind: "invalid-content", language, displayName: "SQL" });
    }
  });
});

describe("shfmt fence formatting (Shell)", () => {
  function fenceTarget(doc: string, contentProbe: string) {
    const target = inspectFenceFormatTarget(doc, doc.indexOf(contentProbe));
    expect(target.kind).toBe("target");
    return target as Extract<typeof target, { kind: "target" }>;
  }

  async function formattedOf(doc: string, contentProbe: string) {
    const target = fenceTarget(doc, contentProbe);
    const outcome = await executeFenceFormat(target, doc, () => ({
      text: doc,
      cursor: doc.indexOf(contentProbe),
    }));
    expect(outcome.kind).toBe("applied");
    if (outcome.kind !== "applied") throw new Error("unreachable");
    expect(outcome.contentFrom).toBe(target.contentFrom);
    expect(outcome.contentTo).toBe(target.contentTo);
    return { language: outcome.language, formatted: outcome.formatted };
  }

  it("maps every registered shell alias to the Shell registry entry", () => {
    for (const alias of ["sh", "bash", "zsh", "shell", "shellscript"]) {
      const doc = `\`\`\`${alias}\necho hi\n\`\`\``;
      expect(inspectFenceFormatTarget(doc, doc.indexOf("echo"))).toMatchObject({
        kind: "target",
        language: alias,
        displayName: "Shell",
      });
    }

    const upper = "```BASH\necho hi\n```";
    expect(
      inspectFenceFormatTarget(upper, upper.indexOf("echo")),
    ).toMatchObject({ kind: "target", language: "bash" });
  });

  it("formats shell fences with 2-space indentation and no rewriting", async () => {
    await expect(
      formattedOf(
        "```sh\nfoo(){\necho a\nif [ $a ];then\necho b\nfi\n}\n```",
        "foo",
      ),
    ).resolves.toEqual({
      language: "sh",
      formatted: "foo() {\n  echo a\n  if [ $a ]; then\n    echo b\n  fi\n}\n",
    });

    await expect(
      formattedOf("```bash\ncat file|grep foo|wc -l\n```", "cat"),
    ).resolves.toEqual({
      language: "bash",
      formatted: "cat file | grep foo | wc -l\n",
    });
  });

  it("returns invalid-content for shell syntax errors without changing anything", async () => {
    const cases: Array<[doc: string, probe: string, language: string]> = [
      ["```sh\nif [ -f x then echo fi\n```", "if", "sh"],
      ['```bash\necho "unclosed\n```', "echo", "bash"],
    ];
    for (const [doc, probe, language] of cases) {
      const target = fenceTarget(doc, probe);
      await expect(
        executeFenceFormat(target, doc, () => ({ text: doc, cursor: doc.indexOf(probe) })),
      ).resolves.toEqual({ kind: "invalid-content", language, displayName: "Shell" });
    }
  });
});

describe("formatFenceInEditorView", () => {
  function viewWith(doc: string, cursorOffset: number, extensions: Extension[] = []) {
    const host = document.createElement("div");
    document.body.append(host);
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(cursorOffset),
        extensions,
      }),
    });
    return { view, host };
  }

  it("reformats a closed json fence content with 2-space indentation", async () => {
    const doc = '```json\n{"a": 1}\n```';
    const cursor = doc.indexOf("\n") + 1;
    const { view, host } = viewWith(doc, cursor);

    try {
      const result = await formatFenceInEditorView(view);
      expect(result).toBeNull();
      expect(view.state.doc.toString()).toBe('```json\n{\n  "a": 1\n}\n```');
      expect(view.state.selection.main.from).toBe(cursor);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("commits as a single undoable transaction", async () => {
    const doc = '```json\n{"a": 1}\n```';
    const cursor = doc.indexOf("\n") + 1;
    const { view, host } = viewWith(doc, cursor, [history()]);

    try {
      await formatFenceInEditorView(view);
      expect(view.state.doc.toString()).toBe('```json\n{\n  "a": 1\n}\n```');
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
      host.remove();
    }
  });

  it("leaves the document untouched for invalid json, unsupported languages and misplaced cursors", async () => {
    const invalid = '```json\n{bad}\n```';
    const invalidView = viewWith(invalid, invalid.indexOf("{bad"));
    try {
      expect(await formatFenceInEditorView(invalidView.view)).toEqual({
        kind: "invalid-content",
        language: "json",
        displayName: "JSON",
      });
      expect(invalidView.view.state.doc.toString()).toBe(invalid);
    } finally {
      invalidView.view.destroy();
      invalidView.host.remove();
    }

    const jsonc = '```jsonc\n{}\n```';
    const jsoncView = viewWith(jsonc, jsonc.indexOf("{}"));
    try {
      expect(await formatFenceInEditorView(jsoncView.view)).toEqual({
        kind: "unsupported-language",
        language: "jsonc",
      });
      expect(jsoncView.view.state.doc.toString()).toBe(jsonc);
    } finally {
      jsoncView.view.destroy();
      jsoncView.host.remove();
    }

    const fenceLine = '```json\n{}\n```';
    const fenceLineView = viewWith(fenceLine, 0);
    try {
      expect(await formatFenceInEditorView(fenceLineView.view)).toEqual({
        kind: "no-context",
      });
      expect(fenceLineView.view.state.doc.toString()).toBe(fenceLine);
    } finally {
      fenceLineView.view.destroy();
      fenceLineView.host.remove();
    }
  });
});
