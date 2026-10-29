import Link from "next/link";
import { TIERS } from "@/lib/types";

export default function HomePage() {
  return (
    <div className="container">
      <header className="site">
        <div className="container">
          <div className="brand">
            GovBid <span>Autopilot</span>
          </div>
          <nav>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/docs">Docs</Link>
          </nav>
        </div>
      </header>

      <section className="hero">
        <h1>Win more government contracts, on autopilot.</h1>
        <p className="lead">
          GovBid Autopilot scrapes SAM.gov every day, scores every opportunity
          against your capability profile with a hybrid AI + rules matcher, and
          drafts submission-ready proposal PDFs — so your team only reviews
          winners, not noise.
        </p>
        <Link className="button" href="/dashboard">
          Open the dashboard
        </Link>
      </section>

      <h2>How it works</h2>
      <div className="cards">
        <div className="card">
          <h3>1. Scrape</h3>
          <p>
            A daily cron job pulls fresh opportunities from SAM.gov for each of
            your NAICS codes. Without an API key, a realistic simulated feed
            keeps the pipeline running end-to-end.
          </p>
        </div>
        <div className="card">
          <h3>2. Match</h3>
          <p>
            Our hybrid matcher combines deterministic scoring (NAICS hierarchy,
            keyword Jaccard overlap, geography, award capacity) with AI
            confidence — 70/30 weighted.
          </p>
        </div>
        <div className="card">
          <h3>3. Draft</h3>
          <p>
            For every high-scoring match, Autopilot generates a full proposal
            draft as a PDF — executive summary through compliance — ready for
            your review and signature.
          </p>
        </div>
      </div>

      <h2>Pricing</h2>
      <div className="cards">
        {TIERS.map((tier) => (
          <div className="card" key={tier.id}>
            <h3>{tier.name}</h3>
            <div className="price">
              ${tier.priceMonthlyUsd}
              <small>/mo</small>
            </div>
            <ul className="tier-features">
              {tier.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <Link className="button" href={`/pricing?select=${tier.id}`}>
              Choose {tier.name}
            </Link>
          </div>
        ))}
      </div>

      <footer className="site">
        <div className="container" style={{ padding: 0 }}>
          GovBid Autopilot — Phase 2. Built for government contractors who bid
          to win.
        </div>
      </footer>
    </div>
  );
}
