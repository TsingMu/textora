import { describe, expect, it } from "vitest";

import { renderMarkdownPreview } from "./markdownPreview";

describe("renderMarkdownPreview", () => {
  it("渲染首版 Markdown 与 GFM 基础结构", () => {
    const result = renderMarkdownPreview(`# Title

Paragraph with **strong**, *emphasis*, ~~deleted~~ and \`code\`.

- [x] done
- [ ] todo

> quoted text

| Name | Value |
| --- | --- |
| alpha | 1 |

\`\`\`ts
const answer = 42;
\`\`\`
`);

    expect(result.status).toBe("ok");
    expect(result.html).toContain("<h1>Title</h1>");
    expect(result.html).toContain("<strong>strong</strong>");
    expect(result.html).toContain("<em>emphasis</em>");
    expect(result.html).toContain("<del>deleted</del>");
    expect(result.html).toContain("<code>code</code>");
    expect(result.html).toContain('<input type="checkbox" disabled checked>');
    expect(result.html).toContain('<input type="checkbox" disabled>');
    expect(result.html).toContain("<blockquote><p>quoted text</p></blockquote>");
    expect(result.html).toContain("<table>");
    expect(result.html).toContain("<th>Name</th>");
    expect(result.html).toContain("<td>alpha</td>");
    expect(result.html).toContain('<pre><code class="language-ts">');
    expect(result.html).toContain("const answer = 42;");
  });

  it("转义原始 HTML，不插入可执行 DOM", () => {
    const result = renderMarkdownPreview(
      '<script>alert("x")</script>\n\n<div onclick="bad()">raw</div>',
    );

    expect(result.status).toBe("ok");
    expect(result.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(result.html).toContain(
      "&lt;div onclick=&quot;bad()&quot;&gt;raw&lt;/div&gt;",
    );
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<div onclick=");
  });

  it("链接不生成 href，图片不生成 src，只显示安全占位", () => {
    const result = renderMarkdownPreview(
      "[site](https://example.com) ![diagram](file:///tmp/diagram.png)",
    );

    expect(result.status).toBe("ok");
    expect(result.html).toContain('class="markdown-preview-link"');
    expect(result.html).toContain("https://example.com");
    expect(result.html).toContain(
      'class="markdown-preview-image-placeholder"',
    );
    expect(result.html).toContain("Image: diagram (file:///tmp/diagram.png)");
    expect(result.html).not.toContain("<a ");
    expect(result.html).not.toContain("href=");
    expect(result.html).not.toContain("<img ");
    expect(result.html).not.toContain("src=");
  });

  it("渲染异常时返回可显示的错误退化结果", () => {
    const result = renderMarkdownPreview("content", {
      renderer: () => {
        throw new Error("boom");
      },
    });

    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error("Expected markdown preview to fail");
    }
    expect(result.message).toBe("boom");
    expect(result.html).toContain("Markdown preview failed: boom");
  });
});
