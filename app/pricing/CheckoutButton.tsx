"use client";

import { useState } from "react";
import type { TierId } from "@/lib/types";

export default function CheckoutButton({ tierId }: { tierId: TierId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(
          "Demo mode: Stripe price IDs are not configured, so no checkout URL was created. Set STRIPE_PRICE_* env vars to go live.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={checkout} disabled={loading}>
        {loading ? "Redirecting…" : `Subscribe`}
      </button>
      {error && (
        <p style={{ color: "#f0c64f", fontSize: "0.8rem", marginTop: "0.5rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
