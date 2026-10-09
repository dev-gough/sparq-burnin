import { describe, expect, it, vi } from "vitest";
import type { EChartsType } from "echarts";
import { bindCategoryPlotClick } from "@/lib/chart-plot-click";

function fixture() {
  const handlers = new Map<string, (event: { offsetX: number; offsetY: number }) => void>();
  const renderer = {
    on: vi.fn((name, handler) => { handlers.set(name, handler); }),
    off: vi.fn((name, handler) => { if (handlers.get(name) === handler) handlers.delete(name); }),
  };
  const option = { xAxis: [{ data: ["2026-09-24", "2026-09-25", "2026-09-26"] }] };
  const chart = {
    getDom: () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    getZr: () => renderer,
    containPixel: vi.fn((_finder, [x, y]) => x >= 10 && x <= 310 && y >= 20 && y <= 220),
    convertFromPixel: vi.fn((_finder, x: number) => Math.floor((x - 10) / 100)),
    getOption: () => option,
  };
  return { chart: chart as unknown as EChartsType, renderer, option, emit: (x: number, y: number, type = "click") => handlers.get(type)?.({ offsetX: x, offsetY: y }) };
}

describe("category plot click", () => {
  it("inspects moving across painted categories separately from clicking and cleans up both listeners", () => {
    const f = fixture();
    const select = vi.fn(), inspect = vi.fn();
    const cleanup = bindCategoryPlotClick(f.chart, select, inspect);
    f.emit(60, 100, "mousemove");
    f.emit(160, 100, "mousemove");
    f.emit(160, 0, "mousemove");
    expect(inspect.mock.calls).toEqual([["2026-09-24"], ["2026-09-25"]]);
    expect(select).not.toHaveBeenCalled();
    f.emit(160, 100);
    expect(select).toHaveBeenCalledWith("2026-09-25");
    cleanup();
    f.emit(260, 100, "mousemove");
    f.emit(260, 100);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledTimes(1);
  });
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
