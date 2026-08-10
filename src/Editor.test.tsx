// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tags } from "@lezer/highlight";
import { Editor, textoraSyntaxHighlightStyle } from "./Editor";

describe("Editor", () => {
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

  it("preserves the editor instance and focus when controlled content updates", async () => {
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <Editor
          content=""
          disabled={false}
          language="plain-text"
          onChange={onChange}
        />,
      );
    });

    const editable = container.querySelector<HTMLElement>(".cm-content");
    expect(editable).not.toBeNull();
    editable?.focus();
    expect(document.activeElement).toBe(editable);

    await act(async () => {
      root.render(
        <Editor
          content="a"
          disabled={false}
          language="plain-text"
          onChange={onChange}
        />,
      );
    });

    expect(container.querySelector(".cm-content")).toBe(editable);
    expect(document.activeElement).toBe(editable);
    expect(container.querySelector(".cm-line")?.textContent).toBe("a");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggles editability without replacing the editor instance", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <Editor
          content="keep"
          disabled={false}
          language="plain-text"
          onChange={onChange}
        />,
      );
    });
    const editable = container.querySelector<HTMLElement>(".cm-content");
    expect(editable?.getAttribute("contenteditable")).toBe("true");

    await act(async () => {
      root.render(
        <Editor
          content="keep"
          disabled
          language="plain-text"
          onChange={onChange}
        />,
      );
    });
    expect(container.querySelector(".cm-content")).toBe(editable);
    expect(editable?.getAttribute("contenteditable")).toBe("false");

    await act(async () => {
      root.render(
        <Editor
          content="keep"
          disabled={false}
          language="plain-text"
          onChange={onChange}
        />,
      );
    });
    expect(container.querySelector(".cm-content")).toBe(editable);
    expect(editable?.getAttribute("contenteditable")).toBe("true");
  });

  it("reconfigures the language extension without replacing the editor instance", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <Editor
          content="const x = 1"
          disabled={false}
          language="plain-text"
          onChange={onChange}
        />,
      );
    });
    const editable = container.querySelector<HTMLElement>(".cm-content");
    expect(editable).not.toBeNull();

    await act(async () => {
      root.render(
        <Editor
          content="const x = 1"
          disabled={false}
          language="typescript"
          onChange={onChange}
        />,
      );
    });
    expect(container.querySelector(".cm-content")).toBe(editable);

    await act(async () => {
      root.render(
        <Editor
          content="const x = 1"
          disabled={false}
          language="markdown"
          onChange={onChange}
        />,
      );
    });
    expect(container.querySelector(".cm-content")).toBe(editable);
  });

  it("preserves the document content across language reconfiguration", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <Editor
          content="const x = 1"
          disabled={false}
          language="typescript"
          onChange={onChange}
        />,
      );
    });
    const editable = container.querySelector<HTMLElement>(".cm-content");
    expect(container.querySelector(".cm-line")?.textContent).toBe("const x = 1");

    await act(async () => {
      root.render(
        <Editor
          content="const x = 1"
          disabled={false}
          language="markdown"
          onChange={onChange}
        />,
      );
    });

    expect(container.querySelector(".cm-content")).toBe(editable);
    expect(container.querySelector(".cm-line")?.textContent).toBe("const x = 1");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("provides project syntax classes for Markdown fenced language labels", () => {
    expect(textoraSyntaxHighlightStyle.style([tags.labelName])).toEqual(
      expect.any(String),
    );
    expect(textoraSyntaxHighlightStyle.style([tags.meta])).toEqual(
      expect.any(String),
    );
  });
});
