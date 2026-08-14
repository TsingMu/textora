import { describe, expect, it } from "vitest";

import {
  buildFenceLanguageInsertion,
  suggestFenceLanguages,
} from "./markdownFenceLanguageSuggestions";
import type { OpeningFenceTokenContext } from "./markdownFenceContext";
import { FENCE_LANGUAGE_DIRECTORY } from "./markdownCodeHighlight";

const FULL_CANONICAL_LIST = [
  "javascript",
  "typescript",
  "json",
  "html",
  "css",
  "rust",
  "python",
  "java",
  "shell",
  "sql",
  "toml",
  "yaml",
  "markdown",
  "mermaid",
];

function ctx(from: number, to: number, prefix = ""): OpeningFenceTokenContext {
  return { marker: "`", prefix, from, to };
}

describe("suggestFenceLanguages", () => {
  it("空前缀返回完整 canonical 列表，按目录顺序稳定", () => {
    expect(suggestFenceLanguages("")).toEqual(FULL_CANONICAL_LIST);
  });

  it("canonical 名称前缀命中", () => {
    expect(suggestFenceLanguages("json")).toEqual(["json"]);
    expect(suggestFenceLanguages("mer")).toEqual(["mermaid"]);
    expect(suggestFenceLanguages("java")).toEqual(["javascript", "java"]);
  });

  it("别名前缀检索到对应 canonical（可能同时命中其他 canonical 前缀）", () => {
    expect(suggestFenceLanguages("bash")).toEqual(["shell"]);
    expect(suggestFenceLanguages("yml")).toEqual(["yaml"]);
    expect(suggestFenceLanguages("md")).toEqual(["markdown"]);
    expect(suggestFenceLanguages("rs")).toEqual(["rust"]);
    expect(suggestFenceLanguages("htm")).toEqual(["html"]);
    // "js" 同时命中 javascript（别名 js）与 json（canonical "json" 以 js 起头）。
    expect(suggestFenceLanguages("js")).toEqual(["javascript", "json"]);
  });

  it("同一前缀同时命中 canonical 与别名时仍去重并保持目录顺序", () => {
    // s 命中 shell(canonical)+sh(别名) 与 sql(canonical)，各出现一次。
    expect(suggestFenceLanguages("s")).toEqual(["shell", "sql"]);
    // j 命中 javascript、json、java 三个 canonical。
    expect(suggestFenceLanguages("j")).toEqual(["javascript", "json", "java"]);
    // t 命中 typescript、toml。
    expect(suggestFenceLanguages("t")).toEqual(["typescript", "toml"]);
  });

  it("大小写不敏感过滤", () => {
    expect(suggestFenceLanguages("JS")).toEqual(["javascript", "json"]);
    expect(suggestFenceLanguages("Py")).toEqual(["python"]);
    expect(suggestFenceLanguages("RUST")).toEqual(["rust"]);
    expect(suggestFenceLanguages("Mermaid")).toEqual(["mermaid"]);
  });

  it("无匹配返回空数组", () => {
    expect(suggestFenceLanguages("unknown")).toEqual([]);
    expect(suggestFenceLanguages("zzz")).toEqual([]);
  });

  it("候选集合与预览语言目录 canonical 完全一致", () => {
    const directoryCanonical = FENCE_LANGUAGE_DIRECTORY.map((e) => e.canonical);
    expect(directoryCanonical).toEqual(FULL_CANONICAL_LIST);
  });

  it("任何前缀的结果都只含 canonical、去重且保持目录顺序", () => {
    const allCanonicals = new Set(FULL_CANONICAL_LIST);
    const allAliases = FENCE_LANGUAGE_DIRECTORY.flatMap((e) => e.aliases);
    expect(allAliases.length).toBeGreaterThan(0);
    const prefixes = [
      "",
      ...FULL_CANONICAL_LIST,
      ...allAliases,
      "j",
      "s",
      "t",
      "z",
    ];
    for (const prefix of prefixes) {
      const result = suggestFenceLanguages(prefix);
      expect(new Set(result).size, `prefix=${prefix}`).toBe(result.length);
      let prev = -1;
      for (const canonical of result) {
        expect(allCanonicals.has(canonical), `prefix=${prefix}`).toBe(true);
        const index = FULL_CANONICAL_LIST.indexOf(canonical);
        expect(index, `prefix=${prefix}`).toBeGreaterThan(prev);
        prev = index;
      }
    }
  });
});

describe("buildFenceLanguageInsertion", () => {
  it("用 canonical 替换首个 info token 范围", () => {
    expect(buildFenceLanguageInsertion(ctx(3, 7, "js"), "javascript")).toEqual({
      from: 3,
      to: 7,
      text: "javascript",
    });
  });

  it("光标在 token 中部时仍替换整个首个 token", () => {
    // token "javascript" 占 [3,13)，光标在 "java" 之后；确认 java 仍替换整段。
    expect(buildFenceLanguageInsertion(ctx(3, 13, "java"), "java")).toEqual({
      from: 3,
      to: 13,
      text: "java",
    });
  });

  it("空 token（零宽范围）确认时在该位置插入 canonical", () => {
    expect(buildFenceLanguageInsertion(ctx(3, 3, ""), "json")).toEqual({
      from: 3,
      to: 3,
      text: "json",
    });
  });

  it("canonical 为空时不生成编辑计划", () => {
    expect(buildFenceLanguageInsertion(ctx(3, 7, "js"), "")).toBeNull();
  });
});
