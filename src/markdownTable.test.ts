import { describe, expect, it } from "vitest";
import {
  changeMarkdownTableAlignment,
  changeMarkdownTableColumn,
  changeMarkdownTableRow,
  decodeMarkdownTableCell,
  encodeMarkdownTableCell,
  formatMarkdownTable,
  replaceMarkdownSourceRange,
  replaceMarkdownTableCell,
  scanMarkdownTable,
  serializeMarkdownTable,
  type MarkdownTable,
} from "./markdownTable";

function table(source: string, from = 0): MarkdownTable {
  const result = scanMarkdownTable(source, from);
  if (result.kind !== "table")
    throw new Error(`expected table: ${JSON.stringify(result)}`);
  return result.table;
}
function contents(t: MarkdownTable) {
  return [t.header, ...t.rows].map((row) =>
    row.cells.map((cell) => decodeMarkdownTableCell(cell.source)),
  );
}

describe("Markdown table source contract", () => {
  it("parses a rectangular table with all alignments and absolute UTF-16 token ranges", () => {
    const source =
      "😀 before\r\n\r\n | **A** | `B` | [C](x) | D |\r\n | :---- | :---: | ---: | ---- |\r\n | a | b | c | d |\r\n\r\nafter";
    const from = source.indexOf(" | **A");
    const t = table(source, from);
    expect(t.alignments).toEqual(["left", "center", "right", "default"]);
    expect(contents(t)).toEqual([
      ["**A**", "`B`", "[C](x)", "D"],
      ["a", "b", "c", "d"],
    ]);
    expect(source.slice(t.from, t.to)).toBe(t.rawSource);
    expect(serializeMarkdownTable(t)).toBe(t.rawSource);
    for (const row of [t.header, t.separator, ...t.rows]) {
      expect(source.slice(row.from, row.to)).toBe(row.source);
      for (const cell of row.cells) {
        expect(source.slice(cell.from, cell.to)).toBe(cell.source);
        expect(cell.leadingWhitespace).toBe(" ");
        expect(cell.trailingWhitespace).toBe(" ");
      }
    }
    expect(source.slice(t.to)).toBe("\r\n\r\nafter");
  });

  it.each(["\n", "\r\n", "\r"])(
    "supports optional outer pipes, empty cells and header-only tables (%j)",
    (eol) => {
      const source = ["A | B | C", "--- | :---: | ---:", "one | | three"].join(
        eol,
      );
      expect(contents(table(source))).toEqual([
        ["A", "B", "C"],
        ["one", "", "three"],
      ]);
      expect(contents(table(`| A |${eol}---`))).toEqual([["A"]]);
      expect(contents(table(`| |${eol}| --- |${eol}| |`))).toEqual([
        [""],
        [""],
      ]);
    },
  );

  it("uses slash parity for all pipes, including code and link text", () => {
    const source = String.raw`| A\|B | code | link |
| --- | --- | --- |
| x\\\|y | \`a\|b\` | [x\|y](a\|b) |`
      .split("\\`")
      .join("`");
    const t = table(source);
    expect(contents(t)).toEqual([
      ["A|B", "code", "link"],
      [String.raw`x\\|y`, "`a|b`", "[x|y](a|b)"],
    ]);
    // An even run does not escape the column delimiter.
    expect(
      contents(
        table(String.raw`| A | B |
| --- | --- |
| x\\|y |`),
      )[1],
    ).toEqual([String.raw`x\\`, "y"]);
    // Backticks do not silently absorb unescaped column delimiters.
    expect(
      scanMarkdownTable("| A | B |\n| --- | --- |\n| `x|y` | z |").kind,
    ).toBe("unsupported");
  });

  it.each([
    "| A | B |\n| --- |\n| x | y |",
    "| A | B |\n| --- | --- |\n| x |",
    "| A | B |\n| --- | --- |\n| x | y | extra |\n| last | row |",
    "| A | B |\n| -- | --- |\n| x | y |",
  ])(
    "retains unsupported candidates without truncating extra cells: %s",
    (source) => {
      const result = scanMarkdownTable(`${source}\n# after`);
      expect(result).toMatchObject({
        kind: "unsupported",
        rawSource: source,
        from: 0,
        to: source.length,
        nextOffset: source.length + 1,
      });
    },
  );

  it.each([
    "after",
    "# Heading",
    "- list",
    "> quote",
    "```json",
    "<div>html</div>",
    "    code | x",
  ])("does not consume an adjacent non-table block: %s", (after) => {
    const source = `| A | B |\n| --- | --- |\n| x | y |\n${after}`;
    const result = scanMarkdownTable(source);
    expect(result.kind).toBe("table");
    if (result.kind === "none") throw new Error("missing table");
    expect(source.slice(result.nextOffset)).toBe(after);
  });

  it("leaves adjacent tables separate, with or without blank lines", () => {
    for (const gap of ["\n", "\n\n"]) {
      const first = "| A | B |\n| --- | --- |\n| a | b |";
      const second = "| C | D |\n| --- | --- |\n| c | d |";
      const source = first + gap + second;
      expect(serializeMarkdownTable(table(source))).toBe(first);
      expect(serializeMarkdownTable(table(source, source.indexOf("| C")))).toBe(
        second,
      );
    }
  });

  it.each([
    "",
    "text",
    "A\n---",
    "    | A |\n    | --- |",
    "> | A |\n> | --- |",
    "- | A |\n  | --- |",
  ])("does not claim a non-table or nested candidate (%j)", (source) => {
    expect(scanMarkdownTable(source)).toEqual({ kind: "none" });
  });

  it("refuses invalid offsets and scans only from complete line boundaries", () => {
    const source = "\r\n| A |\r\n| --- |";
    for (const from of [
      -1,
      0.5,
      1,
      3,
      Infinity,
      NaN,
      source.length,
      source.length + 1,
    ]) {
      expect(scanMarkdownTable(source, from)).toEqual({ kind: "none" });
    }
    expect(scanMarkdownTable(source, 2).kind).toBe("table");
  });

  it("round-trips table/inline layers without adding escaping on repeated passes", () => {
    for (let n = 0; n < 20; n += 2) {
      for (const wrapper of ["", "`", "**"]) {
        const inline = wrapper + "前" + "\\".repeat(n) + "|后" + wrapper;
        const encoded = encodeMarkdownTableCell(inline);
        expect(encoded).not.toBeNull();
        expect(decodeMarkdownTableCell(encoded!)).toBe(inline);
        expect(encodeMarkdownTableCell(decodeMarkdownTableCell(encoded!))).toBe(
          encoded,
        );
      }
    }
    expect(encodeMarkdownTableCell("line\nnext")).toBeNull();
    expect(encodeMarkdownTableCell("line\rnext")).toBeNull();
    expect(encodeMarkdownTableCell(String.raw`\|`)).toBeNull();
    expect(decodeMarkdownTableCell(String.raw`x\\|y`)).toBe(String.raw`x\\|y`);
  });

  it("changes just the target token, preserving padding, neighbors and file boundaries", () => {
    const source =
      "# 前缀😀\r\n\r\n| A  |  B |\r\n| :---- | ---: |\r\n| `old` | [label](Keep\\Path) |\r\n\r\n尾部\r\n";
    const t = table(source, source.indexOf("| A"));
    const inline = "`new|value`";
    const output = replaceMarkdownTableCell(source, t, 0, 0, inline);
    expect(output).toBe(source.replace("`old`", "`new\\|value`"));
    expect(contents(table(output!, t.from))[1]).toEqual([
      inline,
      String.raw`[label](Keep\Path)`,
    ]);
    expect(replaceMarkdownTableCell(source, t, -1, 1, "表头")).toBe(
      source.replace("  B |", "  表头 |"),
    );
    expect(replaceMarkdownTableCell(source, t, 0, 0, "`old`")).toBe(source);
  });

  it("supports empty tokens and deletion to empty without losing neighboring delimiters", () => {
    const source = "| A | B |\n| --- | --- |\n|| value |";
    const t = table(source);
    const filled = replaceMarkdownTableCell(source, t, 0, 0, "填入");
    expect(filled).toBe(source.replace("||", "|填入|"));
    expect(replaceMarkdownTableCell(source, t, 0, 1, "")).toBe(
      source.replace("value", ""),
    );
  });

  it.each([
    ["A|B\n---|---\nx|y", -1, 0, "||B\n---|---\nx|y"],
    ["A|B\n---|---\nx|y", -1, 1, "A||\n---|---\nx|y"],
    ["A|B\n---|---\nx|y", 0, 0, "A|B\n---|---\n||y"],
    ["A|B\n---|---\nx|y", 0, 1, "A|B\n---|---\nx||"],
    ["|A\n---\n|x", 0, 0, "|A\n---\n||"],
  ] as const)(
    "clears unframed edge cells without collapsing columns: %s",
    (source, row, col, expected) => {
      expect(
        replaceMarkdownTableCell(source, table(source), row, col, ""),
      ).toBe(expected);
    },
  );

  it("rejects stale models, invalid targets and replacements changing table structure", () => {
    const source = "| A | B |\n| --- | --- |\nx|y";
    const t = table(source);
    expect(
      replaceMarkdownTableCell(source.replace("A", "Q"), t, 0, 0, "z"),
    ).toBeNull();
    for (const [row, col] of [
      [-2, 0],
      [0.5, 0],
      [1, 0],
      [0, -1],
      [0, 2],
      [0, 0.5],
    ]) {
      expect(replaceMarkdownTableCell(source, t, row, col, "z")).toBeNull();
    }
    for (const inline of [
      "line\nnext",
      " leading",
      "trailing ",
      "# heading",
      "\\",
    ]) {
      expect(replaceMarkdownTableCell(source, t, 0, 0, inline)).toBeNull();
    }
    // A slash immediately before a delimiter would change column count.
    expect(replaceMarkdownTableCell(source, t, 0, 0, "x\\")).toBeNull();
  });

  it("validates minimal source patches including empty insertions and Unicode boundaries", () => {
    expect(
      replaceMarkdownSourceRange("a😀\r\nb", { from: 1, to: 3 }, "😀", "X"),
    ).toBe("aX\r\nb");
    expect(replaceMarkdownSourceRange("ab", { from: 1, to: 1 }, "", "X")).toBe(
      "aXb",
    );
    for (const range of [
      { from: -1, to: 1 },
      { from: 2, to: 1 },
      { from: 0, to: 20 },
      { from: 0.5, to: 1 },
      { from: NaN, to: 1 },
      { from: 2, to: 3 },
      { from: 4, to: 5 },
    ]) {
      expect(replaceMarkdownSourceRange("a😀\r\nb", range, "", "X")).toBeNull();
    }
    expect(
      replaceMarkdownSourceRange("abc", { from: 0, to: 1 }, "old", "X"),
    ).toBeNull();
    expect(
      replaceMarkdownSourceRange("a😀", { from: 2, to: 2 }, "", "X"),
    ).toBeNull();
    expect(
      replaceMarkdownSourceRange("a\r\nb", { from: 2, to: 2 }, "", "X"),
    ).toBeNull();
  });

  it("keeps generated rectangular tables and all untouched cells stable across repeated edits", () => {
    const values = [
      "",
      "中文😀",
      "**bold**",
      "`a|b`",
      String.raw`path\\|name`,
      "[x|y](target)",
    ];
    for (let width = 1; width <= 5; width += 1) {
      const header = Array.from({ length: width }, (_, i) => `H${i}`);
      const cells = Array.from({ length: width }, (_, i) =>
        encodeMarkdownTableCell(values[(i + 1) % values.length])!,
      );
      const raw = formatMarkdownTable(
        header,
        [cells, cells],
        header.map(() => "default"),
      )!;
      const source = "prefix\n\n" + raw + "\n\nend\n";
      for (let col = 0; col < width; col += 1) {
        for (const value of values) {
          const current = table(source, 8);
          const output = replaceMarkdownTableCell(
            source,
            current,
            0,
            col,
            value,
          );
          expect(output).not.toBeNull();
          const updated = table(output!, 8);
          const expected = contents(current);
          expected[1][col] = value;
          expect(contents(updated)).toEqual(expected);
          expect(output!.slice(0, 8)).toBe("prefix\n\n");
          expect(output!.slice(updated.to)).toBe("\n\nend\n");
          expect(
            replaceMarkdownTableCell(output!, updated, 0, col, value),
          ).toBe(output);
        }
      }
    }
  });

  it("provides validated canonical formatting only for explicit later structural edits", () => {
    const raw = String.raw`\`a\|b\``.split("\\`").join("`");
    const source = formatMarkdownTable(
      ["A", "B"],
      [[raw, "[x](URL)"]],
      ["center", "right"],
      "\r\n",
    );
    expect(source).toBe(
      `| A | B |\r\n| :---: | ---: |\r\n| ${raw} | [x](URL) |`,
    );
    expect(serializeMarkdownTable(table(source!))).toBe(source);
    expect(formatMarkdownTable([""], [], ["default"])).toBe("|  |\n| --- |");
    expect(formatMarkdownTable([], [], [])).toBeNull();
    expect(formatMarkdownTable(["A"], [["x", "y"]], ["default"])).toBeNull();
    expect(formatMarkdownTable(["A"], [], [])).toBeNull();
    for (const bad of ["unescaped|pipe", "\n", " leading", "trailing "]) {
      expect(formatMarkdownTable(["A"], [[bad]], ["default"])).toBeNull();
    }
  });
});

