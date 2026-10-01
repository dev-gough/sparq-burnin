import { describe, expect, it, vi } from "vitest";
import type { EChartsType } from "echarts";
import { bindCategoryPlotClick } from "@/lib/chart-plot-click";

function fixture() {
  let click: ((event: { offsetX: number; offsetY: number }) => void) | undefined;
  const renderer = {
    on: vi.fn((_name, handler) => { click = handler; }),
    off: vi.fn((_name, handler) => { if (click === handler) click = undefined; }),
  };
  const option = { xAxis: [{ data: ["2026-09-24", "2026-09-25", "2026-09-26"] }] };
  const chart = {
    getZr: () => renderer,
    containPixel: vi.fn((_finder, [x, y]) => x >= 10 && x <= 310 && y >= 20 && y <= 220),
    convertFromPixel: vi.fn((_finder, x: number) => Math.floor((x - 10) / 100)),
    getOption: () => option,
  };
  return { chart: chart as unknown as EChartsType, renderer, option, emit: (x: number, y: number) => click?.({ offsetX: x, offsetY: y }) };
}

describe("category plot click", () => {
  it("selects the same day above, below, or on a series using only horizontal position", () => {
    const f = fixture();
    const select = vi.fn();
    bindCategoryPlotClick(f.chart, select);
    for (const y of [21, 100, 219]) f.emit(160, y);
    expect(select.mock.calls).toEqual(Array(3).fill(["2026-09-25"]));
    expect(f.chart.convertFromPixel).toHaveBeenCalledWith({ xAxisIndex: 0 }, 160);
  });

  it("ignores legends, margins, invalid coordinates, and missing categories", () => {
    const f = fixture();
    const select = vi.fn();
    bindCategoryPlotClick(f.chart, select);
    for (const [x, y] of [[160, 0], [160, 240], [0, 100], [320, 100], [310, 100]]) f.emit(x, y);
    vi.mocked(f.chart.convertFromPixel).mockReturnValue(NaN);
    f.emit(160, 100);
    expect(select).not.toHaveBeenCalled();
  });

  it("uses the currently painted categories after a range or grouping change", () => {
    const f = fixture();
    const select = vi.fn();
    bindCategoryPlotClick(f.chart, select);
    f.option.xAxis[0].data = ["2026-09-01", "2026-09-08"];
    f.emit(160, 100);
    expect(select).toHaveBeenCalledWith("2026-09-08");
  });

  it("removes its listener before rebinding so a click fires once", () => {
    const f = fixture();
    const oldSelect = vi.fn(), newSelect = vi.fn();
    const cleanup = bindCategoryPlotClick(f.chart, oldSelect);
    cleanup();
    const nextCleanup = bindCategoryPlotClick(f.chart, newSelect);
    f.emit(160, 100);
    expect(oldSelect).not.toHaveBeenCalled();
    expect(newSelect).toHaveBeenCalledTimes(1);
    nextCleanup();
    f.emit(160, 100);
    expect(newSelect).toHaveBeenCalledTimes(1);
  });
});
