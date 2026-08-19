// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ColumnRuler, rulerTicksFor } from "./columnRuler";

describe("rulerTicksFor", () => {
  it("returns no ticks when the metrics are not measurable", () => {
    expect(
      rulerTicksFor({ charWidth: 0, originLeft: 0, scrollLeft: 0, visibleWidth: 100 }),
    ).toEqual([]);
    expect(
      rulerTicksFor({ charWidth: 10, originLeft: 0, scrollLeft: 0, visibleWidth: 0 }),
    ).toEqual([]);
  });

  it("produces base, mid and major ticks with labels for the visible window", () => {
    const ticks = rulerTicksFor({
      charWidth: 10,
      originLeft: 0,
      scrollLeft: 0,
      visibleWidth: 105,
    });
    expect(ticks.map((tick) => tick.column)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(ticks[0]).toEqual({ column: 1, level: "base", left: 10, label: null });
    expect(ticks[4]).toEqual({ column: 5, level: "mid", left: 50, label: null });
    expect(ticks[9]).toEqual({ column: 10, level: "major", left: 100, label: 10 });
  });

  it("shifts the tick window with horizontal scrolling and origin offset", () => {
    // 滚动 100px（gutter 30px）：左缘是第 10 列右边界，第 11 列刻度在 10px。
    const scrolled = rulerTicksFor({
      charWidth: 10,
      originLeft: 30,
      scrollLeft: 130,
      visibleWidth: 110,
    });
    expect(scrolled[0]).toEqual({
      column: 10,
      level: "major",
      left: 0,
      label: 10,
    });
    // 列 15（中刻度）与列 20（强刻度 + 数字）落点随滚动平移。
    expect(scrolled.find((tick) => tick.column === 15)).toEqual({
      column: 15,
      level: "mid",
      left: 50,
      label: null,
    });
    expect(scrolled.find((tick) => tick.column === 20)).toEqual({
      column: 20,
      level: "major",
      left: 100,
      label: 20,
    });

    // 未滚动时 gutter 偏移后，第 1 列刻度位于首字符右边界。
    const guttered = rulerTicksFor({
      charWidth: 10,
      originLeft: 30,
      scrollLeft: 0,
      visibleWidth: 41,
    });
    expect(guttered[0]).toEqual({ column: 1, level: "base", left: 40, label: null });
    expect(guttered).toHaveLength(1);
  });

  it("starts from a partially visible column when scrolled mid-column", () => {
    const ticks = rulerTicksFor({
      charWidth: 10,
      originLeft: 0,
      scrollLeft: 15,
      visibleWidth: 30,
    });
    expect(ticks.map((tick) => tick.column)).toEqual([2, 3, 4]);
    expect(ticks[0].left).toBe(5);
  });
});

describe("ColumnRuler", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders ticks with level classes, positions, and major labels", async () => {
    await act(async () => {
      root.render(
        <ColumnRuler
          metrics={{ charWidth: 10, originLeft: 0, scrollLeft: 0, visibleWidth: 105 }}
        />,
      );
    });

    const ticks = Array.from(container.querySelectorAll(".column-ruler-tick"));
    expect(ticks).toHaveLength(10);
    const major = container.querySelector(".column-ruler-tick.is-major");
    expect(major?.getAttribute("style")).toContain("left: 100px");
    expect(major?.querySelector(".column-ruler-label")?.textContent).toBe("10");
    expect(container.querySelector(".column-ruler-tick.is-mid")).not.toBeNull();
    // 非 10 列刻度不渲染数字。
    expect(container.querySelectorAll(".column-ruler-label")).toHaveLength(1);
  });

  it("renders an empty ruler container while metrics are unavailable", async () => {
    await act(async () => {
      root.render(<ColumnRuler metrics={null} />);
    });
    expect(container.querySelector(".column-ruler")).not.toBeNull();
    expect(container.querySelector(".column-ruler-tick")).toBeNull();
  });
});
