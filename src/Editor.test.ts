// @vitest-environment jsdom

import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  columnBlockDeleteCommand,
  columnBlockDeleteSpec,
  columnBlockPasteCommand,
  columnBlockPastePlan,
  columnBlockSequenceCommand,
  columnBlockSequenceSpec,
  columnBlockSelectionExtensions,
} from "./Editor";

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
