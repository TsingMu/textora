import { describe, expect, it } from "vitest";

import {
  parseMarkdownWysiwygBlocks,
  serializeMarkdownWysiwygBlocks,
  type MarkdownWysiwygBlock,
} from "./markdownWysiwyg";

describe("parseMarkdownWysiwygBlocks", () => {
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

  it("keeps tables, raw HTML, Mermaid and unknown fences as source islands", () => {
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
        type: "source",
        reason: "table",
        source: "| A | B |\n| --- | --- |\n| 1 | 2 |",
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
