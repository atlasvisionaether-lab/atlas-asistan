import Link from "next/link";
import { getMatches, listRuns, demoProfile, getProfile } from "@/lib/store";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const profile = getProfile(demoProfile.id) ?? demoProfile;
  const matches = getMatches(profile.id);
  const runs = listRuns();

  return (
    <div className="container">
      <header className="site">
        <div className="container">
          <div className="brand">
            GovBid <span>Autopilot</span>
          </div>
          <nav>
            <Link href="/">Home</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/docs">Docs</Link>
          </nav>
        </div>
      </header>

      <h1>Dashboard</h1>
      <p className="muted">
        Profile: <strong>{profile.companyName}</strong>
        <span className="badge">NAICS {profile.naicsCodes.join(", ")}</span>
        <span className="badge">{profile.setAsideEligibility.join(" + ")}</span>
      </p>

      <form action="/api/scrape" method="POST" style={{ margin: "1rem 0" }}>
        <input type="hidden" name="profileId" value={profile.id} />
        <button type="submit">Run scrape + match now</button>
      </form>

      <h2>Top matches {matches.length > 0 && `(${matches.length})`}</h2>
      {matches.length === 0 ? (
        <p className="muted">
          No matches yet. Run a scrape to populate your pipeline, or trigger the
          daily cron at <code>/api/cron/daily</code>.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Agency</th>
                <th>NAICS</th>
                <th>Due</th>
                <th>Est. value</th>
                <th>Score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.opportunity.id}>
                  <td>
                    <a href={m.opportunity.sourceUrl} target="_blank" rel="noreferrer">
                      {m.opportunity.title}
                    </a>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {m.reasons.join(" · ")}
                    </div>
                  </td>
                  <td>{m.opportunity.agency}</td>
                  <td>{m.opportunity.naics}</td>
                  <td>{m.opportunity.responseDeadline}</td>
                  <td>
                    {m.opportunity.estimatedValue
                      ? `$${m.opportunity.estimatedValue.toLocaleString()}`
                      : "—"}
                  </td>
                  <td>
                    <span className={`score-pill ${m.score < 0.6 ? "mid" : ""}`}>
                      {(m.score * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td>
                    <Link
                      className="button"
                      href={`/api/proposal/pdf?profileId=${profile.id}&opportunityId=${encodeURIComponent(m.opportunity.id)}`}
                    >
                      Draft PDF
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Cron runs</h2>
      {runs.length === 0 ? (
        <p className="muted">No daily runs recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ran at</th>
                <th>Source</th>
                <th>Scraped</th>
                <th>Top matches</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.ranAt}</td>
                  <td>{r.source}</td>
                  <td>{r.opportunitiesScraped}</td>
                  <td>{r.topMatches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
