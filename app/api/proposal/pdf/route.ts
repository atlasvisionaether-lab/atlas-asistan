import { NextResponse } from "next/server";
import { renderProposalPdf } from "@/lib/proposal";
import { getMatches, demoProfile, getProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const profileId = searchParams.get("profileId") ?? demoProfile.id;
  const opportunityId = searchParams.get("opportunityId");

  const profile = getProfile(profileId);
  if (!profile) {
    return NextResponse.json({ error: "Unknown profile" }, { status: 404 });
  }
  if (!opportunityId) {
    return NextResponse.json(
      { error: "Missing opportunityId" },
      { status: 400 },
    );
  }

  const match = getMatches(profile.id).find(
    (m) => m.opportunity.id === opportunityId,
  );
  const opportunity = match?.opportunity;
  if (!match || !opportunity) {
    return NextResponse.json(
      { error: "Opportunity not found — run a scrape first" },
      { status: 404 },
    );
  }

  const pdf = await renderProposalPdf(profile, opportunity, match.score);
  const safeName = opportunity.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="proposal-${safeName}.pdf"`,
      "Content-Length": String(pdf.length),
    },
  });
}
