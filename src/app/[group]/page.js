import { notFound } from "next/navigation";

import { getGroupOverview } from "@/data/league";
import PredictionPanel from "./PredictionPanel";

export default async function GroupPage({ params }) {
  const group = await getGroupOverview(params.group);
  if (!group) notFound();

  return (
    <main className="page">
      <section className="hero">
        <h1>{group.name}</h1>
        <p>
          This page will host open prediction cards, manager pick previews,
          deadline-aware pulse reveals, and the group leaderboard.
        </p>
      </section>

      <section className="grid">
        <article className="panel">
          <span className="metric">{group.manager_count}</span>
          <h2>Manager Unlock</h2>
          <p>Commissioner-managed PINs are verified server-side.</p>
        </article>
        <article className="panel">
          <span className="metric">{group.lock_minutes_before_kickoff}m</span>
          <h2>Deadline</h2>
          <p>Picks lock one hour before kickoff by backend enforcement.</p>
        </article>
        <article className="panel">
          <span className="metric">{group.data_mode}</span>
          <h2>Pulse Reveal</h2>
          <p>Manager names appear only after each match deadline.</p>
        </article>
      </section>

      <section className="section">
        <article className="panel">
          <h2>Upcoming Matches</h2>
          {group.upcoming_matches.length ? (
            <ul className="match-list">
              {group.upcoming_matches.map((match) => (
                <li key={match.external_match_id}>
                  <strong>{formatMatchLabel(match)}</strong>
                  <span>{formatKickoff(match.kickoff_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>No upcoming seeded matches yet.</p>
          )}
        </article>
      </section>

      <PredictionPanel groupSlug={group.slug} matches={group.upcoming_matches} />
    </main>
  );
}

function formatMatchLabel(match) {
  const teamA = match.team_a?.name || "TBD";
  const teamB = match.team_b?.name || "TBD";
  return `${teamA} vs ${teamB}`;
}

function formatKickoff(value) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}
