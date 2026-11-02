// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownWysiwygEditor } from "./MarkdownWysiwygEditor";
import { MarkdownWysiwygTableEditor } from "./MarkdownWysiwygTableEditor";
import { renderMarkdownPreview } from "./markdownPreview";
import { scanMarkdownTable } from "./markdownTable";

describe("read-only WYSIWYG table", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(source: string, disabled = false) {
    const scan = scanMarkdownTable(source);
    if (scan.kind !== "table") throw new Error("Expected supported fixture");
    await act(async () =>
      root.render(
        <MarkdownWysiwygTableEditor table={scan.table} disabled={disabled} />,
      ),
    );
    return scan.table;
  }

  it("shows real header/body cells, empty cells and four column alignments", async () => {
    await render(
      "| 文件 | 左 | 中 | 右 |\n| --- | :--- | :---: | ---: |\n| `app/src/BackupLimits.kt` | **新增** | | 内容 |",
    );
    expect(container.querySelectorAll("thead th")).toHaveLength(4);
    expect(container.querySelectorAll("tbody td")).toHaveLength(4);
    expect(container.querySelector(".wysiwyg-inline-code")?.textContent).toBe(
      "app/src/BackupLimits.kt",
    );
    expect(container.querySelector(".wysiwyg-inline-bold")?.textContent).toBe(
      "新增",
    );
    for (const selector of ["thead th", "tbody td"]) {
      const cells = Array.from(
        container.querySelectorAll<HTMLElement>(selector),
      );
      expect(cells.map((cell) => cell.style.textAlign)).toEqual([
        "",
        "left",
        "center",
        "right",
      ]);
    }
    expect(container.querySelectorAll("tbody td")[2].textContent).toBe("");
  });

  it.each([false, true])(
    "keeps header-only tables readable with no input or commands (disabled=%s)",
    async (disabled) => {
      await render("| A | B |\n| --- | --- |", disabled);
      expect(container.querySelectorAll("th")).toHaveLength(2);
      expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
      expect(
        container.querySelector('[role="region"]')?.getAttribute("tabindex"),
      ).toBe("0");
      expect(
        container
          .querySelector('[role="region"]')
          ?.getAttribute("aria-disabled"),
      ).toBe(String(disabled));
      expect(
        container.querySelector(
          'input, textarea:not(:disabled), button, [contenteditable="plaintext-only"]',
        ),
      ).toBeNull();
    },
  );

  it("matches Preview visible text and alignments after table/inline decoding without execution", async () => {
    const source = String.raw`| 格式 | 特殊文字 | 链接与 HTML |
| :--- | :---: | ---: |
| **粗体** _斜体_ ~~删除~~ | \*literal\* a\|b | [标签](javascript:alert) <img src=x onerror=bad> |
| \`a\|b\` | \`\`a\`b\`\` | [图片标签](https://example.invalid/secret.png) |
| a\\\|b | | <script>bad</script> |`.replace(/\\`/g, "`");
    await render(source);
    const preview = document.createElement("div");
    preview.innerHTML = renderMarkdownPreview(source).html;
    preview
      .querySelectorAll(".markdown-preview-link-url")
      .forEach((url) => url.remove());
    for (const selector of ["th", "td"]) {
      const read = (el: HTMLElement) =>
        Array.from(el.querySelectorAll<HTMLElement>(selector)).map((cell) => [
          cell.textContent?.replace(/\s+/g, " ").trim(),
          cell.style.textAlign,
        ]);
      expect(read(container)).toEqual(read(preview));
    }
    expect(container.querySelector(".wysiwyg-inline-italic")?.textContent).toBe(
      "斜体",
    );
    expect(container.querySelector(".wysiwyg-inline-strike")?.textContent).toBe(
      "删除",
    );
    expect(container.querySelector(".wysiwyg-inline-link")?.textContent).toBe(
      "标签",
    );
    expect(container.querySelector("tbody")?.textContent).toContain(
      "*literal* a|b",
    );
    expect(container.querySelector("tbody")?.textContent).toContain("a\\|b");
    for (const el of [container, preview])
      expect(
        el.querySelector("a, img, script, [href], [src], [onerror]"),
      ).toBeNull();
  });
  it("preserves Preview image placeholders and URL text without loading or navigating", async () => {
    const source =
      "| images |\n| --- |\n| ![图片](https://example.invalid/image.png) ![](file:///tmp/image.png) |\n| `![literal](file:///no.png)` [标签](https://example.invalid/link) |";
    await render(source);
    const preview = document.createElement("div");
    preview.innerHTML = renderMarkdownPreview(source).html;
    expect(
      preview.querySelectorAll(".markdown-preview-image-placeholder"),
    ).toHaveLength(2);
    expect(preview.querySelector("tbody")?.textContent).toContain(
      "Image: 图片 (https://example.invalid/image.png)",
    );
    expect(preview.querySelector("tbody")?.textContent).toContain(
      "Image: Untitled image (file:///tmp/image.png)",
    );
    expect(preview.querySelector("code")?.textContent).toBe(
      "![literal](file:///no.png)",
    );
    expect(
      preview.querySelector(".markdown-preview-link-url")?.textContent,
    ).toBe("(https://example.invalid/link)");
    for (const el of [container, preview])
      expect(el.querySelector("a, img, [href], [src]")).toBeNull();
  });
});