describe("local table row commands", () => {
  it.each(["\n", "\r\n", "\r"])("inserts/deletes only row tokens, preserving original text and final EOL (%j)", (eol) => {
    for (const suffix of ["", eol, eol + eol + "tail" + eol]) {
      const prefix = "😀 before" + eol + eol;
      const lines = [" A | B ", " :----: | ----: ", " a\\|b | __bold__ ", " `code` | [label](URL) ", " last | 末行 "];
      const source = prefix + lines.join(eol) + suffix;
      const original = table(source, prefix.length);
      for (let index = 0; index <= original.rows.length; index += 1) {
        const inserted = changeMarkdownTableRow(source, original, { type: "insert", index });
        expect(inserted).not.toBeNull();
        const next = table(inserted!, prefix.length);
        const rows = original.rows.map((row) => row.source); rows.splice(index, 0, "|  |  |");
        expect(next.rows.map((row) => row.source)).toEqual(rows);
        expect(next.header.source).toBe(original.header.source);
        expect(next.separator.source).toBe(original.separator.source);
        expect(next.alignments).toEqual(original.alignments);
        expect(inserted!.slice(0, next.from)).toBe(prefix);
        expect(inserted!.slice(next.to)).toBe(suffix);
        expect(changeMarkdownTableRow(inserted!, next, { type: "delete", index })).toBe(source);
      }
      for (let index = 0; index < original.rows.length; index += 1) {
        const removed = changeMarkdownTableRow(source, original, { type: "delete", index })!;
        const next = table(removed, prefix.length);
        expect(next.rows.map((row) => row.source)).toEqual(original.rows.filter((_, i) => i !== index).map((row) => row.source));
        expect(removed.slice(0, next.from)).toBe(prefix); expect(removed.slice(next.to)).toBe(suffix);
      }
    }
  });

  it("inserts a first row in a header-only table and removes the last without touching neighboring tables", () => {
    const first = "| H |\r\n:----:";
    const next = "| Other |\r\n| --- |\r\n| keep |";
    const source = first + "\r\n" + next;
    const added = changeMarkdownTableRow(source, table(source), { type: "insert", index: 0 })!;
    expect(added).toBe(first + "\r\n|  |\r\n" + next);
    expect(changeMarkdownTableRow(added, table(added), { type: "delete", index: 0 })).toBe(source);
    expect(changeMarkdownTableRow(source, table(source), { type: "delete", index: 0 })).toBeNull();
  });

  it("rejects stale/invalid requests and ambiguous candidates instead of changing table boundaries", () => {
    const source = "| A |\n| --- |\n| x |";
    const model = table(source);
    for (const index of [-1, 1.5, 99, NaN, Infinity]) {
      expect(changeMarkdownTableRow(source, model, { type: "insert", index })).toBeNull();
      expect(changeMarkdownTableRow(source, model, { type: "delete", index })).toBeNull();
    }
    expect(changeMarkdownTableRow(source.replace("x", "external"), model, { type: "delete", index: 0 })).toBeNull();
    const ambiguous = "| H |\n| --- |\n| --- |";
    expect(changeMarkdownTableRow(ambiguous, table(ambiguous), { type: "insert", index: 0 })).toBeNull();
  });

  it("keeps generated column counts and every remaining cell token unchanged", () => {
    for (let width = 1; width <= 6; width += 1) {
      const header = Array.from({ length: width }, (_, i) => "H" + i);
      const cells = header.map((_, i) => i % 2 ? "**中文**" : "`x\\|y`");
      const source = formatMarkdownTable(header, [cells], header.map(() => "center"))!;
      const added = changeMarkdownTableRow(source, table(source), { type: "insert", index: 1 })!;
      const next = table(added);
      expect(next.rows).toHaveLength(2);
      expect(next.rows[1].cells).toHaveLength(width);
      expect(next.rows[1].cells.every((cell) => cell.source === "")).toBe(true);
      expect(next.rows[0].cells.map((cell) => cell.source)).toEqual(cells);
      expect(changeMarkdownTableRow(added, next, { type: "delete", index: 1 })).toBe(source);
    }
  });
});

