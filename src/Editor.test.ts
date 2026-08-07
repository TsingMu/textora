// @vitest-environment jsdom

import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  columnBlockDeleteCommand,
  columnBlockDeleteSpec,
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
});
