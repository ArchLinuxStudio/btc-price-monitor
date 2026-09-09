import type { ChartPlot, ChartPriceRange } from "./chart-crosshair.js";

export interface ChartPriceLinePosition {
  /** Null outside the visible scale: never draw a line at a different price. */
  readonly lineY: number | null;
  readonly labelY: number;
  readonly edge: "above" | "below" | null;
}

/** Projects a current quote against the same scale as candles and crosshairs. */
export function projectChartPriceLine(
  price: number,
  plot: ChartPlot,
  range: ChartPriceRange,
): ChartPriceLinePosition | null {
  if (![price, plot.left, plot.top, plot.width, plot.height, range.low, range.high].every(Number.isFinite)
    || price <= 0 || plot.width <= 0 || plot.height <= 0 || range.high <= range.low
    || !Number.isFinite(plot.top + plot.height)) return null;
  if (price > range.high) return { lineY: null, labelY: plot.top, edge: "above" };
  if (price < range.low) return { lineY: null, labelY: plot.top + plot.height, edge: "below" };
  const y = plot.top + (range.high - price) / (range.high - range.low) * plot.height;
  return { lineY: y, labelY: y, edge: null };
}
