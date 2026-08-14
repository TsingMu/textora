// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tags } from "@lezer/highlight";
import { startCompletion, currentCompletions } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
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

describe("Editor markdown opening fence language completion", () => {
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

  function viewOf(container: HTMLElement): EditorView {
    const el = container.querySelector<HTMLElement>(".cm-editor");
    if (!el) throw new Error(".cm-editor not found");
    const view = EditorView.findFromDOM(el);
    if (!view) throw new Error("EditorView not found");
    return view;
  }

  async function renderEditor(props: {
    content: string;
    language: "markdown" | "plain-text";
    disabled?: boolean;
  }) {
    await act(async () => {
      root.render(
        <Editor
          content={props.content}
          disabled={props.disabled ?? false}
          language={props.language}
          onChange={vi.fn()}
        />,
      );
    });
    const view = viewOf(container);
    container.querySelector<HTMLElement>(".cm-content")?.focus();
    // startCompletion 的 source 查询是异步的（微任务/timeout），等待其回落到 state。
    await act(async () => {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      startCompletion(view);
      for (let i = 0; i < 40; i++) {
        if (currentCompletions(view.state).length > 0) break;
        await new Promise((r) => setTimeout(r, 10));
      }
    });
    return view;
  }

  it("Markdown opening fence 给出按前缀过滤的语言候选", async () => {
    const view = await renderEditor({ content: "```j", language: "markdown" });
    expect(currentCompletions(view.state).map((c) => c.label)).toEqual([
      "javascript",
      "json",
      "java",
    ]);
  });

  it("非 Markdown 标签不挂候选（plain-text 的 fence-like 文本不触发）", async () => {
    const view = await renderEditor({ content: "```j", language: "plain-text" });
    expect(currentCompletions(view.state)).toEqual([]);
  });

  it("只读 Markdown 不给候选", async () => {
    const view = await renderEditor({
      content: "```j",
      language: "markdown",
      disabled: true,
    });
    expect(currentCompletions(view.state)).toEqual([]);
  });

  it("弹层打开后切换 disabled 关闭候选且文档不可修改", async () => {
    await act(async () => {
      root.render(
        <Editor
          content="```j"
          disabled={false}
          language="markdown"
          onChange={vi.fn()}
        />,
      );
    });
    const view = viewOf(container);
    container.querySelector<HTMLElement>(".cm-content")?.focus();
    await act(async () => {
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      startCompletion(view);
      for (let i = 0; i < 40; i++) {
        if (currentCompletions(view.state).length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    expect(currentCompletions(view.state).map((c) => c.label)).toContain(
      "javascript",
    );

    // 切换到只读/忙碌：既有弹层应被关闭，且文档不可编辑。
    await act(async () => {
      root.render(
        <Editor
          content="```j"
          disabled
          language="markdown"
          onChange={vi.fn()}
        />,
      );
    });
    expect(currentCompletions(view.state)).toEqual([]);
    expect(
      container.querySelector(".cm-content")?.getAttribute("contenteditable"),
    ).toBe("false");
  });
});
