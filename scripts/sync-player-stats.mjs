import { playerNamesMatch } from "../src/rules/player-matching.js";
import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

const DEFAULT_SEASON_ID = "285023";
const GOAL_EVENT_TYPE = 0;
const ASSIST_EVENT_TYPE = 1;

// Automated scoring only ever covers matches kicking off on or after this
// instant. Manually entered totals in player_stat_tallies stay untouched —
// the ledger (player_match_stats) is additive and the two never overlap,
// so there's no risk of double-counting a goal someone already typed in.
const DEFAULT_SYNC_SINCE = "2026-07-02T00:00:00Z";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const args = parseArgs(process.argv.slice(2));
const writeMode = Boolean(args.write);
const sinceKickoffAt = args.since || DEFAULT_SYNC_SINCE;
const sinceMs = new Date(sinceKickoffAt).getTime();

const fifaMatches = await fetchFifaMatches();
const matches = await supabaseRest("/matches?select=id,external_match_id&external_match_id=not.is.null&limit=300");

const finishedMatches = matches
  .map((match) => ({ match, fifaMatch: fifaMatches.get(String(match.external_match_id)) }))
  .filter(({ fifaMatch }) => {
    if (fifaMatch?.status !== "finished") return false;
    const kickoffMs = new Date(fifaMatch.kickoff_at).getTime();
    return Number.isFinite(sinceMs) ? kickoffMs >= sinceMs : true;
  });

const teams = await supabaseRest("/teams?select=id,fifa_code");
const teamIdByFifaCode = new Map(teams.map((team) => [team.fifa_code, team.id]));

const players = await supabaseRest("/players?select=id,team_id,display_name,external_player_id");
const playerByExternalId = new Map(
  players.filter((player) => player.external_player_id).map((player) => [player.external_player_id, player])
);
const playersByTeam = new Map();
for (const player of players) {
  if (!player.team_id) continue;
  if (!playersByTeam.has(player.team_id)) playersByTeam.set(player.team_id, []);
  playersByTeam.get(player.team_id).push(player);
}

const matchTallies = new Map();
const newExternalLinks = [];
const unmatched = [];
const playerCache = new Map();

for (const { match, fifaMatch } of finishedMatches) {
  let timeline;
  try {
    timeline = await fetchTimeline(fifaMatch, match.external_match_id);
  } catch (error) {
    unmatched.push({ external_match_id: match.external_match_id, reason: "timeline_fetch_failed", error: error.message });
    continue;
  }

  for (const event of timeline) {
    if (event.isOwnGoal) continue;

    let player = playerByExternalId.get(event.playerId);
    if (!player) {
      let fifaPlayer;
      try {
        fifaPlayer = await fetchPlayer(event.playerId);
      } catch (error) {
        unmatched.push({ external_match_id: match.external_match_id, event_id: event.eventId, reason: "player_lookup_failed", error: error.message });
        continue;
      }
      if (!fifaPlayer?.name) {
        unmatched.push({ external_match_id: match.external_match_id, event_id: event.eventId, reason: "player_lookup_empty" });
        continue;
      }

      const teamId = teamIdByFifaCode.get(fifaPlayer.countryCode);
      const candidates = teamId ? (playersByTeam.get(teamId) || []) : players;
      player = candidates.find((candidate) => playerNamesMatch(candidate.display_name, fifaPlayer.name));
      if (!player) {
        unmatched.push({ external_match_id: match.external_match_id, event_id: event.eventId, reason: "no_roster_match", fifa_player: fifaPlayer.name });
        continue;
      }
      playerByExternalId.set(event.playerId, player);
      newExternalLinks.push({ playerId: player.id, externalPlayerId: event.playerId });
    }

    const key = `${player.id}:${match.id}`;
    const tally = matchTallies.get(key) || { playerId: player.id, matchId: match.id, name: player.display_name, goals: 0, assists: 0 };
    if (event.type === GOAL_EVENT_TYPE) tally.goals += 1;
    if (event.type === ASSIST_EVENT_TYPE) tally.assists += 1;
    matchTallies.set(key, tally);
  }
}

