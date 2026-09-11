const PRICE_TICK_SPACING = 64;
const MAX_PRICE_TICKS = 12;
const NICE_STEP_MULTIPLIERS = [1, 2, 2.5, 5, 10] as const;

/** Visible positive grid prices, descending; the supplied price scale is unchanged. */
export function chartPriceTicks(low: number, high: number, height: number): readonly number[] {
  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(height)
    || height <= 0 || high <= 0 || low > high) return [];
  if (low === high) return [high];

  const targetCount = Math.max(2, Math.min(MAX_PRICE_TICKS, Math.floor(height / PRICE_TICK_SPACING) + 1));
  const intervals = targetCount - 1;
  const span = high - low;
  // Divide first only when subtraction overflows. The precision floor keeps
  // adjacent tick indices distinguishable even for a very narrow large-price range.
  const rawStep = Math.max(
    Number.MIN_VALUE,
    high * Number.EPSILON,
    Math.min(Number.MAX_VALUE, Number.isFinite(span) ? span / intervals : high / intervals - low / intervals),
  );
  const [coefficientText, exponentText] = rawStep.toExponential().split("e");
  const coefficient = Number(coefficientText);
  const exponent = Number(exponentText);
  let multiplier = NICE_STEP_MULTIPLIERS.find((candidate) => candidate >= coefficient) ?? 10;
  let step = Number(`${multiplier}e${exponent}`);
  if (!Number.isFinite(step)) {
    // The next nice step above 1e308 is outside JavaScript's finite range.
    multiplier = 1;
    step = Number(`1e${exponent}`);
  }

  const firstIndex = Math.floor(high / step) + 1;
  const ticks: number[] = [];
  for (let offset = 0; offset < MAX_PRICE_TICKS + 2 && ticks.length < MAX_PRICE_TICKS; offset += 1) {
    const index = firstIndex - offset;
    // Decimal construction avoids both 10 ** -324 underflow and multiplication
    // noise that would otherwise exclude a boundary tick such as 0.3.
    const price = Number(`${index * multiplier}e${exponent}`);
    if (price < low || price <= 0) break;
    if (!Number.isFinite(price) || price > high) continue;
    const previous = ticks.at(-1);
    if (previous === undefined || price < previous) ticks.push(price);
  }
  return ticks;
}
