// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownWysiwygEditor } from "./MarkdownWysiwygEditor";

function setValueOnTextarea(
  textarea: HTMLTextAreaElement,
  value: string,
): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function inputInline(span: Element, text: string): void {
  span.textContent = text;
  span.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

describe("MarkdownWysiwygEditor", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders inline-formatted fragments inside the structured text blocks", async () => {
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={
            "# **Title**\n\nplain _em_ text\n\n- `item`\n\n> ~~quote~~\n\n```js\ncode\n```"
          }
          onChange={vi.fn()}
        />,
      );
    });

    expect(
      container.querySelector(".markdown-wysiwyg-heading .wysiwyg-inline-bold")
        ?.textContent,
    ).toBe("Title");
    expect(
      container.querySelector(".markdown-wysiwyg-paragraph .wysiwyg-inline-italic")
        ?.textContent,
    ).toBe("em");
    expect(
      container.querySelector(".markdown-wysiwyg-list-text .wysiwyg-inline-code")
        ?.textContent,
    ).toBe("item");
    expect(
      container.querySelector(".markdown-wysiwyg-blockquote .wysiwyg-inline-strike")
        ?.textContent,
    ).toBe("quote");
    // fenced code stays a literal textarea, not inline-formatted.
    expect(
      container.querySelector<HTMLTextAreaElement>(".markdown-wysiwyg-code")
        ?.value,
    ).toBe("code");
  });

  it("edits an inline heading fragment and emits Markdown source", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor content="# Title" onChange={onChange} />,
      );
    });

    const headingText = container.querySelector(
      ".markdown-wysiwyg-heading .wysiwyg-inline-text",
    );
    expect(headingText).not.toBeNull();

    await act(async () => {
      if (headingText === null) throw new Error("missing heading text span");
      inputInline(headingText, "Edited");
    });

    expect(onChange).toHaveBeenLastCalledWith("# Edited");
  });

  it("edits list item text via the inline editor and keeps other items", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"- one\n- two"}
          onChange={onChange}
        />,
      );
    });

    const itemSpans = container.querySelectorAll(
      ".markdown-wysiwyg-list-text .wysiwyg-inline-text",
    );
    await act(async () => {
      inputInline(itemSpans[1] as Element, "TWO");
    });

    expect(onChange).toHaveBeenLastCalledWith("- one\n- TWO");
  });

  it("allows multiline paragraphs and block quotes while keeping headings and lists single-line", async () => {
    const onChange = vi.fn();
    const content = "# heading\n\nparagraph\n\n- item\n\n> quote";
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor content={content} onChange={onChange} />,
      );
    });

    const heading = container.querySelector(
      ".markdown-wysiwyg-heading .wysiwyg-inline-text",
    );
    const paragraph = container.querySelector(
      ".markdown-wysiwyg-paragraph .wysiwyg-inline-text",
    );
    const listItem = container.querySelector(
      ".markdown-wysiwyg-list-text .wysiwyg-inline-text",
    );
    const quote = container.querySelector(
      ".markdown-wysiwyg-blockquote .wysiwyg-inline-text",
    );
    if (!heading || !paragraph || !listItem || !quote) {
      throw new Error("missing structured inline editor");
    }

    await act(async () => inputInline(heading, "line one\nline two"));
    expect(onChange).toHaveBeenLastCalledWith(
      "# line one line two\n\nparagraph\n\n- item\n\n> quote",
    );

    await act(async () => inputInline(paragraph, "line one\nline two"));
    expect(onChange).toHaveBeenLastCalledWith(
      "# heading\n\nline one\nline two\n\n- item\n\n> quote",
    );

    await act(async () => inputInline(listItem, "line one\nline two"));
    expect(onChange).toHaveBeenLastCalledWith(
      "# heading\n\nparagraph\n\n- line one line two\n\n> quote",
    );

    await act(async () => inputInline(quote, "line one\nline two"));
    expect(onChange).toHaveBeenLastCalledWith(
      "# heading\n\nparagraph\n\n- item\n\n> line one\n> line two",
    );
  });

  it("keeps fenced code and source islands as literal editable textareas", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"```mermaid\nflowchart TD\nA-->B\n```"}
          onChange={onChange}
        />,
      );
    });

    const island = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-source-island",
    );
    expect(island).not.toBeNull();

    await act(async () => {
      if (island === null) throw new Error("missing source island");
      setValueOnTextarea(island, "```mermaid\nflowchart TD\nA-->C\n```");
    });

    expect(onChange).toHaveBeenLastCalledWith(
      "```mermaid\nflowchart TD\nA-->C\n```",
    );
  });

  it("keeps the code block language single-line", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"```js\nvar a = 1;\n```"}
          onChange={onChange}
        />,
      );
    });

    const language = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-code-language",
    );
    await act(async () => {
      if (language === null) throw new Error("missing code language");
      setValueOnTextarea(language, "java\nscript");
    });

    expect(onChange).toHaveBeenLastCalledWith("```java script\nvar a = 1;\n```");
  });

  it("locks every control when disabled", async () => {
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content="# Title\n\n```js\ncode\n```"
          disabled
          onChange={vi.fn()}
        />,
      );
    });

    container
      .querySelectorAll<HTMLElement>(".wysiwyg-inline-run > span")
      .forEach((span) => {
        expect(span.getAttribute("contenteditable")).toBe("false");
      });
    container
      .querySelectorAll<HTMLTextAreaElement>(".markdown-wysiwyg-editor textarea")
      .forEach((textarea) => {
        expect(textarea.disabled).toBe(true);
      });
  });

  it("does not throw when rendering many blocks without layout (jsdom)", async () => {
    await expect(
      act(async () => {
        root.render(
          <MarkdownWysiwygEditor
            content={"# Title\n\nlong paragraph ".repeat(10).trim()}
            onChange={vi.fn()}
          />,
        );
      }),
    ).resolves.toBeUndefined();
    expect(
      container.querySelectorAll(".markdown-wysiwyg-editor > *").length,
    ).toBeGreaterThan(0);
  });
});

