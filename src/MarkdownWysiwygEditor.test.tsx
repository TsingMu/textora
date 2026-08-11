// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownWysiwygEditor } from "./MarkdownWysiwygEditor";

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

    const heading = container.querySelector<HTMLInputElement>(
      ".markdown-wysiwyg-heading",
    );
    expect(heading).not.toBeNull();

    await act(async () => {
      if (heading === null) throw new Error("missing heading");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(heading, "Edited");
      heading.dispatchEvent(new Event("input", { bubbles: true }));
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

    await act(async () => {
      if (island === null) throw new Error("missing source island");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(island, "```mermaid\nflowchart TD\nA-->C\n```");
      island.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith(
      "```mermaid\nflowchart TD\nA-->C\n```",
    );
  });
});
