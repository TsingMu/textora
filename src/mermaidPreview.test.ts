// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  renderMermaidPreview,
  sanitizeMermaidSvgForPreview,
} from "./mermaidPreview";

if (!("getComputedTextLength" in SVGElement.prototype)) {
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value: () => 80,
  });
}

if (!("getBBox" in SVGElement.prototype)) {
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 80, height: 20 }),
  });
}

describe("renderMermaidPreview", () => {
  it("renders a basic Mermaid flowchart into sanitized local SVG", async () => {
    const result = await renderMermaidPreview("flowchart TD\nA[Start] --> B[Done]");

    expect(result.status).toBe("ok");
    expect(result.html).toContain("<svg");
    expect(result.html).toContain("Start");
    expect(result.html).toContain("Done");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onload=");
  });

  it("returns a safe error placeholder for invalid Mermaid syntax", async () => {
    const result = await renderMermaidPreview("flowchart TD\nA -->");

    expect(result.status).toBe("error");
    expect(result.html).toContain("Mermaid preview unavailable");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onerror=");
  });
});

describe("sanitizeMermaidSvgForPreview", () => {
  it("removes scripts, event handlers, unsafe URLs, and external resources", () => {
    const sanitized = sanitizeMermaidSvgForPreview(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <style>@import url("https://example.com/theme.css"); .node { fill: red; }</style>
        <script>alert(1)</script>
        <foreignObject><body onclick="alert(1)">bad</body></foreignObject>
        <a href="https://example.com"><text onclick="alert(1)">Link</text></a>
        <image href="file:///tmp/secret.png" />
        <use href="#safe-marker" />
        <path stroke="url(#safe-marker)" fill="url(https://example.com/pattern.svg)" />
        <text style="background: url(https://example.com/bg.png)">Safe text</text>
      </svg>
    `);

    expect(sanitized).toContain("<svg");
    expect(sanitized).toContain("Safe text");
    expect(sanitized).toContain("href=\"#safe-marker\"");
    expect(sanitized).toContain("stroke=\"url(#safe-marker)\"");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("foreignObject");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("onload");
    expect(sanitized).not.toContain("https://example.com");
    expect(sanitized).not.toContain("file:///tmp/secret.png");
    expect(sanitized).not.toContain("@import");
    expect(sanitized).not.toContain("fill=\"url(");
    expect(sanitized).not.toContain("style=");
  });

  it("rejects non-SVG markup", () => {
    expect(() => sanitizeMermaidSvgForPreview("<div>not svg</div>")).toThrow(
      "non-SVG",
    );
  });
});
