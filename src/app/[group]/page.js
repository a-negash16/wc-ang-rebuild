import { notFound } from "next/navigation";

import {
  getGroupOverview,
  getDraftRoomState,
  getGroupComments,
  getLeaderboardShell,
  getMissingPicksSummary,
  getPredictionPulseState,
  getRecentResults,
} from "@/data/league";
import CommentSection from "./CommentSection";
import PredictionPanel from "./PredictionPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function GroupPage({ params }) {
  const { group: groupSlug } = await params;
  const [group, pulse, leaderboard, recentResults, missingPicks, draftRoom, comments] = await Promise.all([
    getGroupOverview(groupSlug),
    getPredictionPulseState({ groupSlug }),
    getLeaderboardShell({ groupSlug }),
    getRecentResults({ groupSlug }),
    getMissingPicksSummary({ groupSlug }),
    getDraftRoomState({ groupSlug }),
    getGroupComments({ groupSlug }),
  ]);
  if (!group) notFound();
  return (
    <main className={`page theme-${group.slug}`}>
      <section className="hero hero-dashboard" aria-labelledby="group-title">
        <div className="hero-pattern" aria-hidden="true"></div>
        <div className="hero-main">
          <h1 id="group-title">{group.name}</h1>
          <div className="hero-rows" aria-label="Page sections">
            <nav className="hero-actions" aria-label="Page sections">
              <a href="#standings">View standings</a>
              <a href="#next-picks">Next Picks</a>
              <a href="#prediction-pulse">Prediction Pulse</a>
              <a href="#draft-room">Draft Room</a>
              <a href="#recent-results">Recent Results</a>
              <a href="#rules">Rules</a>
              <a href="#comments">Comments</a>
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
        draftTeamManagersByCode={getDraftTeamManagersByCode(draftRoom)}
        draftPlayersByCode={getDraftPlayersByCode(draftRoom)}
      />

      <PredictionPulse pulse={pulse} />
      <DraftRoom draftRoom={draftRoom} />
      <CommentSection groupSlug={group.slug} initialComments={comments} />
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

function DraftRoom({ draftRoom }) {
  const rows = draftRoom?.rows || [];
  const hasDrafts = rows.some((row) => row.teams.length || row.players.length);
  return (
    <section className="section section-band draft-room-section" id="draft-room" aria-labelledby="draft-room-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Post group stage</p>
          <h2 id="draft-room-title">Draft Room</h2>
        </div>
        <span className="status-chip">{rows.length} managers</span>
      </div>
      {hasDrafts ? (
        <div className="draft-room-list" aria-label="Drafted teams and players by manager">
          {rows.map((row) => (
            <article className="draft-manager-card" key={row.manager_code}>
              <header className="draft-manager-header">
                <div>
                  <h3>{row.manager_name}</h3>
                  <span>{formatPoints(row.total_draft_points)} draft pts</span>
                </div>
              </header>
              <div className="draft-columns">
                <DraftColumn title="Drafted Teams" items={row.teams} emptyLabel="No teams drafted" showFlags />
                <DraftColumn title="Drafted Players" items={row.players} emptyLabel="No players drafted" showFlags />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <article className="panel empty-state">
          <strong>No draft data yet.</strong>
          <span>Drafted teams and players will appear here after the commissioner imports the post-group-stage draft.</span>
        </article>
      )}
    </section>
  );
}

function DraftColumn({ title, items, emptyLabel, showFlags = false }) {
  return (
    <div className="draft-column">
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li className={item.eliminated ? "eliminated" : ""} key={`${item.name}-${item.code || "no-code"}`}>
              <span className={[
                showFlags ? "draft-item-name" : "draft-item-name no-flag",
                item.eliminated ? "eliminated" : "",
              ].filter(Boolean).join(" ")}>
                {showFlags ? <span className="flag" aria-hidden="true">{flagForTeamCode(item.code)}</span> : null}
                <strong>{item.name}</strong>
              </span>
              <b>{formatSignedPoints(item.points)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p>{emptyLabel}</p>
      )}
    </div>
  );
}

function getDraftTeamManagersByCode(draftRoom) {
  const map = {};
  for (const row of draftRoom?.rows || []) {
    for (const team of row.teams || []) {
      const code = String(team.code || "").toUpperCase();
      if (!code) continue;
      map[code] ||= [];
      map[code].push(row.manager_name);
    }
  }
  return map;
}

function getDraftPlayersByCode(draftRoom) {
  const map = {};
  for (const row of draftRoom?.rows || []) {
    for (const player of row.players || []) {
      const code = String(player.code || "").toUpperCase();
      if (!code) continue;
      map[code] ||= [];
      map[code].push({
        player_name: player.name,
        manager_name: row.manager_name,
      });
    }
  }
  return map;
}

function PredictionPulse({ pulse }) {
  const matches = pulse?.matches || [];
  if (!matches.length) return null;

  return (
    <section className="section section-dark pulse-section" id="prediction-pulse" aria-labelledby="prediction-pulse-title">
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
            <div className={match.stage === "Group Stage" ? "pulse-bars" : "pulse-bars pulse-bars-knockout"}>
              <PulseChoice
                label={match.team_a_name}
                code={match.team_a_code}
                managers={match.team_a_managers}
                outcome="team_a"
                winnerType={match.winner_type}
                isFinished={match.status === "finished"}
              />
              {match.stage === "Group Stage" ? (
                <PulseChoice
                  label="Tie"
                  managers={match.tie_managers}
                  outcome="tie"
                  winnerType={match.winner_type}
                  isFinished={match.status === "finished"}
                />
              ) : null}
              <PulseChoice
                label={match.team_b_name}
                code={match.team_b_code}
                managers={match.team_b_managers}
                outcome="team_b"
                winnerType={match.winner_type}
                isFinished={match.status === "finished"}
              />
            </div>
            {match.stage === "Group Stage" ? null : <PulseRiskBonus match={match} />}
          </article>
        ))}
      </div>
    </section>
  );
}

