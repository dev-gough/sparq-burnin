import type { EChartsType } from "echarts";

/** Select the displayed category anywhere inside the plot, including blank space. */
export function bindCategoryPlotClick(
  chart: EChartsType,
  onCategoryClick: (category: string) => void,
  onCategoryMove?: (category: string) => void,
): () => void {
  const renderer = chart.getZr();
  const categoryAt = (event: { offsetX: number; offsetY: number }) => {
    const pixel = [event.offsetX, event.offsetY];
    if (!chart.containPixel({ gridIndex: 0 }, pixel)) return;

    const index = chart.convertFromPixel({ xAxisIndex: 0 }, event.offsetX);
    if (!Number.isFinite(index)) return;
    // Read the painted axis, not incoming data: a refresh may still show the
    // previous series. ECharts also handles resized or zoomed coordinates here.
    const axes = chart.getOption().xAxis as { data?: unknown[] }[] | undefined;
    const category = axes?.[0]?.data?.[Math.round(index)];
    return typeof category === "string" ? category : undefined;
  };
  const click = (event: { offsetX: number; offsetY: number }) => {
    const category = categoryAt(event);
    if (category) onCategoryClick(category);
  };
  const move = (event: { offsetX: number; offsetY: number }) => {
    const category = categoryAt(event);
    if (category) onCategoryMove?.(category);
  };
  // ZRender ignores touch pointermove on browsers with Pointer Events support.
  // Listen directly so a horizontal finger drag still inspects the painted axis.
  const dom = onCategoryMove ? chart.getDom() : null;
  const touch = (event: PointerEvent) => {
    if (event.pointerType !== "touch" || !event.isPrimary ||
      !(event.target instanceof Element) || !event.target.closest("canvas")) return;
    const rect = dom!.getBoundingClientRect();
    move({ offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top });
  };
  renderer.on("click", click);
  if (onCategoryMove) renderer.on("mousemove", move);
  dom?.addEventListener("pointerdown", touch);
  dom?.addEventListener("pointermove", touch);
  return () => {
    renderer.off("click", click);
    if (onCategoryMove) renderer.off("mousemove", move);
    dom?.removeEventListener("pointerdown", touch);
    dom?.removeEventListener("pointermove", touch);
  };
}
