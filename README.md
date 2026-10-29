# GovBid Autopilot — Phase 2

An AI agent that finds, matches, and drafts winning government contract
proposals. Phase 2 ships the full pipeline:

- **Scraper** — pulls opportunities from SAM.gov (Opportunities API v2) for
  each of your NAICS codes; falls back to a realistic simulated feed when no
  API key is configured.
- **Hybrid matcher** — deterministic scoring (NAICS hierarchy 40%, keyword
  Jaccard overlap 30%, geography 15%, award value 15%) blended 70/30 with an
  AI confidence signal.
- **Proposal PDF** — one-click, submission-ready proposal drafts (executive
  summary → compliance) generated with PDFKit.
- **Stripe billing** — $199/mo Starter, $999/mo Pro, $2499/mo Enterprise
  subscriptions via Stripe Checkout, with webhook handling.
- **Cron** — daily scrape + match scheduled via Vercel Cron (`vercel.json`,
  13:00 UTC), hitting `/api/cron/daily`.

## Stack

- Next.js 15.5.28 (App Router) + React 19 + TypeScript
- Stripe 23 (Checkout + webhooks)
- PDFKit (proposal PDF generation)

## Quick start

```bash
npm install
cp .env.example .env.local   # optional — simulated mode works with zero config
npm run dev                  # http://localhost:3000
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run smoke` | End-to-end matcher/scraper/PDF smoke test |

## Environment

See `.env.example`. Key variables: `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` /
`STRIPE_PRICE_ENTERPRISE`, `SAM_API_KEY`, `CRON_SECRET`,
`NEXT_PUBLIC_APP_URL`.

## API

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/scrape` | POST/GET | Scrape + match for a profile, store results |
| `/api/match` | GET | Ranked matches (`?profileId=&minScore=&live=1`) |
| `/api/proposal/pdf` | GET | Download proposal PDF (`?profileId=&opportunityId=`) |
| `/api/billing/checkout` | POST | Create Stripe Checkout session (`{ tierId }`) |
| `/api/billing/webhook` | POST | Stripe webhook receiver |
| `/api/cron/daily` | GET | Scheduled daily scrape + match |

## Deploy

Deploy to Vercel; `vercel.json` registers the cron. Add the Stripe webhook
endpoint (`/api/billing/webhook`) in the Stripe dashboard and set
`STRIPE_WEBHOOK_SECRET`.

See [SALES.md](./SALES.md) for the sales narrative.
