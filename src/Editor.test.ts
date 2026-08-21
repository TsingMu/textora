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
  formatJsonFencePlan,
  markdownFenceAutoCloseCommand,
  markdownFenceAutoCloseFallbackExtension,
  markdownFenceAutoCloseSpec,
} from "./Editor";
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

describe("formatJsonFencePlan", () => {
  function stateWith(doc: string, cursorOffset: number) {
    return EditorState.create({ doc, selection: EditorSelection.cursor(cursorOffset) });
  }

  it("reformats a closed json fence content with 2-space indentation", () => {
    const doc = '```json\n{"a": 1}\n```';
    const cursor = doc.indexOf("\n") + 1;
    const result = formatJsonFencePlan(stateWith(doc, cursor));

    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    const next = stateWith(doc, cursor).update(result.spec).state;

    expect(next.doc.toString()).toBe('```json\n{\n  "a": 1\n}\n```');
    expect(next.selection.main.from).toBe(cursor);
  });

  it("normalizes compact and messy json to canonical 2-space form", () => {
    const doc = '```json\n{"b":[1,2,3]}\n```';
    const cursor = doc.indexOf("[");
    const result = formatJsonFencePlan(stateWith(doc, cursor));

    expect(result.kind).toBe("apply");
    if (result.kind !== "apply") return;
    const next = stateWith(doc, cursor).update(result.spec).state;

    expect(next.doc.toString()).toContain('  "b": [');
    expect(next.doc.toString()).toContain('    1,');
  });

  it("recognizes an uppercase JSON info token", () => {
    const doc = '```JSON\n{}\n```';
    const cursor = doc.indexOf("{}");
    const result = formatJsonFencePlan(stateWith(doc, cursor));
    expect(result.kind).toBe("apply");
  });

  it("returns invalid-json without changing the document on parse failure", () => {
    const doc = '```json\n{bad}\n```';
    const cursor = doc.indexOf("{bad");
    const state = stateWith(doc, cursor);
    const result = formatJsonFencePlan(state);

    expect(result.kind).toBe("invalid-json");
    expect(state.doc.toString()).toBe(doc);
  });

  it("returns no-context for an unclosed fence", () => {
    const doc = '```json\n{}';
    const cursor = doc.indexOf("{}");
    expect(formatJsonFencePlan(stateWith(doc, cursor)).kind).toBe("no-context");
  });

  it("returns no-context for jsonc, unknown languages and plain text", () => {
    const jsonc = '```jsonc\n{}\n```';
    expect(formatJsonFencePlan(stateWith(jsonc, jsonc.indexOf("{}"))).kind).toBe("no-context");

    const rust = '```rust\nfn main() {}\n```';
    expect(formatJsonFencePlan(stateWith(rust, rust.indexOf("fn"))).kind).toBe("no-context");

    const plain = "just text";
    expect(formatJsonFencePlan(stateWith(plain, 2)).kind).toBe("no-context");
  });

  it("returns no-context when the cursor is on a fence marker line", () => {
    const doc = '```json\n{}\n```';
    expect(formatJsonFencePlan(stateWith(doc, 0)).kind).toBe("no-context");
    expect(formatJsonFencePlan(stateWith(doc, doc.lastIndexOf("```"))).kind).toBe("no-context");
  });

  it("commits as a single undoable transaction", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const doc = '```json\n{"a": 1}\n```';
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(doc.indexOf("\n") + 1),
        extensions: [history()],
      }),
    });

    try {
      const result = formatJsonFencePlan(view.state);
      expect(result.kind).toBe("apply");
      if (result.kind === "apply") {
        view.dispatch(result.spec);
      }
      expect(view.state.doc.toString()).toBe('```json\n{\n  "a": 1\n}\n```');
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
      host.remove();
    }
  });
});
