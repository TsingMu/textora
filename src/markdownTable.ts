/** UTF-16 offsets into the original source; line endings are never normalized. */
export type MarkdownSourceRange = {
  readonly from: number;
  readonly to: number;
};
export type MarkdownTableAlignment = "default" | "left" | "center" | "right";

export type MarkdownTableCell = MarkdownSourceRange & {
  /** Original table-layer inline source, excluding padding. */
  readonly source: string;
  readonly leadingWhitespace: string;
  readonly trailingWhitespace: string;
};
export type MarkdownTableRow = MarkdownSourceRange & {
  readonly source: string;
  readonly cells: readonly MarkdownTableCell[];
};
export type MarkdownTable = MarkdownSourceRange & {
  readonly rawSource: string;
  readonly header: MarkdownTableRow;
  readonly separator: MarkdownTableRow;
  readonly rows: readonly MarkdownTableRow[];
  readonly alignments: readonly MarkdownTableAlignment[];
};
export type MarkdownTableScan =
  | { readonly kind: "none" }
  | (MarkdownSourceRange & {
      readonly kind: "table";
      readonly table: MarkdownTable;
      readonly nextOffset: number;
    })
  | (MarkdownSourceRange & {
      readonly kind: "unsupported";
      readonly rawSource: string;
      readonly nextOffset: number;
    });

type SourceLine = MarkdownSourceRange & { text: string; next: number };

function readLine(source: string, from: number): SourceLine {
  let to = from;
  while (to < source.length && source[to] !== "\r" && source[to] !== "\n")
    to += 1;
  const endLength = source[to] === "\r" && source[to + 1] === "\n" ? 2 : 1;
  return {
    from,
    to,
    text: source.slice(from, to),
    next: Math.min(source.length, to + endLength),
  };
}

function isLineStart(source: string, offset: number): boolean {
  return (
    Number.isInteger(offset) &&
    offset >= 0 &&
    offset < source.length &&
    (offset === 0 ||
      source[offset - 1] === "\n" ||
      (source[offset - 1] === "\r" && source[offset] !== "\n"))
  );
}

/** Each unescaped pipe delimits a cell, including inside backtick spans. */
function parseRow(line: SourceLine): MarkdownTableRow | null {
  const pipes: number[] = [];
  let slashes = 0;
  for (let i = 0; i < line.text.length; i += 1) {
    const ch = line.text[i];
    if (ch === "|" && slashes % 2 === 0) pipes.push(i);
    slashes = ch === "\\" ? slashes + 1 : 0;
  }
  if (pipes.length === 0) return null;
  const first = line.text.search(/\S/);
  const last = line.text.trimEnd().length - 1;
  const leadingPipe = pipes[0] === first;
  const trailingPipe = pipes[pipes.length - 1] === last;
  // A lone pipe cannot simultaneously frame a cell.
  if (pipes.length === 1 && leadingPipe && trailingPipe) return null;
  const from = leadingPipe ? pipes[0] + 1 : 0;
  const to = trailingPipe ? last : line.text.length;
  const delimiters = pipes.filter((pipe) => pipe >= from && pipe < to);
  const cells: MarkdownTableCell[] = [];
  let start = from;
  for (const end of [...delimiters, to]) {
    const raw = line.text.slice(start, end);
    const leadingWhitespace = raw.match(/^[ \t]*/)?.[0] ?? "";
    const rest = raw.slice(leadingWhitespace.length);
    const trailingWhitespace = rest.match(/[ \t]*$/)?.[0] ?? "";
    const cellFrom = line.from + start + leadingWhitespace.length;
    const cellTo = line.from + end - trailingWhitespace.length;
    cells.push({
      from: cellFrom,
      to: cellTo,
      source: sourceSlice(line, cellFrom, cellTo),
      leadingWhitespace,
      trailingWhitespace,
    });
    start = end + 1;
  }
  return { from: line.from, to: line.to, source: line.text, cells };
}

