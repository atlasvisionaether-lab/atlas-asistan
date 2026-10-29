import { NextRequest, NextResponse } from "next/server";
import { createMicroSaaS } from "@/lib/factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = body as Record<string, unknown> | null;
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }

  for (const field of ["name", "problem", "target", "price"] as const) {
    if (typeof input[field] !== "string" || (input[field] as string).trim() === "") {
      return NextResponse.json(
        { error: `Field '${field}' is required and must be a non-empty string` },
        { status: 400 }
      );
    }
  }

  if (input.slug !== undefined && typeof input.slug !== "string") {
    return NextResponse.json(
      { error: "Field 'slug' must be a string when provided" },
      { status: 400 }
    );
  }

  try {
    const product = await createMicroSaaS({
      name: input.name as string,
      problem: input.problem as string,
      target: input.target as string,
      price: input.price as string,
      slug: input.slug as string | undefined,
    });
    return NextResponse.json({ ok: true, product }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /already exists|required|Invalid slug|Cannot derive/.test(message)
      ? 409
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "POST /api/factory/create",
    body: {
      name: "string (required)",
      problem: "string (required)",
      target: "string (required)",
      price: "string (required)",
      slug: "string (optional, derived from name when omitted)",
    },
  });
}
