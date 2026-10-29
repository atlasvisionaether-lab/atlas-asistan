import Stripe from "stripe";
import { TIERS, type Tier, type TierId } from "./types";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export function getTier(id: TierId): Tier {
  const tier = TIERS.find((t) => t.id === id);
  if (!tier) throw new Error(`Unknown tier: ${id}`);
  return tier;
}

export function priceIdForTier(tier: Tier): string | null {
  const envValue = process.env[tier.priceIdEnv];
  if (!envValue) return null;
  return envValue;
}

export async function createCheckoutSession(params: {
  tierId: TierId;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string | null; mode: "live" | "demo" }> {
  const tier = getTier(params.tierId);
  const priceId = priceIdForTier(tier);

  if (!priceId) {
    return { url: null, mode: "demo" };
  }

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    customer_email: params.customerEmail,
    metadata: { tier: tier.id },
    subscription_data: { metadata: { tier: tier.id } },
  });

  return { url: session.url, mode: "live" };
}

export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  return getStripe().webhooks.constructEvent(payload, signature, secret);
}
