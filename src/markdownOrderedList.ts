import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

type Marker = { from: number; to: number; number: number; delimiter: string };

function markers(state: EditorState, list: SyntaxNode): Marker[] {
  const result: Marker[] = [];
  for (const item of list.getChildren("ListItem")) {
    const mark = item.getChild("ListMark");
    if (!mark) return [];
    const match = /^(\d{1,9})([.)])$/.exec(state.sliceDoc(mark.from, mark.to));
    if (!match) return [];
    result.push({ from: mark.from, to: mark.to, number: Number(match[1]), delimiter: match[2] });
  }
  return result;
}

/** Keep increasing source lists sequential after deleting items.
 * Never normalize a document on load, paste, text edits, undo or redo.
 */
export const markdownOrderedListDeletion = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged || !transaction.isUserEvent("delete") ||
    transaction.startState.selection.ranges.length !== 1) return transaction;

  const deletions: { from: number; to: number }[] = [];
  transaction.changes.iterChangedRanges((from, to, fromB, toB) => {
    if (to > from && fromB === toB) deletions.push({ from, to });
  });
  if (!deletions.some((range) => /\d+[.)]/.test(
    transaction.startState.sliceDoc(range.from, range.to)))) return transaction;
  // Syntax parsing is bounded. On incomplete large documents leave source intact.
  const before = ensureSyntaxTree(transaction.startState, transaction.startState.doc.length, 50);
  if (!before) return transaction;
  const changes: { from: number; to: number; insert: string }[] = [];
  let after: ReturnType<typeof ensureSyntaxTree> | undefined;
  before.iterate({
    enter(node) {
      if (!deletions.some((range) => range.from < node.to && range.to > node.from)) return false;
      if (node.name !== "OrderedList") return;
      const old = markers(transaction.startState, node.node);
      if (old.length < 2 || old.some((mark, i) => i > 0 && mark.number <= old[i - 1].number)) return;
      const removed = (mark: Marker) => deletions.some((range) =>
        range.from <= mark.from && range.to >= mark.to);
      if (!old.some(removed)) return;
      const survivors = old.filter((mark) => !removed(mark));
      if (survivors.length === 0) return;
      after ??= ensureSyntaxTree(transaction.state, transaction.newDoc.length, 50);
      if (!after) return;
      const firstPosition = transaction.changes.mapPos(survivors[0].from, 1);
      let list: SyntaxNode | null = after.resolveInner(firstPosition, 1);
      while (list && list.name !== "OrderedList") list = list.parent;
      if (!list) return;
      const next = markers(transaction.state, list);
      // Reject merging/splitting or partially deleted markers. Only surviving
      // items of this exact list may be renumbered, never an adjacent list.
      if (next.length !== survivors.length || next.some((mark, i) =>
        mark.from !== transaction.changes.mapPos(survivors[i].from, 1) ||
        mark.number !== survivors[i].number || mark.delimiter !== survivors[i].delimiter)) return;
      next.forEach((mark, i) => {
        const number = old[0].number + i;
        if (number !== mark.number) changes.push({ from: mark.from,
          to: mark.to - 1, insert: String(number) });
      });
    },
  });
  return changes.length === 0 ? transaction : [transaction, {
    changes: changes.sort((a, b) => a.from - b.from), sequential: true,
  }];
});
