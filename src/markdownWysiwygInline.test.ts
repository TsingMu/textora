import { describe, expect, it } from "vitest";

import {
  escapeInlineText,
  escapeLinkLabel,
  parseInline,
  serializeInline,
} from "./markdownWysiwygInline";

function roundTrip(source: string): string {
  return serializeInline(parseInline(source));
}

describe("parseInline / serializeInline", () => {
  it("parses the five inline formats and round-trips them", () => {
    expect(parseInline("**bold**")).toEqual([
      { type: "bold", marker: "**", text: "bold" },
    ]);
    expect(parseInline("__bold__")).toEqual([
      { type: "bold", marker: "__", text: "bold" },
    ]);
    expect(parseInline("*italic*")).toEqual([
      { type: "italic", marker: "*", text: "italic" },
    ]);
    expect(parseInline("_italic_")).toEqual([
      { type: "italic", marker: "_", text: "italic" },
    ]);
    expect(parseInline("~~strike~~")).toEqual([
      { type: "strike", text: "strike" },
    ]);
    expect(parseInline("`code`")).toEqual([
      { type: "code", text: "code", backticks: 1 },
    ]);
    expect(parseInline("[label](destination)")).toEqual([
      { type: "link", label: "label", destination: "destination" },
    ]);

    for (const source of [
      "**bold**",
      "__bold__",
      "*italic*",
      "_italic_",
      "~~strike~~",
      "`code`",
      "[label](destination)",
    ]) {
      expect(roundTrip(source)).toBe(source);
    }
  });

  it("keeps adjacent format fragments independent", () => {
    expect(parseInline("**a**_b_~~c~~`d`")).toEqual([
      { type: "bold", marker: "**", text: "a" },
      { type: "italic", marker: "_", text: "b" },
      { type: "strike", text: "c" },
      { type: "code", text: "d", backticks: 1 },
    ]);
    expect(roundTrip("**a**_b_~~c~~`d`")).toBe("**a**_b_~~c~~`d`");
  });

  it("degrades nested formatting to literal source", () => {
    expect(parseInline("**a *b* c**")).toEqual([
      { type: "text", text: "**a *b* c**" },
    ]);
    expect(parseInline("~~a `b` c~~")).toEqual([
      { type: "text", text: "~~a `b` c~~" },
    ]);
    expect(parseInline("[a *b*](target)")).toEqual([
      { type: "text", text: "[a *b*](target)" },
    ]);
    expect(roundTrip("**a *b* c**")).toBe("**a *b* c**");
  });

  it("degrades links with titles or ambiguous destinations to literal source", () => {
    expect(parseInline('[label](target "title")')).toEqual([
      { type: "text", text: '[label](target "title")' },
    ]);
    expect(roundTrip('[label](target "title")')).toBe(
      '[label](target "title")',
    );
  });

  it("preserves backslash escapes as literal text", () => {
    expect(parseInline("a\\*b")).toEqual([{ type: "text", text: "a\\*b" }]);
    expect(parseInline("\\*not italic\\*")).toEqual([
      { type: "text", text: "\\*not italic\\*" },
    ]);
    expect(roundTrip("a\\*b")).toBe("a\\*b");
    expect(roundTrip("\\*not italic\\*")).toBe("\\*not italic\\*");
  });

  it("degrades incomplete or unmatched markup to literal source", () => {
    expect(parseInline("**unclosed")).toEqual([
      { type: "text", text: "**unclosed" },
    ]);
    expect(parseInline("*a")).toEqual([{ type: "text", text: "*a" }]);
    expect(parseInline("[no link")).toEqual([
      { type: "text", text: "[no link" },
    ]);
    expect(parseInline("[label](dest")).toEqual([
      { type: "text", text: "[label](dest" },
    ]);
    expect(parseInline("~~")).toEqual([{ type: "text", text: "~~" }]);

    for (const source of [
      "**unclosed",
      "*a",
      "[no link",
      "[label](dest",
      "~~",
    ]) {
      expect(roundTrip(source)).toBe(source);
    }
  });

  it("preserves original delimiters and link destinations", () => {
    expect(parseInline("__bold__")[0]).toEqual({
      type: "bold",
      marker: "__",
      text: "bold",
    });
    expect(parseInline("_italic_")[0]).toEqual({
      type: "italic",
      marker: "_",
      text: "italic",
    });
    const destination = "https://example.invalid/path?a=b&c=d#frag";
    expect(parseInline(`[Textora](${destination})`)[0]).toEqual({
      type: "link",
      label: "Textora",
      destination,
    });
    expect(roundTrip(`[Textora](${destination})`)).toBe(
      `[Textora](${destination})`,
    );
  });

  it("does not treat intraword underscores as emphasis", () => {
    expect(parseInline("snake_case_var")).toEqual([
      { type: "text", text: "snake_case_var" },
    ]);
    expect(roundTrip("snake_case_var")).toBe("snake_case_var");
    expect(parseInline("变量_名称_值")).toEqual([
      { type: "text", text: "变量_名称_值" },
    ]);
    expect(roundTrip("变量_名称_值")).toBe("变量_名称_值");
  });

  it("keeps ordinary marker characters inside formatted text", () => {
    for (const source of [
      "**cost ~5**",
      "**snake_case**",
      "**array[index]**",
      "**2*3**",
    ]) {
      expect(parseInline(source)[0]?.type).toBe("bold");
      expect(roundTrip(source)).toBe(source);
    }
  });

  it("treats backslashes as literal inside code spans", () => {
    expect(parseInline("`a\\`b`")).toEqual([
      { type: "code", text: "a\\", backticks: 1 },
      { type: "text", text: "b`" },
    ]);
    expect(roundTrip("`a\\`b`")).toBe("`a\\`b`");
  });

  it("round-trips the spec examples and mixed runs", () => {
    const samples = [
      "**状态**：待开始",
      "_注意事项_",
      "~~已取消~~",
      "使用 `docs/tasks/current.md` 路径",
      "[Textora](https://example.invalid)",
      "text **bold** more _italic_ end ~~st~~ `c`",
      "``code with ` backtick``",
      "",
      "plain text",
      "a*b*c*d",
      "2*3*4",
    ];
    for (const source of samples) {
      expect(roundTrip(source)).toBe(source);
    }
  });
});

