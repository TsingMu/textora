import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { MarkdownWysiwygTableCellEditor } from "./MarkdownWysiwygTableCellEditor";
import {
  decodeMarkdownTableCell,
  type MarkdownTable,
  type MarkdownTableAlignment,
  type MarkdownTableColumnCommand,
  type MarkdownTableRowCommand,
} from "./markdownTable";

type MarkdownWysiwygTableEditorProps = {
  table: MarkdownTable;
  disabled?: boolean;
  contextRevision?: number;
  documentSource?: string;
  onRowChange?: (command: MarkdownTableRowCommand) => string | null;
  onColumnChange?: (command: MarkdownTableColumnCommand) => string | null;
  onAlignmentChange?: (
    column: number,
    alignment: MarkdownTableAlignment,
  ) => string | null;
  onCellChange?: (row: number, column: number, inlineSource: string) => boolean;
};

// Only validated Markdown token patches leave this view.
export function MarkdownWysiwygTableEditor({
  table,
  disabled = false,
  onCellChange,
  contextRevision = 0,
  documentSource = table.rawSource,
  onRowChange,
  onColumnChange,
  onAlignmentChange,
}: MarkdownWysiwygTableEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const [selected, setSelected] = useState({ row: -1, column: 0 });
  const [structureRevision, setStructureRevision] = useState(0);
  // Column commands rebuild the header row too; row commands must not remount
  // the header input hosts and their native text history.
  const [headerRevision, setHeaderRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"row" | "column" | "alignment" | null>(
    null,
  );
  const [composing, setComposing] = useState(false);
  const compositionActive = useRef(false);
  const compositionTarget = useRef<EventTarget | null>(null);
  type Confirmation = {
    kind: "row" | "column";
    row: number;
    column: number;
    epoch: number;
    preview: string;
  };
  const [pending, setPending] = useState<Confirmation | null>(null);
  const pendingRef = useRef<Confirmation | null>(null);
  const context = useRef({
    source: documentSource,
    contextRevision,
    disabled,
    from: table.from,
    epoch: 0,
  });
  const focusRequest = useRef<{
    source: string;
    previousSource: string;
    contextRevision: number;
    row: number;
    column: number;
  } | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  if (
    context.current.source !== documentSource ||
    context.current.contextRevision !== contextRevision ||
    context.current.disabled !== disabled ||
    context.current.from !== table.from
  ) {
    const external = context.current.contextRevision !== contextRevision;
    context.current = {
      source: documentSource,
      contextRevision,
      disabled,
      from: table.from,
      epoch: context.current.epoch + 1,
    };
    pendingRef.current = null;
    compositionActive.current = false;
    compositionTarget.current = null;
    if (composing) setComposing(false);
    if (pending) setPending(null);
    if (error) setError(null);
    if (external) setSelected({ row: -1, column: 0 });
  }
  const epoch = context.current.epoch;
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pendingRef.current = null;
      focusRequest.current = null;
    };
  }, []);
  const focus = (row: number, column: number) => {
    host.current
      ?.querySelector<HTMLTextAreaElement>(
        `[data-table-row="${row}"][data-table-column="${column}"] textarea:not(:disabled)`,
      )
      ?.focus();
  };
  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    if (
      !disabled &&
      request.contextRevision === contextRevision &&
      request.source === documentSource
    ) {
      focusRequest.current = null;
      setBusy(false);
      focus(request.row, request.column);
    } else if (
      disabled ||
      request.contextRevision !== contextRevision ||
      request.previousSource !== documentSource
    ) {
      focusRequest.current = null;
      setBusy(false);
    }
  });
  useLayoutEffect(() => {
    if (pending) cancelButton.current?.focus();
  }, [pending]);
  const valid = () =>
    alive.current &&
    !disabled &&
    epoch === context.current.epoch &&
    !focusRequest.current;
  const submit = (
    kind: "row" | "column",
    command: MarkdownTableRowCommand,
    target: { row: number; column: number },
  ) => {
    const change = kind === "row" ? onRowChange : onColumnChange;
    if (
      !valid() ||
      compositionActive.current ||
      pendingRef.current ||
      !change
    )
      return;
    // Guard repeated clicks before React commits the controlled snapshot.
    focusRequest.current = {
      source: "",
      previousSource: documentSource,
      contextRevision,
      row: target.row,
      column: target.column,
    };
    const source = change(command);
    if (source === null) {
      focusRequest.current = null;
      setError(kind);
      return;
    }
    focusRequest.current = {
      source,
      previousSource: documentSource,
      contextRevision,
      row: target.row,
      column: target.column,
    };
    setSelected(target);
    setStructureRevision((value) => value + 1);
    if (kind === "column") setHeaderRevision((value) => value + 1);
    setBusy(true);
    setError(null);
  };
  const insertRow = (index: number) => {
    if (valid() && !pendingRef.current)
      submit("row", { type: "insert", index }, { row: index, column: selected.column });
  };
  const requestDeleteRow = () => {
    if (
      !valid() ||
      compositionActive.current ||
      pendingRef.current ||
      selected.row < 0
    )
      return;
    const row = table.rows[selected.row];
    if (!row) return;
    if (row.cells.every((cell) => cell.source === "")) {
      submit("row", { type: "delete", index: selected.row }, {
        row: Math.min(selected.row, table.rows.length - 2),
        column: selected.column,
      });
    } else {
      const confirmation: Confirmation = {
        kind: "row",
        ...selected,
        epoch,
        preview:
          row.source.slice(0, 160) + (row.source.length > 160 ? "…" : ""),
      };
      pendingRef.current = confirmation;
      setPending(confirmation);
    }
  };
  // Alignment edits keep the structure; no rebuild or focus request is needed,
  // so the focused cell host and its native input history stay untouched.
  const applyAlignment = (column: number, alignment: MarkdownTableAlignment) => {
    if (
      !valid() ||
      compositionActive.current ||
      pendingRef.current ||
      !onAlignmentChange ||
      table.alignments[column] === alignment
    )
      return;
    if (onAlignmentChange(column, alignment) === null) setError("alignment");
  };
  const requestDeleteColumn = () => {    if (
      !valid() ||
      compositionActive.current ||
      pendingRef.current ||
      table.header.cells.length <= 1
    )
      return;
    const column = selected.column;
    const cells = [table.header, ...table.rows].map(
      (row) => row.cells[column],
    );
    if (cells.some((cell) => cell === undefined)) return;
    if (cells.every((cell) => cell.source === "")) {
      submit("column", { type: "delete", index: column }, {
        row: selected.row,
        column: Math.min(column, table.header.cells.length - 2),
      });
    } else {
      const previewSource = cells.map((cell) => cell.source).join(" / ");
      const confirmation: Confirmation = {
        kind: "column",
        ...selected,
        column,
        epoch,
        preview:
          previewSource.slice(0, 160) + (previewSource.length > 160 ? "…" : ""),
      };
      pendingRef.current = confirmation;
      setPending(confirmation);
    }
  };
  const confirmDelete = () => {
    if (
      !valid() ||
      compositionActive.current ||
      !pending ||
      pendingRef.current !== pending ||
      pending.epoch !== epoch
    )
      return;
    pendingRef.current = null;
    setPending(null);
    if (pending.kind === "row") {
      submit("row", { type: "delete", index: pending.row }, {
        row: Math.min(pending.row, table.rows.length - 2),
        column: pending.column,
      });
    } else {
      submit("column", { type: "delete", index: pending.column }, {
        row: pending.row,
        column: Math.min(pending.column, table.header.cells.length - 2),
      });
    }
  };
  const cancelDelete = () => {
    if (!valid() || !pending || pendingRef.current !== pending) return;
    pendingRef.current = null;
    setPending(null);
    focus(pending.row, pending.column);
  };
  const cellContent = (source: string, row: number, column: number) => (
    <MarkdownWysiwygTableCellEditor
      source={decodeMarkdownTableCell(source)}
      disabled={disabled || !onCellChange}
      contextRevision={contextRevision + structureRevision}
      label={`${row === -1 ? "Table header" : `Table row ${row + 1}`}, column ${column + 1}`}
      onChange={(inlineSource) =>
        onCellChange?.(row, column, inlineSource) ?? false
      }
    />
  );
  const selectCell = (row: number, column: number) => {
    setSelected((current) =>
      current.row === row && current.column === column
        ? current
        : { row, column },
    );
  };
  const focusCell = (event: MouseEvent<HTMLTableCellElement>) => {
    if (!(event.target instanceof HTMLTextAreaElement))
      event.currentTarget
        .querySelector<HTMLTextAreaElement>("textarea:not(:disabled)")
        ?.focus();
  };
  const alignment = (column: number) => {
    const value = table.alignments[column];
    return { textAlign: value === "default" ? undefined : value };
  };

  return (
    <div
      className="markdown-wysiwyg-table-block"
      ref={host}
      onCompositionStartCapture={(event) => {
        if (
          !(event.target instanceof HTMLTextAreaElement) ||
          event.target.disabled
        )
          return;
        compositionTarget.current = event.target;
        compositionActive.current = true;
        setComposing(true);
      }}
      onCompositionEndCapture={(event) => {
        if (compositionTarget.current !== event.target) return;
        compositionTarget.current = null;
        compositionActive.current = false;
        setComposing(false);
      }}
    >
      {onRowChange && (
        <div
          className="wysiwyg-table-row-actions"
          role="group"
          aria-label="Table row actions"
        >
          <span>
            {selected.row < 0 ? "Header" : `Data row ${selected.row + 1}`}
          </span>
          {selected.row >= 0 && (
            <button
              type="button"
              disabled={disabled || busy || !!pending || composing}
              aria-label={`Insert row before data row ${selected.row + 1}`}
              onClick={() => insertRow(selected.row)}
            >
              Insert row before
            </button>
          )}
          <button
            type="button"
            disabled={disabled || busy || !!pending || composing}
            aria-label={
              selected.row < 0
                ? "Insert data row after header"
                : `Insert row after data row ${selected.row + 1}`
            }
            onClick={() => insertRow(selected.row + 1)}
          >
            {selected.row < 0
              ? "Insert data row after header"
              : "Insert row after"}
          </button>
          {selected.row >= 0 && (
            <button
              type="button"
              disabled={disabled || busy || !!pending || composing}
              onClick={requestDeleteRow}
            >
              Delete data row {selected.row + 1}
            </button>
          )}
        </div>
      )}
      {onColumnChange && (
        <div
          className="wysiwyg-table-column-actions"
          role="group"
          aria-label="Table column actions"
        >
          <span>Column {selected.column + 1}</span>
          <button
            type="button"
            disabled={disabled || busy || !!pending || composing}
            aria-label={`Insert column before column ${selected.column + 1}`}
            onClick={() => {
              if (valid() && !pendingRef.current)
                submit("column", { type: "insert", index: selected.column }, {
                  row: selected.row,
                  column: selected.column,
                });
            }}
          >
            Insert column before
          </button>
          <button
            type="button"
            disabled={disabled || busy || !!pending || composing}
            aria-label={`Insert column after column ${selected.column + 1}`}
            onClick={() => {
              if (valid() && !pendingRef.current)
                submit(
                  "column",
                  { type: "insert", index: selected.column + 1 },
                  { row: selected.row, column: selected.column + 1 },
                );
            }}
          >
            Insert column after
          </button>
          <button
            type="button"
            disabled={
              disabled ||
              busy ||
              !!pending ||
              composing ||
              table.header.cells.length <= 1
            }
            aria-label={`Delete column ${selected.column + 1}`}
            onClick={requestDeleteColumn}
          >
            Delete column {selected.column + 1}
          </button>
        </div>
      )}
      {onAlignmentChange && (
        <div
          className="wysiwyg-table-column-actions"
          role="group"
          aria-label={`Column ${selected.column + 1} alignment`}
        >
          {(["default", "left", "center", "right"] as const).map((value) => (
            <button
              key={value}
              type="button"
              disabled={
                disabled ||
                busy ||
                !!pending ||
                composing ||
                table.alignments[selected.column] === value
              }
              aria-label={`Set column ${selected.column + 1} alignment to ${value}`}
              aria-current={table.alignments[selected.column] === value}
              onClick={() => applyAlignment(selected.column, value)}
            >
              {value === "default"
                ? "Align default"
                : `Align ${value}`}
            </button>
          ))}
        </div>
      )}
      {pending?.kind === "row" && (
        <div
          className="wysiwyg-table-row-confirm"
          role="group"
          aria-label={`Confirm deletion of data row ${pending.row + 1}`}
        >
          <p role="alert">
            Delete data row {pending.row + 1}? Its contents will be deleted.
          </p>
          <code>{pending.preview}</code>
          <div className="wysiwyg-table-row-actions">
            <button
              type="button"
              onClick={confirmDelete}
              disabled={disabled || composing}
            >
              Confirm delete row {pending.row + 1}
            </button>
            <button type="button" ref={cancelButton} onClick={cancelDelete}>
              Cancel row deletion
            </button>
          </div>
        </div>
      )}
      {pending?.kind === "column" && (
        <div
          className="wysiwyg-table-column-confirm"
          role="group"
          aria-label={`Confirm deletion of column ${pending.column + 1}`}
        >
          <p role="alert">
            Delete column {pending.column + 1}? Its contents will be deleted.
          </p>
          <code>{pending.preview}</code>
          <div className="wysiwyg-table-column-actions">
            <button
              type="button"
              onClick={confirmDelete}
              disabled={disabled || composing}
            >
              Confirm delete column {pending.column + 1}
            </button>
            <button type="button" ref={cancelButton} onClick={cancelDelete}>
              Cancel column deletion
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="status">
          {error === "row"
            ? "This row operation cannot be represented safely. Use source mode."
            : error === "column"
              ? "This column operation cannot be represented safely. Use source mode."
              : "This alignment change cannot be represented safely. Use source mode."}
        </p>
      )}
      <div
        className="markdown-wysiwyg-table-scroll"
        role="region"
        aria-label={
          disabled || !onCellChange
            ? "Markdown table (read only)"
            : "Markdown table"
        }
        aria-disabled={disabled}
        tabIndex={0}
      >
        <table className="markdown-wysiwyg-table">
          <thead key={`head:${headerRevision}`}>
            <tr>
              {table.header.cells.map((cell, column) => (
                <th
                  key={column}
                  data-table-row={-1}
                  data-table-column={column}
                  onFocusCapture={() => selectCell(-1, column)}
                  onPointerDownCapture={() => selectCell(-1, column)}
                  onKeyDownCapture={(event) => {
                    if (event.target === document.activeElement)
                      selectCell(-1, column);
                  }}
                  scope="col"
                  style={alignment(column)}
                  onClick={focusCell}
                >
                  {cellContent(cell.source, -1, column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody key={`body:${structureRevision}`}>
            {table.rows.map((row, index) => (
              <tr key={index}>
                {row.cells.map((cell, column) => (
                  <td
                    key={column}
                    style={alignment(column)}
                    onClick={focusCell}
                    data-table-row={index}
                    data-table-column={column}
                    onFocusCapture={() => selectCell(index, column)}
                    onPointerDownCapture={() =>
                      setSelected({ row: index, column })
                    }
                    onKeyDownCapture={(event) => {
                      if (event.target === document.activeElement)
                        selectCell(index, column);
                    }}
                  >
                    {cellContent(cell.source, index, column)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
