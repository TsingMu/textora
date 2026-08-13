import { describe, expect, it } from "vitest";

import { collectMarkdownBlockMap } from "./markdownPreview";

describe("collectMarkdownBlockMap", () => {
  it("returns no blocks for empty or blank-only source", () => {
    expect(collectMarkdownBlockMap("")).toEqual([]);
    expect(collectMarkdownBlockMap("\n\n  \n")).toEqual([]);
  });

  it("maps a multi-line paragraph to its source line range", () => {
    // 两行非空、非块起始 → 同一段落。
    const map = collectMarkdownBlockMap("hello\nworld");
    expect(map).toEqual([
      { index: 0, kind: "paragraph", startLine: 0, endLine: 2 },
    ]);
  });

  it("records heading and paragraph ranges with blank lines skipped", () => {
    const map = collectMarkdownBlockMap("# Title\n\nText.");
    expect(map).toEqual([
      { index: 0, kind: "heading", startLine: 0, endLine: 1 },
      { index: 1, kind: "paragraph", startLine: 2, endLine: 3 },
    ]);
  });

  it("maps a fenced code block across opening, content and closing lines", () => {
    const map = collectMarkdownBlockMap("```js\nconst x = 1;\n```");
    expect(map).toEqual([
      { index: 0, kind: "fence", startLine: 0, endLine: 3 },
    ]);
  });

  it("detects a mermaid fenced block without needing preview content", () => {
    const map = collectMarkdownBlockMap("```mermaid\ngraph TD\nA-->B\n```");
    expect(map).toEqual([
      { index: 0, kind: "mermaid", startLine: 0, endLine: 4 },
    ]);
  });

  it("maps unordered and task list items as a single list block", () => {
    const map = collectMarkdownBlockMap("- a\n- [x] b\n- c");
    expect(map).toEqual([
      { index: 0, kind: "list", startLine: 0, endLine: 3 },
    ]);
  });

  it("maps an ordered list as a single list block", () => {
    const map = collectMarkdownBlockMap("1. one\n2. two");
    expect(map).toEqual([
      { index: 0, kind: "list", startLine: 0, endLine: 2 },
    ]);
  });

  it("maps a GFM table across header, separator and body rows", () => {
    const map = collectMarkdownBlockMap("| h1 | h2 |\n| --- | --- |\n| a | b |");
    expect(map).toEqual([
      { index: 0, kind: "table", startLine: 0, endLine: 3 },
    ]);
  });

  it("maps a blockquote spanning multiple quote lines", () => {
    const map = collectMarkdownBlockMap("> quote\n> more");
    expect(map).toEqual([
      { index: 0, kind: "blockquote", startLine: 0, endLine: 2 },
    ]);
  });

  it("maps a thematic break (hr)", () => {
    const map = collectMarkdownBlockMap("intro\n---");
    expect(map).toEqual([
      { index: 0, kind: "paragraph", startLine: 0, endLine: 1 },
      { index: 1, kind: "hr", startLine: 1, endLine: 2 },
    ]);
  });

  it("assigns consecutive ordinals across mixed blocks and skips blank lines", () => {
    const map = collectMarkdownBlockMap("# H\n\np1\n\n- a\n- b");
    expect(map.map((b) => [b.index, b.kind, b.startLine, b.endLine])).toEqual([
      [0, "heading", 0, 1],
      [1, "paragraph", 2, 3],
      [2, "list", 4, 6],
    ]);
    // 序号等于位置，连续无间断。
    expect(map.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it("maps consecutive fenced blocks independently", () => {
    const map = collectMarkdownBlockMap("```js\na\n```\n```mermaid\nb\n```");
    expect(map).toEqual([
      { index: 0, kind: "fence", startLine: 0, endLine: 3 },
      { index: 1, kind: "mermaid", startLine: 3, endLine: 6 },
    ]);
  });
});
