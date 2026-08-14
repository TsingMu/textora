// @vitest-environment jsdom

import { act, useState } from "react";
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

  it("edits heading blocks and emits Markdown source", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor content="# Title" onChange={onChange} />,
      );
    });

    const heading = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-heading",
    );
    expect(heading).not.toBeNull();
    expect(heading?.tagName).toBe("TEXTAREA");

    await act(async () => {
      if (heading === null) throw new Error("missing heading");
      setValueOnTextarea(heading, "Edited");
    });

    expect(onChange).toHaveBeenLastCalledWith("# Edited");
  });

  it("keeps source islands editable without executing or dropping source", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={'```mermaid\nflowchart TD\nA-->B\n```'}
          onChange={onChange}
        />,
      );
    });

    const island = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-source-island",
    );
    expect(island).not.toBeNull();
    expect(island?.tagName).toBe("TEXTAREA");

    await act(async () => {
      if (island === null) throw new Error("missing source island");
      setValueOnTextarea(island, "```mermaid\nflowchart TD\nA-->C\n```");
    });

    expect(onChange).toHaveBeenLastCalledWith(
      "```mermaid\nflowchart TD\nA-->C\n```",
    );
  });

  it("renders list item text as a wrapping textarea and keeps long text on one source line", async () => {
    const longChinese =
      "这是一个非常非常非常非常非常非常长的无空格中文列表项文本用来验证窄窗口下软换行不会向源码注入额外换行";
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={`- ${longChinese}`}
          onChange={onChange}
        />,
      );
    });

    const itemText = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-list-text",
    );
    expect(itemText).not.toBeNull();
    expect(itemText?.tagName).toBe("TEXTAREA");

    const longEnglish =
      "SupercalifragilisticexpialidociousAndThenSomeMoreWordsWithoutAnyBreaksHere";
    await act(async () => {
      if (itemText === null) throw new Error("missing list item text");
      setValueOnTextarea(itemText, longEnglish);
    });

    expect(onChange).toHaveBeenLastCalledWith(`- ${longEnglish}`);
    const lastCall =
      onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ?? "";
    expect(lastCall).not.toContain("\n");
  });

  it("keeps single-line controls (heading, list item, code language) on one source line by stripping newlines", async () => {
    const contentRef: { current: string } = {
      current: "# Heading\n\n- item\n\n```js\nvar a = 1;\n```",
    };

    function ControlledEditor() {
      const [content, setContent] = useState(contentRef.current);
      contentRef.current = content;
      return <MarkdownWysiwygEditor content={content} onChange={setContent} />;
    }

    await act(async () => {
      root.render(<ControlledEditor />);
    });

    const heading = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-heading",
    );
    const itemText = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-list-text",
    );
    const language = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-code-language",
    );

    expect(heading?.tagName).toBe("TEXTAREA");
    expect(itemText?.tagName).toBe("TEXTAREA");
    expect(language?.tagName).toBe("TEXTAREA");

    await act(async () => {
      if (!heading || !itemText || !language) {
        throw new Error("missing single-line controls");
      }
      setValueOnTextarea(heading, "multi\nline\nheading");
    });
    await act(async () => {
      if (!itemText) throw new Error("missing list item text");
      setValueOnTextarea(itemText, "first\nsecond");
    });
    await act(async () => {
      if (!language) throw new Error("missing code language");
      setValueOnTextarea(language, "java\nscript");
    });

    const [headingLine, , listItemLine, , fenceStart] =
      contentRef.current.split("\n");
    expect(headingLine).toBe("# multi line heading");
    expect(listItemLine).toBe("- first second");
    expect(fenceStart).toBe("```java script");
  });

  it("prevents Enter from inserting newlines in single-line controls", async () => {
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor
          content={"# Heading\n\n- item"}
          onChange={vi.fn()}
        />,
      );
    });

    const heading = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-heading",
    );
    const itemText = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-list-text",
    );

    const headingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    const itemEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });

    heading?.dispatchEvent(headingEnter);
    itemText?.dispatchEvent(itemEnter);

    expect(headingEnter.defaultPrevented).toBe(true);
    expect(itemEnter.defaultPrevented).toBe(true);
  });

  it("does not intercept Enter while composing (CJK input methods)", async () => {
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor content={"# 标题"} onChange={vi.fn()} />,
      );
    });

    const heading = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-heading",
    );

    const enterDuringComposition = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    heading?.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    heading?.dispatchEvent(enterDuringComposition);
    expect(enterDuringComposition.defaultPrevented).toBe(false);

    const enterAfterComposition = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    heading?.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    heading?.dispatchEvent(enterAfterComposition);
    expect(enterAfterComposition.defaultPrevented).toBe(true);
  });

  it("allows newlines in multi-line controls (paragraph) to reach the Markdown source", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor content={"one paragraph"} onChange={onChange} />,
      );
    });

    const paragraph = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-paragraph",
    );
    expect(paragraph?.tagName).toBe("TEXTAREA");

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    paragraph?.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);

    await act(async () => {
      if (paragraph === null) throw new Error("missing paragraph");
      setValueOnTextarea(paragraph, "line one\nline two");
    });

    expect(onChange).toHaveBeenLastCalledWith("line one\nline two");
  });

  it("auto-grows without throwing when scrollHeight is unavailable (jsdom)", async () => {
    await expect(
      act(async () => {
        root.render(
          <MarkdownWysiwygEditor
            content={"# Title\n\nlong ".repeat(20).trim()}
            onChange={vi.fn()}
          />,
        );
      }),
    ).resolves.toBeUndefined();

    const textareas = container.querySelectorAll<HTMLTextAreaElement>(
      ".markdown-wysiwyg-editor textarea",
    );
    expect(textareas.length).toBeGreaterThan(0);
    textareas.forEach((textarea) => {
      expect(textarea.tagName).toBe("TEXTAREA");
    });
  });
});

