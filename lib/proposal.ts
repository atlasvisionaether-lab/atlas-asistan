import PDFDocument from "pdfkit";
import type { ContractorProfile, GeneratedProposal, Opportunity, ProposalSection } from "./types";

function buildSections(
  profile: ContractorProfile,
  opportunity: Opportunity,
  score: number,
): ProposalSection[] {
  return [
    {
      heading: "1. Executive Summary",
      body: `${profile.companyName} submits this proposal in response to "${opportunity.title}" (${opportunity.agency}, ${opportunity.office}). GovBid Autopilot scored this opportunity ${(score * 100).toFixed(0)}% against our capability profile. We bring direct experience in ${profile.pastPerformance.slice(0, 3).join(", ") || "comparable federal programs"}, certifications including ${profile.certifications.join(", ") || "industry-standard credentials"}, and operations across ${profile.states.join(", ") || "our service footprint"}.`,
    },
    {
      heading: "2. Understanding of Requirements",
      body: `The solicitation calls for: ${opportunity.description.slice(0, 400)}${opportunity.description.length > 400 ? "…" : ""} Place of performance: ${opportunity.placeOfPerformance || "as specified in the solicitation"}. Response deadline: ${opportunity.responseDeadline}. We have reviewed the statement of work and confirm our solution addresses each stated requirement.`,
    },
    {
      heading: "3. Technical Approach",
      body: `Our approach combines proven delivery methods with active management: (1) mobilization and transition planning within 30 days; (2) keyword-aligned staffing against your technical requirements (${profile.keywords.slice(0, 8).join(", ") || "relevant domains"}); (3) continuous performance monitoring with monthly reporting; and (4) surge capacity for demand spikes. All work is performed in NAICS ${opportunity.naics} scope.`,
    },
    {
      heading: "4. Management and Key Personnel",
      body: `A dedicated program manager will lead delivery, supported by leads for each functional area. Key personnel are cleared and available to start immediately upon award. Governance includes weekly status reviews, monthly program reviews with the government, and a formal issue-escalation path.`,
    },
    {
      heading: "5. Past Performance",
      body: profile.pastPerformance.length
        ? `Relevant recent performance: ${profile.pastPerformance.join("; ")}. References, contract numbers, and points of contact are available upon request.`
        : `We will provide references for comparable work upon request, including contract identifiers, customer points of contact, and outcome summaries.`,
    },
    {
      heading: "6. Price Summary",
      body: opportunity.estimatedValue
        ? `Our proposed price is structured against the government estimate of $${opportunity.estimatedValue.toLocaleString()} with a target savings of 5-10% through efficient staffing and automation. A detailed cost breakdown is provided in Volume II.`
        : `Pricing is provided in Volume II on a fixed-price / time-and-materials basis as required by the solicitation, with fully burdened labor rates and supporting rationale.`,
    },
    {
      heading: "7. Compliance and Certifications",
      body: `We certify compliance with all applicable clauses and provisions of this solicitation. ${profile.setAsideEligibility.length ? `We qualify under the following set-aside categories: ${profile.setAsideEligibility.join(", ")}. ` : ""}Our certifications include ${profile.certifications.join(", ") || "all required industry certifications"}.`,
    },
  ];
}

export function generateProposal(
  profile: ContractorProfile,
  opportunity: Opportunity,
  score: number,
): GeneratedProposal {
  return {
    title: `Proposal — ${opportunity.title}`,
    sections: buildSections(profile, opportunity, score),
  };
}

export async function renderProposalPdf(
  profile: ContractorProfile,
  opportunity: Opportunity,
  score: number,
): Promise<Buffer> {
  const proposal = generateProposal(profile, opportunity, score);
  const doc = new PDFDocument({ size: "LETTER", margin: 72 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.fontSize(20).text(profile.companyName, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(14).text(proposal.title, { align: "center" });
  doc.moveDown(0.25);
  doc
    .fontSize(10)
    .fillColor("#555555")
    .text(
      `${opportunity.agency} — ${opportunity.office}  |  NAICS ${opportunity.naics}  |  Match score ${(score * 100).toFixed(0)}%  |  Due ${opportunity.responseDeadline}`,
      { align: "center" },
    );
  doc.moveDown(1);
  doc.fillColor("#000000");

  for (const section of proposal.sections) {
    doc.fontSize(13).text(section.heading);
    doc.moveDown(0.3);
    doc.fontSize(11).text(section.body, { align: "justify" });
    doc.moveDown(1);
  }

  doc
    .fontSize(9)
    .fillColor("#888888")
    .text(
      `Draft generated by GovBid Autopilot on ${new Date().toISOString().slice(0, 10)}. Review and customize before submission. Source: ${opportunity.sourceUrl}`,
      { align: "center" },
    );

  doc.end();
  return done;
}
