// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownWysiwygInlineEditor } from "./MarkdownWysiwygInlineEditor";

function inputText(span: Element, text: string): void {
  span.textContent = text;
  span.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

describe("MarkdownWysiwygInlineEditor", () => {
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

  function render(
    source: string,
    onChange: (source: string) => void,
    singleLine = false,
  ) {
    return act(async () => {
      root.render(
        <MarkdownWysiwygInlineEditor
          source={source}
          singleLine={singleLine}
          onChange={onChange}
        />,
      );
    });
  }

  it("renders the five inline formats with markers hidden", async () => {
    await render("**b**_i_~~s~~`c`[t](u)", vi.fn());

    const bold = container.querySelector(".wysiwyg-inline-bold");
    const italic = container.querySelector(".wysiwyg-inline-italic");
    const strike = container.querySelector(".wysiwyg-inline-strike");
    const code = container.querySelector(".wysiwyg-inline-code");
    const link = container.querySelector(".wysiwyg-inline-link");

    expect(bold?.textContent).toBe("b");
    expect(italic?.textContent).toBe("i");
    expect(strike?.textContent).toBe("s");
    expect(code?.textContent).toBe("c");
    expect(link?.textContent).toBe("t");
    expect(container.querySelector(".wysiwyg-inline-run")?.textContent).toBe(
      "bisct",
    );
  });

  it("writes back a single Markdown string when a fragment is edited", async () => {
    const onChange = vi.fn();
    await render("**a**b", onChange);

    const bold = container.querySelector(".wysiwyg-inline-bold");
    if (!bold) throw new Error("missing bold span");
    await act(async () => inputText(bold, "x"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("**x**b");
  });

  it("keeps neighbouring text when a fragment is emptied", async () => {
    const onChange = vi.fn();
    await render("**a**b", onChange);

    const bold = container.querySelector(".wysiwyg-inline-bold");
    if (!bold) throw new Error("missing bold span");
    await act(async () => inputText(bold, ""));

    expect(onChange).toHaveBeenLastCalledWith("b");
  });

  it("strips newlines from edited content so inline source stays single-line", async () => {
    const onChange = vi.fn();
    await render("`c`d", onChange, true);

    const code = container.querySelector(".wysiwyg-inline-code");
    if (!code) throw new Error("missing code span");
    await act(async () => inputText(code, "x\ny"));

    const emitted = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(emitted).toBe("`x y`d");
    expect(emitted).not.toContain("\n");
  });

  it("pastes plain text only and strips line breaks", async () => {
    const onChange = vi.fn();
    const execCommand = vi.fn();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    await render("**a**", onChange, true);

    const bold = container.querySelector(".wysiwyg-inline-bold");
    if (!bold) throw new Error("missing bold span");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: (type: string) =>
          type === "text/plain" ? "plain\ntext" : "<b>rich</b>",
      },
    });
    bold.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "plain text");
  });

  it("preserves normalized line breaks while editing multiline content", async () => {
    const onChange = vi.fn();
    await render("paragraph", onChange);

    const text = container.querySelector(".wysiwyg-inline-text");
    if (!text) throw new Error("missing text span");
    await act(async () => inputText(text, "line one\r\nline two"));

    expect(onChange).toHaveBeenLastCalledWith("line one\nline two");
  });

  it("preserves line breaks when pasting plain text into multiline content", async () => {
    const execCommand = vi.fn();
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    await render("paragraph", vi.fn());

    const text = container.querySelector(".wysiwyg-inline-text");
    if (!text) throw new Error("missing text span");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        getData: (type: string) =>
          type === "text/plain" ? "plain\r\ntext" : "<b>rich</b>",
      },
    });
    text.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "plain\ntext");
  });

  it("allows Enter for multiline content and blocks it for single-line content", async () => {
    await render("paragraph", vi.fn());
    const text = container.querySelector(".wysiwyg-inline-text");
    if (!text) throw new Error("missing text span");
    const multilineEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    text.dispatchEvent(multilineEnter);
    expect(multilineEnter.defaultPrevented).toBe(false);

    await render("heading", vi.fn(), true);
    const singleLineText = container.querySelector(".wysiwyg-inline-text");
    if (!singleLineText) throw new Error("missing text span");
    const singleLineEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    singleLineText.dispatchEvent(singleLineEnter);
    expect(singleLineEnter.defaultPrevented).toBe(true);

    singleLineText.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    singleLineText.dispatchEvent(composingEnter);
    expect(composingEnter.defaultPrevented).toBe(false);
  });

  it("escapes edited plain text minimally so it stays literal", async () => {
    const onChange = vi.fn();
    await render("ab", onChange);

    const text = container.querySelector(".wysiwyg-inline-text");
    if (!text) throw new Error("missing text span");
    await act(async () => inputText(text, "a*b"));

    expect(onChange).toHaveBeenLastCalledWith("a\\*b");
  });

  it("locks every fragment when disabled", async () => {
    await act(async () => {
      root.render(
        <MarkdownWysiwygInlineEditor
          source="**a**b"
          disabled
          onChange={vi.fn()}
        />,
      );
    });
    const spans = container.querySelectorAll<HTMLSpanElement>(
      ".wysiwyg-inline-run > span",
    );
    expect(spans.length).toBeGreaterThan(0);
    spans.forEach((span) => {
      expect(span.getAttribute("contenteditable")).toBe("false");
    });
  });

  it("makes fragments editable when not disabled", async () => {
    await render("**a**b", vi.fn());
    const spans = container.querySelectorAll<HTMLSpanElement>(
      ".wysiwyg-inline-run > span",
    );
    spans.forEach((span) => {
      expect(span.getAttribute("contenteditable")).toBe("plaintext-only");
    });
  });

  it("renders links as non-navigable spans without href", async () => {
    await render("[Textora](https://example.invalid)", vi.fn());
    const link = container.querySelector<HTMLSpanElement>(".wysiwyg-inline-link");
    expect(link?.tagName).toBe("SPAN");
    expect(link?.getAttribute("href")).toBeNull();
    expect(link?.textContent).toBe("Textora");
  });

  it("keeps a link valid when its edited label contains a closing bracket", async () => {
    const onChange = vi.fn();
    await render("[Textora](https://example.invalid)", onChange);
    const link = container.querySelector(".wysiwyg-inline-link");
    if (!link) throw new Error("missing link span");
    await act(async () => inputText(link, "Text]ora"));

    expect(onChange).toHaveBeenLastCalledWith(
      "[Text\\]ora](https://example.invalid)",
    );
  });
});
