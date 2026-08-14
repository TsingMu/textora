import { describe, expect, it } from "vitest";

import {
  FENCE_LANGUAGE_DIRECTORY,
  renderHighlightedCodeBlock,
  resolveMarkdownCodeBlockLanguage,
} from "./markdownCodeHighlight";

describe("FENCE_LANGUAGE_DIRECTORY", () => {
  it("canonical 顺序与首版候选词表一致", () => {
    expect(FENCE_LANGUAGE_DIRECTORY.map((e) => e.canonical)).toEqual([
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
    ]);
  });

  it("canonical 与每个别名都按目录映射到同一高亮语言，证明目录是高亮解析的单一来源", () => {
    for (const entry of FENCE_LANGUAGE_DIRECTORY) {
      // mermaid 在高亮解析中显式返回 null（由图表渲染接管）。
      if (entry.canonical === "mermaid") {
        expect(resolveMarkdownCodeBlockLanguage(entry.canonical)).toBeNull();
        continue;
      }
      expect(resolveMarkdownCodeBlockLanguage(entry.canonical)).toBe(
        entry.previewTarget,
      );
      for (const alias of entry.aliases) {
        expect(resolveMarkdownCodeBlockLanguage(alias)).toBe(entry.previewTarget);
      }
    }
  });

  it("大小写不敏感识别仍然成立", () => {
    expect(resolveMarkdownCodeBlockLanguage("RUST")).toBe("rust");
    expect(resolveMarkdownCodeBlockLanguage("Py")).toBe("python");
  });
});

describe("resolveMarkdownCodeBlockLanguage", () => {
  it("按 info string 首个 token 大小写不敏感识别常见语言别名", () => {
    expect(resolveMarkdownCodeBlockLanguage("TS title=\"demo\"")).toBe(
      "typescript",
    );
    expect(resolveMarkdownCodeBlockLanguage("tsx")).toBe("typescript");
    expect(resolveMarkdownCodeBlockLanguage("js")).toBe("javascript");
    expect(resolveMarkdownCodeBlockLanguage("bash")).toBe("shell");
    expect(resolveMarkdownCodeBlockLanguage("yml")).toBe("yaml");
    expect(resolveMarkdownCodeBlockLanguage("md")).toBe("markdown");
  });

  it("未知、空白与 Mermaid 语言不走普通代码高亮", () => {
    expect(resolveMarkdownCodeBlockLanguage("")).toBeNull();
    expect(resolveMarkdownCodeBlockLanguage("   ")).toBeNull();
    expect(resolveMarkdownCodeBlockLanguage("unknown")).toBeNull();
    expect(resolveMarkdownCodeBlockLanguage("Mermaid")).toBeNull();
  });
});

describe("renderHighlightedCodeBlock", () => {
  it("为受支持语言输出 CodeMirror token class", () => {
    const html = renderHighlightedCodeBlock("const answer = 42;", "ts");

    expect(html).toContain('class="tok-keyword"');
    expect(html).toContain('class="tok-number"');
    expect(html).toContain("const");
    expect(html).toContain("42");
  });

  it("覆盖首版语言集合的基础高亮契约", () => {
    const cases = [
      ["let x = 1;", "javascript"],
      ["type Answer = number;", "typescript"],
      ['{"ok": true}', "json"],
      ["<main>Hello</main>", "html"],
      [".button { color: red; }", "css"],
      ["fn main() {}", "rust"],
      ["def answer():\n    return 42", "python"],
      ["class Demo {}", "java"],
      ["echo hello", "shell"],
      ["select * from notes", "sql"],
      ["name = \"textora\"", "toml"],
      ["name: textora", "yaml"],
      ["# Title\n\n`code`", "markdown"],
    ] as const;

    for (const [code, language] of cases) {
      expect(
        renderHighlightedCodeBlock(code, language),
        `${language} should emit highlighted spans`,
      ).toContain("<span");
    }
  });

  it("未知语言退化为已转义的普通代码文本", () => {
    const html = renderHighlightedCodeBlock("<script>alert(1)</script>", "wat");

    expect(html).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<span");
  });

  it("高亮语言中的原始 HTML 仍按文本转义", () => {
    const html = renderHighlightedCodeBlock(
      'const html = "<img src=x onerror=alert(1)>";',
      "ts",
    );

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="');
  });
});
