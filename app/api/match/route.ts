import { NextResponse } from "next/server";
import { getMatches, demoProfile } from "@/lib/store";
import { rankMatches } from "@/lib/matcher";
import { scrapeForProfile } from "@/lib/scraper";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId") ?? demoProfile.id;
  const minScore = Number(searchParams.get("minScore") ?? "0.45");
  const live = searchParams.get("live") === "1";

  const profile = (await import("@/lib/store")).getProfile(profileId);
  if (!profile) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 404 });
  }

  if (live) {
    const { opportunities } = await scrapeForProfile(profile, process.env.SAM_API_KEY);
    const matches = rankMatches(profile, opportunities, minScore);
    return NextResponse.json({
      profileId,
      matches: matches.map((m) => ({
        opportunity: m.opportunity,
        score: m.score,
        breakdown: m.breakdown,
        reasons: m.reasons,
      })),
    });
  }

  const stored = getMatches(profileId);
  return NextResponse.json({
    profileId,
    matches: stored.map((m) => ({
      opportunity: m.opportunity,
      score: m.score,
      breakdown: m.breakdown,
      reasons: m.reasons,
    })),
  });
}
