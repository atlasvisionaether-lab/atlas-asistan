import { NextRequest, NextResponse } from "next/server";
import { listIdeas } from "@/lib/factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const ideas = await listIdeas();
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const sliced =
      Number.isFinite(limit) && typeof limit === "number" && limit > 0
        ? ideas.slice(0, limit)
        : ideas;
    return NextResponse.json({ ok: true, count: sliced.length, total: ideas.length, ideas: sliced });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