function sourceSlice(line: SourceLine, from: number, to: number): string {
  return line.text.slice(from - line.from, to - line.from);
}

function isBlockBoundary(line: string): boolean {
  return (
    /^(?: {4}|\t)/.test(line) ||
    /^ {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|>|[-+*]\s|\d+[.)]\s|<\/?[A-Za-z])/.test(
      line,
    ) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)
  );
}

function separatorAlignment(
  cell: MarkdownTableCell,
): MarkdownTableAlignment | null {
  if (!/^:?-{3,}:?$/.test(cell.source)) return null;
  if (cell.source.startsWith(":"))
    return cell.source.endsWith(":") ? "center" : "left";
  return cell.source.endsWith(":") ? "right" : "default";
}

function tableStart(
  source: string,
  line: SourceLine,
): {
  header: MarkdownTableRow;
  separator: MarkdownTableRow;
  separatorLine: SourceLine;
} | null {
  if (isBlockBoundary(line.text)) return null;
  const header = parseRow(line);
  if (!header || line.next >= source.length) return null;
  const separatorLine = readLine(source, line.next);
  // One-column separators can omit their outer pipes (unambiguous after a pipe header).
  let separator = parseRow(separatorLine);
  if (!separator && /^ {0,3}:?-+:?[ \t]*$/.test(separatorLine.text)) {
    const leadingWhitespace = separatorLine.text.match(/^[ \t]*/)?.[0] ?? "";
    const text = separatorLine.text.trim();
    const from = separatorLine.from + leadingWhitespace.length;
    separator = {
      from: separatorLine.from,
      to: separatorLine.to,
      source: separatorLine.text,
      cells: [
        {
          from,
          to: from + text.length,
          source: text,
          leadingWhitespace,
          trailingWhitespace: separatorLine.text.slice(
            leadingWhitespace.length + text.length,
          ),
        },
      ],
    };
  }
  if (
    !separator ||
    /^(?: {4}|\t)/.test(separatorLine.text) ||
    !separator.cells.every((cell) => /^:?-+:?$/.test(cell.source))
  )
    return null;
  return { header, separator, separatorLine };
}

/** Scan one top-level table candidate. None does not consume input. */
export function scanMarkdownTable(
  source: string,
  startOffset = 0,
): MarkdownTableScan {
  if (!isLineStart(source, startOffset)) return { kind: "none" };
  const start = tableStart(source, readLine(source, startOffset));
  if (!start) return { kind: "none" };
  const { header, separator, separatorLine } = start;
  const alignments = separator.cells.map(separatorAlignment);
  let supported =
    header.cells.length === separator.cells.length &&
    alignments.every((alignment) => alignment !== null);
  const rows: MarkdownTableRow[] = [];
  let to = separatorLine.to;
  let nextOffset = separatorLine.next;
  while (nextOffset < source.length) {
    const line = readLine(source, nextOffset);
    if (line.text.trim() === "" || isBlockBoundary(line.text)) break;
    // Adjacent tables need not have a blank line between them.
    if (tableStart(source, line)) break;
    const row = parseRow(line);
    if (!row) break;
    rows.push(row);
    if (row.cells.length !== header.cells.length) supported = false;
    to = line.to;
    nextOffset = line.next;
  }
  const rawSource = source.slice(startOffset, to);
  if (!supported)
    return {
      kind: "unsupported",
      from: startOffset,
      to,
      nextOffset,
      rawSource,
    };
  return {
    kind: "table",
    from: startOffset,
    to,
    nextOffset,
    table: {
      from: startOffset,
      to,
      rawSource,
      header,
      separator,
      rows,
      alignments: alignments as MarkdownTableAlignment[],
    },
  };
}

/** Remove exactly the table escape before a pipe; leave inline escapes untouched. */
export function decodeMarkdownTableCell(source: string): string {
  return source.replace(/(\\+)\|/g, (match: string, slashes: string) =>
    slashes.length % 2 === 1 ? `${slashes.slice(1)}|` : match,
  );
}