if (writeMode) {
  for (const link of newExternalLinks) {
    await supabaseRest(`/players?id=eq.${link.playerId}`, {
      method: "PATCH",
      body: JSON.stringify({ external_player_id: link.externalPlayerId }),
    });
  }
  for (const tally of matchTallies.values()) {
    const existing = await supabaseRest(
      `/player_match_stats?select=id&player_id=eq.${tally.playerId}&match_id=eq.${tally.matchId}&limit=1`
    );
    const body = {
      player_id: tally.playerId,
      match_id: tally.matchId,
      goals: tally.goals,
      assists: tally.assists,
      updated_at: new Date().toISOString(),
    };
    if (existing[0]?.id) {
      await supabaseRest(`/player_match_stats?id=eq.${existing[0].id}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      await supabaseRest("/player_match_stats", { method: "POST", body: JSON.stringify(body) });
    }
  }
}

console.log(JSON.stringify({
  mode: writeMode ? "write" : "dry-run",
  since_kickoff_at: sinceKickoffAt,
  finished_matches: finishedMatches.length,
  match_stat_rows: matchTallies.size,
  summary: [...matchTallies.values()],
  unmatched,
}, null, 2));

async function fetchFifaMatches() {
  const seasonId = process.env.FIFA_SEASON_ID || DEFAULT_SEASON_ID;
  const url = process.env.FIFA_MATCHES_URL
    || `https://api.fifa.com/api/v3/calendar/matches?language=en&count=500&idSeason=${seasonId}`;
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "wc-ang-rebuild/1.0" } });
  if (!response.ok) throw new Error(`FIFA matches request failed with HTTP ${response.status}`);
  const payload = await response.json();
  const results = Array.isArray(payload?.Results) ? payload.Results : [];
  return new Map(results.map((match) => [String(match.IdMatch), normalizeFifaMatch(match)]));
}

function normalizeFifaMatch(match) {
  const status = match.MatchStatus === 0 && match.ResultType
    ? "finished"
    : match.MatchStatus === 2 || match.MatchStatus === 3 ? "live" : "scheduled";
  return {
    id_competition: match.IdCompetition ? String(match.IdCompetition) : null,
    id_season: match.IdSeason ? String(match.IdSeason) : null,
    id_stage: match.IdStage ? String(match.IdStage) : null,
    kickoff_at: match.Date || null,
    status,
  };
}

async function fetchTimeline(fifaMatch, externalMatchId) {
  const { id_competition: idCompetition, id_season: idSeason, id_stage: idStage } = fifaMatch;
  if (!idCompetition || !idSeason || !idStage) throw new Error("Missing FIFA stage identifiers for timeline lookup");
  const url = `https://api.fifa.com/api/v3/timelines/${idCompetition}/${idSeason}/${idStage}/${externalMatchId}`;
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "wc-ang-rebuild/1.0" } });
  if (!response.ok) throw new Error(`FIFA timeline request failed with HTTP ${response.status}`);
  const payload = await response.json();
  const rawEvents = Array.isArray(payload?.Event) ? payload.Event : [];
  return rawEvents
    .filter((event) => event.Type === GOAL_EVENT_TYPE || event.Type === ASSIST_EVENT_TYPE)
    .map((event) => ({
      eventId: event.EventId ? String(event.EventId) : null,
      type: event.Type,
      playerId: event.IdPlayer ? String(event.IdPlayer) : null,
      isOwnGoal: /own goal/i.test(event.EventDescription?.[0]?.Description || ""),
    }))
    .filter((event) => event.playerId);
}

async function fetchPlayer(playerId) {
  if (playerCache.has(playerId)) return playerCache.get(playerId);
  const response = await fetch(`https://api.fifa.com/api/v3/players/${playerId}?language=en`, {
    headers: { accept: "application/json", "user-agent": "wc-ang-rebuild/1.0" },
  });
  if (!response.ok) throw new Error(`FIFA player request failed with HTTP ${response.status}`);
  const payload = await response.json();
  const player = { name: payload?.Name?.[0]?.Description || null, countryCode: payload?.IdCountry || null };
  playerCache.set(playerId, player);
  return player;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
