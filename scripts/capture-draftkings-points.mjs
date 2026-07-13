import { createOddsApiClientFromEnv } from "../src/integrations/odds-api.js";
import { calculateTwoTeamPointSplit, getKnockoutStagePointScale, namesMatch } from "../src/rules/odds-points.js";
import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

const BOOKMAKER_KEY = "draftkings";
const DEFAULT_CAPTURE_START_HOURS = 24;
const DEFAULT_CAPTURE_END_HOURS = 25;

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ODDS_API_KEY"]);

const args = parseArgs(process.argv.slice(2));
const writeMode = Boolean(args.write);
const captureStartHours = Number(args["capture-start-hours"] || DEFAULT_CAPTURE_START_HOURS);
const captureEndHours = Number(args["capture-end-hours"] || DEFAULT_CAPTURE_END_HOURS);
const includeAllUpcoming = Boolean(args["all-upcoming"]);
const updateExisting = Boolean(args["update-existing"]);

const client = createOddsApiClientFromEnv();
const oddsResult = await client.getOdds({
  sport: args.sport || "soccer_fifa_world_cup",
  regions: args.regions || "us",
  markets: "h2h",
  oddsFormat: "american",
  dateFormat: "iso",
});

const matches = await supabaseRest(`/matches?select=id,external_match_id,stage,kickoff_at,status,team_a_id,team_b_id,team_a:team_a_id(name,fifa_code),team_b:team_b_id(name,fifa_code)&status=eq.scheduled&limit=300`);

const now = Date.now();
const captureStartMs = captureStartHours * 60 * 60 * 1000;
const captureEndMs = captureEndHours * 60 * 60 * 1000;
const eligibleMatches = matches.filter((match) => {
  if (!match.team_a || !match.team_b) return false;
  const kickoffTime = new Date(match.kickoff_at).getTime();
  if (kickoffTime < now) return false;
  if (includeAllUpcoming) return true;
  return kickoffTime >= now + captureStartMs && kickoffTime <= now + captureEndMs;
});
const existingValues = await getExistingPickValues(eligibleMatches);

const captured = [];
const skipped = [];
for (const match of eligibleMatches) {
  const existingTeamA = existingValues.has(valueKey(match.id, match.team_a_id));
  const existingTeamB = existingValues.has(valueKey(match.id, match.team_b_id));
  if (!updateExisting && existingTeamA && existingTeamB) {
    skipped.push({ external_match_id: match.external_match_id, reason: "already_captured", match: formatMatch(match) });
    continue;
  }

  const event = findOddsEvent({ events: oddsResult.data || [], match });
  if (!event) {
    skipped.push({ external_match_id: match.external_match_id, reason: "no_odds_event", match: formatMatch(match) });
    continue;
  }

  const bookmaker = (event.bookmakers || []).find((book) => book.key === BOOKMAKER_KEY);
  if (!bookmaker) {
    skipped.push({ external_match_id: match.external_match_id, reason: "no_draftkings", match: formatMatch(match) });
    continue;
  }

  const market = (bookmaker.markets || []).find((item) => item.key === "h2h");
  if (!market) {
    skipped.push({ external_match_id: match.external_match_id, reason: "no_h2h_market", match: formatMatch(match) });
    continue;
  }

  const teamAOutcome = findOutcome(market.outcomes || [], match.team_a.name);
  const teamBOutcome = findOutcome(market.outcomes || [], match.team_b.name);
  const drawOutcome = findOutcome(market.outcomes || [], "Draw") || findOutcome(market.outcomes || [], "Tie");
  if (!teamAOutcome || !teamBOutcome) {
    skipped.push({
      external_match_id: match.external_match_id,
      reason: "missing_team_outcome",
      match: formatMatch(match),
      outcomes: (market.outcomes || []).map((outcome) => outcome.name),
    });
    continue;
  }

  const stageScale = getKnockoutStagePointScale(match.stage);
  const split = calculateTwoTeamPointSplit({
    teamAOdds: teamAOutcome.price,
    teamBOdds: teamBOutcome.price,
    totalPoints: stageScale.totalPoints,
    minPoints: stageScale.minPoints,
    maxPoints: stageScale.maxPoints,
  });
  const row = {
    external_match_id: match.external_match_id,
    kickoff_at: match.kickoff_at,
    match: formatMatch(match),
    bookmaker: bookmaker.title || bookmaker.key,
    team_a: match.team_a.name,
    team_a_odds: teamAOutcome.price,
    team_a_points: split.team_a_points,
    team_b: match.team_b.name,
    team_b_odds: teamBOutcome.price,
    team_b_points: split.team_b_points,
    draw_odds: drawOutcome?.price ?? null,
    point_scale: stageScale.label,
  };

  if (writeMode) {
    const snapshot = await supabaseRest("/odds_snapshots", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        match_id: match.id,
        source: BOOKMAKER_KEY,
        market: "h2h",
        raw_payload: {
          event_id: event.id,
          sport_key: event.sport_key,
          commence_time: event.commence_time,
          bookmaker,
          ignored_draw_odds: drawOutcome?.price ?? null,
          formula: `two-team normalized implied probability; team points = round((1 - team_probability) * ${stageScale.totalPoints}) to nearest 0.5; clamped ${stageScale.minPoints}-${stageScale.maxPoints}; pair sums to ${stageScale.totalPoints}`,
        },
      }),
    });
    const snapshotId = snapshot?.[0]?.id || null;
    await upsertMatchPickValue({
      matchId: match.id,
      teamId: match.team_a_id,
      points: split.team_a_points,
      snapshotId,
    });
    await upsertMatchPickValue({
      matchId: match.id,
      teamId: match.team_b_id,
      points: split.team_b_points,
      snapshotId,
    });
  }

  captured.push(row);
}