describe("local table column commands", () => {
  const withInsert = (list: readonly string[], at: number, value = "") => [
    ...list.slice(0, at),
    value,
    ...list.slice(at),
  ];
  const without = <T,>(list: readonly T[], at: number) =>
    list.filter((_, i) => i !== at);
  // Every column carries a different loss-sensitive token shape.
  const headerTokens = ["a\\|b", "a\\\\\\|b", "`x\\|y`", "[l\\|abel](URL)", "末**文**"];
  const rowTokens = ["odd\\\\\\|b", "`c\\|d`", "URL", "中文", "\\\\"];
  const lastRowTokens = ["", "", "", "", ""];
  const alignTokens = [":---:", "---:", "---", ":---", ":---:"];
  const alignValues = ["center", "right", "default", "left", "center"] as const;
  const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;

  it.each(["\n", "\r\n", "\r"])(
    "inserts/deletes a column at every boundary, syncing rows, alignments and file edges (%j)",
    (eol) => {
      for (const suffix of ["", eol, eol + eol + "tail" + eol]) {
        const prefix = "😀 before" + eol + eol;
        const source =
          prefix +
          [
            row(headerTokens),
            row(alignTokens),
            row(rowTokens),
            row(lastRowTokens),
          ].join(eol) +
          suffix;
        const original = table(source, prefix.length);
        for (let index = 0; index <= headerTokens.length; index += 1) {
          const inserted = changeMarkdownTableColumn(source, original, {
            type: "insert",
            index,
          });
          expect(inserted).not.toBeNull();
          const next = table(inserted!, prefix.length);
          expect(next.header.cells.map((cell) => cell.source)).toEqual(
            withInsert(headerTokens, index),
          );
          expect(
            next.rows.map((line) => line.cells.map((cell) => cell.source)),
          ).toEqual([
            withInsert(rowTokens, index),
            withInsert(lastRowTokens, index),
          ]);
          expect(next.alignments).toEqual(withInsert(alignValues, index, "default"));
          expect(inserted!.slice(0, next.from)).toBe(prefix);
          expect(inserted!.slice(next.to)).toBe(suffix);
          expect(
            changeMarkdownTableColumn(inserted!, next, {
              type: "delete",
              index,
            }),
          ).toBe(source);
        }
        for (let index = 0; index < headerTokens.length; index += 1) {
          const removed = changeMarkdownTableColumn(source, original, {
            type: "delete",
            index,
          });
          expect(removed).not.toBeNull();
          const next = table(removed!, prefix.length);
          expect(next.header.cells.map((cell) => cell.source)).toEqual(
            without(headerTokens, index),
          );
          expect(
            next.rows.map((line) => line.cells.map((cell) => cell.source)),
          ).toEqual([without(rowTokens, index), without(lastRowTokens, index)]);
          expect(next.alignments).toEqual(without(alignValues, index));
          expect(removed!.slice(0, next.from)).toBe(prefix);
          expect(removed!.slice(next.to)).toBe(suffix);
        }
      }
    },
  );

  it("supports header-only tables, refuses the last column, and canonicalizes only the current table", () => {
    const first = "| A |\r\n:----:";
    const next = "| Other |\r\n| --- |\r\n| keep |";
    const source = first + "\r\n" + next;
    const added = changeMarkdownTableColumn(source, table(source), {
      type: "insert",
      index: 1,
    })!;
    expect(added).toBe("| A |  |\r\n| :---: | --- |\r\n" + next);
    expect(
      changeMarkdownTableColumn(source, table(source), { type: "delete", index: 0 }),
    ).toBeNull();
    const removed = changeMarkdownTableColumn(added, table(added), {
      type: "delete",
      index: 1,
    })!;
    const model = table(removed);
    expect(model.header.cells.map((cell) => cell.source)).toEqual(["A"]);
    expect(model.alignments).toEqual(["center"]);
    expect(model.rows).toHaveLength(0);
    expect(removed.endsWith(next)).toBe(true);
  });

  it("normalizes a non-canonical table body while keeping outer bytes and neighbors untouched", () => {
    const prefix = "前文\n\n";
    const body = " A |  B \r\n :----: |  --- \r\n a | b ";
    const neighbor = "\r\n\r\n| T |\r\n| --- |\r\n| keep |";
    const source = prefix + body + neighbor;
    const original = table(source, prefix.length);
    const added = changeMarkdownTableColumn(source, original, {
      type: "insert",
      index: 0,
    })!;
    expect(added).toBe(
      prefix +
        "|  | A | B |\r\n| --- | :---: | --- |\r\n|  | a | b |" +
        neighbor,
    );
    const next = table(added, prefix.length);
    expect(next.header.cells.map((cell) => cell.source)).toEqual(["", "A", "B"]);
    expect(next.alignments).toEqual(["default", "center", "default"]);
    expect(
      changeMarkdownTableColumn(added, next, { type: "delete", index: 0 }),
    ).toBe(
      prefix + "| A | B |\r\n| :---: | --- |\r\n| a | b |" + neighbor,
    );
  });

  it("rejects stale, out-of-range and boundary-changing requests without touching the source", () => {
    const source = "| A | B |\n| --- | --- |\n| x | y |";
    const model = table(source);
    for (const index of [-1, 0.5, NaN, Infinity, 3, 99]) {
      expect(
        changeMarkdownTableColumn(source, model, { type: "insert", index }),
      ).toBeNull();
      expect(
        changeMarkdownTableColumn(source, model, { type: "delete", index }),
      ).toBeNull();
    }
    expect(
      changeMarkdownTableColumn(source, model, { type: "delete", index: 2 }),
    ).toBeNull();
    const stale = source.replace("x", "external");
    expect(
      changeMarkdownTableColumn(stale, model, { type: "insert", index: 0 }),
    ).toBeNull();
    expect(
      changeMarkdownTableColumn(stale, model, { type: "delete", index: 0 }),
    ).toBeNull();
    const single = "| A |\n| --- |\n| x |";
    expect(
      changeMarkdownTableColumn(single, table(single), { type: "delete", index: 0 }),
    ).toBeNull();
  });
});

