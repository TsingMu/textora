import { describe, expect, it } from "vitest";

import {
  parseMarkdownWysiwygBlocks,
  parseMarkdownWysiwygDocument,
  replaceWysiwygBlock,
  serializeMarkdownWysiwygBlock,
  serializeMarkdownWysiwygBlocks,
  type MarkdownWysiwygBlock,
} from "./markdownWysiwyg";

describe("parseMarkdownWysiwygBlocks", () => {
  it.each([1, 2, 3, 4, 5, 6])(
    "parses incomplete level %i headings and subsequent edits without hanging",
    (level) => {
      const hashes = "#".repeat(level);
      for (const suffix of ["", " ", "\t"]) {
        expect(parseMarkdownWysiwygBlocks(hashes + suffix)).toEqual([
          { type: "paragraph", text: hashes },
        ]);
      }
      for (const suffix of ["  ", " \t", "\t "]) {
        expect(parseMarkdownWysiwygBlocks(hashes + suffix)).toHaveLength(1);
      }
      expect(parseMarkdownWysiwygBlocks(`${hashes} Title`)).toEqual([
        { type: "heading", level, text: "Title" },
      ]);
      expect(
        parseMarkdownWysiwygBlocks(`before\n${hashes} \nafter\n# End`),
      ).toEqual([
        { type: "paragraph", text: `before ${hashes} after` },
        { type: "heading", level: 1, text: "End" },
      ]);
    },
  );

  it("parses first-version editable block types", () => {
    const blocks = parseMarkdownWysiwygBlocks(`# Title

Paragraph text
continues here.

- [x] done
- [ ] todo

> quote
> line

\`\`\`json
{"ok":true}
\`\`\`

---
`);

    expect(blocks).toEqual([
      { type: "heading", level: 1, text: "Title" },
      { type: "paragraph", text: "Paragraph text continues here." },
      {
        type: "list",
        ordered: false,
        items: [
          { text: "done", taskState: "checked" },
          { text: "todo", taskState: "unchecked" },
        ],
      },
      { type: "blockquote", text: "quote\nline" },
      { type: "code", language: "json", code: '{"ok":true}' },
      { type: "horizontal-rule" },
    ]);
  });

  it("structures supported tables while preserving HTML, Mermaid and unknown source islands", () => {
    const blocks = parseMarkdownWysiwygBlocks(`| A | B |
| --- | --- |
| 1 | 2 |

<div onclick="bad()">raw</div>

\`\`\`mermaid
flowchart TD
A-->B
\`\`\`

\`\`\`custom
keep me
\`\`\`
`);

    expect(blocks).toEqual([
      {
        type: "table",
        table: expect.objectContaining({ rawSource: "| A | B |\n| --- | --- |\n| 1 | 2 |" }),
      },
      {
        type: "source",
        reason: "html",
        source: '<div onclick="bad()">raw</div>',
      },
      {
        type: "source",
        reason: "mermaid",
        source: "```mermaid\nflowchart TD\nA-->B\n```",
      },
      {
        type: "source",
        reason: "unknown-fence",
        source: "```custom\nkeep me\n```",
      },
    ]);
  });
});

describe("serializeMarkdownWysiwygBlocks", () => {
  it("serializes edited blocks back to Markdown source", () => {
    const blocks: MarkdownWysiwygBlock[] = [
      { type: "heading", level: 2, text: "Edited" },
      { type: "paragraph", text: "Updated paragraph." },
      {
        type: "list",
        ordered: true,
        items: [
          { text: "first", taskState: null },
          { text: "second", taskState: null },
        ],
      },
      { type: "blockquote", text: "note\nagain" },
      { type: "code", language: "json", code: '{\n  "ok": true\n}' },
      { type: "horizontal-rule" },
    ];

    expect(serializeMarkdownWysiwygBlocks(blocks)).toBe(`## Edited

Updated paragraph.

1. first
2. second

> note
> again

\`\`\`json
{
  "ok": true
}
\`\`\`

---`);
  });

  it("preserves source islands exactly during serialization", () => {
    const source = "```mermaid\nflowchart TD\nA-->B\n```";

    expect(
      serializeMarkdownWysiwygBlocks([
        { type: "heading", level: 1, text: "Diagram" },
        { type: "source", reason: "mermaid", source },
      ]),
    ).toBe(`# Diagram

${source}`);
  });
});

