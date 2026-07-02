import {
  ASSIST_EVENT_TYPE,
  GOAL_EVENT_TYPE,
  getFifaMatchesById,
  getFifaMatchTimeline,
  getFifaPlayer,
} from "@/integrations/fifa-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { playerNamesMatch } from "@/rules/player-matching";

// Automated scoring only ever covers matches kicking off on or after this
// instant. Manually entered totals in player_stat_tallies stay untouched —
// the ledger (player_match_stats) is additive and the two never overlap,
// so there's no risk of double-counting a goal someone already typed in.
export const DEFAULT_SYNC_SINCE = "2026-07-02T00:00:00Z";

export async function syncPlayerStats({
  supabase = createSupabaseServerClient(),
  fifaMatchesById,
  sinceKickoffAt = DEFAULT_SYNC_SINCE,
  writeMode = false,
} = {}) {
  const matchesById = fifaMatchesById || await getFifaMatchesById();
  const sinceMs = new Date(sinceKickoffAt).getTime();

  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select("id,external_match_id")
    .not("external_match_id", "is", null)
    .limit(300);
  if (matchesError) throw new Error(matchesError.message);

  const finishedMatches = (matches || [])
    .map((match) => ({ match, fifaMatch: matchesById.get(String(match.external_match_id)) }))
    .filter(({ fifaMatch }) => {
      if (fifaMatch?.status !== "finished") return false;
      const kickoffMs = new Date(fifaMatch.kickoff_at).getTime();
      return Number.isFinite(sinceMs) ? kickoffMs >= sinceMs : true;
    });

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id,fifa_code");
  if (teamsError) throw new Error(teamsError.message);
  const teamIdByFifaCode = new Map((teams || []).map((team) => [team.fifa_code, team.id]));

  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id,team_id,display_name,external_player_id");
  if (playersError) throw new Error(playersError.message);

  const playerByExternalId = new Map(
    (players || []).filter((player) => player.external_player_id)
      .map((player) => [player.external_player_id, player])
  );
  const playersByTeam = new Map();
  for (const player of players || []) {
    if (!player.team_id) continue;
    if (!playersByTeam.has(player.team_id)) playersByTeam.set(player.team_id, []);
    playersByTeam.get(player.team_id).push(player);
  }

  const matchTallies = new Map();
  const newExternalLinks = [];
  const unmatched = [];

  for (const { match, fifaMatch } of finishedMatches) {
    let timeline;
    try {
      timeline = await getFifaMatchTimeline({
        idCompetition: fifaMatch.id_competition,
        idSeason: fifaMatch.id_season,
        idStage: fifaMatch.id_stage,
        externalMatchId: match.external_match_id,
      });
    } catch (timelineError) {
      unmatched.push({
        external_match_id: match.external_match_id,
        reason: "timeline_fetch_failed",
        error: timelineError.message,
      });
      continue;
    }

    for (const event of timeline.events) {
      if (event.isOwnGoal) continue;

      let player = playerByExternalId.get(event.playerId);
      if (!player) {
        let fifaPlayer;
        try {
          fifaPlayer = await getFifaPlayer(event.playerId);
        } catch (playerError) {
          unmatched.push({
            external_match_id: match.external_match_id,
            event_id: event.eventId,
            reason: "player_lookup_failed",
            error: playerError.message,
          });
          continue;
        }
        if (!fifaPlayer?.name) {
          unmatched.push({ external_match_id: match.external_match_id, event_id: event.eventId, reason: "player_lookup_empty" });
          continue;
        }

        const teamId = teamIdByFifaCode.get(fifaPlayer.countryCode);
        const candidates = teamId ? (playersByTeam.get(teamId) || []) : (players || []);
        player = candidates.find((candidate) => playerNamesMatch(candidate.display_name, fifaPlayer.name));
        if (!player) {
          unmatched.push({
            external_match_id: match.external_match_id,
            event_id: event.eventId,
            reason: "no_roster_match",
            fifa_player: fifaPlayer.name,
          });
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
      const { error } = await supabase
        .from("players")
        .update({ external_player_id: link.externalPlayerId })
        .eq("id", link.playerId);
      if (error) throw new Error(error.message);
    }
    for (const tally of matchTallies.values()) {
      const { error } = await supabase
        .from("player_match_stats")
        .upsert({
          player_id: tally.playerId,
          match_id: tally.matchId,
          goals: tally.goals,
          assists: tally.assists,
          updated_at: new Date().toISOString(),
        }, { onConflict: "player_id,match_id" });
      if (error) throw new Error(error.message);
    }
  }

  return {
    ok: true,
    mode: writeMode ? "write" : "dry-run",
    since_kickoff_at: sinceKickoffAt,
    finished_matches: finishedMatches.length,
    match_stat_rows: matchTallies.size,
    summary: [...matchTallies.values()],
    unmatched,
  };
}
