export interface CandleViewport {
  readonly start: number;
  readonly count: number;
}

export interface CandleViewportBounds {
  readonly startIndex: number;
  readonly endIndex: number;
}

export const MIN_VISIBLE_CANDLES = 12;
export const DEFAULT_VISIBLE_CANDLES = 120;

function normalizedTotal(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(total));
}

function minimumVisibleCount(total: number): number {
  return Math.min(MIN_VISIBLE_CANDLES, total);
}

function normalizedCount(count: number, total: number): number {
  if (total === 0) return 0;
  const minimum = minimumVisibleCount(total);
  if (Number.isNaN(count)) return total;
  if (count === Number.POSITIVE_INFINITY) return total;
  if (count === Number.NEGATIVE_INFINITY) return minimum;
  return Math.min(total, Math.max(minimum, count));
}

function clampedStart(start: number, maximum: number): number {
  if (Number.isNaN(start) || start === Number.NEGATIVE_INFINITY) return 0;
  if (start === Number.POSITIVE_INFINITY) return maximum;
  return Math.min(maximum, Math.max(0, start));
}

function clampedAnchor(anchor: number): number {
  if (Number.isNaN(anchor)) return 0.5;
  if (anchor === Number.NEGATIVE_INFINITY) return 0;
  if (anchor === Number.POSITIVE_INFINITY) return 1;
  return Math.min(1, Math.max(0, anchor));
}

/**
 * Creates a viewport aligned to the newest candle. Omitting `initialCount`
 * creates the reset state showing up to the newest 120 candles.
 */
export function createCandleViewport(
  total: number,
  initialCount = DEFAULT_VISIBLE_CANDLES,
): CandleViewport {
  const safeTotal = normalizedTotal(total);
  const count = normalizedCount(initialCount, safeTotal);
  return {
    start: safeTotal - count,
    count,
  };
}

/**
 * Clamps a viewport to the loaded series while retaining fractional candle
 * offsets. Invalid counts fall back to the full series; invalid starts use the
 * nearest deterministic boundary.
 */
export function normalizeCandleViewport(
  viewport: CandleViewport,
  total: number,
): CandleViewport {
  const safeTotal = normalizedTotal(total);
  const count = normalizedCount(viewport.count, safeTotal);
  const maximumStart = safeTotal - count;
  return {
    start: clampedStart(viewport.start, maximumStart),
    count,
  };
}

/** Returns whether the viewport matches the default newest-candles reset state. */
export function isCandleViewportReset(viewport: CandleViewport, total: number): boolean {
  const safeTotal = normalizedTotal(total);
  const normalized = normalizeCandleViewport(viewport, safeTotal);
  const reset = createCandleViewport(safeTotal);
  const tolerance = Math.max(1, safeTotal) * Number.EPSILON * 16;
  return Math.abs(normalized.start - reset.start) <= tolerance
    && Math.abs(normalized.count - reset.count) <= tolerance;
}

/** Returns whether every loaded candle is visible, leaving no room for local pan. */
export function isCandleViewportFull(viewport: CandleViewport, total: number): boolean {
  const safeTotal = normalizedTotal(total);
  const normalized = normalizeCandleViewport(viewport, safeTotal);
  const tolerance = Math.max(1, safeTotal) * Number.EPSILON * 16;
  return normalized.start <= tolerance && safeTotal - normalized.count <= tolerance;
}

/** Keeps the same candles and scale visible when older candles are prepended. */
export function prependCandleViewport(
  viewport: CandleViewport,
  previousTotal: number,
  addedCount: number,
): CandleViewport {
  const safePreviousTotal = normalizedTotal(previousTotal);
  const total = normalizedTotal(safePreviousTotal + normalizedTotal(addedCount));
  if (safePreviousTotal === 0) return createCandleViewport(total);

  const current = normalizeCandleViewport(viewport, safePreviousTotal);
  return normalizeCandleViewport({
    start: current.start + (total - safePreviousTotal),
    count: current.count,
  }, total);
}

/** Both spacing and body width follow the visible candle count without a pixel cap. */
export function candleBarGeometry(
  plotWidth: number,
  count: number,
): { spacing: number; bodyWidth: number } {
  if (!Number.isFinite(plotWidth) || plotWidth <= 0 || !Number.isFinite(count) || count <= 0) {
    return { spacing: 0, bodyWidth: 0 };
  }
  const spacing = plotWidth / Math.max(1, count);
  return { spacing, bodyWidth: spacing * 0.72 };
}

/**
 * Zooms around a position within the viewport. `scale > 1` zooms in and
 * `0 < scale < 1` zooms out. The anchor is clamped to `0..1`, and its data
 * position remains fixed unless a series boundary makes that impossible.
 */
export function zoomCandleViewport(
  viewport: CandleViewport,
  total: number,
  scale: number,
  anchor = 0.5,
): CandleViewport {
  const safeTotal = normalizedTotal(total);
  const current = normalizeCandleViewport(viewport, safeTotal);
  if (safeTotal === 0 || Number.isNaN(scale) || scale <= 0) return current;

  const anchorRatio = clampedAnchor(anchor);
  const anchorPosition = current.start + current.count * anchorRatio;
  const requestedCount = scale === Number.POSITIVE_INFINITY
    ? minimumVisibleCount(safeTotal)
    : current.count / scale;
  const count = normalizedCount(requestedCount, safeTotal);

  return normalizeCandleViewport({
    start: anchorPosition - count * anchorRatio,
    count,
  }, safeTotal);
}

/**
 * Moves the viewport by a (possibly fractional) candle count. Positive values
 * move toward newer candles; negative values move toward older candles.
 */
export function panCandleViewport(
  viewport: CandleViewport,
  total: number,
  delta: number,
): CandleViewport {
  const safeTotal = normalizedTotal(total);
  const current = normalizeCandleViewport(viewport, safeTotal);
  if (safeTotal === 0 || Number.isNaN(delta) || delta === 0) return current;

  const maximumStart = safeTotal - current.count;
  const nextStart = delta === Number.POSITIVE_INFINITY
    ? maximumStart
    : delta === Number.NEGATIVE_INFINITY
      ? 0
      : current.start + delta;

  return normalizeCandleViewport({ start: nextStart, count: current.count }, safeTotal);
}

/**
 * Returns the half-open integer slice covering every candle intersected by the
 * continuous viewport. `endIndex` is exclusive.
 */
export function candleViewportBounds(
  viewport: CandleViewport,
  total: number,
): CandleViewportBounds {
  const safeTotal = normalizedTotal(total);
  if (safeTotal === 0) return { startIndex: 0, endIndex: 0 };

  const normalized = normalizeCandleViewport(viewport, safeTotal);
  const startIndex = Math.min(safeTotal - 1, Math.floor(normalized.start));
  const endIndex = Math.min(
    safeTotal,
    Math.max(startIndex + 1, Math.ceil(normalized.start + normalized.count)),
  );
  return { startIndex, endIndex };
}
