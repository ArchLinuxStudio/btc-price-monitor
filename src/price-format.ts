const formatters: Readonly<Record<"high" | "medium" | "small" | "tiny", Intl.NumberFormat>> = {
  high: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  medium: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }),
  small: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }),
  tiny: new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 8,
  }),
};

export function formatUsdPrice(value: unknown): string {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return "—";

  if (price >= 100) return formatters.high.format(price);
  if (price >= 0.01) return formatters.medium.format(price);
  if (price >= 0.0001) return formatters.small.format(price);
  if (price >= 0.00000001) return formatters.tiny.format(price);
  return price.toExponential(2).replace("e-0", "e-").replace("e+", "e");
}
