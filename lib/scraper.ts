import type { ContractorProfile, Opportunity } from "./types";

const SAM_API_BASE = "https://api.sam.gov/opportunities/v2/opportunities";

export interface ScrapeOptions {
  naics: string;
  postedWithinDays?: number;
  limit?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface ScrapeResult {
  opportunities: Opportunity[];
  source: "sam.gov" | "simulated";
}

function toOpportunity(raw: Record<string, unknown>): Opportunity {
  const notice = (raw.noticeId ?? raw.id ?? "") as string;
  return {
    id: notice,
    title: (raw.title ?? "Untitled solicitation") as string,
    agency: ((raw.departmentName ?? raw.organizationName ?? "") as string) || "Unknown agency",
    office: (raw.subTier ?? raw.office ?? "") as string,
    naics: ((raw.naicsCode ?? raw.naics ?? "") as string) || "000000",
    postedDate: (raw.postedDate ?? "") as string,
    responseDeadline: (raw.responseDeadLine ?? raw.responseDeadline ?? "") as string,
    description: (raw.description ?? "") as string,
    placeOfPerformance:
      ((raw.placeOfPerformance as { cityName?: string } | undefined)?.cityName ??
        "") || "",
    estimatedValue: raw.award$ ? Number((raw as { "award$": { totalValue?: number } }).award$.totalValue) : undefined,
    sourceUrl: (raw.uiLink ?? `https://sam.gov/workspace/contract/opp/${notice}/view`) as string,
  };
}

function simulatedFeed(naics: string, limit: number): Opportunity[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const templates: Array<Omit<Opportunity, "id" | "postedDate" | "responseDeadline">> = [
    {
      title: "IT Support Services BPA",
      agency: "Department of Veterans Affairs",
      office: "Technology Acquisition Center",
      naics,
      description:
        "The VA seeks a contractor to provide comprehensive IT support services including help desk, endpoint management, and network operations for regional facilities.",
      placeOfPerformance: "Washington, DC",
      estimatedValue: 4200000,
      sourceUrl: "https://sam.gov/simulated/it-support-bpa",
    },
    {
      title: "Cybersecurity Assessment and Authorization",
      agency: "Department of Homeland Security",
      office: "Cybersecurity and Infrastructure Security Agency",
      naics,
      description:
        "CISA requires continuous monitoring, vulnerability assessments, and RMF authorization support across DHS component systems.",
      placeOfPerformance: "Arlington, VA",
      estimatedValue: 8900000,
      sourceUrl: "https://sam.gov/simulated/cyber-aa",
    },
    {
      title: "Cloud Migration and Managed Services",
      agency: "General Services Administration",
      office: "Federal Acquisition Service",
      naics,
      description:
        "GSA is modernizing legacy workloads to cloud infrastructure and requires migration planning, execution, and 24/7 managed operations.",
      placeOfPerformance: "Kansas City, MO",
      estimatedValue: 6100000,
      sourceUrl: "https://sam.gov/simulated/cloud-migration",
    },
    {
      title: "Help Desk and End User Computing Support",
      agency: "Department of Agriculture",
      office: "Office of the Chief Information Officer",
      naics,
      description:
        "USDA requires Tier 1-3 help desk support, device provisioning, and asset lifecycle management for 40,000+ endpoints nationwide.",
      placeOfPerformance: "Multiple CONUS",
      estimatedValue: 2750000,
      sourceUrl: "https://sam.gov/simulated/helpdesk-usda",
    },
  ];
  return templates.slice(0, limit).map((t, i) => ({
    ...t,
    id: `SIM-${naics}-${i + 1}`,
    postedDate: new Date(now - i * 2 * dayMs).toISOString().slice(0, 10),
    responseDeadline: new Date(now + (14 + i * 7) * dayMs).toISOString().slice(0, 10),
  }));
}

export async function scrapeOpportunities(options: ScrapeOptions): Promise<ScrapeResult> {
  const { naics, postedWithinDays = 30, limit = 50, apiKey } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!apiKey) {
    return { opportunities: simulatedFeed(naics, limit), source: "simulated" };
  }

  const postedFrom = new Date(Date.now() - postedWithinDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const params = new URLSearchParams({
    api_key: apiKey,
    naicsCode: naics,
    postedFrom,
    postedTo: new Date().toISOString().slice(0, 10),
    limit: String(limit),
    ptype: "o,s,p,k",
  });

  const res = await fetchImpl(`${SAM_API_BASE}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`SAM.gov API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { opportunitiesData?: Record<string, unknown>[] };
  const opportunities = (data.opportunitiesData ?? []).map(toOpportunity);
  return { opportunities, source: "sam.gov" };
}

export async function scrapeForProfile(
  profile: ContractorProfile,
  apiKey?: string,
): Promise<ScrapeResult> {
  const all: Opportunity[] = [];
  let source: ScrapeResult["source"] = "simulated";
  for (const naics of profile.naicsCodes) {
    const result = await scrapeOpportunities({ naics, apiKey, limit: 25 });
    source = result.source;
    all.push(...result.opportunities);
  }
  const seen = new Set<string>();
  const deduped = all.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  return { opportunities: deduped, source };
}
