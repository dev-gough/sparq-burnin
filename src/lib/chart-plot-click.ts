import type { EChartsType } from "echarts";

/** Select the displayed category anywhere inside the plot, including blank space. */
export function bindCategoryPlotClick(
  chart: EChartsType,
  onCategoryClick: (category: string) => void,
): () => void {
  const renderer = chart.getZr();
  const click = (event: { offsetX: number; offsetY: number }) => {
    const pixel = [event.offsetX, event.offsetY];
    if (!chart.containPixel({ gridIndex: 0 }, pixel)) return;

    const index = chart.convertFromPixel({ xAxisIndex: 0 }, event.offsetX);
    if (!Number.isFinite(index)) return;
    // Read the painted axis, not incoming data: a refresh may still show the
    // previous series. ECharts also handles resized or zoomed coordinates here.
    const axes = chart.getOption().xAxis as { data?: unknown[] }[] | undefined;
    const category = axes?.[0]?.data?.[Math.round(index)];
    if (typeof category === "string") onCategoryClick(category);
  };
  renderer.on("click", click);
  return () => renderer.off("click", click);
}
