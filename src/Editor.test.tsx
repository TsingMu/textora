// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./Editor";

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
      root.render(<Editor content="" onChange={onChange} />);
    });

    const editable = container.querySelector<HTMLElement>(".cm-content");
    expect(editable).not.toBeNull();
    editable?.focus();
    expect(document.activeElement).toBe(editable);

    await act(async () => {
      root.render(<Editor content="a" onChange={onChange} />);
    });

    expect(container.querySelector(".cm-content")).toBe(editable);
    expect(document.activeElement).toBe(editable);
    expect(container.querySelector(".cm-line")?.textContent).toBe("a");
    expect(onChange).not.toHaveBeenCalled();
  });
});
