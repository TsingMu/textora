// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownWysiwygEditor } from "./MarkdownWysiwygEditor";
import { scanMarkdownTable, decodeMarkdownTableCell } from "./markdownTable";
import { inlineNodeVisibleText, parseInline } from "./markdownWysiwygInline";

function input(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("editable table cells", () => {
  let root: ReturnType<typeof createRoot>;
  let host: HTMLDivElement;
  let source: string;
  const changed = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    changed.mockClear();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
  function Controlled({
    initial,
    disabled = false,
  }: {
    initial: string;
    disabled?: boolean;
  }) {
    const [value, setValue] = useState(initial);
    source = value;
    return (
      <MarkdownWysiwygEditor
        content={value}
        disabled={disabled}
        onChange={(next) => {
          changed(next);
          setValue(next);
        }}
      />
    );
  }
  async function render(
    value = "| A | B |\n| :---: | ---: |\n| **粗体** |  |",
    disabled = false,
  ) {
    await act(async () =>
      root.render(<Controlled initial={value} disabled={disabled} />),
    );
  }
  function cell(selector = "tbody td", index = 0) {
    return host.querySelectorAll<HTMLTextAreaElement>(selector + " textarea")[
      index
    ]!;
  }

  it("edits headers, empty cells and emptied formatting while preserving native control identity", async () => {
    await render();
    const header = cell("thead th");
    await act(async () => input(header, "文件"));
    expect(source).toContain("| 文件 | B |");
    const bold = cell();
    bold.focus();
    await act(async () => input(bold, ""));
    expect(source).toContain("|  |  |");
    expect(cell()).toBe(bold);
    expect(document.activeElement).toBe(bold);
    await act(async () => input(bold, "恢复"));
    expect(source).toContain("|  **恢复**|  |");
    const empty = host
      .querySelectorAll<HTMLTableCellElement>("tbody td")[1]
      .querySelector("textarea")!;
    await act(async () => input(empty, "内容"));
    expect(source).toContain("|  **恢复**|  内容|");
  });

  it.each([
    ["**old**", "**new**"],
    ["_old_", "_new_"],
    ["~~old~~", "~~new~~"],
    ["`old`", "`new`"],
    ["[old](URL)", "[new](URL)"],
  ])(
    "edits an existing formatted fragment without changing its neighbors (%s)",
    async (raw, expected) => {
      const original = `| H |\n| --- |\n| prefix ${raw} suffix |`;
      await render(original);
      const field =
        host.querySelectorAll<HTMLTextAreaElement>("tbody textarea")[1];
      await act(async () => input(field, "new"));
      expect(source).toBe(original.replace(raw, expected));
    },
  );

  it("focuses empty cell input from the cell background and leaves Tab/Shift+Tab native", async () => {
    await render();
    const td = host.querySelectorAll<HTMLTableCellElement>("tbody td")[1];
    await act(async () => td.click());
    const field = td.querySelector("textarea")!;
    expect(document.activeElement).toBe(field);
    for (const shiftKey of [false, true]) {
      const tab = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(false);
    }
  });

  it.each(["中文😀", "a|b", "a\\|b", "`literal`", "x\\", "hello world"])(
    "keeps special visible text and table shape (%j)",
    async (visible) => {
      await render("| H |\n| --- |\n| text |");
      const field = cell();
      await act(async () => input(field, visible));
      const scan = scanMarkdownTable(source);
      expect(scan.kind).toBe("table");
      if (scan.kind !== "table") throw new Error("not rectangular");
      expect(scan.table.rows).toHaveLength(1);
      expect(scan.table.rows[0].cells).toHaveLength(1);
      const raw = decodeMarkdownTableCell(scan.table.rows[0].cells[0].source);
      expect(parseInline(raw).map(inlineNodeVisibleText).join("")).toBe(
        visible,
      );
      expect(cell()).toBe(field);
    },
  );

  it("does not drop a transient word-separating space or rewrite existing cell padding", async () => {
    await render("| H |\n| --- |\n|  hello   |");
    const field = cell();
    await act(async () => input(field, "hello "));
    expect(field.value).toBe("hello ");
    expect(changed).not.toHaveBeenCalled();
    await act(async () => input(field, "hello world"));
    expect(source).toBe("| H |\n| --- |\n|  hello world   |");
  });

  it("retains unedited inline tokens, link destination and document surroundings", async () => {
    const original =
      "\r\n | H | Other |\r\n | ----- | :----: |\r\n | **粗体** _斜体_ ~~删除~~ `code` [标签](URL) | same |\r\n\r\ntail\r\n";
    await render(original);
    const fragments = host.querySelectorAll<HTMLTextAreaElement>(
      "tbody td:first-child textarea",
    );
    await act(async () => input(fragments[fragments.length - 1], "新标签"));
    expect(source).toBe(original.replace("[标签](URL)", "[新标签](URL)"));
    expect(host.querySelector("a, [href], img")).toBeNull();
  });

  it("defers Chinese composition until commit, permits candidate Enter, and blocks ordinary Enter/beforeinput", async () => {
    await render();
    const field = cell();
    await act(async () => {
      field.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      input(field, "zhong");
    });
    expect(changed).not.toHaveBeenCalled();
    const candidate = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    field.dispatchEvent(candidate);
    expect(candidate.defaultPrevented).toBe(false);
    await act(async () => {
      input(field, "中文");
      field.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "中文" }),
      );
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(source).toContain("**中文**");
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    const newline = new InputEvent("beforeinput", {
      inputType: "insertLineBreak",
      bubbles: true,
      cancelable: true,
    });
    field.dispatchEvent(newline);
    expect(newline.defaultPrevented).toBe(true);
  });

  it("pastes only flattened plain text once, never a matrix or HTML", async () => {
    await render();
    const field = cell();
    field.setSelectionRange(0, field.value.length);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    const clipboard = {
      getData: vi.fn((type) =>
        type === "text/plain" ? "中文\r\nA\tB|C" : "<b>bad</b>",
      ),
    };
    Object.defineProperty(paste, "clipboardData", { value: clipboard });
    await act(async () => field.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(clipboard.getData).toHaveBeenCalledExactlyOnceWith("text/plain");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(source).toContain("**中文 A B\\|C**");
  });

  it("grows and retains code fences while refusing edge backticks that cannot round-trip", async () => {
    await render("| H |\n| --- |\n| `old` |");
    const field = cell();
    await act(async () => input(field, "a`b"));
    expect(source).toContain("| ``a`b`` |");
    await act(async () => input(field, "plain"));
    expect(source).toContain("| ``plain`` |");
    const before = source;
    await act(async () => input(field, "`edge`"));
    expect(source).toBe(before);
    expect(field.value).toBe("plain");
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });

  it("rolls back a nonrepresentable code edit visibly, preserving the source", async () => {
    const original = "| H |\n| --- |\n| `old` |";
    await render(original);
    const field = cell();
    await act(async () => input(field, "a\\|b"));
    expect(source).toBe(original);
    expect(changed).not.toHaveBeenCalled();
    expect(field.value).toBe("old");
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "source mode",
    );
  });

  it("invalidates pending composition when an external update changes only another block", async () => {
    const initial = "# Before\n\n| H |\n| --- |\n| value |";
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <MarkdownWysiwygEditor content={initial} onChange={onChange} />,
      ),
    );
    const field = cell();
    await act(async () => {
      field.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      input(field, "旧组合");
    });
    await act(async () =>
      root.render(
        <MarkdownWysiwygEditor
          content={initial.replace("Before", "External")}
          onChange={onChange}
        />,
      ),
    );
    await act(async () => {
      field.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          bubbles: true,
        }),
      );
      input(field, "迟到内容");
      field.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe("value");
  });

  it("rejects late composition after an external snapshot or lock and allows subsequent fresh typing", async () => {
    const initial = "| H |\n| --- |\n| old |";
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <MarkdownWysiwygEditor content={initial} onChange={onChange} />,
      ),
    );
    const field = cell();
    await act(async () => {
      field.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      input(field, "组合中");
    });
    await act(async () =>
      root.render(
        <MarkdownWysiwygEditor
          content={initial.replace("old", "external")}
          onChange={onChange}
        />,
      ),
    );
    await act(async () => {
      input(field, "过期");
      field.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      input(field, "过期");
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe("external");
    await act(async () => {
      field.dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true }),
      );
      input(field, "fresh");
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    onChange.mockClear();
    await act(async () =>
      root.render(
        <MarkdownWysiwygEditor
          content={initial}
          onChange={onChange}
          disabled
        />,
      ),
    );
    await act(async () => {
      input(field, "forbidden");
      field.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
