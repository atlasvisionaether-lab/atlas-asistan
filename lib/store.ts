import type { ContractorProfile, Opportunity, OpportunityMatch } from "./types";

export interface DailyRun {
  id: string;
  ranAt: string;
  source: "sam.gov" | "simulated";
  opportunitiesScraped: number;
  topMatches: number;
}

const profiles = new Map<string, ContractorProfile>();
const matchesByProfile = new Map<string, OpportunityMatch[]>();
const runs: DailyRun[] = [];

export const demoProfile: ContractorProfile = {
  id: "demo-contractor",
  companyName: "Aether Federal Solutions",
  naicsCodes: ["541512", "541511", "541519", "541330", "541690"],
  keywords: [
    "IT support",
    "help desk",
    "cybersecurity",
    "cloud migration",
    "managed services",
    "network operations",
    "endpoint management",
    "RMF",
    "continuous monitoring",
    "zero trust",
  ],
  certifications: ["CMMI Level 3", "ISO 27001", "ISO 9001", "FedRAMP Ready"],
  pastPerformance: [
    "VA IT support services BPA — 5 years, 99.8% SLA attainment",
    "DHS continuous monitoring program — 3 years",
    "GSA cloud migration — 18-month engagement, 40% faster cutover",
  ],
  states: ["VA", "DC", "MD", "MO"],
  maxAwardValue: 15000000,
  setAsideEligibility: ["8(a)", "SDVOSB"],
};

if (process.env.NODE_ENV !== "production" || !process.env.SAM_API_KEY) {
  profiles.set(demoProfile.id, demoProfile);
}

export function getProfile(id: string): ContractorProfile | undefined {
  if (id === demoProfile.id && !profiles.has(id)) return demoProfile;
  return profiles.get(id);
}

export function upsertProfile(profile: ContractorProfile): void {
  profiles.set(profile.id, profile);
}

export function saveMatches(profileId: string, matches: OpportunityMatch[]): void {
  matchesByProfile.set(profileId, matches);
}

export function getMatches(profileId: string): OpportunityMatch[] {
  return matchesByProfile.get(profileId) ?? [];
}

export function recordRun(run: Omit<DailyRun, "id" | "ranAt">, id?: string): DailyRun {
  const entry: DailyRun = {
    id: id ?? `run-${Date.now()}`,
    ranAt: new Date().toISOString(),
    ...run,
  };
  runs.unshift(entry);
  return entry;
}

export function listRuns(): DailyRun[] {
  return runs;
}

export function searchOpportunities(query: string): Opportunity[] {
  const q = query.toLowerCase();
  const all: Opportunity[] = [];
  for (const matches of matchesByProfile.values()) {
    for (const m of matches) all.push(m.opportunity);
  }
  if (!q) return all;
  return all.filter(
    (o) =>
      o.title.toLowerCase().includes(q) ||
      o.agency.toLowerCase().includes(q) ||
      o.description.toLowerCase().includes(q),
  );
}
