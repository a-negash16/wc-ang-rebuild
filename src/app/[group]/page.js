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

  return (
    <main className={`page theme-${group.slug}`}>
      <section className="hero hero-dashboard">
        <div>
          <p className="eyebrow">Prediction league rebuild</p>
          <h1>{group.name}</h1>
          <p>
            Make picks before lock, track the room once pulse reveals, and keep standings within reach.
          </p>
        </div>
        <div className="hero-status">
          <span>Group room</span>
          <strong>{group.lock_minutes_before_kickoff}m lock</strong>
          <small>{group.manager_count} managers · {group.data_mode}</small>
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
    <section className="section" aria-labelledby="standings-title">
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