/**
 * Input is table-neutral inline Markdown, not an already table-encoded token.
 * Odd backslash runs before a pipe cannot round-trip this layer exactly; refuse
 * them rather than silently changing code/link text. Callers retain source UI.
 */
export function encodeMarkdownTableCell(inlineSource: string): string | null {
  if (/[\r\n]/.test(inlineSource)) return null;
  let slashes = 0;
  let result = "";
  for (const ch of inlineSource) {
    if (ch === "|") {
      if (slashes % 2 !== 0) return null;
      result += "\\";
    }
    result += ch;
    slashes = ch === "\\" ? slashes + 1 : 0;
  }
  return result;
}

export function replaceMarkdownSourceRange(
  source: string,
  range: MarkdownSourceRange,
  expectedRaw: string,
  replacement: string,
): string | null {
  const { from, to } = range;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > source.length ||
    source.slice(from, to) !== expectedRaw
  )
    return null;
  // Never split a surrogate pair or CRLF at a patch boundary.
  for (const offset of [from, to]) {
    const before = source.charCodeAt(offset - 1);
    const after = source.charCodeAt(offset);
    if (
      (before >= 0xd800 &&
        before <= 0xdbff &&
        after >= 0xdc00 &&
        after <= 0xdfff) ||
      (source[offset - 1] === "\r" && source[offset] === "\n")
    )
      return null;
  }
  return source.slice(0, from) + replacement + source.slice(to);
}

/** rowIndex -1 denotes the header. Only the edited content token can change. */
export function replaceMarkdownTableCell(
  source: string,
  table: MarkdownTable,
  rowIndex: number,
  columnIndex: number,
  inlineSource: string,
): string | null {
  if (
    !Number.isInteger(rowIndex) ||
    rowIndex < -1 ||
    !Number.isInteger(columnIndex) ||
    columnIndex < 0 ||
    source.slice(table.from, table.to) !== table.rawSource
  )
    return null;
  const row = rowIndex === -1 ? table.header : table.rows[rowIndex];
  const cell = row?.cells[columnIndex];
  const encoded = encodeMarkdownTableCell(inlineSource);
  if (!cell || encoded === null) return null;
  const apply = (replacement: string): string | null => {
    const updated = replaceMarkdownSourceRange(
      source,
      cell,
      cell.source,
      replacement,
    );
    if (updated === null) return null;
    const next = scanMarkdownTable(updated, table.from);
    if (
      next.kind !== "table" ||
      next.to !== table.to + replacement.length - cell.source.length ||
      next.table.header.cells.length !== table.header.cells.length ||
      next.table.rows.length !== table.rows.length ||
      next.table.alignments.some(
        (alignment, i) => alignment !== table.alignments[i],
      )
    )
      return null;
    const oldRows = [table.header, ...table.rows];
    const newRows = [next.table.header, ...next.table.rows];
    // Check every cell, not just the changed one: token interpretation must not
    // move text across cell boundaries after editing optional outer pipes.
    if (
      newRows.some((nextRow, i) =>
        nextRow.cells.some(
          (nextCell, j) =>
            nextCell.source !==
            (i === rowIndex + 1 && j === columnIndex
              ? encoded
              : oldRows[i].cells[j].source),
        ),
      )
    )
      return null;
    return updated;
  };
  const updated = apply(encoded);
  if (updated !== null || encoded !== "") return updated;
  // Clearing an edge cell of A|B would leave |B (one column). Supply an
  // outer framing pipe *inside the replaced token*, preserving all other bytes.
  const before = row.source.slice(0, cell.from - row.from);
  const after = row.source.slice(cell.to - row.from);
  const prefix =
    columnIndex === 0 && !/^[ \t]*\|[ \t]*$/.test(before) ? "|" : "";
  const suffix =
    columnIndex === row.cells.length - 1 && !/^[ \t]*\|[ \t]*$/.test(after)
      ? "|"
      : "";
  return prefix || suffix ? apply(prefix + suffix) : null;
}

