import type { CandleViewport } from "./chart-viewport.js";

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

export interface ChartPlot {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface ChartPriceRange {
  readonly low: number;
  readonly high: number;
}

export interface ChartCrosshair extends ChartPoint {
  readonly index: number;
  readonly price: number;
}

/**
 * Snaps time to the nearest actual candle center inside the drawn plot while
 * retaining the pointer's price. Use the renderer's viewport and padded price
 * range so both guide lines and their axis markers share its exact scale.
 */
export function projectChartCrosshair(
  point: ChartPoint,
  plot: ChartPlot,
  viewport: CandleViewport,
  total: number,
  prices: ChartPriceRange,
): ChartCrosshair | null {
  if (![
    point.x, point.y,
    plot.left, plot.top, plot.width, plot.height,
    viewport.start, viewport.count,
    prices.low, prices.high,
  ].every(Number.isFinite)
    || plot.width <= 0 || plot.height <= 0 || viewport.count <= 0
    || !Number.isSafeInteger(total) || total <= 0
    || prices.high <= prices.low) return null;

  const right = plot.left + plot.width;
  const bottom = plot.top + plot.height;
  const priceSpan = prices.high - prices.low;
  const viewportEnd = viewport.start + viewport.count;
  if (![right, bottom, priceSpan, viewportEnd].every(Number.isFinite)
    || point.x < plot.left || point.x > right
    || point.y < plot.top || point.y > bottom) return null;

  // A partially clipped candle may have its center outside the plot. Do not
  // choose it: an offscreen guide cannot identify its timestamp accurately.
  const firstIndex = Math.max(0, Math.ceil(viewport.start - 0.5));
  const lastIndex = Math.min(total - 1, Math.floor(viewportEnd - 0.5));
  if (firstIndex > lastIndex) return null;

  const nearestIndex = Math.round(
    viewport.start + (point.x - plot.left) / plot.width * viewport.count - 0.5,
  );
  const index = Math.min(lastIndex, Math.max(firstIndex, nearestIndex));
  const x = plot.left + (index + 0.5 - viewport.start) / viewport.count * plot.width;
  return {
    index,
    x: Math.min(right, Math.max(plot.left, x)),
    y: point.y,
    price: prices.high - (point.y - plot.top) / plot.height * priceSpan,
  };
}
