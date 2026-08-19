// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tags } from "@lezer/highlight";
import { startCompletion, currentCompletions } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { Editor, textoraSyntaxHighlightStyle } from "./Editor";

// jsdom 不实现 Range 几何。CodeMirror 以 requestAnimationFrame 调度文本测量，
// 缺失的 getClientRects 会在断言或卸载之后以非确定性未处理错误浮出。
if (!("getClientRects" in Range.prototype)) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

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

  it("wraps wide grapheme clusters in two-column visual cells", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <Editor
          content="测试a👍"
          disabled={false}
          language="plain-text"
          onChange={onChange}
        />,
      );
    });

    const wideCells = Array.from(
      container.querySelectorAll<HTMLElement>(".cm-wide-display-cluster"),
    );
    expect(wideCells.map((cell) => cell.textContent)).toEqual(["测", "试", "👍"]);
    expect(container.querySelector(".cm-line")?.textContent).toBe("测试a👍");

    await act(async () => {
      root.render(
        <Editor
          content="a中"
          disabled={false}
          language="plain-text"
          onChange={onChange}
        />,
      );
    });
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(".cm-wide-display-cluster"),
      ).map((cell) => cell.textContent),
    ).toEqual(["中"]);
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

describe("Editor word wrap reconfiguration", () => {
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

  function viewOf(element: HTMLElement): EditorView {
    const editor = element.querySelector<HTMLElement>(".cm-editor");
    if (!editor) throw new Error(".cm-editor not found");
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("EditorView not found");
    return view;
  }

  async function renderEditor(wordWrapEnabled?: boolean) {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <Editor
          content="long line"
          disabled={false}
          language="plain-text"
          onChange={onChange}
          wordWrapEnabled={wordWrapEnabled}
        />,
      );
    });
    return { onChange, editable: container.querySelector<HTMLElement>(".cm-content")! };
  }

  it("installs line wrapping by default", async () => {
    await renderEditor();
    expect(
      container.querySelector(".cm-content")?.classList.contains("cm-lineWrapping"),
    ).toBe(true);
  });

  it("honors a disabled preference on first mount", async () => {
    await renderEditor(false);
    expect(
      container.querySelector(".cm-content")?.classList.contains("cm-lineWrapping"),
    ).toBe(false);
  });

  it("toggles word wrap without replacing the editor instance or editing the document", async () => {
    const { onChange, editable } = await renderEditor(true);
    expect(editable.classList.contains("cm-lineWrapping")).toBe(true);

    await act(async () => {
      root.render(
        <Editor
          content="long line"
          disabled={false}
          language="plain-text"
          onChange={onChange}
          wordWrapEnabled={false}
        />,
      );
    });
    expect(container.querySelector(".cm-content")).toBe(editable);
    expect(editable.classList.contains("cm-lineWrapping")).toBe(false);
    expect(container.querySelector(".cm-line")?.textContent).toBe("long line");
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <Editor
          content="long line"
          disabled={false}
          language="plain-text"
          onChange={onChange}
          wordWrapEnabled
        />,
      );
    });
    expect(container.querySelector(".cm-content")).toBe(editable);
    expect(editable.classList.contains("cm-lineWrapping")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps selection and undo history across word wrap reconfiguration", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <Editor
          content=""
          disabled={false}
          language="plain-text"
          onChange={onChange}
          wordWrapEnabled
        />,
      );
    });
    const view = viewOf(container);
    container.querySelector<HTMLElement>(".cm-content")?.focus();
    await act(async () => {
      view.dispatch({
        changes: { from: 0, insert: "hello" },
        userEvent: "input.type",
      });
      view.dispatch({ selection: { anchor: 2, head: 5 } });
    });
    // 打字本身触发一次 onChange；后续重配不得再触发（上游脏状态契约）。
    expect(onChange).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <Editor
          content="hello"
          disabled={false}
          language="plain-text"
          onChange={onChange}
          wordWrapEnabled={false}
        />,
      );
    });

    expect(view.state.doc.toString()).toBe("hello");
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(5);
    expect(onChange).toHaveBeenCalledTimes(1);

    // 一次撤销直接回到输入前内容：重配没有增加任何撤销步骤。
    let undone = false;
    await act(async () => {
      undone = undo(view);
    });
    expect(undone).toBe(true);
    expect(view.state.doc.toString()).toBe("");
  });

  it("shows the column ruler only while word wrap is disabled", async () => {
    const { onChange, editable } = await renderEditor(true);
    expect(container.querySelector(".column-ruler")).toBeNull();

    await renderEditor(false);
    expect(container.querySelector(".column-ruler")).not.toBeNull();
    expect(container.querySelector(".editor-with-ruler")?.classList).toContain(
      "has-column-ruler",
    );
    // 标尺出现不重建编辑器实例。
    expect(container.querySelector(".cm-content")).toBe(editable);

    await renderEditor(true);
    expect(container.querySelector(".column-ruler")).toBeNull();
    expect(container.querySelector(".editor-with-ruler")?.classList).not.toContain(
      "has-column-ruler",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the ruler empty rather than crashing when layout is unmeasurable", async () => {
    await renderEditor(false);
    const ruler = container.querySelector(".column-ruler");
    expect(ruler).not.toBeNull();
    // jsdom 无布局：度量守卫返回空刻度而不是异常。
    expect(ruler?.querySelector(".column-ruler-tick")).toBeNull();
  });

  it("aligns column 1 to the actual line insertion point rather than the content box", async () => {
    await renderEditor(false);
    const view = viewOf(container);
    vi.spyOn(view, "defaultCharacterWidth", "get").mockReturnValue(10);
    view.scrollDOM.getBoundingClientRect = () =>
      ({ left: 100, width: 500 }) as DOMRect;
    view.contentDOM.getBoundingClientRect = () =>
      ({ left: 140 }) as DOMRect;
    const coordsAtPosSpy = vi.spyOn(view, "coordsAtPos").mockReturnValue({
      left: 148,
      right: 148,
      top: 0,
      bottom: 20,
    });

    await act(async () => {
      view.scrollDOM.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    expect(coordsAtPosSpy).toHaveBeenCalledWith(0);
    expect(
      container.querySelector<HTMLElement>(".column-ruler-tick")?.style.left,
    ).toBe("58px");
  });

  it("realigns the ruler when the line-number gutter widens as the line count grows", async () => {
    // 布局桩：可控矩形 + 手动触发的 ResizeObserver（jsdom 两者都没有）。
    const observed: Element[] = [];
    const observerCallbacks: ResizeObserverCallback[] = [];
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        observerCallbacks.push(callback);
      }
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {}
    }
    (
      window as unknown as { ResizeObserver: unknown }
    ).ResizeObserver = FakeResizeObserver;

    try {
      const onChange = vi.fn();
      const nineLines = "1\n2\n3\n4\n5\n6\n7\n8\n9";
      await act(async () => {
        root.render(
          <Editor
            content={nineLines}
            disabled={false}
            language="plain-text"
            onChange={onChange}
            wordWrapEnabled={false}
          />,
        );
      });
      const view = viewOf(container);
      const charWidthSpy = vi
        .spyOn(view, "defaultCharacterWidth", "get")
        .mockReturnValue(10);
      let insertionLeft = 40;
      view.scrollDOM.getBoundingClientRect = () =>
        ({ left: 0, width: 500 }) as DOMRect;
      vi.spyOn(view, "coordsAtPos").mockImplementation(() => ({
        left: insertionLeft,
        right: insertionLeft,
        top: 0,
        bottom: 20,
      }));

      const fireResizeObservers = () =>
        act(async () => {
          for (const callback of observerCallbacks) {
            callback([], {} as ResizeObserver);
          }
          await Promise.resolve();
        });

      await fireResizeObservers();
      const firstTick = () =>
        container.querySelector<HTMLElement>(".column-ruler-tick");
      expect(firstTick()?.style.left).toBe("50px");

      // 模拟行数 9→10 后 gutter 变宽：CodeMirror 的行数布局不是本用例的验证目标，
      // 直接改变内容左边界并触发 gutter observer，避免真实文档替换遗留异步 geometry update。
      insertionLeft = 48;
      await fireResizeObservers();

      // 标尺第 1 列跟随新的 gutter 宽度重新对齐。
      expect(firstTick()?.style.left).toBe("58px");
      // gutter 被纳入观察：其宽度变化能触发重测。
      expect(
        observed.some((element) => element.classList.contains("cm-gutters")),
      ).toBe(true);
      expect(charWidthSpy).toHaveBeenCalled();

      // 恢复全局桩之前先卸载 Editor；保留 React root 供 afterEach 正常销毁。
      await act(async () => {
        root.render(null);
        await Promise.resolve();
      });
    } finally {
      delete (window as unknown as { ResizeObserver: unknown }).ResizeObserver;
      vi.restoreAllMocks();
    }
  });

  it("skips reconfiguration when the preference value is unchanged", async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <Editor
          content="long line"
          disabled={false}
          language="plain-text"
          onChange={onChange}
          wordWrapEnabled
        />,
      );
    });
    const view = viewOf(container);
    const dispatchSpy = vi.spyOn(view, "dispatch");

    // 同值重渲染（含挂载后首跑）不产生任何重配事务。
    await act(async () => {
      root.render(
        <Editor
          content="long line"
          disabled={false}
          language="plain-text"
          onChange={onChange}
          wordWrapEnabled
        />,
      );
    });
    expect(dispatchSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <Editor
          content="long line"
          disabled={false}
          language="plain-text"
          onChange={onChange}
          wordWrapEnabled={false}
        />,
      );
    });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(".cm-content")?.classList.contains("cm-lineWrapping"),
    ).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Editor cursor position notifications", () => {
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

  function viewOf(element: HTMLElement): EditorView {
    const editor = element.querySelector<HTMLElement>(".cm-editor");
    if (!editor) throw new Error(".cm-editor not found");
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("EditorView not found");
    return view;
  }

  async function renderPositionEditor(
    onCursorPosition: (position: unknown) => void,
  ) {
    await act(async () => {
      root.render(
        <Editor
          content={"ab\ncd"}
          disabled={false}
          language="plain-text"
          onChange={vi.fn()}
          onCursorPosition={onCursorPosition}
        />,
      );
    });
    return viewOf(container);
  }

  it("reports the initial cursor position on mount", async () => {
    const onCursorPosition = vi.fn();
    await renderPositionEditor(onCursorPosition);
    expect(onCursorPosition).toHaveBeenCalledTimes(1);
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 1, column: 1 });
  });

  it("reports the main selection head for selection, document, and multi-cursor changes", async () => {
    const onCursorPosition = vi.fn();
    const view = await renderPositionEditor(onCursorPosition);

    await act(async () => {
      view.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 2, column: 3 });

    // 反向选择显示用户正在移动的 head 端。
    await act(async () => {
      view.dispatch({ selection: { anchor: 5, head: 2 } });
    });
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 1, column: 3 });

    // 文档变化后位置随选择映射更新。
    await act(async () => {
      view.dispatch({ selection: { anchor: 0, head: 5 } });
      view.dispatch({
        changes: { from: 0, insert: "a" },
        userEvent: "input.type",
      });
    });
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 2, column: 3 });

    // 矩形/多选区只报告 main 选择的 head（此时文档为 "aab\ncd"，head 5 在第 2 行偏移 1）。
    await act(async () => {
      view.dispatch({
        selection: EditorSelection.create(
          [
            { anchor: 0, head: 0 },
            { anchor: 4, head: 5 },
          ],
          1,
        ),
      });
    });
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 2, column: 2 });
  });

  it("does not re-notify for repeated updates at the same position", async () => {
    const onCursorPosition = vi.fn();
    const view = await renderPositionEditor(onCursorPosition);
    // 初始 {1,1} 一次。
    expect(onCursorPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.dispatch({ selection: { anchor: 0, head: 3 } });
    });
    expect(onCursorPosition).toHaveBeenCalledTimes(2);
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 2, column: 1 });

    // 同位置重复派发不产生新通知。
    await act(async () => {
      view.dispatch({ selection: { anchor: 0, head: 3 } });
      view.dispatch({});
    });
    expect(onCursorPosition).toHaveBeenCalledTimes(2);
  });

  it("clears the position on unmount", async () => {
    const onCursorPosition = vi.fn();
    await renderPositionEditor(onCursorPosition);
    await act(async () => {
      root.unmount();
    });
    expect(onCursorPosition).toHaveBeenLastCalledWith(null);
  });

  it("updates the position after deletions and undo", async () => {
    const onCursorPosition = vi.fn();
    const view = await renderPositionEditor(onCursorPosition);

    await act(async () => {
      view.dispatch({ selection: { anchor: 0, head: 3 } });
    });
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 2, column: 1 });

    // 删除换行符：head 映射到合并后行的第 3 列。
    await act(async () => {
      view.dispatch({
        changes: { from: 2, to: 3 },
        userEvent: "delete.backward",
      });
    });
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 1, column: 3 });

    // 撤销恢复文档与选择：位置回到第 2 行第 1 列。
    let undone = false;
    await act(async () => {
      undone = undo(view);
    });
    expect(undone).toBe(true);
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 2, column: 1 });
  });

  it("keeps reporting positions while the editor is read-only", async () => {
    const onCursorPosition = vi.fn();
    await act(async () => {
      root.render(
        <Editor
          content={"ab\ncd"}
          disabled
          language="plain-text"
          onChange={vi.fn()}
          onCursorPosition={onCursorPosition}
        />,
      );
    });
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 1, column: 1 });

    const editor = container.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editor!)!;
    await act(async () => {
      view.dispatch({ selection: { anchor: 0, head: 4 } });
    });
    expect(onCursorPosition).toHaveBeenLastCalledWith({ line: 2, column: 2 });
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
