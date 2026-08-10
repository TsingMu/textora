import { describe, expect, it } from "vitest";

import { languageExtension, safeLanguageExtension } from "./languageExtensions";
import type { LanguageMode } from "./languageRecognition";

const HIGHLIGHTED_MODES: LanguageMode[] = [
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
];

describe("languageExtension", () => {
  it("为每种已识别语言返回非空扩展", () => {
    for (const mode of HIGHLIGHTED_MODES) {
      expect(languageExtension(mode), `${mode} should map to an extension`).not.toBeNull();
    }
  });

  it("普通文本与尚未接入高亮的 Mermaid 模式不挂任何语言扩展", () => {
    expect(languageExtension("plain-text")).toBeNull();
    expect(languageExtension("mermaid")).toBeNull();
  });
});

describe("safeLanguageExtension", () => {
  it("普通文本与 Mermaid 返回 null，其余返回非空扩展且不抛错", () => {
    expect(safeLanguageExtension("plain-text")).toBeNull();
    expect(safeLanguageExtension("mermaid")).toBeNull();
    for (const mode of HIGHLIGHTED_MODES) {
      expect(() => safeLanguageExtension(mode)).not.toThrow();
      expect(safeLanguageExtension(mode), `${mode} should be non-null`).not.toBeNull();
    }
  });
});
