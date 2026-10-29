import { NextRequest, NextResponse } from "next/server";
import { calculate, type CalcItem, type Unit } from "@/lib/calculate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNITS: Unit[] = ["g", "kg", "ml", "l", "oz", "lb", "fl-oz", "count"];

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const items = (body as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "Provide a non-empty 'items' array" },
      { status: 400 }
    );
  }

  const parsed: CalcItem[] = [];
  for (const [i, raw] of items.entries()) {
    const item = raw as Partial<CalcItem>;
    if (typeof item.label !== "string" || item.label.trim() === "") {
      return NextResponse.json({ error: `Item ${i}: 'label' is required` }, { status: 400 });
    }
    if (typeof item.price !== "number" || !Number.isFinite(item.price) || item.price < 0) {
      return NextResponse.json({ error: `Item ${i}: 'price' must be a non-negative number` }, { status: 400 });
    }
    if (typeof item.size !== "number" || !Number.isFinite(item.size) || item.size <= 0) {
      return NextResponse.json({ error: `Item ${i}: 'size' must be a positive number` }, { status: 400 });
    }
    if (typeof item.unit !== "string" || !UNITS.includes(item.unit as Unit)) {
      return NextResponse.json(
        { error: `Item ${i}: 'unit' must be one of ${UNITS.join(", ")}` },
        { status: 400 }
      );
    }
    parsed.push({
      label: item.label.trim(),
      price: item.price,
      size: item.size,
      unit: item.unit as Unit,
    });
  }

  try {
    const result = calculate(parsed);
    return NextResponse.json({ ok: true, product: "password-strength-checker", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "POST /api/calculate",
    units: UNITS,
    example: {
      items: [
        { label: "Brand A", price: 4.99, size: 500, unit: "g" },
        { label: "Brand B", price: 3.49, size: 12, unit: "oz" },
      ],
    },
  });
}
