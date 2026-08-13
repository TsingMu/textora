// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import {
  previewBlockIndexForSourceLine,
  previewBlockRelativeTops,
  scrollPreviewToBlock,
  topPreviewBlockIndex,
} from "./markdownPreviewSync";
import { collectMarkdownBlockMap } from "./markdownPreview";

describe("previewBlockRelativeTops", () => {
  function rect(top: number): DOMRect {
    return { top } as DOMRect;
  }

  it("computes each block's top relative to the pane viewport top", () => {
    const pane = document.createElement("div");
    const content = document.createElement("div");
    const a = document.createElement("div");
    const b = document.createElement("div");
    const c = document.createElement("div");
    content.append(a, b, c);

    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(rect(100));
    vi.spyOn(a, "getBoundingClientRect").mockReturnValue(rect(80));
    vi.spyOn(b, "getBoundingClientRect").mockReturnValue(rect(130));
    vi.spyOn(c, "getBoundingClientRect").mockReturnValue(rect(200));

    expect(previewBlockRelativeTops(pane, content)).toEqual([-20, 30, 100]);
    vi.restoreAllMocks();
  });
});

describe("topPreviewBlockIndex", () => {
  it("returns null for an empty list", () => {
    expect(topPreviewBlockIndex([])).toBeNull();
  });

  it("falls back to the first block when all blocks are below the viewport top", () => {
    expect(topPreviewBlockIndex([5, 30, 60])).toBe(0);
  });

  it("returns the last block whose top is at or above the viewport top", () => {
    expect(topPreviewBlockIndex([-50, -10, 30])).toBe(1);
    expect(topPreviewBlockIndex([-100, -50, -10])).toBe(2);
    expect(topPreviewBlockIndex([-100, 10, 30])).toBe(0);
  });
});

describe("previewBlockIndexForSourceLine", () => {
  it("returns null for an empty map or negative line", () => {
    expect(previewBlockIndexForSourceLine([], 0)).toBeNull();
    expect(previewBlockIndexForSourceLine(collectMarkdownBlockMap("a"), -1)).toBeNull();
  });

  it("maps a line inside the first block to index 0", () => {
    const map = collectMarkdownBlockMap("hello\nworld");
    expect(previewBlockIndexForSourceLine(map, 0)).toBe(0);
    expect(previewBlockIndexForSourceLine(map, 1)).toBe(0);
  });

  it("maps lines across heading + paragraph blocks", () => {
    const map = collectMarkdownBlockMap("# Title\n\nText.");
    // 行 0 = 标题；行 2 = 段落；行 1（空行）仍归属上一个块（标题）。
    expect(previewBlockIndexForSourceLine(map, 0)).toBe(0);
    expect(previewBlockIndexForSourceLine(map, 1)).toBe(0);
    expect(previewBlockIndexForSourceLine(map, 2)).toBe(1);
  });

  it("clamps a line beyond the last block to the last block index", () => {
    const map = collectMarkdownBlockMap("# Title\n\nText.");
    expect(previewBlockIndexForSourceLine(map, 99)).toBe(1);
  });

  it("falls back to the first block for leading blank lines", () => {
    const map = collectMarkdownBlockMap("\n\n# Title");
    expect(previewBlockIndexForSourceLine(map, 0)).toBe(0);
    expect(previewBlockIndexForSourceLine(map, 2)).toBe(0);
  });
});

describe("scrollPreviewToBlock", () => {
  function rect(top: number): DOMRect {
    return { top } as DOMRect;
  }

  function makePaneAndContent(childCount: number): {
    pane: HTMLElement;
    content: HTMLElement;
  } {
    const pane = document.createElement("aside");
    const content = document.createElement("div");
    pane.appendChild(content);
    for (let i = 0; i < childCount; i++) {
      content.appendChild(document.createElement("div"));
    }
    return { pane, content };
  }

  it("scrolls the preview pane to put the matching child at the top", () => {
    const { pane, content } = makePaneAndContent(3);
    Object.defineProperty(pane, "scrollTop", {
      configurable: true,
      writable: true,
      value: 20,
    });
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(rect(100));
    vi.spyOn(content.children[1] as HTMLElement, "getBoundingClientRect").mockReturnValue(
      rect(180),
    );
    const flag = { current: false };

    const ok = scrollPreviewToBlock(pane, content, 1, flag);

    expect(ok).toBe(true);
    expect(pane.scrollTop).toBe(100);
    vi.restoreAllMocks();
  });

  it("keeps the programmatic flag set until the next animation frame", () => {
    const { pane, content } = makePaneAndContent(2);
    vi.spyOn(pane, "getBoundingClientRect").mockReturnValue(rect(0));
    vi.spyOn(content.children[0] as HTMLElement, "getBoundingClientRect").mockReturnValue(
      rect(0),
    );
    const frames: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);
        return 1;
      });
    const flag = { current: false };

    scrollPreviewToBlock(pane, content, 0, flag);
    expect(flag.current).toBe(true);
    expect(frames).toHaveLength(1);

    frames[0]!(0);
    expect(flag.current).toBe(false);

    rafSpy.mockRestore();
  });

  it("returns false and leaves the flag unchanged for an invalid index", () => {
    const { pane, content } = makePaneAndContent(1);
    const scrollTo = vi.fn();
    Object.defineProperty(pane, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollTo,
    });
    const flag = { current: false };

    expect(scrollPreviewToBlock(pane, content, 5, flag)).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(flag.current).toBe(false);
  });
});
