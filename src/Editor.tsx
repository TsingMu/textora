import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { useEffect, useRef } from "react";

type EditorProps = {
  content: string;
  disabled?: boolean;
  onChange: (content: string) => void;
};

export function Editor({ content, disabled = false, onChange }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const viewRef = useRef<EditorView | null>(null);
  const isSyncingContentRef = useRef(false);
  const availabilityRef = useRef(new Compartment());

  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
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
}
