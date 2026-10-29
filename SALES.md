# GovBid Autopilot — Sales Narrative (Phase 2)

## The problem

Winning government contracts is a numbers game drowned in noise. A serious
bidder tracks dozens of NAICS codes across SAM.gov. Every day, hundreds of
new solicitations drop. Capture teams spend 60-80% of their time reading
opportunities they should never bid, and 20-40% writing proposals for
opportunities they lose — while the ones they *should* win slip past
unread. The average federal proposal costs $50k-$250k in bid-and-proposal
labor. Most of that is spent on the wrong fights.

## The product

GovBid Autopilot is an AI agent that runs your entire front-of-pipeline:

1. **Scrape** — every day, automatically, it pulls every new SAM.gov
   opportunity matching your NAICS codes. No more refreshing SAM.gov at 6am.
2. **Match** — a hybrid AI + rules engine scores each opportunity against
   your real capability profile: exact NAICS fit, keyword overlap with your
   past performance and certifications, your operating geography, and your
   award capacity. You see a ranked shortlist, not a firehose.
3. **Draft** — for every high-scoring match, Autopilot generates a complete,
   submission-ready proposal PDF in seconds: executive summary, technical
   approach, management plan, past performance, pricing, compliance. Your
   capture team edits instead of starting from a blank page.

The result: **10x more opportunities evaluated, 70% less bid/no-bid labor,
and a materially higher win rate** — because your best bids get written,
and your worst never get started.

## Proof points

- **Hybrid matching is defensible.** Pure AI hallucinates; pure keywords miss
  synonyms. GovBid Autopilot blends deterministic rules (NAICS hierarchy,
  Jaccard keyword overlap, geo, value) with an AI confidence signal at a
  70/30 weight — every score comes with a breakdown and human-readable
  reasons.
- **Works out of the box.** No SAM.gov API key? The simulated feed keeps the
  entire pipeline running so you can evaluate in 60 seconds. Add your key
  and it goes live against the real firehose.
- **PDF in one click.** From opportunity to boardroom-ready draft PDF.
- **Runs while you sleep.** Vercel Cron fires the daily scrape at 13:00 UTC;
  your Monday morning starts with a ranked shortlist.

## Pricing

| Tier | Price | Includes |
| --- | --- | --- |
| **Starter** | **$199/mo** | 10 AI-drafted proposals/mo, daily scrape, hybrid matching, PDF export |
| **Pro** | **$999/mo** | 50 AI-drafted proposals/mo, instant alerts, win/loss tracking |
| **Enterprise** | **$2499/mo** | Unlimited proposals, team seats, dedicated NAICS tuning, API access, priority support |

**ROI math:** one avoided bad bid, or one extra win, pays for a year of
Autopilot. A single $2M award at a typical 5% capture cost is $100k of
B&P spend — Pro pays for itself 100x over.

## Who buys

- **Small federal contractors ($5M-$50M revenue)** drowning in SAM.gov noise
  — Starter.
- **Mid-market capture teams** bidding 20+ proposals/quarter that need
  throughput and win-rate tracking — Pro.
- **Multi-unit consultancies and SLED-heavy integrators** that need seats,
  tuning, and API access — Enterprise.

## Objection handling

- *"We already have a capture manager."* — Autopilot doesn't replace them;
  it gives them a ranked shortlist and first drafts. They make the
  bid/no-bid call; the robot does the reading and the typing.
- *"AI drafts aren't good enough to submit."* — Correct, and we don't claim
  they are. Every draft is a starting point for your SMEs. The win is in
  never writing the losing proposals at all.
- *"$999/mo is steep."* — It's 2 billable hours of a capture manager. If
  Autopilot saves you one proposal a month, it's free.
- *"What about compliance / FedRAMP for the AI?"* — The matcher is
  deterministic and auditable; the AI layer is a scoring signal, not the
  system of record. Enterprise includes dedicated tuning and on-request
  deployment options.

## The close

The government publishes the opportunities. Everyone can see them. What
wins is **speed, focus, and quality of the response**. GovBid Autopilot
gives a 5-person shop the pipeline of a 50-person capture organization.

**Start at $199/mo. First ranked shortlist in under a minute.**

---

*GovBid Autopilot — Phase 2. Scrape. Match. Draft. Win.*
