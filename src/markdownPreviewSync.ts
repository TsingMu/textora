/**
 * Markdown Preview 同步滚动辅助（`docs/features/markdown-preview-sync-scroll.md` 切片 3）。
 *
 * 纯函数 + 受控 DOM 操作：按块映射把源码行定位到对应预览块序号，并在程序滚动预览时打标记，
 * 供后续预览→源码方向（切片 4）抑制反向循环。本模块不读取 CodeMirror 状态、不监听事件。
 */

import type { MarkdownBlock } from "./markdownPreview";

/**
 * 返回与 `sourceLine`（0-based）对应的预览块序号：取 `startLine <= sourceLine` 的最后一个块；
 * `sourceLine` 处于首块之前的空白行时回落到首块（0），超过所有块时回落到最后一个块。
 * 空映射或负行号返回 `null`。
 */
export function previewBlockIndexForSourceLine(
  blockMap: readonly MarkdownBlock[],
  sourceLine: number,
): number | null {
  if (sourceLine < 0 || blockMap.length === 0) {
    return null;
  }
  let result = 0;
  for (let i = 0; i < blockMap.length; i++) {
    if (blockMap[i].startLine <= sourceLine) {
      result = i;
    } else {
      break;
    }
  }
  return result;
}

/**
 * 计算预览各顶层块相对视口顶部的偏移（`child.rect.top - pane.rect.top`），随当前滚动位置变化。
 * 供 {@link topPreviewBlockIndex} 找出视口顶部对应的预览块。在每次滚动时读取 live rect，因此预览重渲染
 * 或 Mermaid 异步高度变化后的新结构会在下一次滚动自动反映。
 */
export function previewBlockRelativeTops(
  pane: HTMLElement,
  content: HTMLElement,
): number[] {
  const paneTop = pane.getBoundingClientRect().top;
  return Array.from(content.children).map((child) => {
    if (!(child instanceof HTMLElement)) {
      return Number.POSITIVE_INFINITY;
    }
    return child.getBoundingClientRect().top - paneTop;
  });
}

/**
 * 返回预览视口顶部对应的块序号：取相对偏移 `<= 0` 的最后一个块（其顶部恰在视口顶部或之上）；
 * 全部 `> 0`（滚动到文档最顶）时回落到 0。空数组返回 `null`。
 */
export function topPreviewBlockIndex(
  blockRelativeTops: readonly number[],
): number | null {
  if (blockRelativeTops.length === 0) {
    return null;
  }
  let result = 0;
  for (let i = 0; i < blockRelativeTops.length; i++) {
    if (blockRelativeTops[i] <= 0) {
      result = i;
    } else {
      break;
    }
  }
  return result;
}

/**
 * 把预览容器第 N 个顶层元素滚动到预览 pane 可视顶部。滚动前置位 `programmaticRef` 为 `true`
 * 并在下一动画帧清除，使由本次程序滚动派生的预览滚动事件能被预览→源码方向（切片 4）识别并忽略，
 * 避免循环。容器或序号无效时返回 `false`，不改动任何状态。
 */
export function scrollPreviewToBlock(
  pane: HTMLElement,
  content: HTMLElement,
  blockIndex: number,
  programmaticRef: { current: boolean },
): boolean {
  const child = content.children[blockIndex];
  if (!(child instanceof HTMLElement)) {
    return false;
  }
  programmaticRef.current = true;
  const targetTop =
    child.getBoundingClientRect().top -
    pane.getBoundingClientRect().top +
    pane.scrollTop;
  const top = Math.max(0, targetTop);
  if (typeof pane.scrollTo === "function") {
    pane.scrollTo({ top, behavior: "auto" });
  } else {
    pane.scrollTop = top;
  }
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
  } else {
    programmaticRef.current = false;
  }
  return true;
}
