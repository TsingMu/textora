// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { buildMarkdownDocx } from "./markdownWordExport";
import { renderMarkdownPreview } from "./markdownPreview";

async function files(html: string) {
  return JSZip.loadAsync(await buildMarkdownDocx(html, "中文文档"));
}
describe("editable Word export", () => {
  it("creates real OOXML with editable headings, formatting, lists, tables and Chinese", async () => {
    const html = renderMarkdownPreview(
      '# 中文标题\n\n**粗体** *斜体* ~~删除~~ `代码`\n\n1. 第一项\n2. 第二项\n\n> 引用\n\n| 表头 | 说明 |\n| --- | --- |\n| 单元 | 内容 |\n\n```json\n{"a":1}\n```',
    ).html;
    const zip = await files(html);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("中文标题");
    expect(xml).toContain('w:pStyle w:val="Heading1"');
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("<w:i/>");
    expect(xml).toContain("<w:strike/>");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("表头");
    expect(xml).toContain("单元");
    expect(xml).toContain("w:numPr");
    expect(xml).toContain("27231F");
    expect(xml).toContain("D8C8B8");
    expect(await zip.file("word/styles.xml")!.async("string")).toContain(
      "PingFang SC",
    );
    expect(await zip.file("word/numbering.xml")!.async("string")).toContain(
      "decimal",
    );
  });
  it("overrides built-in heading styles without duplicate style IDs", async () => {
    const zip = await files("<h1>Title</h1><h2>Subtitle</h2>");
    const styles = new DOMParser().parseFromString(
      await zip.file("word/styles.xml")!.async("string"),
      "application/xml",
    );
    const all = Array.from(styles.getElementsByTagName("w:style"));
    const ids = all.map((node) => node.getAttribute("w:styleId"));
    expect(new Set(ids).size).toBe(ids.length);
    const heading = all.find(
      (node) => node.getAttribute("w:styleId") === "Heading1",
    );
    expect(
      heading?.getElementsByTagName("w:color")[0].getAttribute("w:val"),
    ).toBe("2D2924");
  });
  it("keeps URL text passive and never embeds remote or local user images", async () => {
    const zip = await files(
      renderMarkdownPreview(
        "[链接](https://example.invalid)\n\n![图片](file:///private/data.png)\n\n<script>bad()</script>",
      ).html,
    );
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("https://example.invalid");
    expect(xml).toContain("file:///private/data.png");
    const relationships = await zip
      .file("word/_rels/document.xml.rels")!
      .async("string");
    expect(relationships).not.toContain('TargetMode="External"');
    expect(
      Object.keys(zip.files).some(
        (name) => name.startsWith("word/media/") && !name.endsWith("/"),
      ),
    ).toBe(false);
  });
  it("embeds a local diagram as an image and propagates rasterization failures", async () => {
    const rasterize = vi.fn(async () => ({
      data: Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=",
        ),
        (c) => c.charCodeAt(0),
      ),
      width: 200,
      height: 100,
    }));
    const bytes = await buildMarkdownDocx(
      '<div><svg viewBox="0 0 200 100"><style>.private-css-sentinel {fill:red}</style><text>图表</text></svg></div>',
      "图表",
      rasterize,
    );
    const zip = await JSZip.loadAsync(bytes);
    expect(rasterize).toHaveBeenCalledOnce();
    expect(
      Object.keys(zip.files).some((name) => /word\/media\/.*\.png$/.test(name)),
    ).toBe(true);
    expect(await zip.file("word/document.xml")!.async("string")).toContain(
      "Mermaid diagram",
    );
    expect(await zip.file("word/document.xml")!.async("string")).not.toContain(
      "private-css-sentinel",
    );
    await expect(
      buildMarkdownDocx("<svg/>", "error", async () => {
        throw new Error("raster failed");
      }),
    ).rejects.toThrow("raster failed");
  });
  it("supports empty documents and independent numbering for separate lists", async () => {
    expect((await files("")).file("[Content_Types].xml")).not.toBeNull();
    const zip = await files(
      "<ol><li>first</li></ol><p>between</p><ol><li>restart</li></ol>",
    );
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    expect(numbering.match(/w:num w:numId=/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
