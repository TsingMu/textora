import { describe, expect, it } from "vitest";

import {
  detectLanguage,
  isLanguageMode,
  languageDisplayName,
  LANGUAGE_MODES,
  suggestedSaveFileName,
  type LanguageMode,
} from "./languageRecognition";

describe("detectLanguage", () => {
  describe("扩展名识别", () => {
    const cases: Array<[string, LanguageMode]> = [
      ["app.js", "javascript"],
      ["app.mjs", "javascript"],
      ["app.cjs", "javascript"],
      ["app.jsx", "javascript"],
      ["app.ts", "typescript"],
      ["app.mts", "typescript"],
      ["app.cts", "typescript"],
      ["app.tsx", "typescript"],
      ["config.json", "json"],
      ["page.html", "html"],
      ["page.htm", "html"],
      ["styles.css", "css"],
      ["main.rs", "rust"],
      ["script.py", "python"],
      ["App.java", "java"],
      ["deploy.sh", "shell"],
      ["deploy.bash", "shell"],
      ["query.sql", "sql"],
      ["cargo.toml", "toml"],
      ["values.yaml", "yaml"],
      ["values.yml", "yaml"],
      ["README.md", "markdown"],
      ["README.markdown", "markdown"],
      ["diagram.mmd", "mermaid"],
      ["diagram.mermaid", "mermaid"],
    ];

    for (const [fileName, expected] of cases) {
      it(`${fileName} → ${expected}`, () => {
        expect(detectLanguage(null, fileName)).toBe(expected);
      });
    }
  });

  it("扩展名大小写不敏感", () => {
    expect(detectLanguage(null, "App.TS")).toBe("typescript");
    expect(detectLanguage(null, "App.TSX")).toBe("typescript");
    expect(detectLanguage(null, "script.PY")).toBe("python");
    expect(detectLanguage(null, "config.JSON")).toBe("json");
    expect(detectLanguage(null, "README.MD")).toBe("markdown");
    expect(detectLanguage(null, "diagram.MMD")).toBe("mermaid");
    expect(detectLanguage(null, "diagram.MERMAID")).toBe("mermaid");
  });

  it("完整文件名优先于扩展名匹配", () => {
    expect(detectLanguage(null, "package.json")).toBe("json");
    expect(detectLanguage(null, "tsconfig.json")).toBe("json");
    expect(detectLanguage(null, "jsconfig.json")).toBe("json");
    expect(detectLanguage(null, "Cargo.toml")).toBe("toml");
    expect(detectLanguage(null, "pyproject.toml")).toBe("toml");
    // 复合文件名同样大小写不敏感。
    expect(detectLanguage(null, "PACKAGE.JSON")).toBe("json");
  });

  it("Untitled 与无扩展名/未知扩展名退化为普通文本", () => {
    expect(detectLanguage(null, "Untitled")).toBe("plain-text");
    expect(detectLanguage(null, "Untitled 2")).toBe("plain-text");
    expect(detectLanguage(null, "Makefile")).toBe("plain-text");
    expect(detectLanguage(null, "notes.txt")).toBe("plain-text");
    expect(detectLanguage(null, "archive.xyz")).toBe("plain-text");
    // 隐藏文件（点开头）不计为有扩展名。
    expect(detectLanguage(null, ".gitignore")).toBe("plain-text");
    // 多段扩展名只取最后一段；gz 未识别。
    expect(detectLanguage(null, "archive.tar.gz")).toBe("plain-text");
  });

  it("从完整路径取文件名后再识别", () => {
    expect(detectLanguage("/Users/me/project/app.tsx", "app.tsx")).toBe(
      "typescript",
    );
    expect(detectLanguage("/home/u/cfg/Cargo.toml", "Cargo.toml")).toBe("toml");
    expect(detectLanguage("/a/b/c/deploy.SH", "deploy.SH")).toBe("shell");
    // path 为空时回退到 displayName。
    expect(detectLanguage(null, "script.py")).toBe("python");
  });

  it("Untitled 路径为 null 时按显示名退化为普通文本", () => {
    expect(detectLanguage(null, "Untitled")).toBe("plain-text");
  });
});

describe("languageDisplayName", () => {
  it("返回每种模式的展示名", () => {
    const cases: Array<[LanguageMode, string]> = [
      ["javascript", "JavaScript"],
      ["typescript", "TypeScript"],
      ["json", "JSON"],
      ["html", "HTML"],
      ["css", "CSS"],
      ["rust", "Rust"],
      ["python", "Python"],
      ["java", "Java"],
      ["shell", "Shell"],
      ["sql", "SQL"],
      ["toml", "TOML"],
      ["yaml", "YAML"],
      ["markdown", "Markdown"],
      ["mermaid", "Mermaid"],
      ["plain-text", "Plain Text"],
    ];
    for (const [mode, expected] of cases) {
      expect(languageDisplayName(mode)).toBe(expected);
    }
  });

  it("未识别文件经 detectLanguage 后展示为 Plain Text", () => {
    const mode = detectLanguage(null, "notes.xyz");
    expect(languageDisplayName(mode)).toBe("Plain Text");
  });
});

describe("isLanguageMode", () => {
  it("固定清单包含 Plain Text 与全部源码模式且不重复", () => {
    expect(LANGUAGE_MODES).toHaveLength(15);
    expect(LANGUAGE_MODES[0]).toBe("plain-text");
    expect(new Set(LANGUAGE_MODES).size).toBe(LANGUAGE_MODES.length);
    for (const mode of LANGUAGE_MODES) {
      expect(languageDisplayName(mode)).not.toBe("");
    }
  });

  it("接受清单内模式并拒绝未知载荷", () => {
    for (const mode of LANGUAGE_MODES) {
      expect(isLanguageMode(mode)).toBe(true);
    }
    for (const value of [
      "",
      "cobol",
      "java2",
      "textora-syntax-java",
      "Plain Text",
      undefined,
      null,
      7,
      {},
    ]) {
      expect(isLanguageMode(value)).toBe(false);
    }
  });
});

describe("suggestedSaveFileName", () => {
  it("为全部 15 种模式固定首选后缀边界", () => {
    const expectedSuffixes: Record<LanguageMode, string | null> = {
      "plain-text": null,
      javascript: "js",
      typescript: "ts",
      json: "json",
      html: "html",
      css: "css",
      rust: "rs",
      python: "py",
      java: "java",
      shell: "sh",
      sql: "sql",
      toml: "toml",
      yaml: "yaml",
      markdown: "md",
      mermaid: "mmd",
    };
    expect(LANGUAGE_MODES).toHaveLength(
      Object.keys(expectedSuffixes).length,
    );
    for (const mode of LANGUAGE_MODES) {
      const suffix = expectedSuffixes[mode];
      expect(suggestedSaveFileName("Untitled", mode)).toBe(
        suffix === null ? "Untitled" : `Untitled.${suffix}`,
      );
    }
  });

  it("直接追加完整显示名，不替换编号或其他字符", () => {
    expect(suggestedSaveFileName("Untitled 2", "plain-text")).toBe(
      "Untitled 2",
    );
    expect(suggestedSaveFileName("Untitled 2", "java")).toBe("Untitled 2.java");
    expect(suggestedSaveFileName("Untitled 12", "mermaid")).toBe(
      "Untitled 12.mmd",
    );
    expect(suggestedSaveFileName("Draft v2", "markdown")).toBe(
      "Draft v2.md",
    );
  });
});
