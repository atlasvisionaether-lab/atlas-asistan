import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { demoProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let profileId = demoProfile.id;
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    if (typeof body.profileId === "string") profileId = body.profileId;
  } else {
    const form = await request.formData().catch(() => null);
    const value = form?.get("profileId");
    if (typeof value === "string" && value) profileId = value;
  }

  const result = await runPipeline(profileId);
  if (!result) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 404 });
  }

  return NextResponse.redirect(new URL("/dashboard", request.url), 303);
}

export async function GET() {
  const result = await runPipeline(demoProfile.id);
  if (!result) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 404 });
  }
  return NextResponse.json({
    profileId: result.profile.id,
    source: result.source,
    scraped: result.scraped,
    matches: result.matches.map((m) => ({
      id: m.opportunity.id,
      title: m.opportunity.title,
      agency: m.opportunity.agency,
      score: m.score,
      reasons: m.reasons,
    })),
  });
}
