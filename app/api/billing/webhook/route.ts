import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { verifyWebhookSignature } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(payload, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log(
        `[billing] checkout completed: customer=${session.customer} tier=${session.metadata?.tier} subscription=${session.subscription}`,
      );
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      console.log(
        `[billing] subscription ${event.type}: ${subscription.id} status=${subscription.status}`,
      );
      break;
    }
    default:
      console.log(`[billing] unhandled event: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}
