// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { markdownOrderedListDeletion } from "./markdownOrderedList";

function state(doc: string) {
  return EditorState.create({ doc, extensions: [markdown(), markdownOrderedListDeletion] });
}
function remove(doc: string, text: string, event = "delete.selection") {
  const from = doc.indexOf(text);
  if (from < 0) throw new Error("missing deletion text");
  return state(doc).update({ changes: { from, to: from + text.length }, userEvent: event }).newDoc.toString();
}

describe("Markdown ordered list deletion", () => {
  it("renumbers the screenshot sequence in the source, preserving all content", () => {
    const doc = "### 环境\n\n1. 搭建XC基础环境。\n2. 删除项\n3. 在原DB2环境开启归档日志\n4. 对数据量较大的表\n5. 结合其他经验\n\n**完成标准**";
    expect(remove(doc, "2. 删除项\n")).toBe(doc.replace("2. 删除项\n", "")
      .replace("3. 在原", "2. 在原").replace("4. 对数据", "3. 对数据").replace("5. 结合", "4. 结合"));
  });
  it.each([
    ["1. a\n", "1. b\n2. c"],
    ["2. b\n", "1. a\n2. c"],
    ["\n3. c", "1. a\n2. b"],
    ["1. a\n2. b\n", "1. c"],
  ])("handles deleting first, middle, last or multiple items: %s", (deleted, expected) => {
    expect(remove("1. a\n2. b\n3. c", deleted)).toBe(expected);
  });
  it("also closes existing gaps in the affected list after a deletion", () => {
    expect(remove("1. a\n3. b\n4. c\n5. d", "3. b\n")).toBe("1. a\n2. c\n3. d");
  });
  it("preserves non-one starts, delimiters, whitespace and width changes", () => {
    expect(remove("8) a\n9) b\n10)  c\n11)\td", "9) b\n")).toBe("8) a\n9)  c\n10)\td");
  });
  it("renumbers nested and quote lists independently", () => {
    const doc = "1. outer\n   1. inner\n   2. delete\n   3. last\n2. outer2\n\n> 1. x\n> 2. y\n> 3. z";
    expect(remove(doc, "   2. delete\n")).toBe(doc.replace("   2. delete\n", "").replace("   3. last", "   2. last"));
    expect(remove(doc, "> 2. y\n")).toBe(doc.replace("> 2. y\n", "").replace("> 3. z", "> 2. z"));
    expect(remove(doc, "1. outer\n   1. inner\n   2. delete\n   3. last\n")).toBe("1. outer2\n\n> 1. x\n> 2. y\n> 3. z");
  });
  it("keeps multiline paragraphs and nested content unchanged", () => {
    expect(remove("1. a\n   continuation\n2. b\n   - nested\n3. c\n   more", "2. b\n   - nested\n"))
      .toBe("1. a\n   continuation\n2. c\n   more");
  });
  it("does not normalize non-increasing numbering, all-one numbering, paste or loading", () => {
    expect(remove("3. a\n1. b\n2. c", "1. b\n")).toBe("3. a\n2. c");
    expect(remove("1. a\n1. b\n1. c", "1. b\n")).toBe("1. a\n1. c");
    expect(remove("1. a\n2. b\n3. c", "2. b\n", "input.paste")).toBe("1. a\n3. c");
    expect(state("1. a\n3. c").doc.toString()).toBe("1. a\n3. c");
  });
  it("does not renumber deleting only item text, partial markers, or newlines", () => {
    expect(remove("1. a\n2. b\n3. c", "b")).toBe("1. a\n2. \n3. c");
    expect(remove("1. a\n2. b\n3. c", "2")).toBe("1. a\n. b\n3. c");
    expect(remove("1. a\n2. b\n3. c", "\n")).toBe("1. a2. b\n3. c");
  });
  it("leaves code blocks, indented code, and unrelated lists alone", () => {
    const doc = "```md\n1. a\n2. b\n3. c\n```\n\n1. d\n2. e\n3. f";
    expect(remove(doc, "2. b\n")).toBe(doc.replace("2. b\n", ""));
    expect(remove("    1. a\n    2. b\n    3. c", "    2. b\n")).toBe("    1. a\n    3. c");
    expect(remove(doc, "2. e\n")).toBe(doc.replace("2. e\n", "").replace("3. f", "2. f"));
  });
  it("does not renumber a list merged with another list during deletion", () => {
    const doc = "1. a\n2. b\n\nheading\n\n1. x\n2. y";
    expect(remove(doc, "2. b\n\nheading\n\n")).toBe("1. a\n1. x\n2. y");
  });
  it("maps the cursor with renumbering and returns a single transaction", () => {
    const doc = "8. a\n9. b\n10. c\n11. d";
    const from = doc.indexOf("9.");
    const tr = state(doc).update({ changes: { from, to: doc.indexOf("10.") },
      selection: { anchor: doc.indexOf("d") - "9. b\n".length }, userEvent: "delete.selection" });
    expect(tr.newDoc.toString()).toBe("8. a\n9. c\n10. d");
    expect(tr.state.selection.main.head).toBe(tr.newDoc.toString().indexOf("d"));
    expect(tr.annotation(Transaction.userEvent)).toBe("delete.selection");
  });
  it("does not change column block deletion", () => {
    const doc = "1. a\n2. b\n3. c";
    const s = EditorState.create({ doc, extensions: [markdown(), markdownOrderedListDeletion,
      EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)]) });
    expect(s.update({ changes: { from: 5, to: 10 }, userEvent: "delete.selection" }).newDoc.toString()).toBe("1. a\n3. c");
  });
  it("undoes and redoes deletion with the renumbering in one step", () => {
    const view = new EditorView({ state: EditorState.create({ doc: "1. a\n2. b\n3. c",
      extensions: [markdown(), markdownOrderedListDeletion, history()] }) });
    try {
      view.dispatch({ changes: { from: 5, to: 10 }, userEvent: "delete.selection" });
      expect(view.state.doc.toString()).toBe("1. a\n2. c");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("1. a\n2. b\n3. c");
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe("1. a\n2. c");
    } finally { view.destroy(); }
  });
});