function PulseRiskBonus({ match }) {
  if (!match.et_risk_managers && !match.pens_risk_managers) return null;
  return (
    <div className="pulse-risk-panel">
      <div className="pulse-risk-heading">
        <strong>Risk Bonus</strong>
        <span>{formatLengthResult(match)}</span>
      </div>
      <div className="pulse-risk-grid">
        <PulseRiskChoice
          label="ET"
          managers={match.et_risk_managers}
          isFinished={match.status === "finished"}
          isCorrect={match.length === "ET"}
          winLabel="+4"
          lossLabel="-2"
        />
        <PulseRiskChoice
          label="Pens"
          managers={match.pens_risk_managers}
          isFinished={match.status === "finished"}
          isCorrect={match.length === "Pens"}
          winLabel="+8"
          lossLabel="-4"
        />
      </div>
    </div>
  );
}

function PulseRiskChoice({ label, managers, isFinished, isCorrect, winLabel, lossLabel }) {
  const resultClass = isFinished ? isCorrect ? "is-correct" : "is-wrong" : "";
  const pointsLabel = isFinished ? isCorrect ? winLabel : lossLabel : `${winLabel}/${lossLabel}`;
  return (
    <div className="pulse-risk-choice">
      <strong>{label} <small>{pointsLabel}</small></strong>
      <ManagerChips managers={managers} resultClass={resultClass} compact />
    </div>
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
  const winnerName = getKnockoutWinnerName(match);
  return (
    <div className="pulse-score" aria-label="Final score">
      <b>{formatScore(match.team_a_score)}</b>
      <span>-</span>
      <b>{formatScore(match.team_b_score)}</b>
      {winnerName ? <small>{winnerName} advances</small> : null}
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

function ManagerChips({ managers, resultClass = "", compact = false }) {
  const names = String(managers || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (!names.length) return <span className="manager-empty">No picks</span>;
  return (
    <span className={compact ? "manager-chips compact" : "manager-chips"}>
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
                  <th>KO</th>
                  <th>Risks</th>
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
                    <td>{formatPoints(row.knockout_prediction_points)}</td>
                    <td>{formatPoints(row.knockout_risk_points)}</td>
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

function formatLengthResult(match) {
  if (match.status !== "finished") return "Risk reveal";
  if (match.length === "ET") return "Ended in ET";
  if (match.length === "Pens") return "Ended in Pens";
  return "Ended in 90";
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
      tag: "KO",
      title: "Knockouts",
      body: "Winner picks become odds-weighted after the group stage. Length picks are a flat bonus, no odds.",
      rows: [
        ["Correct winner", "3-7"],
        ["Correctly call Extra Time", "5"],
        ["Correctly call Penalties", "8"],
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

function formatSignedPoints(value) {
  const points = Number(value || 0);
  return points > 0 ? `+${points}` : "+0";
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
  const winnerName = getKnockoutWinnerName(match);
  if (winnerName) return `${winnerName} advances`;
  if (match.length === "ET") return "Final ET";
  if (match.length === "Pens") return "Final Pens";
  return "Final";
}

function getKnockoutWinnerName(match) {
  if (!match || match.status !== "finished" || isGroupStageLabel(match.stage)) return null;
  const teamAScore = numberOrNull(match.team_a_score);
  const teamBScore = numberOrNull(match.team_b_score);
  if (teamAScore !== null && teamBScore !== null && teamAScore !== teamBScore) return null;
  if (match.winner_team_id && match.winner_team_id === (match.team_a?.id || match.team_a_id)) {
    return match.team_a?.name || match.team_a_name || null;
  }
  if (match.winner_team_id && match.winner_team_id === (match.team_b?.id || match.team_b_id)) {
    return match.team_b?.name || match.team_b_name || null;
  }
  if (match.winner_type === "team_a") return match.team_a?.name || match.team_a_name || null;
  if (match.winner_type === "team_b") return match.team_b?.name || match.team_b_name || null;
  return null;
}

function isGroupStageLabel(stage) {
  return String(stage || "").toLowerCase().includes("group");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    ENG: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
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