describe("table row editing", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let source: string;
  let updateExternal: (value: string) => void;
  const changed = vi.fn();
  const initial =
    "# Title\n\n| H | B |\n| :---: | ---: |\n| first | 一 |\n| second | 二 |\n| third | 三 |\n\ntail\n";
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
  });
  function Document({
    value,
    disabled = false,
  }: {
    value: string;
    disabled?: boolean;
  }) {
    const [current, setCurrent] = useState(value);
    source = current;
    updateExternal = setCurrent;
    return (
      <MarkdownWysiwygEditor
        content={current}
        disabled={disabled}
        onChange={(next) => {
          changed(next);
          setCurrent(next);
          return true;
        }}
      />
    );
  }
  async function render(value = initial, disabled = false) {
    await act(async () =>
      root.render(<Document value={value} disabled={disabled} />),
    );
  }
  function button(text: string) {
    const result = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((item) => item.textContent === text);
    if (!result) throw new Error(`missing button ${text}`);
    return result;
  }
  async function press(text: string) {
    await act(async () => button(text).click());
  }
  function field(row: number, column: number) {
    return host.querySelector<HTMLTextAreaElement>(
      `[data-table-row="${row}"][data-table-column="${column}"] textarea`,
    )!;
  }
  async function select(row: number, column = 0) {
    await act(async () => field(row, column).focus());
  }
  const confirmation = () => host.querySelector(".wysiwyg-table-row-confirm");

  it("inserts the first row under the header and deletes its empty row directly, restoring header focus", async () => {
    const headerOnly = "\r\n| H | B |\r\n| :---: | ---: |\r\n\r\ntail\r\n";
    await render(headerOnly);
    await select(-1, 1);
    expect(
      host.querySelectorAll(".wysiwyg-table-row-actions button"),
    ).toHaveLength(1);
    await press("Insert data row after header");
    expect(source).toBe(
      headerOnly.replace("| :---: | ---: |", "| :---: | ---: |\r\n|  |  |"),
    );
    expect(document.activeElement).toBe(field(0, 1));
    await press("Delete data row 1");
    expect(source).toBe(headerOnly);
    expect(confirmation()).toBeNull();
    expect(document.activeElement).toBe(field(-1, 1));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("inserts before/after the focused row and prevents overlapping old clicks", async () => {
    await render();
    await select(1, 1);
    expect(button("Insert row before").getAttribute("aria-label")).toBe(
      "Insert row before data row 2",
    );
    expect(button("Insert row after").getAttribute("aria-label")).toBe(
      "Insert row after data row 2",
    );
    await press("Insert row before");
    expect(source).toBe(
      initial.replace("| second | 二 |", "|  |  |\n| second | 二 |"),
    );
    expect(document.activeElement).toBe(field(1, 1));
    await press("Delete data row 2");
    expect(source).toBe(initial);
    expect(document.activeElement).toBe(field(1, 1));
    const add = button("Insert row after");
    const count = changed.mock.calls.length;
    await act(async () => {
      add.click();
      add.click();
    });
    expect(changed).toHaveBeenCalledTimes(count + 1);
    expect(source).toBe(
      initial.replace("| second | 二 |", "| second | 二 |\n|  |  |"),
    );
    expect(document.activeElement).toBe(field(2, 1));
  });

  it("requires local confirmation, cancels without writing, and focuses next/previous/header after deletion", async () => {
    await render();
    await select(1, 1);
    await press("Delete data row 2");
    expect(source).toBe(initial);
    expect(changed).not.toHaveBeenCalled();
    expect(confirmation()?.textContent).toContain("second");
    expect(document.activeElement).toBe(button("Cancel row deletion"));
    host
      .querySelectorAll<HTMLButtonElement>(
        '[aria-label="Table row actions"] button',
      )
      .forEach((control) => expect(control.disabled).toBe(true));
    await press("Cancel row deletion");
    expect(source).toBe(initial);
    expect(changed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field(1, 1));
    await press("Delete data row 2");
    const confirm = button("Confirm delete row 2");
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(source).toBe(initial.replace("| second | 二 |\n", ""));
    expect(document.activeElement).toBe(field(1, 1));
    expect(field(1, 1).value).toBe("三");
    await press("Delete data row 2");
    await press("Confirm delete row 2");
    expect(document.activeElement).toBe(field(0, 1));
    await press("Delete data row 1");
    await press("Confirm delete row 1");
    expect(source).toBe("# Title\n\n| H | B |\n| :---: | ---: |\n\ntail\n");
    expect(document.activeElement).toBe(field(-1, 1));
  });

  it.each(["external", "other-block", "locked"])(
    "cancels stale confirmation after %s and never revives it",
    async (change) => {
      await render();
      await select(0);
      await press("Delete data row 1");
      const oldConfirm = button("Confirm delete row 1");
      if (change === "external")
        await act(async () =>
          updateExternal(initial.replace("first", "external")),
        );
      if (change === "other-block") {
        const heading = host.querySelector(".is-h1 .wysiwyg-inline-text")!;
        await act(async () => {
          heading.textContent = "Changed";
          heading.dispatchEvent(new InputEvent("input", { bubbles: true }));
        });
      }
      if (change === "locked") await render(initial, true);
      expect(confirmation()).toBeNull();
      const count = changed.mock.calls.length;
      const unchanged = source;
      await act(async () => oldConfirm.click());
      expect(source).toBe(unchanged);
      expect(changed).toHaveBeenCalledTimes(count);
      if (change === "external") await act(async () => updateExternal(initial));
      if (change === "locked") {
        host
          .querySelectorAll<HTMLButtonElement>(
            '[aria-label="Table row actions"] button',
          )
          .forEach((control) => expect(control.disabled).toBe(true));
        await render(initial, false);
      }
      await act(async () => oldConfirm.click());
      expect(changed).toHaveBeenCalledTimes(count);
    },
  );

  it("does not delete a source-empty row while its IME text is uncommitted", async () => {
    const original = "| H |\n| --- |\n|  |";
    await render(original);
    await select(0);
    const input = field(0, 0);
    await act(async () =>
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    expect(button("Delete data row 1").disabled).toBe(true);
    await press("Delete data row 1");
    expect(source).toBe(original);
    await act(async () =>
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    expect(button("Delete data row 1").disabled).toBe(false);
    await press("Delete data row 1");
    expect(source).toBe("| H |\n| --- |");
  });

  it("recovers the target on an already-focused cell and ignores another field's stale composition end", async () => {
    await render();
    await select(0, 1);
    const body = field(0, 1);
    const header = field(-1, 1);
    await act(async () =>
      header.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    await act(async () => updateExternal(initial.replace("tail", "external")));
    // No focus event fires when the external update left the same control focused.
    expect(document.activeElement).toBe(body);
    await act(async () =>
      body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(button("Delete data row 1")).not.toBeNull();
    await act(async () =>
      body.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    await act(async () =>
      header.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    expect(button("Delete data row 1").disabled).toBe(true);
    await act(async () =>
      body.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    expect(button("Delete data row 1").disabled).toBe(false);
    await act(async () => updateExternal(initial.replace("tail", "external again")));
    await act(async () => body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
    expect(button("Delete data row 1")).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
  });

  it("keeps original content and releases controls when a row change cannot preserve parsing", async () => {
    const ambiguous = "| H |\n| --- |\n| --- |";
    await render(ambiguous);
    await select(0);
    await press("Insert row before");
    expect(source).toBe(ambiguous);
    expect(changed).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "source mode",
    );
    expect(button("Insert row before").disabled).toBe(false);
  });
});

describe("table column editing", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let source: string;
  let updateExternal: (value: string) => void;
  const changed = vi.fn();
  const body =
    "| H | B |\n| :---: | ---: |\n| first | 一 |\n| second | 二 |\n| third | 三 |";
  const initial = `# Title\n\n${body}\n\ntail\n`;
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
  });
  function Document({ value }: { value: string }) {
    const [current, setCurrent] = useState(value);
    source = current;
    updateExternal = setCurrent;
    return (
      <MarkdownWysiwygEditor
        content={current}
        onChange={(next) => {
          changed(next);
          setCurrent(next);
          return true;
        }}
      />
    );
  }
  async function render(value = initial) {
    await act(async () => root.render(<Document value={value} />));
  }
  function button(text: string) {
    const result = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((item) => item.textContent === text);
    if (!result) throw new Error(`missing button ${text}`);
    return result;
  }
  async function press(text: string) {
    await act(async () => button(text).click());
  }
  function field(row: number, column: number) {
    return host.querySelector<HTMLTextAreaElement>(
      `[data-table-row="${row}"][data-table-column="${column}"] textarea`,
    )!;
  }
  async function select(row: number, column = 0) {
    await act(async () => field(row, column).focus());
  }

  it("inserts columns before/after the focused cell, focuses the new column, then deletes the empty column directly", async () => {
    await render();
    await select(1, 1);
    const one =
      "| H |  | B |\n| :---: | --- | ---: |\n| first |  | 一 |\n| second |  | 二 |\n| third |  | 三 |";
    await press("Insert column before");
    expect(source).toBe(initial.replace(body, one));
    expect(document.activeElement).toBe(field(1, 1));
    const two =
      "| H |  |  | B |\n| :---: | --- | --- | ---: |\n| first |  |  | 一 |\n| second |  |  | 二 |\n| third |  |  | 三 |";
    await press("Insert column after");
    expect(source).toBe(initial.replace(body, two));
    expect(document.activeElement).toBe(field(1, 2));
    await select(1, 1);
    await press("Delete column 2");
    expect(source).toBe(initial.replace(body, one));
    expect(document.activeElement).toBe(field(1, 1));
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("confirms a non-empty column including its header, cancels cleanly, then deletes and focuses the right neighbor", async () => {
    await render();
    await select(0, 0);
    await press("Delete column 1");
    const confirm = host.querySelector(".wysiwyg-table-column-confirm")!;
    expect(confirm).not.toBeNull();
    expect(confirm.querySelector("code")?.textContent).toContain(
      "H / first / second / third",
    );
    await press("Cancel column deletion");
    expect(source).toBe(initial);
    expect(document.activeElement).toBe(field(0, 0));
    expect(changed).not.toHaveBeenCalled();
    await press("Delete column 1");
    await press("Confirm delete column 1");
    expect(source).toBe(
      initial.replace(
        body,
        "| B |\n| ---: |\n| 一 |\n| 二 |\n| 三 |",
      ),
    );
    expect(document.activeElement).toBe(field(0, 0));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("disables deleting the last column and keeps focus across interleaved row and column commands", async () => {
    const narrow = "| H |\n| --- |\n| x |";
    await render(narrow);
    await select(0, 0);
    expect(button("Delete column 1").disabled).toBe(true);
    const wide = "| H |  |\n| --- | --- |\n| x |  |";
    await press("Insert column after");
    expect(source).toBe(wide);
    expect(document.activeElement).toBe(field(0, 1));
    await press("Insert row before");
    expect(source).toBe("| H |  |\n| --- | --- |\n|  |  |\n| x |  |");
    expect(document.activeElement).toBe(field(0, 1));
    await press("Delete data row 1");
    expect(source).toBe(wide);
    expect(document.activeElement).toBe(field(0, 1));
    await press("Delete column 2");
    expect(source).toBe(narrow);
    expect(document.activeElement).toBe(field(0, 0));
    expect(button("Delete column 1").disabled).toBe(true);
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it("blocks stacked structure commands while a column confirmation is pending and cancels it on external updates", async () => {
    await render();
    await select(0, 0);
    await press("Delete column 1");
    expect(button("Insert row after").disabled).toBe(true);
    expect(button("Insert column before").disabled).toBe(true);
    const stale = button("Confirm delete column 1");
    await act(async () => updateExternal(initial.replace("tail", "external")));
    expect(host.querySelector(".wysiwyg-table-column-confirm")).toBeNull();
    const count = changed.mock.calls.length;
    await act(async () => stale.click());
    expect(source).toBe(initial.replace("tail", "external"));
    expect(changed).toHaveBeenCalledTimes(count);
  });

  it("blocks column commands while an IME composition is uncommitted", async () => {
    await render();
    await select(0, 0);
    const input = field(0, 0);
    await act(async () =>
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    expect(button("Insert column before").disabled).toBe(true);
    await press("Insert column before");
    expect(source).toBe(initial);
    await act(async () =>
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    expect(button("Insert column before").disabled).toBe(false);
    await press("Insert column before");
    expect(source).toBe(
      initial.replace(
        body,
        "|  | H | B |\n| --- | :---: | ---: |\n|  | first | 一 |\n|  | second | 二 |\n|  | third | 三 |",
      ),
    );
    expect(document.activeElement).toBe(field(0, 0));
  });

  it("keeps original content and releases controls when a column change cannot be represented", async () => {
    const scan = scanMarkdownTable("| H |\n| --- |\n| x |");
    if (scan.kind !== "table") throw new Error("expected table");
    await act(async () =>
      root.render(
        <MarkdownWysiwygTableEditor table={scan.table} onColumnChange={() => null} />,
      ),
    );
    await act(async () =>
      host
        .querySelector<HTMLTextAreaElement>('[data-table-row="0"][data-table-column="0"] textarea')
        ?.focus(),
    );
    await act(async () => button("Insert column before").click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "column operation",
    );
    expect(button("Insert column before").disabled).toBe(false);
  });
});

describe("table column alignment", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let source: string;
  const changed = vi.fn();
  const body = "| A | B |\n| :--- | ---: |\n| a | b |";
  const initial = `# T\n\n${body}\n\ntail\n`;
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
  });
  function Document({ value }: { value: string }) {
    const [current, setCurrent] = useState(value);
    source = current;
    return (
      <MarkdownWysiwygEditor
        content={current}
        onChange={(next) => {
          changed(next);
          setCurrent(next);
          return true;
        }}
      />
    );
  }
  async function render(value = initial) {
    await act(async () => root.render(<Document value={value} />));
  }
  function button(text: string) {
    const result = Array.from(
      host.querySelectorAll<HTMLButtonElement>("button"),
    ).find((item) => item.textContent === text);
    if (!result) throw new Error(`missing button ${text}`);
    return result;
  }
  async function press(text: string) {
    await act(async () => button(text).click());
  }
  function field(row: number, column: number) {
    return host.querySelector<HTMLTextAreaElement>(
      `[data-table-row="${row}"][data-table-column="${column}"] textarea`,
    )!;
  }
  async function select(row: number, column = 0) {
    await act(async () => field(row, column).focus());
  }

  it("sets all four alignments for the selected column, disabling the current one and keeping focus and host identity", async () => {
    await render();
    await select(0, 0);
    const input = field(0, 0);
    expect(button("Align left").disabled).toBe(true);
    expect(button("Align center").getAttribute("aria-label")).toBe(
      "Set column 1 alignment to center",
    );
    await press("Align center");
    expect(source).toBe(initial.replace(":--- |", ":---: |"));
    expect(host.querySelector<HTMLElement>("thead th")?.style.textAlign).toBe("center");
    expect(host.querySelector<HTMLElement>("tbody td")?.style.textAlign).toBe("center");
    expect(document.activeElement).toBe(input);
    await press("Align right");
    expect(source).toBe(initial.replace(":--- |", "---: |"));
    expect(button("Align right").disabled).toBe(true);
    await press("Align default");
    expect(source).toBe(initial.replace(":--- |", "--- |"));
    await press("Align left");
    expect(source).toBe(initial);
    expect(document.activeElement).toBe(input);
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it("keeps alignments correct across interleaved row and column commands", async () => {
    await render();
    await select(0, 1);
    await press("Align center");
    expect(source).toBe(initial.replace("| ---: |", "| :---: |"));
    await press("Insert row after");
    expect(source).toBe(
      initial.replace("| ---: |", "| :---: |").replace("a | b |", "a | b |\n|  |  |"),
    );
    await press("Insert column after");
    expect(source).toBe(
      initial
        .replace("| A | B |", "| A | B |  |")
        .replace("| :--- | ---: |", "| :--- | :---: | --- |")
        .replace("a | b |", "a | b |  |\n|  |  |  |"),
    );
    expect(button("Align default").disabled).toBe(true);
    await press("Delete column 3");
    expect(source).toBe(
      initial.replace("| ---: |", "| :---: |").replace("a | b |", "a | b |\n|  |  |"),
    );
    expect(host.querySelectorAll<HTMLElement>("tbody td")[0].style.textAlign).toBe("left");
    expect(host.querySelectorAll<HTMLElement>("tbody td")[1].style.textAlign).toBe("center");
    expect(button("Align center").disabled).toBe(true);
  });

  it("blocks alignment while a deletion confirmation is pending and releases after cancel", async () => {
    await render();
    await select(0, 0);
    await press("Delete data row 1");
    expect(button("Align center").disabled).toBe(true);
    await press("Cancel row deletion");
    expect(button("Align center").disabled).toBe(false);
    expect(source).toBe(initial);
    expect(changed).not.toHaveBeenCalled();
  });

  it("blocks alignment while an IME composition is uncommitted", async () => {
    await render();
    await select(0, 0);
    await act(async () =>
      field(0, 0).dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    expect(button("Align center").disabled).toBe(true);
    await press("Align center");
    expect(source).toBe(initial);
    await act(async () =>
      field(0, 0).dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    await press("Align center");
    expect(source).toBe(initial.replace(":--- |", ":---: |"));
  });

  it("keeps original content and releases controls when an alignment change cannot be represented", async () => {
    const scan = scanMarkdownTable(initial.slice(initial.indexOf("| A")));
    if (scan.kind !== "table") throw new Error("expected table");
    await act(async () =>
      root.render(
        <MarkdownWysiwygTableEditor
          table={scan.table}
          onAlignmentChange={() => null}
        />,
      ),
    );
    await act(async () => button("Align center").click());
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "alignment change",
    );
    expect(button("Align center").disabled).toBe(false);
  });
});
