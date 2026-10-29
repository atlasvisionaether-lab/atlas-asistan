import { rankMatches } from "./matcher";
import { scrapeForProfile } from "./scraper";
import { getProfile, recordRun, saveMatches, type DailyRun } from "./store";
import type { ContractorProfile, OpportunityMatch } from "./types";

export interface PipelineResult {
  profile: ContractorProfile;
  matches: OpportunityMatch[];
  scraped: number;
  source: "sam.gov" | "simulated";
  run: DailyRun;
}

export async function runPipeline(
  profileId: string,
  options: { minScore?: number; recordCronRun?: boolean } = {},
): Promise<PipelineResult | null> {
  const profile = getProfile(profileId);
  if (!profile) return null;

  const { opportunities, source } = await scrapeForProfile(
    profile,
    process.env.SAM_API_KEY,
  );
  const matches = rankMatches(profile, opportunities, options.minScore);
  saveMatches(profile.id, matches);
  const run = recordRun({
    source,
    opportunitiesScraped: opportunities.length,
    topMatches: matches.length,
  });

  return { profile, matches, scraped: opportunities.length, source, run };
}
