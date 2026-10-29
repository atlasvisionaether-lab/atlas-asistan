import Link from "next/link";
import { Suspense } from "react";
import { TIERS } from "@/lib/types";
import CheckoutButton from "./CheckoutButton";

export default function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ select?: string }>;
}) {
  return (
    <div className="container">
      <header className="site">
        <div className="container">
          <div className="brand">
            GovBid <span>Autopilot</span>
          </div>
          <nav>
            <Link href="/">Home</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/docs">Docs</Link>
          </nav>
        </div>
      </header>

      <h1>Pricing</h1>
      <p className="lead" style={{ color: "var(--muted)" }}>
        One subscription. Unlimited scraping and matching. Proposal drafts
        metered by tier.
      </p>

      <Suspense fallback={null}>
        <SelectedNotice searchParams={searchParams} />
      </Suspense>

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
            <CheckoutButton tierId={tier.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

async function SelectedNotice({
  searchParams,
}: {
  searchParams: Promise<{ select?: string }>;
}) {
  const { select } = await searchParams;
  if (!select) return null;
  const tier = TIERS.find((t) => t.id === select);
  if (!tier) return null;
  return (
    <p className="muted">
      Selected plan: <strong>{tier.name}</strong> — ${tier.priceMonthlyUsd}/mo
    </p>
  );
}
