import { notFound } from "next/navigation";

import { getGroupOverview, getLeaderboardShell, getPredictionPulseState } from "@/data/league";
import PredictionPanel from "./PredictionPanel";

export const dynamic = "force-dynamic";

export default async function GroupPage({ params }) {
  const { group: groupSlug } = await params;
  const [group, pulse, leaderboard] = await Promise.all([
    getGroupOverview(groupSlug),
    getPredictionPulseState({ groupSlug }),
    getLeaderboardShell({ groupSlug }),
  ]);
  if (!group) notFound();
  const summary = getStandingSummary(leaderboard?.rows || []);

  return (
    <main className={`page theme-${group.slug}`}>
      <section className="hero hero-dashboard" aria-labelledby="group-title">
        <div className="hero-main">
          <h1 id="group-title">{group.name}</h1>
          <div className="hero-rows" aria-label="Group summary">
            <div className="hero-row">
              <span>Leader(s)</span>
              <strong>{summary.leaders}</strong>
            </div>
            <div className="hero-row">
              <span>Last place(s)</span>
              <strong>{summary.lastPlace}</strong>
            </div>
            <nav className="hero-actions" aria-label="Page sections">
              <a href="#standings">View standings</a>
              <a href="#next-picks">Next Picks</a>
              <a href="#recent-results">Recent Results</a>
            </nav>
          </div>
        </div>
      </section>

      <PredictionPanel
        groupSlug={group.slug}
        managers={group.managers}
        matches={group.upcoming_matches}
        lockMinutesBeforeKickoff={group.lock_minutes_before_kickoff}
      />

      <PredictionPulse pulse={pulse} />
      <Leaderboard leaderboard={leaderboard} />
      <RecentResults />
    </main>
  );
}

function PredictionPulse({ pulse }) {
  const matches = (pulse?.matches || []).filter((match) => match.reveal);
  if (!matches.length) return null;

  return (
    <section className="section pulse-section" aria-labelledby="prediction-pulse-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Room energy</p>
          <h2 id="prediction-pulse-title">Prediction Pulse</h2>
        </div>
        <span className="status-chip">{matches.length} revealed</span>
      </div>

      <div className="swipe-rail pulse-rail" aria-label="Revealed prediction pulse cards">
        {matches.map((match) => (
          <article className="pulse-card" key={match.external_match_id}>
            <div className="pulse-card-heading">
              <span>{formatKickoff(match.kickoff_at)}</span>
              <strong>
                <TeamLabel name={match.team_a_name} />
                <em>vs</em>
                <TeamLabel name={match.team_b_name} />
              </strong>
            </div>
            <div className="pulse-bars">
              <PulseChoice label={match.team_a_name} count={match.team_a_picks} managers={match.team_a_managers} />
              <PulseChoice label="Tie" count={match.tie_picks} managers={match.tie_managers} />
              <PulseChoice label={match.team_b_name} count={match.team_b_picks} managers={match.team_b_managers} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PulseChoice({ label, count, managers }) {
  return (
    <div className="pulse-choice">
      <div>
        <strong>{label === "Tie" ? "Tie" : <TeamLabel name={label} compact />}</strong>
        <span>{managers || "No picks"}</span>
      </div>
      <b>{count}</b>
    </div>
  );
}

function TeamLabel({ name, compact = false }) {
  return (
    <span className={compact ? "team-label compact" : "team-label"}>
      <span className="flag" aria-hidden="true">{flagForTeamName(name)}</span>
      <span>{name || "TBD"}</span>
    </span>
  );
}

function Leaderboard({ leaderboard }) {
  const rows = leaderboard?.rows || [];
  return (
    <section className="section" id="standings" aria-labelledby="standings-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Scoring</p>
          <h2 id="standings-title">Standings</h2>
        </div>
        <span className="status-chip">Scoring engine next</span>
      </div>
      <article className="panel leaderboard-panel">
        {rows.length ? rows.map((row) => (
          <div className="leaderboard-row" key={row.manager_code}>
            <span>{row.rank}</span>
            <strong>{row.manager_name}</strong>
            <b>{row.total_points} pts</b>
          </div>
        )) : (
          <p>No standings data yet.</p>
        )}
      </article>
    </section>
  );
}

function RecentResults() {
  return (
    <section className="section" id="recent-results" aria-labelledby="recent-results-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Finished matches</p>
          <h2 id="recent-results-title">Recent Results</h2>
        </div>
        <span className="status-chip">Coming next</span>
      </div>
      <article className="panel quiet-panel">
        <strong>No finished matches in the rebuild feed yet.</strong>
        <span>Results will appear here once match status and scoring are wired in.</span>
      </article>
    </section>
  );
}

function getStandingSummary(rows) {
  if (!rows.length) {
    return {
      leaders: "No standings yet",
      lastPlace: "No standings yet",
    };
  }

  const points = rows.map((row) => Number(row.total_points || 0));
  const top = Math.max(...points);
  const bottom = Math.min(...points);
  const leaders = rows.filter((row) => Number(row.total_points || 0) === top);
  const lastPlace = rows.filter((row) => Number(row.total_points || 0) === bottom);

  return {
    leaders: formatManagerSummary(leaders, top),
    lastPlace: formatManagerSummary(lastPlace, bottom),
  };
}

function formatManagerSummary(rows, points) {
  if (rows.length > 3) return `All managers tied (${points} pts)`;
  const names = rows.map((row) => row.manager_name).join(", ");
  return `${names} (${points} pts)`;
}

function flagForTeamName(name) {
  const normalized = String(name || "").toLowerCase();
  const flags = {
    australia: "🇦🇺",
    belgium: "🇧🇪",
    brazil: "🇧🇷",
    "côte d'ivoire": "🇨🇮",
    "cote d'ivoire": "🇨🇮",
    "curaçao": "🇨🇼",
    curacao: "🇨🇼",
    ecuador: "🇪🇨",
    germany: "🇩🇪",
    haiti: "🇭🇹",
    "ir iran": "🇮🇷",
    japan: "🇯🇵",
    netherlands: "🇳🇱",
    paraguay: "🇵🇾",
    "saudi arabia": "🇸🇦",
    spain: "🇪🇸",
    sweden: "🇸🇪",
    tunisia: "🇹🇳",
    türkiye: "🇹🇷",
    turkey: "🇹🇷",
    usa: "🇺🇸",
  };
  return flags[normalized] || "🏳";
}

function formatKickoff(value) {
  if (!value) return "TBD";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}
