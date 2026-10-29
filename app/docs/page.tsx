import Link from "next/link";

export default function DocsPage() {
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
            <Link href="/pricing">Pricing</Link>
          </nav>
        </div>
      </header>

      <h1>Docs</h1>

      <h2>Quick start</h2>
      <div className="card">
        <p>
          <code>cp .env.example .env.local</code> — then run{" "}
          <code>npm run dev</code> and open the dashboard. Without a{" "}
          <code>SAM_API_KEY</code>, the scraper uses a simulated feed so every
          feature works out of the box.
        </p>
      </div>

      <h2>Environment variables</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Variable</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>STRIPE_SECRET_KEY</code>
              </td>
              <td>Stripe secret key for checkout + webhooks.</td>
            </tr>
            <tr>
              <td>
                <code>STRIPE_WEBHOOK_SECRET</code>
              </td>
              <td>Verifies <code>/api/billing/webhook</code> signatures.</td>
            </tr>
            <tr>
              <td>
                <code>STRIPE_PRICE_STARTER</code> / <code>PRO</code> /{" "}
                <code>ENTERPRISE</code>
              </td>
              <td>
                Stripe Price IDs for $199 / $999 / $2499 monthly subscriptions.
              </td>
            </tr>
            <tr>
              <td>
                <code>SAM_API_KEY</code>
              </td>
              <td>SAM.gov Opportunities API key. Optional.</td>
            </tr>
            <tr>
              <td>
                <code>CRON_SECRET</code>
              </td>
              <td>
                If set, <code>/api/cron/daily</code> requires{" "}
                <code>Authorization: Bearer &lt;secret&gt;</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>NEXT_PUBLIC_APP_URL</code>
              </td>
              <td>Base URL for Stripe checkout redirects.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>API</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Method</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>/api/scrape</code>
              </td>
              <td>POST</td>
              <td>
                Scrape SAM.gov for the profile&apos;s NAICS codes, run the hybrid
                matcher, store ranked matches. Form or JSON body{" "}
                <code>{"{ profileId }"}</code>.
              </td>
            </tr>
            <tr>
              <td>
                <code>/api/match</code>
              </td>
              <td>GET</td>
              <td>
                Return ranked matches for a profile. Query:{" "}
                <code>?profileId=&amp;minScore=</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>/api/proposal/pdf</code>
              </td>
              <td>GET</td>
              <td>
                Generate and download a proposal PDF. Query:{" "}
                <code>?profileId=&amp;opportunityId=</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>/api/billing/checkout</code>
              </td>
              <td>POST</td>
              <td>
                Create a Stripe Checkout session. Body:{" "}
                <code>{'{ "tierId": "pro" }'}</code>
              </td>
            </tr>
            <tr>
              <td>
                <code>/api/billing/webhook</code>
              </td>
              <td>POST</td>
              <td>Stripe webhook receiver (checkout.session.completed).</td>
            </tr>
            <tr>
              <td>
                <code>/api/cron/daily</code>
              </td>
              <td>GET</td>
              <td>
                Scheduled daily scrape + match for all profiles. Wired to Vercel
                Cron via <code>vercel.json</code> (13:00 UTC).
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Matcher scoring</h2>
      <div className="card">
        <p>
          Score = 0.40 × NAICS fit + 0.30 × keyword overlap + 0.15 × geography +
          0.15 × award value. NAICS fit is exact (1.0), same 4-digit family
          (0.6), or same 2-digit sector (0.3). Keyword overlap is Jaccard
          similarity over the opportunity text against the profile&apos;s
          keywords, certifications, and past performance. The hybrid score adds
          an AI confidence signal: <code>0.7 × rules + 0.3 × AI</code>.
        </p>
      </div>
    </div>
  );
}