/** Unedited table serialization is byte-for-byte (UTF-16 string) source reuse. */
export function serializeMarkdownTable(table: MarkdownTable): string {
  return table.rawSource;
}

/** For later explicit structural edits only; cell inputs are original table-layer tokens. */
export function formatMarkdownTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  alignments: readonly MarkdownTableAlignment[],
  newline: "\n" | "\r\n" | "\r" = "\n",
): string | null {
  if (
    header.length === 0 ||
    header.length !== alignments.length ||
    rows.some((row) => row.length !== header.length) ||
    [header, ...rows].some((row) => row.some((cell) => /[\r\n]/.test(cell)))
  )
    return null;
  const separators = {
    default: "---",
    left: ":---",
    center: ":---:",
    right: "---:",
  };
  const rowSource = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  const source = [
    rowSource(header),
    rowSource(alignments.map((a) => separators[a])),
    ...rows.map(rowSource),
  ].join(newline);
  const parsed = scanMarkdownTable(source);
  if (
    parsed.kind !== "table" ||
    parsed.to !== source.length ||
    parsed.table.rows.length !== rows.length ||
    parsed.table.header.cells.length !== header.length
  )
    return null;
  const expected = [header, ...rows];
  const actual = [parsed.table.header, ...parsed.table.rows];
  if (
    actual.some((row, i) =>
      row.cells.some((cell, j) => cell.source !== expected[i][j]),
    )
  )
    return null;
  return source;
}

export type MarkdownTableRowCommand =
  { type: "insert"; index: number } | { type: "delete"; index: number };

/** Column commands are the only path allowed to rebuild the current table body. */
export type MarkdownTableColumnCommand = MarkdownTableRowCommand;

const markdownTableAlignmentTokens: Record<MarkdownTableAlignment, string> = {
  default: "---",
  left: ":---",
  center: ":---:",
  right: "---:",
};

/** Explicit alignment edits rewrite only the target separator cell token. */
export function changeMarkdownTableAlignment(
  source: string,
  table: MarkdownTable,
  index: number,
  alignment: MarkdownTableAlignment,
): string | null {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    !markdownTableAlignmentTokens[alignment] ||
    source.slice(table.from, table.to) !== table.rawSource
  )
    return null;
  const current = scanMarkdownTable(source, table.from);
  if (current.kind !== "table" || current.to !== table.to) return null;
  const model = current.table;
  if (index >= model.header.cells.length) return null;
  // Choosing the current value again is an explicit no-op, not a failure.
  if (model.alignments[index] === alignment) return null;
  const cell = model.separator.cells[index];
  if (!cell) return null;
  const token = markdownTableAlignmentTokens[alignment];
  const nextSource = replaceMarkdownSourceRange(
    source,
    cell,
    cell.source,
    token,
  );
  if (nextSource === null) return null;
  const next = scanMarkdownTable(nextSource, model.from);
  // Compare against one prebuilt list; rebuilding it per row makes large
  // synchronous alignment clicks quadratic on the UI thread.
  const previousRows = [model.header, ...model.rows];
  if (
    next.kind !== "table" ||
    next.to !== model.to + token.length - cell.source.length ||
    next.table.rows.length !== model.rows.length ||
    next.table.alignments.some(
      (value, i) => value !== (i === index ? alignment : model.alignments[i]),
    ) ||
    [next.table.header, ...next.table.rows].some((row, i) =>
      row.cells.some(
        (cell, j) => cell.source !== previousRows[i].cells[j].source,
      ),
    ) ||
    next.table.separator.cells.some(
      (c, j) => c.source !== (j === index ? token : model.separator.cells[j].source),
    )
  )
    return null;
  return nextSource;
}