type ResizeObserverCallback = (entries: {
  contentRect: { width: number };
}[]) => void;

describe("AutoGrowTextarea resize behavior", () => {
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
        HTMLTextAreaElement.prototype as unknown as {
          scrollHeight?: number;
        }
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
        HTMLTextAreaElement.prototype as unknown as {
          offsetHeight?: number;
        }
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
        HTMLTextAreaElement.prototype as unknown as {
          clientHeight?: number;
        }
      ).clientHeight;
    }
    globalThis.ResizeObserver = originalResizeObserver;
  });

  function fireResizeObserver(width: number) {
    resizeCallbacks.forEach((callback) =>
      callback([{ contentRect: { width } }]),
    );
  }

  function headingHeight(): string {
    return (
      container.querySelector<HTMLTextAreaElement>(".markdown-wysiwyg-heading")
        ?.style.height ?? ""
    );
  }

  it("measures height from scrollHeight on mount", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor content="# Heading" onChange={vi.fn()} />,
      );
    });
    expect(headingHeight()).toBe("40px");
  });

  it("re-measures when the value changes", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor content="# one" onChange={vi.fn()} />,
      );
    });
    expect(headingHeight()).toBe("40px");

    mockHeight = 90;
    await act(async () => {
      root.render(
        <MarkdownWysiwygEditor content="# two" onChange={vi.fn()} />,
      );
    });
    expect(headingHeight()).toBe("90px");
  });

  it("re-measures when heading level changes even with the same text", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(<MarkdownWysiwygEditor content="# x" onChange={vi.fn()} />);
    });
    const heading = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-heading",
    );
    expect(heading?.className).toContain("is-h1");
    expect(headingHeight()).toBe("40px");

    mockHeight = 110;
    await act(async () => {
      root.render(<MarkdownWysiwygEditor content="## x" onChange={vi.fn()} />);
    });
    const after = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-heading",
    );
    expect(after?.className).toContain("is-h2");
    expect(headingHeight()).toBe("110px");
  });

  it("re-measures when ResizeObserver reports a container width change", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(<MarkdownWysiwygEditor content="# x" onChange={vi.fn()} />,
      );
    });
    expect(headingHeight()).toBe("40px");

    act(() => fireResizeObserver(100));

    mockHeight = 70;
    act(() => fireResizeObserver(60));
    expect(headingHeight()).toBe("70px");
  });

  it("does not re-measure when width is unchanged (no feedback loop)", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(<MarkdownWysiwygEditor content="# x" onChange={vi.fn()} />,
      );
    });
    act(() => fireResizeObserver(100));
    mockHeight = 70;
    act(() => fireResizeObserver(70));

    mockHeight = 250;
    act(() => fireResizeObserver(70));
    expect(headingHeight()).toBe("70px");
  });

  it("re-measures on the first ResizeObserver notification at the final width", async () => {
    mockHeight = 40;
    await act(async () => {
      root.render(<MarkdownWysiwygEditor content="# x" onChange={vi.fn()} />,
      );
    });
    expect(headingHeight()).toBe("40px");

    // A parent scrollbar may reduce the available width after mount, so the
    // first observer notification carries the final width and the required
    // height (here 70px) may differ from the mount-time measure.
    mockHeight = 70;
    act(() => fireResizeObserver(120));
    expect(headingHeight()).toBe("70px");

    // A later notification with the same final width must not re-measure.
    mockHeight = 250;
    act(() => fireResizeObserver(120));
    expect(headingHeight()).toBe("70px");
  });

  it("includes top and bottom border thickness in the final height (border-box)", async () => {
    mockHeight = 40;
    // 1px top + 1px bottom border: offsetHeight - clientHeight = 2.
    mockOffsetHeight = 50;
    mockClientHeight = 48;
    await act(async () => {
      root.render(<MarkdownWysiwygEditor content="# x" onChange={vi.fn()} />,
      );
    });
    expect(headingHeight()).toBe("42px");
  });
});