type ResizeObserverCallback = (entries: {
  contentRect: { width: number };
}[]) => void;

describe("AutoGrowTextarea resize behavior (code block content)", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let originalScrollHeight: PropertyDescriptor | undefined;
  let originalOffsetHeight: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;
  let originalResizeObserver: typeof globalThis.ResizeObserver;
  let mockHeight: number;
  let mockOffsetHeight: number;
  let mockClientHeight: number;
  let resizeCallbacks: ResizeObserverCallback[];

  beforeEach(() => {
    originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "scrollHeight",
    );
    originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "offsetHeight",
    );
    originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "clientHeight",
    );
    mockHeight = 0;
    mockOffsetHeight = 0;
    mockClientHeight = 0;
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => mockHeight,
    });
    Object.defineProperty(HTMLTextAreaElement.prototype, "offsetHeight", {
      configurable: true,
      get: () => mockOffsetHeight,
    });
    Object.defineProperty(HTMLTextAreaElement.prototype, "clientHeight", {
      configurable: true,
      get: () => mockClientHeight,
    });

    originalResizeObserver = globalThis.ResizeObserver;
    resizeCallbacks = [];
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof globalThis.ResizeObserver;

    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (originalScrollHeight) {
      Object.defineProperty(
        HTMLTextAreaElement.prototype,
        "scrollHeight",
        originalScrollHeight,
      );
    } else {
      delete (
        HTMLTextAreaElement.prototype as unknown as { scrollHeight?: number }
      ).scrollHeight;
    }
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLTextAreaElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    } else {
      delete (
        HTMLTextAreaElement.prototype as unknown as { offsetHeight?: number }
      ).offsetHeight;
    }
    if (originalClientHeight) {
      Object.defineProperty(
        HTMLTextAreaElement.prototype,
        "clientHeight",
        originalClientHeight,
      );
    } else {
      delete (
        HTMLTextAreaElement.prototype as unknown as { clientHeight?: number }
      ).clientHeight;
    }
    globalThis.ResizeObserver = originalResizeObserver;
  });

  function fireResizeObserver(width: number) {
    resizeCallbacks.forEach((callback) =>
      callback([{ contentRect: { width } }]),
    );
  }

  function codeHeight(): string {
    return (
      container.querySelector<HTMLTextAreaElement>(".markdown-wysiwyg-code")
        ?.style.height ?? ""
    );
  }

  it("measures height from scrollHeight on mount", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"```js\ncode\n```"}
          onChange={vi.fn()}
        />,
      );
    });
    expect(codeHeight()).toBe("40px");
  });

  it("re-measures when the code content changes", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"```js\none\n```"}
          onChange={vi.fn()}
        />,
      );
    });
    expect(codeHeight()).toBe("40px");

    mockHeight = 90;
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"```js\ntwo\n```"}
          onChange={vi.fn()}
        />,
      );
    });
    expect(codeHeight()).toBe("90px");
  });

  it("re-measures on the first ResizeObserver notification at the final width", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"```js\ncode\n```"}
          onChange={vi.fn()}
        />,
      );
    });
    expect(codeHeight()).toBe("40px");

    mockHeight = 70;
    act(() => fireResizeObserver(120));
    expect(codeHeight()).toBe("70px");

    mockHeight = 250;
    act(() => fireResizeObserver(120));
    expect(codeHeight()).toBe("70px");
  });

  it("re-measures when ResizeObserver reports a width change without looping", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"```js\ncode\n```"}
          onChange={vi.fn()}
        />,
      );
    });
    act(() => fireResizeObserver(100));
    mockHeight = 70;
    act(() => fireResizeObserver(60));
    expect(codeHeight()).toBe("70px");

    mockHeight = 250;
    act(() => fireResizeObserver(60));
    expect(codeHeight()).toBe("70px");
  });

  it("includes top and bottom border thickness in the final height (border-box)", async () => {
    mockHeight = 40;
    mockOffsetHeight = 50;
    mockClientHeight = 48;
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"```js\ncode\n```"}
          onChange={vi.fn()}
        />,
      );
    });
    expect(codeHeight()).toBe("42px");
  });
});
