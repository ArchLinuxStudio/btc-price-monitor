import type { CandleViewport } from "./chart-viewport.js";

export interface ChartTimeAxisTick {
  readonly index: number;
  /** Center of the label, which may move inward to avoid clipping its text. */
  readonly x: number;
  readonly width: number;
}

export interface ChartTimeAxisStartMarker {
  /** The real oldest candle center; the marker's stem stays at this coordinate. */
  readonly x: number;
  readonly left: number;
  readonly width: number;
}

export interface ChartTimeAxisLayout {
  readonly ticks: readonly ChartTimeAxisTick[];
  readonly startMarker: ChartTimeAxisStartMarker | null;
}

const MAX_TICKS = 5;
const LABEL_GAP = 12;

/**
 * Places date labels only at visible real candles, leaving blank pan regions
 * undated. Pass null until the history origin is confirmed; its marker then
 * takes precedence over nearby date labels when the first candle is visible.
 */
export function layoutChartTimeAxis(
  viewport: CandleViewport,
  total: number,
  plot: { readonly left: number; readonly width: number },
  measureLabel: (index: number) => number,
  startMarkerWidth: number | null,
): ChartTimeAxisLayout {
  const empty: ChartTimeAxisLayout = { ticks: [], startMarker: null };
  const right = plot.left + plot.width;
  const end = viewport.start + viewport.count;
  if (!Number.isSafeInteger(total) || total <= 0
    || !Number.isFinite(viewport.start) || !Number.isFinite(viewport.count) || viewport.count <= 0
    || !Number.isFinite(plot.left) || !Number.isFinite(plot.width) || plot.width <= 0
    || !Number.isFinite(right) || !Number.isFinite(end)
    || (startMarkerWidth !== null
      && (!Number.isFinite(startMarkerWidth) || startMarkerWidth <= 0))) return empty;

  const firstIndex = Math.max(0, Math.ceil(viewport.start - 0.5));
  const lastIndex = Math.min(total - 1, Math.floor(end - 0.5));
  if (firstIndex > lastIndex) return empty;

  const center = (index: number): number =>
    plot.left + ((index + 0.5 - viewport.start) / viewport.count) * plot.width;
  const clampedLeft = (x: number, width: number): number =>
    Math.min(right - width, Math.max(plot.left, x - width / 2));
  let startMarker: ChartTimeAxisStartMarker | null = null;
  if (firstIndex === 0 && startMarkerWidth !== null) {
    const width = Math.min(plot.width, startMarkerWidth);
    const x = Math.min(right, Math.max(plot.left, center(0)));
    startMarker = { x, left: clampedLeft(x, width), width };
  }

  const ticks: ChartTimeAxisTick[] = [];
  const candidateCount = Math.min(MAX_TICKS, lastIndex - firstIndex + 1);
  for (let slot = 0; slot < candidateCount; slot += 1) {
    const index = candidateCount === 1
      ? firstIndex
      : firstIndex + Math.round((lastIndex - firstIndex) * slot / (candidateCount - 1));
    if (index === 0 && startMarker) continue;
    const width = measureLabel(index);
    if (!Number.isFinite(width) || width < 0 || width > plot.width) continue;
    const left = clampedLeft(center(index), width);
    if (startMarker && left < startMarker.left + startMarker.width + LABEL_GAP
      && left + width + LABEL_GAP > startMarker.left) continue;
    const previous = ticks[ticks.length - 1];
    if (previous && left < previous.x + previous.width / 2 + LABEL_GAP) continue;
    ticks.push({ index, x: left + width / 2, width });
  }
  return { ticks, startMarker };
}
