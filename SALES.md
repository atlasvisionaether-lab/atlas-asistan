# SALES.md — Selling Micro-SaaS Products

## Positioning

Every product built by this factory is a **single-purpose tool** that solves
one painful problem for one specific audience. That is the entire pitch:

> "The fastest way to know if Brand A is really cheaper than Brand B."

Never sell "a platform". Sell the answer, in under 10 seconds.

## Pricing ladder (from IDEAS.md)

| Tier | Price | When to use |
| --- | --- | --- |
| Free | $0 | Acquisition / SEO funnel (e.g. Reading Time Estimator) |
| Micro one-time | $3–$7 | Simple calculators with no accounts |
| Standard one-time | $8–$12 | Calculators with save/history (Supabase) |
| Pro one-time | $12–$15 | Professional audiences (freelancers, investors) |
| SaaS subscription | $5–$19/mo | Recurring use (trackers, alerting, teams) |

## Launch playbook (per product, ~1 day)

1. **Pick from IDEAS.md.** Prefer problems you personally feel.
2. **Create via the factory** (`POST /api/factory/create`) or the dashboard.
3. **Differentiate the copy.** Rewrite the landing headline to name the
   exact pain: "Stop overpaying at the grocery store — compare unit prices
   in 10 seconds."
4. **Ship fast.** Vercel deploy, custom domain, one screenshot, one GIF.
5. **One acquisition channel.** Choose exactly one:
   - SEO: target `<problem> calculator` keywords (low competition, high intent).
   - Reddit: answer questions in the target subreddit, link the tool.
   - Product Hunt: launch Tuesday–Thursday, "hunter" story angle.
   - TikTok/Reels: 15-second demo of the before/after pain.
6. **Monetize on day one.** Stripe checkout link on the landing page.
   One-time price, no subscription friction for v1.
7. **Measure:** landing conversion > 3% and checkout conversion > 2% is a
   winner. Below that, fix the headline, not the product.

## Outreach templates

**Reddit comment:**

> Built a tiny tool for this exact annoyance: <link>. Free to try, no
> signup. Happy to add features people actually want.

**Cold email to a blogger in the niche:**

> Hi <name> — I made a free calculator for <specific problem from your
> article>. Thought your readers might like it: <link>.

**Product Hunt tagline:**

> <Product> — the 10-second answer to "<exact question>".

## Portfolio math (the factory thesis)

A single micro-SaaS rarely pays rent. The factory exists so that shipping
product #11 costs the same as shipping product #1. Targets:

- 11 products live (Factory v1)
- Each at $9 average one-time price
- 100 sales per product per year = **$9,900/product/year**
- 11 × $9.9k ≈ **$109k/year** from a portfolio of tiny tools

Kill any product under 20 sales in 90 days. Reinvest in the winners.

## Anti-patterns (do not)

- Don't add features to a shipped product before it sells 20 copies.
- Don't build a marketplace, accounts, or teams into v1.
- Don't chase enterprise deals with a micro-SaaS.
- Don't redesign; the template's dark minimal UI already converts.
