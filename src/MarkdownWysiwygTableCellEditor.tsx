import { useLayoutEffect, useRef, useState } from "react";
import {
  escapeInlineText,
  escapeLinkLabel,
  inlineNodeVisibleText,
  parseInline,
  serializeInline,
  type InlineNode,
} from "./markdownWysiwygInline";

function nodesFor(source: string): InlineNode[] {
  const nodes = parseInline(source);
  return nodes.length ? nodes : [{ type: "text", text: "" }];
}

export function normalizeTableCellInput(value: string): string {
  return value.replace(/\r\n?|\n|\t/g, " ");
}

export function MarkdownWysiwygTableCellEditor({
  source,
  disabled,
  label,
  contextRevision,
  onChange,
}: {
  source: string;
  disabled: boolean;
  label: string;
  contextRevision: number;
  onChange: (inlineSource: string) => boolean;
}) {
  const [nodes, setNodes] = useState(() => nodesFor(source));
  const [error, setError] = useState(false);
  const expected = useRef(source);
  const previousDisabled = useRef(disabled);
  const previousContext = useRef(contextRevision);
  const revision = useRef(0);
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Keep our own fragments stable (including an emptied formatted fragment), so
  // native textarea selection, composition and undo survive ordinary input.
  // An external snapshot or lock invalidates pending native composition instead.
  if (
    source !== expected.current ||
    contextRevision !== previousContext.current ||
    (disabled && !previousDisabled.current)
  ) {
    expected.current = source;
    revision.current += 1;
    setNodes(nodesFor(source));
    if (error) setError(false);
  }
  previousDisabled.current = disabled;
  previousContext.current = contextRevision;

  return (
    <span className="wysiwyg-table-cell">
      {nodes.map((node, index) => (
        <CellFragment
          key={index}
          node={node}
          label={`${label}, fragment ${index + 1}`}
          disabled={disabled}
          revision={revision.current}
          onChange={(visible) => {
            if (disabled || !alive.current) return false;
            const text =
              node.type === "code"
                ? visible
                : node.type === "link"
                  ? escapeLinkLabel(visible)
                  : escapeInlineText(visible);
            const next = nodes.map((current, i) =>
              i !== index
                ? current
                : node.type === "link"
                  ? { ...node, label: text }
                  : { ...node, text },
            );
            // Boundary whitespace is table padding, not inline content. Retain
            // the user's transient spaces locally until subsequent text arrives.
            const raw = serializeInline(next);
            const wire = raw.replace(/^[ \t]+|[ \t]+$/g, "");
            const leftPadding = raw.match(/^[ \t]*/)?.[0].length ?? 0;
            const rightPadding = raw.match(/[ \t]*$/)?.[0].length ?? 0;
            const visibleText = next.map(inlineNodeVisibleText).join("");
            const expectedText = visibleText.slice(
              leftPadding,
              visibleText.length - rightPadding,
            );
            const roundTripText = parseInline(wire)
              .map(inlineNodeVisibleText)
              .join("");
            // Fence concatenation at a code-span edge can change visible text.
            // Reject rather than persisting a representation that drops characters.
            if (
              roundTripText !== expectedText ||
              (wire !== expected.current && !onChange(wire))
            ) {
              setError(true);
              return false;
            }
            expected.current = wire;
            const edited = next[index];
            if (edited.type === "code" && edited.text !== "") {
              const stored = parseInline(serializeInline([edited]))[0];
              if (stored?.type === "code")
                next[index] = { ...edited, backticks: stored.backticks };
            }
            setNodes(next);
            setError(false);
            return true;
          }}
        />
      ))}
      {error && (
        <span className="wysiwyg-table-cell-error" role="status">
          This text cannot be represented safely in this cell. Use source mode.
        </span>
      )}
    </span>
  );
}

function CellFragment({
  node,
  label,
  disabled,
  revision,
  onChange,
}: {
  node: InlineNode;
  label: string;
  disabled: boolean;
  revision: number;
  onChange: (visible: string) => boolean;
}) {
  const text = inlineNodeVisibleText(node);
  const [draft, setDraft] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const composition = useRef<number | null>(null);
  const cancelled = useRef(false);
  const lastRevision = useRef(revision);
  useLayoutEffect(() => {
    if (lastRevision.current !== revision) {
      if (composition.current !== null) cancelled.current = true;
      composition.current = null;
      lastRevision.current = revision;
    }
    if (composition.current === null) setDraft(text);
  }, [text, revision, disabled]);

  useLayoutEffect(() => {
    const element = ref.current;
    const beforeInput = (event: InputEvent) => {
      if (composition.current !== null || event.isComposing) return;
      if (
        event.inputType === "insertParagraph" ||
        event.inputType === "insertLineBreak"
      )
        event.preventDefault();
    };
    element?.addEventListener("beforeinput", beforeInput);
    return () => element?.removeEventListener("beforeinput", beforeInput);
  }, []);

  const commit = (raw: string) => {
    if (disabled || cancelled.current) {
      setDraft(text);
      if (ref.current) ref.current.value = text;
      return;
    }
    const next = normalizeTableCellInput(raw);
    if (onChange(next)) setDraft(next);
    else {
      setDraft(text);
      if (ref.current) ref.current.value = text;
    }
  };
  const className = `wysiwyg-table-fragment wysiwyg-inline-${node.type}`;
  return (
    <span className={className}>
      <span
        className="wysiwyg-table-fragment-mirror"
        data-text={draft}
        aria-hidden="true"
      />
      <textarea
        ref={ref}
        rows={1}
        cols={1}
        value={draft}
        disabled={disabled}
        aria-label={label}
        spellCheck={false}
        onChange={(event) => {
          if (composition.current !== null) {
            if (!disabled) setDraft(event.currentTarget.value);
          } else commit(event.currentTarget.value);
        }}
        onCompositionStart={() => {
          if (disabled) return;
          composition.current = revision;
          cancelled.current = false;
        }}
        onCompositionEnd={(event) => {
          const valid = composition.current === revision && !disabled;
          composition.current = null;
          if (valid) commit(event.currentTarget.value);
          else {
            cancelled.current = true;
            setDraft(text);
            event.currentTarget.value = text;
          }
        }}
        onPointerDown={() => {
          cancelled.current = false;
        }}
        onKeyDown={(event) => {
          if (composition.current !== null || event.nativeEvent.isComposing)
            return;
          cancelled.current = false;
          if (event.key === "Enter") event.preventDefault();
        }}
        onPaste={(event) => {
          event.preventDefault();
          if (disabled) return;
          cancelled.current = false;
          const plain = normalizeTableCellInput(
            event.clipboardData.getData("text/plain"),
          );
          // Native insertion preserves WebKit's text undo stack.
          if (!document.execCommand?.("insertText", false, plain)) {
            event.currentTarget.setRangeText(
              plain,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
              "end",
            );
            commit(event.currentTarget.value);
          }
        }}
      />
    </span>
  );
}
