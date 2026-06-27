import { notFound } from "next/navigation";

import {
  getGroupOverview,
  getLeaderboardShell,
  getMissingPicksSummary,
  getPredictionPulseState,
  getRecentResults,
} from "@/data/league";
import PredictionPanel from "./PredictionPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function GroupPage({ params }) {
  const { group: groupSlug } = await params;
  const [group, pulse, leaderboard, recentResults, missingPicks] = await Promise.all([
    getGroupOverview(groupSlug),
    getPredictionPulseState({ groupSlug }),
    getLeaderboardShell({ groupSlug }),
    getRecentResults({ groupSlug }),
    getMissingPicksSummary({ groupSlug }),
  ]);
  if (!group) notFound();
  const summary = getStandingSummary(leaderboard?.rows || []);

  return (
    <main className={`page theme-${group.slug}`}>
      <section className="hero hero-dashboard" aria-labelledby="group-title">
        <div className="hero-pattern" aria-hidden="true"></div>
        <div className="hero-main">
          <p className="hero-kicker">Private league · World Cup 2026</p>
          <h1 id="group-title">{group.name}</h1>
          <div className="hero-rows" aria-label="Group summary">
            <div className="hero-meta">
              <span className="status-dot" aria-hidden="true"></span>
              <span className="hero-status-lines">
                <span className="hero-status-line">
                  <span className="hero-status-icon" aria-hidden="true">⭐</span>
                  <strong>{summary.leaders}</strong>
                </span>
                <span className="hero-status-line">
                  <span className="hero-status-icon" aria-hidden="true">🤡</span>
                  <strong>{summary.lastPlace}</strong>
                </span>
              </span>
            </div>
            <nav className="hero-actions" aria-label="Page sections">
              <a href="#standings">View standings</a>
              <a href="#next-picks">Next Picks</a>
              <a href="#recent-results">Recent Results</a>
            </nav>
          </div>
        </div>
      </section>

      <MissingPicksBar summary={missingPicks} />

      <PredictionPanel
        groupSlug={group.slug}
        managers={group.managers}
        matches={group.upcoming_matches}
        lockMinutesBeforeKickoff={group.lock_minutes_before_kickoff}
        timezone={group.timezone}
      />

      <PredictionPulse pulse={pulse} />
      <Leaderboard leaderboard={leaderboard} />
      <RulesSection />
      <RecentResults results={recentResults} />
    </main>
  );
}

function MissingPicksBar({ summary }) {
  const rows = summary?.rows || [];
  if (!rows.length) return null;
  const hasMonitoredMatches = Number(summary.match_count || 0) > 0;
  const totalMissing = rows.reduce((sum, row) => sum + Number(row.missing_count || 0), 0);

  return (
    <section className="missing-picks-bar" aria-labelledby="missing-picks-title">
      <div className="missing-picks-copy">
        <p className="eyebrow">Next action</p>
        <h2 id="missing-picks-title">Missing picks</h2>
        <span>
          {hasMonitoredMatches
            ? `${summary.match_count} match${summary.match_count === 1 ? "" : "es"} lock within ${summary.warning_hours}h`
            : `No picks locking within ${summary.warning_hours}h`}
        </span>
      </div>
      <div className="missing-picks-chips" aria-label="Missing pick counts by manager">
        {rows.map((row) => (
          <span
            className={Number(row.missing_count || 0) > 0 ? "missing-count-chip needs-action" : "missing-count-chip"}
            key={row.manager_code}
          >
            <strong>{row.manager_name}</strong>
            <b>{hasMonitoredMatches ? row.missing_count : "-"}</b>
          </span>
        ))}
      </div>
      <span className={totalMissing > 0 ? "missing-total needs-action" : "missing-total"}>
        {hasMonitoredMatches ? `${totalMissing} missing` : "clear"}
      </span>
    </section>
  );
}

