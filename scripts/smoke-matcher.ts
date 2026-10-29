import { rankMatches, tokenize, jaccard } from "../lib/matcher.ts";
import { scrapeForProfile } from "../lib/scraper.ts";
import { renderProposalPdf } from "../lib/proposal.ts";
import { demoProfile } from "../lib/store.ts";

async function main() {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      process.exit(1);
    }
    console.log(`ok: ${msg}`);
  };

  assert(tokenize("IT Support, cloud! migration").includes("support"), "tokenizer strips punctuation");
  assert(jaccard(new Set(["a", "b"]), new Set(["b", "c"])) === 1 / 3, "jaccard computes overlap");

  const { opportunities, source } = await scrapeForProfile(demoProfile);
  assert(opportunities.length > 0, `scraper returned ${opportunities.length} opportunities (${source})`);

  const matches = rankMatches(demoProfile, opportunities);
  assert(matches.length > 0, `matcher ranked ${matches.length} opportunities above threshold`);
  assert(
    matches.every((m, i, arr) => i === 0 || arr[i - 1].score >= m.score),
    "matches are sorted descending by score",
  );
  const top = matches[0];
  console.log(`top match: "${top.opportunity.title}" score=${top.score.toFixed(3)} reasons=${top.reasons.join("; ")}`);

  const pdf = await renderProposalPdf(demoProfile, top.opportunity, top.score);
  assert(pdf.length > 1000, `proposal PDF generated (${pdf.length} bytes)`);
  assert(pdf.subarray(0, 5).toString() === "%PDF-", "PDF magic header present");

  console.log("SMOKE OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
