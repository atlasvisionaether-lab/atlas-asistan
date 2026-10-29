import { NextResponse } from "next/server";
import { createCheckoutSession } from "@/lib/billing";
import { TIERS, type TierId } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_TIERS = new Set<string>(TIERS.map((t) => t.id));

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const tierId = body?.tierId as string;
  const email = typeof body?.email === "string" ? body.email : undefined;

  if (!VALID_TIERS.has(tierId)) {
    return NextResponse.json(
      { error: `Invalid tier. Expected one of: ${[...VALID_TIERS].join(", ")}` },
      { status: 400 },
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  const { url, mode } = await createCheckoutSession({
    tierId: tierId as TierId,
    customerEmail: email,
    successUrl: `${baseUrl}/pricing?status=success`,
    cancelUrl: `${baseUrl}/pricing?status=cancelled`,
  });

  return NextResponse.json({ url, mode });
}