function PredictionPulse({ pulse }) {
  const matches = pulse?.matches || [];
  if (!matches.length) return null;

  return (
    <section className="section section-dark pulse-section" aria-labelledby="prediction-pulse-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Room energy</p>
          <h2 id="prediction-pulse-title">Prediction Pulse</h2>
        </div>
        <span className="status-chip">{matches.length} latest</span>
      </div>

      <div className="swipe-rail pulse-rail" aria-label="Revealed prediction pulse cards">
        {matches.map((match) => (
          <article className={`pulse-card pulse-card-${getPulseStatus(match)}`} key={match.external_match_id}>
            <div className="pulse-card-heading">
              <div className="pulse-meta-row">
                <span>{formatKickoff(match.kickoff_at)}</span>
                <span className={`match-state match-state-${getPulseStatus(match)}`}>
                  {getPulseStatusLabel(match)}
                </span>
              </div>
              <PulseMatchup match={match} />
              {match.status === "finished" ? <PulseScore match={match} /> : null}
              <GroupChip group={match.group_label} fallback={match.stage} />
            </div>
            <div className="pulse-bars">
              <PulseChoice
                label={match.team_a_name}
                code={match.team_a_code}
                managers={match.team_a_managers}
                outcome="team_a"
                winnerType={match.winner_type}
                isFinished={match.status === "finished"}
              />
              <PulseChoice
                label="Tie"
                managers={match.tie_managers}
                outcome="tie"
                winnerType={match.winner_type}
                isFinished={match.status === "finished"}
              />
              <PulseChoice
                label={match.team_b_name}
                code={match.team_b_code}
                managers={match.team_b_managers}
                outcome="team_b"
                winnerType={match.winner_type}
                isFinished={match.status === "finished"}
              />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PulseMatchup({ match }) {
  return (
    <div className="pulse-matchup">
      <TeamLabel name={match.team_a_name} code={match.team_a_code} />
      <em>vs</em>
      <TeamLabel name={match.team_b_name} code={match.team_b_code} />
    </div>
  );
}

function PulseScore({ match }) {
  return (
    <div className="pulse-score" aria-label="Final score">
      <b>{formatScore(match.team_a_score)}</b>
      <span>-</span>
      <b>{formatScore(match.team_b_score)}</b>
    </div>
  );
}

function PulseChoice({ label, code, managers, outcome, winnerType, isFinished }) {
  const resultClass = isFinished && winnerType
    ? outcome === winnerType ? "is-correct" : "is-wrong"
    : "";
  return (
    <div className="pulse-choice">
      <div>
        <strong>{label === "Tie" ? "Tie" : <TeamLabel name={label} code={code} compact />}</strong>
        <ManagerChips managers={managers} resultClass={resultClass} />
      </div>
    </div>
  );
}

function ManagerChips({ managers, resultClass = "" }) {
  const names = String(managers || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (!names.length) return <span className="manager-empty">No picks</span>;
  return (
    <span className="manager-chips">
      {names.map((name) => (
        <em className={resultClass} key={name}>{name}</em>
      ))}
    </span>
  );
}

function TeamLabel({ name, code, team, compact = false }) {
  const label = name || team?.name || "TBD";
  return (
    <span className={compact ? "team-label compact" : "team-label"}>
      <span className="flag" aria-hidden="true">{flagForTeamCode(code || team?.fifa_code)}</span>
      <span>{label}</span>
    </span>
  );
}

function GroupChip({ group, fallback }) {
  const label = group ? `Group ${group}` : fallback;
  if (!label) return null;
  const groupClass = group ? ` group-${String(group).toLowerCase()}` : "";
  return <span className={`group-chip${groupClass}`}>{label}</span>;
}

function Leaderboard({ leaderboard }) {
  const rows = leaderboard?.rows || [];
  return (
    <section className="section section-band" id="standings" aria-labelledby="standings-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Scoring</p>
          <h2 id="standings-title">Standings</h2>
        </div>
        <span className="status-chip">{rows.length} managers</span>
      </div>
      <article className="panel leaderboard-panel">
        {rows.length ? (
          <div className="leaderboard-scroll">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Manager</th>
                  <th>Total</th>
                  <th>Group</th>
                  <th>Players</th>
                  <th>Teams</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.manager_code}>
                    <td className="rank-cell">
                      <span className="rank-stack">
                        <strong>{row.rank}</strong>
                        <em className={rankDeltaClass(row.rank_delta)}>{formatRankDelta(row.rank_delta)}</em>
                      </span>
                    </td>
                    <th scope="row">{row.manager_name}</th>
                    <td><b>{formatPoints(row.total_points)}</b></td>
                    <td>{formatPoints(row.group_stage_points)}</td>
                    <td>{formatPoints(row.drafted_players_points)}</td>
                    <td>{formatPoints(row.drafted_teams_points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state compact">
            <strong>No standings data yet.</strong>
            <span>Scores will appear here after the first completed match is processed.</span>
          </div>
        )}
      </article>
    </section>
  );
}

function RecentResults({ results }) {
  const rows = results || [];
  return (
    <section className="section section-band" id="recent-results" aria-labelledby="recent-results-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Finished matches</p>
          <h2 id="recent-results-title">Recent Results</h2>
        </div>
        <span className="status-chip">{rows.length ? `${rows.length} finals` : "No finals yet"}</span>
      </div>
      {rows.length ? (
        <div className="swipe-rail results-rail" aria-label="Recent finished matches">
          {rows.map((match) => (
            <article className="result-card" key={match.external_match_id}>
              <div className="result-meta">
                <GroupChip group={match.group_label} fallback={match.stage} />
              </div>
              <div className="result-scoreline">
                <TeamLabel team={match.team_a} />
                <b>{formatScore(match.team_a_score)}</b>
                <span>-</span>
                <b>{formatScore(match.team_b_score)}</b>
                <TeamLabel team={match.team_b} />
              </div>
              <div className="result-footer">
                <span>{formatKickoff(match.kickoff_at)}</span>
                <strong>{formatResultStatus(match)}</strong>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <article className="panel empty-state">
          <strong>No finished matches in the rebuild feed yet.</strong>
          <span>Finished matches will appear here once a match is marked complete.</span>
        </article>
      )}
    </section>
  );
}

function getPulseStatus(match) {
  if (match.status === "finished") return "finished";
  if (match.status === "live") return "live";
  return "revealed";
}

function getPulseStatusLabel(match) {
  if (match.status === "finished") return "Final";
  if (match.status === "live") return "Live";
  return "Locked";
}

function RulesSection() {
  const rules = [
    {
      tag: "1",
      title: "Group Picks",
      body: "Pick each group-stage result before the deadline.",
      rows: [
        ["Correct winner", "3"],
        ["Correct tie", "5"],
      ],
    },
    {
      tag: "Draft",
      title: "Drafted Players",
      body: "Drafted player points accumulate throughout the tournament.",
      rows: [
        ["Goal", "5"],
        ["Assist", "3"],
        ["Player of match", "7"],
        ["GK/CB clean sheet", "3"],
      ],
      draft: true,
    },
    {
      tag: "Teams",
      title: "Drafted Teams",
      body: "Drafted teams score every time they advance to another stage.",
      rows: [
        ["Each stage advanced", "10"],
      ],
    },
    {
      tag: "Future",
      title: "Futures",
      body: "Champion picks are commissioner-entered and odds-weighted.",
      rows: [
        ["Least likely champion", "up to 100"],
        ["Favorites", "less"],
      ],
    },
    {
      tag: "KO",
      title: "Knockouts",
      body: "Winner picks become odds-weighted after the group stage.",
      rows: [
        ["Correct winner", "1-9"],
        ["90/ET/Pens", "2"],
      ],
    },
  ];

  return (
    <section className="section section-band" id="rules" aria-labelledby="rules-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">League format</p>
          <h2 id="rules-title">The Rules</h2>
        </div>
        <span className="status-chip">Swipe cards</span>
      </div>
      <div className="rules-grid" aria-label="League rules">
        {rules.map((rule) => (
          <article className="rule-card" key={rule.title}>
            <span className={rule.draft ? "rule-tag rule-tag-draft" : "rule-tag"}>
              {rule.tag}
            </span>
            <h3 className="rule-title">{rule.title}</h3>
            <p>{rule.body}</p>
            <table className="rule-table">
              <tbody>
                {rule.rows.map(([label, value]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </div>
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
    leaders: formatStandingSentence(leaders, top, {
      singular: "leads",
      plural: "lead",
    }),
    lastPlace: formatStandingSentence(lastPlace, bottom, {
      singular: "is last",
      plural: "are last",
    }),
  };
}

function formatStandingSentence(rows, points, verbs) {
  if (!rows.length) return "No standings yet";
  if (rows.length > 3) return `All managers are tied with ${points} pts`;
  const names = formatNameList(rows.map((row) => row.manager_name));
  const verb = rows.length === 1 ? verbs.singular : verbs.plural;
  return `${names} ${verb} with ${points} pts`;
}

function formatNameList(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function formatPoints(value) {
  return Number(value || 0);
}

function formatRankDelta(value) {
  const delta = Number(value || 0);
  if (!delta) return "-";
  return delta > 0 ? `↑${delta}` : `↓${Math.abs(delta)}`;
}

function rankDeltaClass(value) {
  const delta = Number(value || 0);
  if (delta > 0) return "rank-up";
  if (delta < 0) return "rank-down";
  return "rank-flat";
}

function formatScore(value) {
  return value === null || value === undefined ? "-" : value;
}

function formatResultStatus(match) {
  if (match.length === "ET") return "Final ET";
  if (match.length === "Pens") return "Final Pens";
  return "Final";
}

function flagForTeamCode(code) {
  const normalized = String(code || "").toUpperCase();
  const flags = {
    ALG: "🇩🇿",
    ARG: "🇦🇷",
    AUS: "🇦🇺",
    AUT: "🇦🇹",
    BEL: "🇧🇪",
    BIH: "🇧🇦",
    BRA: "🇧🇷",
    CAN: "🇨🇦",
    CIV: "🇨🇮",
    COL: "🇨🇴",
    COD: "🇨🇩",
    CPV: "🇨🇻",
    CRO: "🇭🇷",
    CUW: "🇨🇼",
    CZE: "🇨🇿",
    ECU: "🇪🇨",
    EGY: "🇪🇬",
    ENG: "🏴",
    ESP: "🇪🇸",
    FRA: "🇫🇷",
    GER: "🇩🇪",
    GHA: "🇬🇭",
    HAI: "🇭🇹",
    IRN: "🇮🇷",
    IRQ: "🇮🇶",
    JOR: "🇯🇴",
    JPN: "🇯🇵",
    KOR: "🇰🇷",
    KSA: "🇸🇦",
    MAR: "🇲🇦",
    MEX: "🇲🇽",
    NED: "🇳🇱",
    NOR: "🇳🇴",
    NZL: "🇳🇿",
    PAN: "🇵🇦",
    PAR: "🇵🇾",
    POR: "🇵🇹",
    QAT: "🇶🇦",
    RSA: "🇿🇦",
    SCO: "🏴",
    SEN: "🇸🇳",
    SUI: "🇨🇭",
    SWE: "🇸🇪",
    TUN: "🇹🇳",
    TUR: "🇹🇷",
    URU: "🇺🇾",
    USA: "🇺🇸",
    UZB: "🇺🇿",
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
