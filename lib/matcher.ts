import type {
  ContractorProfile,
  MatchBreakdown,
  Opportunity,
  OpportunityMatch,
} from "./types";

const WEIGHTS = {
  naics: 0.4,
  keywords: 0.3,
  geo: 0.15,
  value: 0.15,
} as const;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were",
  "under", "over", "into", "all", "any", "per", "via", "including", "such",
  "must", "shall", "will", "may", "can", "not", "its", "their", "our", "out",
  "but", "who", "whom", "which", "per", "within", "between", "across",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function naicsScore(profile: ContractorProfile, opp: Opportunity): number {
  if (profile.naicsCodes.includes(opp.naics)) return 1;
  const profilePrefixes = new Set(profile.naicsCodes.map((n) => n.slice(0, 4)));
  if (profilePrefixes.has(opp.naics.slice(0, 4))) return 0.6;
  const oppPrefixes = new Set([opp.naics.slice(0, 2)]);
  const profileSectors = new Set(profile.naicsCodes.map((n) => n.slice(0, 2)));
  for (const sector of oppPrefixes) if (profileSectors.has(sector)) return 0.3;
  return 0;
}

function keywordScore(profile: ContractorProfile, opp: Opportunity): number {
  const profileTokens = new Set([
    ...profile.keywords.flatMap(tokenize),
    ...profile.certifications.flatMap(tokenize),
    ...profile.pastPerformance.flatMap(tokenize),
    ...tokenize(profile.companyName),
  ]);
  const oppTokens = new Set(
    tokenize(`${opp.title} ${opp.description} ${opp.agency} ${opp.office}`),
  );
  return jaccard(profileTokens, oppTokens);
}

function geoScore(profile: ContractorProfile, opp: Opportunity): number {
  const place = opp.placeOfPerformance.toLowerCase();
  if (!place) return 0.5;
  const matches = profile.states.some(
    (s) =>
      place.includes(s.toLowerCase()) ||
      place.includes("multiple conus") ||
      place.includes("nationwide"),
  );
  if (matches) return 1;
  if (place.includes("conus") || place.includes("ous")) return 0.5;
  return 0.2;
}

function valueScore(profile: ContractorProfile, opp: Opportunity): number {
  if (!opp.estimatedValue) return 0.5;
  const max = profile.maxAwardValue;
  if (!max) return 0.5;
  if (opp.estimatedValue <= max) return 1;
  if (opp.estimatedValue <= max * 1.5) return 0.6;
  return 0.1;
}

export function scoreOpportunity(
  profile: ContractorProfile,
  opportunity: Opportunity,
): OpportunityMatch {
  const naics = naicsScore(profile, opportunity);
  const keywords = keywordScore(profile, opportunity);
  const geo = geoScore(profile, opportunity);
  const value = valueScore(profile, opportunity);

  const total =
    naics * WEIGHTS.naics +
    keywords * WEIGHTS.keywords +
    geo * WEIGHTS.geo +
    value * WEIGHTS.value;

  const breakdown: MatchBreakdown = {
    naicsScore: naics,
    keywordScore: keywords,
    geoScore: geo,
    valueScore: value,
    total,
  };

  const reasons: string[] = [];
  if (naics === 1) reasons.push(`Exact NAICS ${opportunity.naics} match`);
  else if (naics >= 0.6) reasons.push(`NAICS family ${opportunity.naics} match`);
  if (keywords >= 0.1) {
    reasons.push(`Strong keyword overlap (${(keywords * 100).toFixed(0)}%)`);
  }
  if (geo === 1) reasons.push(`In operating geography: ${opportunity.placeOfPerformance}`);
  if (value === 1 && opportunity.estimatedValue) {
    reasons.push(`Award value $${opportunity.estimatedValue.toLocaleString()} within capacity`);
  }
  if (reasons.length === 0) reasons.push("Partial fit — review manually");

  return { opportunity, score: total, breakdown, reasons };
}

export function rankMatches(
  profile: ContractorProfile,
  opportunities: Opportunity[],
  minScore = 0.45,
): OpportunityMatch[] {
  return opportunities
    .map((o) => scoreOpportunity(profile, o))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score);
}

export function hybridScore(
  profile: ContractorProfile,
  opportunity: Opportunity,
  aiConfidence: number,
): number {
  const rules = scoreOpportunity(profile, opportunity).score;
  const clamped = Math.min(1, Math.max(0, aiConfidence));
  return rules * 0.7 + clamped * 0.3;
}