export function changeMarkdownTableColumn(
  source: string,
  table: MarkdownTable,
  command: MarkdownTableColumnCommand,
): string | null {
  if (
    (command.type !== "insert" && command.type !== "delete") ||
    source.slice(table.from, table.to) !== table.rawSource
  )
    return null;
  const current = scanMarkdownTable(source, table.from);
  if (current.kind !== "table" || current.to !== table.to) return null;
  const model = current.table;
  const { index } = command;
  const width = model.header.cells.length;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > width ||
    (command.type === "delete" && (index === width || width < 2))
  )
    return null;
  const newline = source.slice(model.header.to, model.separator.from);
  if (!/^(?:\r\n|\r|\n)$/.test(newline)) return null;
  const tokens = [model.header, ...model.rows].map((row) =>
    row.cells.map((cell) => cell.source),
  );
  const alignments = [...model.alignments];
  if (command.type === "insert") {
    for (const row of tokens) row.splice(index, 0, "");
    alignments.splice(index, 0, "default");
  } else {
    for (const row of tokens) row.splice(index, 1);
    alignments.splice(index, 1);
  }
  // Tokens are original table-layer sources: no decode/encode pass runs here.
  const body = formatMarkdownTable(
    tokens[0],
    tokens.slice(1),
    alignments,
    newline as "\n" | "\r\n" | "\r",
  );
  if (body === null) return null;
  const nextSource =
    source.slice(0, model.from) + body + source.slice(model.to);
  const next = scanMarkdownTable(nextSource, model.from);
  if (
    next.kind !== "table" ||
    next.to !== model.from + body.length ||
    next.table.rows.length !== model.rows.length ||
    next.table.alignments.some(
      (alignment, i) => alignment !== alignments[i],
    ) ||
    [next.table.header, ...next.table.rows].some((row, i) =>
      row.cells.some((cell, j) => cell.source !== tokens[i][j]),
    )
  )
    return null;
  return nextSource;
}

/** Only row tokens and one necessary separator change; all other bytes survive. */
export function changeMarkdownTableRow(
  source: string,
  table: MarkdownTable,
  command: MarkdownTableRowCommand,
): string | null {
  if (
    (command.type !== "insert" && command.type !== "delete") ||
    source.slice(table.from, table.to) !== table.rawSource
  )
    return null;
  const current = scanMarkdownTable(source, table.from);
  if (current.kind !== "table" || current.to !== table.to) return null;
  const model = current.table;
  const { index } = command;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > model.rows.length ||
    (command.type === "delete" && index === model.rows.length)
  )
    return null;
  const newline = source.slice(model.header.to, model.separator.from);
  if (!/^(?:\r\n|\r|\n)$/.test(newline)) return null;
  const emptyRow = `| ${model.header.cells.map(() => "").join(" | ")} |`;
  const expectedRows = model.rows.map((row) => row.source);
  let range: MarkdownSourceRange;
  let replacement: string;
  if (command.type === "insert") {
    expectedRows.splice(index, 0, emptyRow);
    if (index < model.rows.length) {
      range = { from: model.rows[index].from, to: model.rows[index].from };
      replacement = emptyRow + newline;
    } else {
      range = { from: model.to, to: model.to };
      replacement = newline + emptyRow;
    }
  } else {
    expectedRows.splice(index, 1);
    const row = model.rows[index];
    range =
      index + 1 < model.rows.length
        ? { from: row.from, to: model.rows[index + 1].from }
        : { from: (model.rows[index - 1] ?? model.separator).to, to: row.to };
    replacement = "";
  }
  const nextSource = replaceMarkdownSourceRange(
    source,
    range,
    source.slice(range.from, range.to),
    replacement,
  );
  if (nextSource === null) return null;
  const next = scanMarkdownTable(nextSource, model.from);
  if (
    next.kind !== "table" ||
    next.to !== model.to + replacement.length - (range.to - range.from) ||
    next.table.header.source !== model.header.source ||
    next.table.separator.source !== model.separator.source ||
    next.table.rows.length !== expectedRows.length ||
    next.table.rows.some((row, i) => row.source !== expectedRows[i]) ||
    next.table.alignments.some((value, i) => value !== model.alignments[i])
  )
    return null;
  return nextSource;
}
