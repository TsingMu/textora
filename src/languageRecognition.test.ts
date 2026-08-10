import { describe, expect, it } from "vitest";

import {
  detectLanguage,
  languageDisplayName,
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
