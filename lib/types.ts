export type NAICSCode = string;

export interface Opportunity {
  id: string;
  title: string;
  agency: string;
  office: string;
  naics: NAICSCode;
  postedDate: string;
  responseDeadline: string;
  description: string;
  placeOfPerformance: string;
  estimatedValue?: number;
  sourceUrl: string;
}

export interface ContractorProfile {
  id: string;
  companyName: string;
  naicsCodes: NAICSCode[];
  keywords: string[];
  certifications: string[];
  pastPerformance: string[];
  states: string[];
  maxAwardValue?: number;
  setAsideEligibility: string[];
}

export type MatchBreakdown = {
  naicsScore: number;
  keywordScore: number;
  geoScore: number;
  valueScore: number;
  total: number;
};

export interface OpportunityMatch {
  opportunity: Opportunity;
  score: number;
  breakdown: MatchBreakdown;
  reasons: string[];
}

export type TierId = "starter" | "pro" | "enterprise";

export interface Tier {
  id: TierId;
  name: string;
  priceMonthlyUsd: number;
  priceIdEnv: string;
  proposalsPerMonth: number;
  features: string[];
}

export const TIERS: Tier[] = [
  {
    id: "starter",
    name: "Starter",
    priceMonthlyUsd: 199,
    priceIdEnv: "STRIPE_PRICE_STARTER",
    proposalsPerMonth: 10,
    features: [
      "10 AI-drafted proposals / month",
      "Daily opportunity scrape",
      "Hybrid AI + rules matching",
      "PDF proposal export",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthlyUsd: 999,
    priceIdEnv: "STRIPE_PRICE_PRO",
    proposalsPerMonth: 50,
    features: [
      "50 AI-drafted proposals / month",
      "Daily scrape + instant alerts",
      "Hybrid AI + rules matching",
      "PDF proposal export",
      "Win/loss tracking",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceMonthlyUsd: 2499,
    priceIdEnv: "STRIPE_PRICE_ENTERPRISE",
    proposalsPerMonth: -1,
    features: [
      "Unlimited AI-drafted proposals",
      "Multi-agency team seats",
      "Dedicated NAICS tuning",
      "API access",
      "Priority support",
    ],
  },
];

export interface ProposalSection {
  heading: string;
  body: string;
}

export interface GeneratedProposal {
  title: string;
  sections: ProposalSection[];
}
