// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  markdownExportFileName,
  mountMarkdownPrintSnapshot,
  prepareMarkdownExport,
} from "./markdownExport";
import { renderMermaidPreview } from "./mermaidPreview";
vi.mock("./mermaidPreview", () => ({ renderMermaidPreview: vi.fn() }));

afterEach(() => {
  document.getElementById("markdown-export-root")?.remove();
  vi.restoreAllMocks();
});

describe("Markdown export snapshot", () => {
  it("uses Preview markup including headings, formatting, tables, code and safe links", async () => {
    const html = await prepareMarkdownExport(
      '# 中文标题\n\n**bold** [link](https://example.invalid)\n\n| A | B |\n| --- | --- |\n| x | y |\n\n```json\n{"a":1}\n```\n\n<script>bad()</script>',
    );
    expect(html).toContain("<h1>中文标题</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("language-json");
    expect(html).not.toMatch(/<script>|href=/);
    expect(html).toContain("&lt;script&gt;");
  });
  it("awaits diagrams and rejects failed rendering instead of silently dropping them", async () => {
    vi.mocked(renderMermaidPreview).mockResolvedValueOnce({
      status: "ok",
      html: "<svg><text>图</text></svg>",
    });
    expect(
      await prepareMarkdownExport("```mermaid\ngraph TD\nA-->B\n```"),
    ).toContain("<svg>");
    vi.mocked(renderMermaidPreview).mockResolvedValueOnce({
      status: "error",
      html: "error",
      message: "bad",
    });
    await expect(prepareMarkdownExport("```mermaid\nbad\n```")).rejects.toThrow(
      "Mermaid",
    );
  });
  it("derives safe Unicode output names without changing the source extension", () => {
    expect(markdownExportFileName("报告.markdown", "pdf")).toBe("报告.pdf");
    expect(markdownExportFileName("/tmp/报告.md", "docx")).toBe("报告.docx");
    expect(markdownExportFileName("", "pdf")).toBe("Document.pdf");
  });
  it("mounts only a hidden immutable print snapshot and cleans it up after native completion", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    document.title = "Original";
    const cleanup = await mountMarkdownPrintSnapshot(
      "<h1>snapshot</h1>",
      "报告.pdf",
    );
    expect(document.getElementById("markdown-export-root")?.textContent).toBe(
      "snapshot",
    );
    expect(document.title).toBe("报告.pdf");
    await expect(
      mountMarkdownPrintSnapshot("another", "other"),
    ).rejects.toThrow("already");
    cleanup();
    expect(document.getElementById("markdown-export-root")).toBeNull();
    expect(document.title).toBe("Original");
    vi.unstubAllGlobals();
  });
});
