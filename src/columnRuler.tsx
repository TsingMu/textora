import { useMemo } from "react";

/** 标尺度量快照：由 Editor 从 CodeMirror 实际布局测量，不含固定 CSS 像素假设。 */
export type ColumnRulerMetrics = {
  /** 每个显示列的像素宽（编辑器实际字符宽）。 */
  charWidth: number;
  /** 滚动坐标 `scrollLeft = 0` 时正文行首插入点相对标尺视口左缘的像素 x。 */
  originLeft: number;
  /** 当前水平滚动像素。 */
  scrollLeft: number;
  /** 标尺可视像素宽。 */
  visibleWidth: number;
};

export type RulerTickLevel = "base" | "mid" | "major";

/** 一个列刻度：1-based 列号、层级、相对标尺视口的像素位置与 10 列数字。 */
export type RulerTick = {
  column: number;
  level: RulerTickLevel;
  left: number;
  label: number | null;
};

/**
 * 计算可视窗口内的列刻度：每列基础刻度、每 5 列中刻度、每 10 列强刻度并显示十进制
 * 列号。刻度位于对应字符列的右边界，因此输入 5 个窄字符后的光标与刻度 5 对齐；
 * 数字不改变相邻刻度间距。度量不可用（非正字符宽或可视宽）时返回空。
 */
export function rulerTicksFor(metrics: ColumnRulerMetrics): RulerTick[] {
  if (!(metrics.charWidth > 0) || !(metrics.visibleWidth > 0)) {
    return [];
  }
  const first = Math.max(
    1,
    Math.ceil((metrics.scrollLeft - metrics.originLeft) / metrics.charWidth),
  );
  // 减去极小量避免把「恰好压在右缘」的刻度算入。
  const last = Math.floor(
    (metrics.scrollLeft + metrics.visibleWidth - metrics.originLeft - 1e-6) /
      metrics.charWidth,
  );
  const ticks: RulerTick[] = [];
  for (let column = first; column <= last; column += 1) {
    const level: RulerTickLevel =
      column % 10 === 0 ? "major" : column % 5 === 0 ? "mid" : "base";
    ticks.push({
      column,
      level,
      left: Math.round(
        (metrics.originLeft + column * metrics.charWidth - metrics.scrollLeft) *
          100,
      ) / 100,
      label: level === "major" ? column : null,
    });
  }
  return ticks;
}

/** 横向列标尺视图；`metrics === null`（尚不可测量）时渲染空标尺容器。 */
export function ColumnRuler({
  metrics,
}: {
  metrics: ColumnRulerMetrics | null;
}) {
  const ticks = useMemo(
    () => (metrics === null ? [] : rulerTicksFor(metrics)),
    [metrics],
  );
  return (
    <div className="column-ruler" aria-hidden="true">
      {ticks.map((tick) => (
        <span
          key={tick.column}
          className={`column-ruler-tick is-${tick.level}`}
          style={{ left: `${tick.left}px` }}
        >
          {tick.label !== null && (
            <span className="column-ruler-label">{tick.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
