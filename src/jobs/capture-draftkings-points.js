import { createOddsApiClientFromEnv } from "@/integrations/odds-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calculateTwoTeamPointSplit, namesMatch } from "@/rules/odds-points";

export const DRAFTKINGS_BOOKMAKER_KEY = "draftkings";
export const DEFAULT_CAPTURE_START_HOURS = 24;
export const DEFAULT_CAPTURE_END_HOURS = 25;

export async function captureDraftKingsPoints({
  supabase = createSupabaseServerClient(),
  oddsClient = createOddsApiClientFromEnv(),
  writeMode = false,
  includeAllUpcoming = false,
  updateExisting = false,
  captureStartHours = DEFAULT_CAPTURE_START_HOURS,
  captureEndHours = DEFAULT_CAPTURE_END_HOURS,
  now = new Date(),
} = {}) {
  const oddsResult = await oddsClient.getOdds({
    sport: "soccer_fifa_world_cup",
    regions: "us",
    markets: "h2h",
    oddsFormat: "american",
    dateFormat: "iso",
  });

  const { data: matches, error } = await supabase
    .from("matches")
    .select(`
      id,
      external_match_id,
      stage,
      kickoff_at,
      status,
      team_a_id,
      team_b_id,
      team_a:team_a_id ( name, fifa_code ),
      team_b:team_b_id ( name, fifa_code )
    `)
    .eq("status", "scheduled")
    .limit(300);

  if (error) throw new Error(error.message);

  const eligibleMatches = filterEligibleMatches({
    matches: matches || [],
    includeAllUpcoming,
    captureStartHours,
    captureEndHours,
    now,
  });
  const existingValues = await getExistingPickValues({ supabase, matches: eligibleMatches });
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

    const bookmaker = (event.bookmakers || []).find((book) => book.key === DRAFTKINGS_BOOKMAKER_KEY);
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

    const split = calculateTwoTeamPointSplit({
      teamAOdds: teamAOutcome.price,
      teamBOdds: teamBOutcome.price,
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
    };

    if (writeMode) {
      const snapshotId = await insertOddsSnapshot({ supabase, match, event, bookmaker, drawOutcome });
      await upsertMatchPickValue({
        supabase,
        matchId: match.id,
        teamId: match.team_a_id,
        points: split.team_a_points,
        snapshotId,
      });
      await upsertMatchPickValue({
        supabase,
        matchId: match.id,
        teamId: match.team_b_id,
        points: split.team_b_points,
        snapshotId,
      });
    }

    captured.push(row);
  }

  return {
    ok: true,
    mode: writeMode ? "write" : "dry-run",
    bookmaker: DRAFTKINGS_BOOKMAKER_KEY,
    capture_window_hours: includeAllUpcoming ? "all-upcoming" : `${captureStartHours}-${captureEndHours}`,
    remainingRequests: oddsResult.remainingRequests,
    usedRequests: oddsResult.usedRequests,
    captured_count: captured.length,
    skipped_count: skipped.length,
    captured,
    skipped,
  };
}

function filterEligibleMatches({ matches, includeAllUpcoming, captureStartHours, captureEndHours, now }) {
  const nowMs = now.getTime();
  const startMs = captureStartHours * 60 * 60 * 1000;
  const endMs = captureEndHours * 60 * 60 * 1000;
  return matches.filter((match) => {
    if (!match.team_a || !match.team_b) return false;
    const kickoffTime = new Date(match.kickoff_at).getTime();
    if (kickoffTime < nowMs) return false;
    if (includeAllUpcoming) return true;
    return kickoffTime >= nowMs + startMs && kickoffTime <= nowMs + endMs;
  });
}

async function getExistingPickValues({ supabase, matches }) {
  const matchIds = [...new Set(matches.map((match) => match.id).filter(Boolean))];
  if (!matchIds.length) return new Set();
  const { data, error } = await supabase
    .from("match_pick_values")
    .select("match_id,team_id")
    .in("match_id", matchIds);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((row) => valueKey(row.match_id, row.team_id)));
}

async function insertOddsSnapshot({ supabase, match, event, bookmaker, drawOutcome }) {
  const { data, error } = await supabase
    .from("odds_snapshots")
    .insert({
      match_id: match.id,
      source: DRAFTKINGS_BOOKMAKER_KEY,
      market: "h2h",
      raw_payload: {
        event_id: event.id,
        sport_key: event.sport_key,
        commence_time: event.commence_time,
        bookmaker,
        ignored_draw_odds: drawOutcome?.price ?? null,
        formula: "two-team normalized implied probability; team points = round((1 - team_probability) * 10) to nearest 0.5; clamped 3-7; pair sums to 10",
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data?.id || null;
}

async function upsertMatchPickValue({ supabase, matchId, teamId, points, snapshotId }) {
  const { error } = await supabase
    .from("match_pick_values")
    .upsert({
      match_id: matchId,
      team_id: teamId,
      points,
      source_odds_snapshot_id: snapshotId,
    }, { onConflict: "match_id,team_id" });
  if (error) throw new Error(error.message);
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
