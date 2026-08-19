import { describe, expect, it } from "vitest";
import {
  cursorPositionFromFacts,
  displayColumnBefore,
  graphemeDisplaySegments,
} from "./cursorPosition";

describe("displayColumnBefore", () => {
  it("keeps column 1 at the start of a line and counts ASCII clusters", () => {
    expect(displayColumnBefore("", 4)).toBe(1);
    expect(displayColumnBefore("abc", 4)).toBe(4);
  });

  it("advances tabs to the next tab stop", () => {
    expect(displayColumnBefore("\t", 4)).toBe(5);
    expect(displayColumnBefore("\t\t", 4)).toBe(9);
    expect(displayColumnBefore("a\t", 4)).toBe(5);
    expect(displayColumnBefore("\tab", 4)).toBe(7);
    expect(displayColumnBefore("\t", 2)).toBe(3);
  });

  it("counts wide and fullwidth characters as two columns", () => {
    expect(displayColumnBefore("中", 4)).toBe(3);
    expect(displayColumnBefore("a中", 4)).toBe(4);
    expect(displayColumnBefore("！", 4)).toBe(3);
    expect(displayColumnBefore("ｱ", 4)).toBe(2); // 半角片假名占 1 列
  });

  it("counts emoji presentation clusters as one two-column cluster", () => {
    expect(displayColumnBefore("👍", 4)).toBe(3); // 代理对是单个字素簇
    expect(displayColumnBefore("👨‍👩‍👧", 4)).toBe(3); // ZWJ 家庭 emoji 只算一簇
    expect(displayColumnBefore("❤️", 4)).toBe(3); // VS16 强制 emoji 呈现
    expect(displayColumnBefore("☺︎", 4)).toBe(2); // VS15 文本呈现占 1 列
    expect(displayColumnBefore("☺", 4)).toBe(2); // 低位符号 emoji 未确认展示态，按 1 列
  });

  it("counts BMP default-presentation emoji without VS16 as two columns", () => {
    expect(displayColumnBefore("⌚", 4)).toBe(3); // U+231A 默认 emoji 呈现
    expect(displayColumnBefore("♿", 4)).toBe(3); // U+267F 默认 emoji 呈现
    expect(displayColumnBefore("⌚♿", 4)).toBe(5);
    // VS15 仍强制文本呈现为 1 列。
    expect(displayColumnBefore("⌚︎", 4)).toBe(2);
    expect(displayColumnBefore("♿︎", 4)).toBe(2);
  });

  it("does not add width for combining marks inside a cluster", () => {
    expect(displayColumnBefore("é", 4)).toBe(2); // e + 组合锐音符
    expect(displayColumnBefore("が", 4)).toBe(3); // 浊音假名仍是一个宽簇
  });
  it("counts pure zero-width graphemes as zero columns", () => {
    expect(displayColumnBefore("\u200B", 4)).toBe(1); // U+200B 零宽空格
    expect(displayColumnBefore("\u200C\u200D", 4)).toBe(1); // 连接符/零宽连接残段
    expect(displayColumnBefore("a\u200Bb", 4)).toBe(3); // 零宽空格不推进列
    // 孤立组合标记（无基础字符）同样不占列。
    expect(displayColumnBefore("\u0301", 4)).toBe(1);
  });

  it("safely degrades unclassifiable characters to one column", () => {
    expect(displayColumnBefore("\u0001\u0002", 4)).toBe(3);
  });
});

describe("graphemeDisplaySegments", () => {
  it("shares grapheme ranges and widths with visual cell rendering", () => {
    expect(Array.from(graphemeDisplaySegments("测a👍"))).toEqual([
      { segment: "测", from: 0, to: 1, width: 2 },
      { segment: "a", from: 1, to: 2, width: 1 },
      { segment: "👍", from: 2, to: 4, width: 2 },
    ]);
  });
});

describe("cursorPositionFromFacts", () => {
  it("derives the 1-based line and display column from editor facts", () => {
    expect(
      cursorPositionFromFacts({ lineNumber: 1, lineText: "", headOffsetInLine: 0, tabSize: 4 }),
    ).toEqual({ line: 1, column: 1 });

    expect(
      cursorPositionFromFacts({
        lineNumber: 3,
        lineText: "a\t中👍",
        headOffsetInLine: "a\t中👍".length,
        tabSize: 4,
      }),
    ).toEqual({ line: 3, column: 9 });

    // 只统计 head 之前的前缀。
    expect(
      cursorPositionFromFacts({ lineNumber: 2, lineText: "中👍", headOffsetInLine: 1, tabSize: 4 }),
    ).toEqual({ line: 2, column: 3 });
  });
});