describe("serializeInline editing safety", () => {
  it("drops empty format fragments without touching neighbours", () => {
    expect(serializeInline([{ type: "bold", marker: "**", text: "" }])).toBe("");
    expect(
      serializeInline([{ type: "italic", marker: "*", text: "" }]),
    ).toBe("");
    expect(serializeInline([{ type: "strike", text: "" }])).toBe("");
    expect(serializeInline([{ type: "code", text: "", backticks: 1 }])).toBe("");
    expect(
      serializeInline([{ type: "link", label: "", destination: "x" }]),
    ).toBe("");
    expect(
      serializeInline([
        { type: "italic", marker: "*", text: "" },
        { type: "text", text: "a" },
        { type: "bold", marker: "**", text: "" },
      ]),
    ).toBe("a");
  });

  it("grows the code span fence when content needs more backticks", () => {
    expect(
      serializeInline([{ type: "code", text: "a`b", backticks: 1 }]),
    ).toBe("``a`b``");
    expect(
      serializeInline([{ type: "code", text: "a``b", backticks: 1 }]),
    ).toBe("```a``b```");
    // Edited down to fewer backticks still keeps the stored fence for stability.
    expect(
      serializeInline([{ type: "code", text: "plain", backticks: 2 }]),
    ).toBe("``plain``");
  });
});

describe("escapeInlineText", () => {
  it("escapes inline-significant characters so edited text stays literal", () => {
    expect(escapeInlineText("a*b_c~d`e[f")).toBe("a\\*b\\_c\\~d\\`e\\[f");
    expect(escapeInlineText("back\\slash")).toBe("back\\\\slash");
    expect(escapeInlineText("plain text 123")).toBe("plain text 123");
  });

  it("produces text that re-parses as a single literal text node", () => {
    const edited = "now with **stars** and `ticks`";
    const escaped = escapeInlineText(edited);
    expect(parseInline(escaped)).toEqual([{ type: "text", text: escaped }]);
  });

  it("escapes closing brackets when text is used as a link label", () => {
    expect(escapeLinkLabel("a]b")).toBe("a\\]b");
    expect(parseInline(`[${escapeLinkLabel("a]b")}](target)`)).toEqual([
      { type: "link", label: "a\\]b", destination: "target" },
    ]);
  });
});
