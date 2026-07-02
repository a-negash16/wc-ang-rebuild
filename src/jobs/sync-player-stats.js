import {
  ASSIST_EVENT_TYPE,
  GOAL_EVENT_TYPE,
  getFifaMatchesById,
  getFifaMatchTimeline,
  getFifaPlayer,
} from "@/integrations/fifa-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { playerNamesMatch } from "@/rules/player-matching";

export async function syncPlayerStats({
  supabase = createSupabaseServerClient(),
  fifaMatchesById,
  writeMode = false,
} = {}) {
  const matchesById = fifaMatchesById || await getFifaMatchesById();

  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select("id,external_match_id")
    .not("external_match_id", "is", null)
    .limit(300);
  if (matchesError) throw new Error(matchesError.message);

  const finishedMatches = (matches || [])
    .map((match) => ({ match, fifaMatch: matchesById.get(String(match.external_match_id)) }))
    .filter(({ fifaMatch }) => fifaMatch?.status === "finished");

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

  const tallies = new Map();
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

      const tally = tallies.get(player.id) || { goals: 0, assists: 0, name: player.display_name };
      if (event.type === GOAL_EVENT_TYPE) tally.goals += 1;
      if (event.type === ASSIST_EVENT_TYPE) tally.assists += 1;
      tallies.set(player.id, tally);
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
    for (const [playerId, tally] of tallies.entries()) {
      const { error } = await supabase
        .from("player_stat_tallies")
        .upsert({
          player_id: playerId,
          goals: tally.goals,
          assists: tally.assists,
          updated_at: new Date().toISOString(),
        }, { onConflict: "player_id" });
      if (error) throw new Error(error.message);
    }
  }

  return {
    ok: true,
    mode: writeMode ? "write" : "dry-run",
    finished_matches: finishedMatches.length,
    players_updated: tallies.size,
    summary: [...tallies.entries()].map(([playerId, tally]) => ({ player_id: playerId, ...tally })),
    unmatched,
  };
}