describe("located WYSIWYG document and local patches", () => {
  it.each(["\n", "\r\n", "\r"])(
    "locates every block in original source without consuming separators (%j)",
    (eol) => {
      const chunks = [
        "## 😀 标题 ###  ",
        "paragraph\ncontinuation",
        "3. first\n4. next",
        "> quote\n> line",
        "```json\n{}\n```",
        "---",
        "| A | B |\n| --- | --- |\n| a | b |",
        "| invalid | table |\n| --- | --- |\n| too | many | cells |",
        "<div>html</div>",
        "```custom\nraw\n```",
        "```mermaid\ngraph TD\nA-->B\n```",
        "    unknown text",
      ].map((chunk) => chunk.replace(/\n/g, eol));
      const source = eol + chunks.join(eol + " " + eol + eol) + eol;
      const { blocks, ranges } = parseMarkdownWysiwygDocument(source);
      expect(blocks.map((block) => block.type)).toEqual([
        "heading",
        "paragraph",
        "list",
        "blockquote",
        "code",
        "horizontal-rule",
        "table",
        "source",
        "source",
        "source",
        "source",
        "source",
      ]);
      expect(ranges.map((range) => source.slice(range.from, range.to))).toEqual(
        chunks,
      );
      expect(parseMarkdownWysiwygBlocks(source)).toEqual(blocks);
      expect(source.slice(ranges[ranges.length - 1].to)).toBe(eol);
      for (let i = 1; i < ranges.length; i += 1)
        expect(ranges[i].from).toBeGreaterThan(ranges[i - 1].to);
    },
  );

  it("patches a single non-table block, preserving tables, blank lines and trailing EOL exactly", () => {
    const source =
      "\r\n## 标题 ###  \r\n \r\n\r\n | A | B |\r\n | ---- | :---: |\r\n | `x` | __b__ |\r\n\r\nTail\r\n";
    const { blocks, ranges } = parseMarkdownWysiwygDocument(source);
    const target = ranges[0];
    const expectedRaw = source.slice(target.from, target.to);
    const changed: MarkdownWysiwygBlock = {
      type: "heading",
      level: 2,
      text: "新标题",
    };
    expect(
      replaceWysiwygBlock(
        source,
        target,
        expectedRaw,
        serializeMarkdownWysiwygBlock(changed),
      ),
    ).toBe(source.replace(expectedRaw, "## 新标题"));
    for (const range of ranges) {
      const raw = source.slice(range.from, range.to);
      expect(replaceWysiwygBlock(source, range, raw, raw)).toBe(source);
    }
    expect(blocks[1]).toMatchObject({
      type: "table",
      table: { rawSource: " | A | B |\r\n | ---- | :---: |\r\n | `x` | __b__ |" },
    });
  });

  it("does not let supported tables absorb following paragraphs or adjacent tables", () => {
    const first = "| A |\n| --- |\n| x |";
    const second = "| B |\n| --- |\n| y |";
    const source = first + "\n" + second + "\nplain paragraph\n# End";
    const result = parseMarkdownWysiwygDocument(source);
    expect(result.blocks).toEqual([
      { type: "table", table: expect.objectContaining({ rawSource: first }) },
      { type: "table", table: expect.objectContaining({ rawSource: second }) },
      { type: "paragraph", text: "plain paragraph" },
      { type: "heading", level: 1, text: "End" },
    ]);
    expect(result.ranges.map((r) => source.slice(r.from, r.to))).toEqual([
      first,
      second,
      "plain paragraph",
      "# End",
    ]);
  });

  it("keeps every row of malformed table candidates as source without eating following blocks", () => {
    const invalid =
      "| A | B |\n| -- | --- |\n| too | many | cells |\n| still | here |";
    const source = "before\n" + invalid + "\nafter";
    expect(parseMarkdownWysiwygBlocks(source)).toEqual([
      { type: "paragraph", text: "before" },
      { type: "source", reason: "table", source: invalid },
      { type: "paragraph", text: "after" },
    ]);
  });

  it("preserves original raw source islands and legacy unclosed code text with trailing EOL", () => {
    const source = "```custom\r\nraw\r\n";
    const result = parseMarkdownWysiwygDocument(source);
    expect(result.blocks).toEqual([
      { type: "source", reason: "unknown-fence", source: "```custom\r\nraw" },
    ]);
    expect(result.ranges).toEqual([{ from: 0, to: source.length - 2 }]);
    expect(parseMarkdownWysiwygBlocks("```json\nx\n")).toEqual([
      { type: "code", language: "json", code: "x\n" },
    ]);
    const located = parseMarkdownWysiwygDocument("```json\nx\n");
    expect(located.ranges).toEqual([{ from: 0, to: 9 }]);
    expect(parseMarkdownWysiwygDocument("```\n").ranges).toEqual([
      { from: 0, to: 3 },
    ]);
  });

  it("rejects stale source and invalid ranges without modifying content", () => {
    const source = "# Title\n\nText";
    const { ranges } = parseMarkdownWysiwygDocument(source);
    expect(
      replaceWysiwygBlock(source, ranges[0], "stale", "# Other"),
    ).toBeNull();
    expect(
      replaceWysiwygBlock(source, { from: -1, to: 3 }, "", "new"),
    ).toBeNull();
    expect(
      replaceWysiwygBlock(source, { from: 4, to: 3 }, "", "new"),
    ).toBeNull();
    expect(
      replaceWysiwygBlock(source, { from: 0, to: 999 }, source, "new"),
    ).toBeNull();
    expect(
      replaceWysiwygBlock(source, { from: 1.5, to: 3 }, "", "new"),
    ).toBeNull();
  });

  it("always advances and produces bounded nonoverlapping original ranges on incomplete syntax", () => {
    const inputs = [
      "",
      "\n \r\n",
      "#",
      "## ",
      "##\t",
      "```",
      "```\n",
      "|",
      "||",
      "| A |\n| -- |",
      "| A |\n| --- |\n| a | b |",
      "<div>",
      "    code",
      "---",
      "- ",
      "> ",
    ];
    for (const eol of ["\n", "\r\n", "\r"]) {
      for (const input of inputs) {
        const source = input.replace(/\n/g, eol);
        const { blocks, ranges } = parseMarkdownWysiwygDocument(source);
        expect(ranges).toHaveLength(blocks.length);
        let end = 0;
        for (const range of ranges) {
          expect(range.from).toBeGreaterThanOrEqual(end);
          expect(range.to).toBeGreaterThan(range.from);
          expect(range.to).toBeLessThanOrEqual(source.length);
          expect(source.slice(range.from, range.to)).not.toMatch(/[\r\n]$/);
          end = range.to;
        }
      }
    }
  });
});

describe("top-level table subset", () => {
  it("keeps list-contained tables as source islands and never interprets quote contents as tables", () => {
    const nested = "  | A | B |\n  | --- | --- |\n  | 1 | 2 |";
    const source = "- item\n\n" + nested + "\n\n> | A |\n> | --- |\n\n| top |\n| --- |";
    const blocks = parseMarkdownWysiwygBlocks(source);
    expect(blocks.map((block) => block.type)).toEqual(["list", "source", "blockquote", "table"]);
    expect(blocks[1]).toEqual({ type: "source", reason: "table", source: nested });
  });
});

describe("table block serialization", () => {
  it.each(["\n", "\r\n", "\r"])("reuses every unedited table token (%j)", (eol) => {
    const source = [" A | B ", " :----: | ---: ", " **中文** | `a\\|b` "].join(eol);
    const [block] = parseMarkdownWysiwygBlocks(source);
    expect(block.type).toBe("table");
    expect(serializeMarkdownWysiwygBlock(block)).toBe(source);
  });
});
