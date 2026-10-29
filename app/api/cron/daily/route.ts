import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";
import { demoProfile, listRuns } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    const isVercelCron = request.headers.get("x-vercel-cron") === "1";
    if (!isVercelCron && auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await runPipeline(demoProfile.id, { minScore: 0.4 });
  if (!result) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    ranAt: result.run.ranAt,
    source: result.source,
    opportunitiesScraped: result.scraped,
    topMatches: result.matches.length,
    runsRecorded: listRuns().length,
  });
}