describe("column alignment commands", () => {
  it.each(["\n", "\r\n", "\r"])(
    "rewrites only the target separator token, keeping padding and neighbors (%j)",
    (eol) => {
      const prefix = "前文" + eol + eol;
      const lines = ["| **A** | `B\\|x` |", " | :---- |  ---: | ", " a | b "];
      const suffix = eol + eol + "tail" + eol;
      const source = prefix + lines.join(eol) + suffix;
      const original = table(source, prefix.length);
      for (const [index, alignment, token] of [
        [0, "center", ":---:"],
        [1, "default", "---"],
        [0, "right", "---:"],
        [1, "left", ":---"],
      ] as const) {
        const next = changeMarkdownTableAlignment(
          source,
          original,
          index,
          alignment,
        );
        expect(next).not.toBeNull();
        const cell = original.separator.cells[index];
        expect(next).toBe(
          source.slice(0, cell.from) + token + source.slice(cell.to),
        );
        const model = table(next!, prefix.length);
        expect(model.alignments).toEqual(
          original.alignments.map((value, i) =>
            i === index ? alignment : value,
          ),
        );
        expect(model.separator.cells.map((c) => c.source)).toEqual(
          original.separator.cells.map((c, i) => (i === index ? token : c.source)),
        );
        expect(
          [model.header, ...model.rows].every((row, i) =>
            row.cells.every(
              (c, j) =>
                c.source === [original.header, ...original.rows][i].cells[j].source,
            ),
          ),
        ).toBe(true);
        expect(next!.slice(0, model.from)).toBe(prefix);
        expect(next!.slice(model.to)).toBe(suffix);
      }
      // Choosing the current value again is an explicit no-op.
      expect(changeMarkdownTableAlignment(source, original, 0, "left")).toBeNull();
      expect(changeMarkdownTableAlignment(source, original, 1, "right")).toBeNull();
    },
  );

  it("supports pipe-less one-column separators and refuses invalid or stale requests", () => {
    const lone = "| A |\r\n:----:";
    expect(changeMarkdownTableAlignment(lone, table(lone), 0, "default")).toBe(
      "| A |\r\n---",
    );
    expect(changeMarkdownTableAlignment(lone, table(lone), 0, "right")).toBe(
      "| A |\r\n---:",
    );
    const source = "| A | B |\n| --- | --- |\n| a | b |";
    const model = table(source);
    for (const index of [-1, 0.5, NaN, Infinity, 2, 99]) {
      expect(changeMarkdownTableAlignment(source, model, index, "center")).toBeNull();
    }
    expect(
      changeMarkdownTableAlignment(source, model, 0, "diagonal" as never),
    ).toBeNull();
    const stale = source.replace("a |", "x |");
    expect(changeMarkdownTableAlignment(stale, model, 0, "center")).toBeNull();
  });

  it("keeps the exact target-token diff and every row on many-row tables", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => `| x${i} | y |`);
    const source = ["| a\\|b | `c\\|d` |", "| :--- | ---: |", ...rows].join("\n");
    const original = table(source);
    const next = changeMarkdownTableAlignment(source, original, 1, "center");
    expect(next).toBe(source.replace("| ---: |", "| :---: |"));
    const model = table(next!);
    expect(model.rows).toHaveLength(1200);
    expect(model.rows.every((row, i) => row.source === rows[i])).toBe(true);
    expect(model.alignments).toEqual(["left", "center"]);
    expect(changeMarkdownTableAlignment(next!, model, 1, "center")).toBeNull();
  });

  it("applies to columns created by column commands and survives row commands", () => {
    const source = "| A | B |\n| --- | --- |\n| a | b |";
    const inserted = changeMarkdownTableColumn(source, table(source), {
      type: "insert",
      index: 1,
    })!;
    const aligned = changeMarkdownTableAlignment(
      inserted,
      table(inserted),
      1,
      "center",
    )!;
    expect(table(aligned).alignments).toEqual(["default", "center", "default"]);
    const rowed = changeMarkdownTableRow(aligned, table(aligned), {
      type: "insert",
      index: 0,
    })!;
    expect(table(rowed).alignments).toEqual(["default", "center", "default"]);
    const deleted = changeMarkdownTableColumn(rowed, table(rowed), {
      type: "delete",
      index: 1,
    })!;
    expect(table(deleted).alignments).toEqual(["default", "default"]);
  });
});
