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
  EditorView,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

type EditorProps = {
  content: string;
  disabled?: boolean;
  onChange: (content: string) => void;
};

export type EditorHandle = {
  fillColumnBlockSequence: () => boolean;
};

type ColumnBlockDeleteDirection = "backward" | "forward";
type ColumnBlockPastePlan =
  | { kind: "apply"; spec: TransactionSpec }
  | { kind: "reject" };

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

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(
  { content, disabled = false, onChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const viewRef = useRef<EditorView | null>(null);
  const isSyncingContentRef = useRef(false);
  const availabilityRef = useRef(new Compartment());

  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    fillColumnBlockSequence() {
      const view = viewRef.current;
      if (view === null) {
        return false;
      }
      return columnBlockSequenceCommand(view);
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
        columnBlockSelectionExtensions,
        availabilityRef.current.of([
          EditorState.readOnly.of(disabled),
          EditorView.editable.of(!disabled),
        ]),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": "Text editor",
          spellcheck: "false",
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isSyncingContentRef.current) {
            onChangeRef.current(update.state.doc.toString());
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

    return () => {
      viewRef.current = null;
      view.destroy();
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

  return <div className="editor-host" ref={hostRef} />;
});