console.log(JSON.stringify({
  mode: writeMode ? "write" : "dry-run",
  bookmaker: BOOKMAKER_KEY,
  capture_window_hours: includeAllUpcoming ? "all-upcoming" : `${captureStartHours}-${captureEndHours}`,
  remainingRequests: oddsResult.remainingRequests,
  usedRequests: oddsResult.usedRequests,
  captured_count: captured.length,
  skipped_count: skipped.length,
  captured,
  skipped,
}, null, 2));

async function upsertMatchPickValue({ matchId, teamId, points, snapshotId }) {
  const existing = await supabaseRest(
    `/match_pick_values?select=id&match_id=eq.${matchId}&team_id=eq.${teamId}&limit=1`
  );
  const body = {
    match_id: matchId,
    team_id: teamId,
    points,
    source_odds_snapshot_id: snapshotId,
  };
  if (existing[0]?.id) {
    await supabaseRest(`/match_pick_values?id=eq.${existing[0].id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  } else {
    await supabaseRest("/match_pick_values", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

async function getExistingPickValues(matches) {
  const matchIds = [...new Set(matches.map((match) => match.id).filter(Boolean))];
  if (!matchIds.length) return new Set();
  const query = `/match_pick_values?select=match_id,team_id&match_id=in.(${matchIds.join(",")})`;
  const data = await supabaseRest(query);
  return new Set((data || []).map((row) => valueKey(row.match_id, row.team_id)));
}

function findOddsEvent({ events, match }) {
  return events.find((event) => {
    const eventTime = new Date(event.commence_time).getTime();
    const matchTime = new Date(match.kickoff_at).getTime();
    const timeMatches = Math.abs(eventTime - matchTime) <= 2 * 60 * 60 * 1000;
    const teamsMatch = (
      namesMatch(event.home_team, match.team_a.name) && namesMatch(event.away_team, match.team_b.name)
    ) || (
      namesMatch(event.home_team, match.team_b.name) && namesMatch(event.away_team, match.team_a.name)
    );
    return timeMatches && teamsMatch;
  });
}

function findOutcome(outcomes, teamName) {
  return outcomes.find((outcome) => namesMatch(outcome.name, teamName));
}

function formatMatch(match) {
  return `${match.team_a?.name || "TBD"} v ${match.team_b?.name || "TBD"}`;
}

function valueKey(matchId, teamId) {
  return `${matchId}:${teamId}`;
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
