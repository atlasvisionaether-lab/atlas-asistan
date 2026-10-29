export type Unit = "g" | "kg" | "ml" | "l" | "oz" | "lb" | "fl-oz" | "count";

export interface CalcItem {
  label: string;
  /** Price paid for the item, in the user's currency. */
  price: number;
  /** Size of the item in `unit`. */
  size: number;
  unit: Unit;
}

export interface CalcResult {
  label: string;
  price: number;
  size: number;
  unit: Unit;
  /** Price per normalized base unit (per g, per ml, per oz, or per count). */
  unitPrice: number;
  baseUnit: string;
  isBest: boolean;
  /** Effective price for a standardized quantity (default: one base unit). */
  perBaseUnit: number;
}

export interface CalculateResponse {
  results: CalcResult[];
  best: CalcResult | null;
  currency: string;
  itemCount: number;
}

const TO_BASE: Record<Unit, { factor: number; base: string }> = {
  g: { factor: 1, base: "g" },
  kg: { factor: 1000, base: "g" },
  ml: { factor: 1, base: "ml" },
  l: { factor: 1000, base: "ml" },
  oz: { factor: 1, base: "oz" },
  lb: { factor: 16, base: "oz" },
  "fl-oz": { factor: 1, base: "fl-oz" },
  count: { factor: 1, base: "count" },
};

export function normalizeSize(size: number, unit: Unit): { size: number; base: string } {
  const conv = TO_BASE[unit];
  if (!conv) throw new Error(`Unsupported unit: ${unit}`);
  return { size: size * conv.factor, base: conv.base };
}

export function calculateUnitPrice(item: CalcItem): { unitPrice: number; baseUnit: string } {
  if (!Number.isFinite(item.price) || item.price < 0) {
    throw new Error(`Invalid price for item "${item.label}"`);
  }
  if (!Number.isFinite(item.size) || item.size <= 0) {
    throw new Error(`Invalid size for item "${item.label}"`);
  }
  const { size, base } = normalizeSize(item.size, item.unit);
  return { unitPrice: item.price / size, baseUnit: base };
}

export function calculate(items: CalcItem[], currency = "$"): CalculateResponse {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Provide at least one item");
  }
  const results: CalcResult[] = items.map((item) => {
    const { unitPrice, baseUnit } = calculateUnitPrice(item);
    return {
      label: item.label,
      price: item.price,
      size: item.size,
      unit: item.unit,
      unitPrice,
      baseUnit,
      isBest: false,
      perBaseUnit: unitPrice,
    };
  });
  let bestIdx = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].unitPrice < results[bestIdx].unitPrice) bestIdx = i;
  }
  results[bestIdx].isBest = true;
  return {
    results,
    best: results[bestIdx],
    currency,
    itemCount: results.length,
  };
}

export function formatMoney(value: number, currency = "$"): string {
  const digits = value < 0.01 && value > 0 ? 4 : 2;
  return `${currency}${value.toFixed(digits)}`;
}

export function formatUnitPrice(value: number, baseUnit: string, currency = "$"): string {
  return `${formatMoney(value, currency)}/${baseUnit}`;
}
