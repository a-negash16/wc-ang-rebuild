import fs from "node:fs/promises";
import path from "node:path";

import { getFifaMatchesById } from "@/integrations/fifa-api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scoreGroupStagePick, totalLeaderboardPoints } from "@/rules/scoring";

const SEED_DIR = path.join(process.cwd(), "supabase", "seed-data");
const PULSE_RECENT_LIMIT = 3;
const UPCOMING_MATCH_LIMIT = 16;

export async function getGroups() {
  const supabase = getOptionalSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("groups")
      .select("slug,name,timezone,lock_minutes_before_kickoff,is_active")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  return readSeedJson("groups.json");
}

export async function getGroupOverview(groupSlug) {
  const supabase = getOptionalSupabaseClient();
  if (supabase) {
    const { data: group, error: groupError } = await supabase
      .from("groups")
      .select("id,slug,name,timezone,lock_minutes_before_kickoff")
      .eq("slug", groupSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (groupError) throw new Error(groupError.message);
    if (!group) return null;

    const [{ data: managers, error: managersError }, { data: matches, error: matchError }] =
      await Promise.all([
        supabase
          .from("managers")
          .select("manager_code,display_name")
          .eq("group_id", group.id)
          .eq("is_active", true)
          .order("display_name", { ascending: true }),
        supabase
          .from("group_matches")
          .select(`
            matches (
              external_match_id,
              stage,
              group_label,
              kickoff_at,
              status,
              team_a:team_a_id ( fifa_code, name ),
              team_b:team_b_id ( fifa_code, name )
            )
          `)
          .eq("group_id", group.id)
          .limit(120),
      ]);

    if (managersError) throw new Error(managersError.message);
    if (matchError) throw new Error(matchError.message);

    return {
      ...group,
      managers: managers || [],
      manager_count: managers?.length || 0,
      upcoming_matches: normalizeSupabaseMatches(matches || []),
      data_mode: "supabase",
    };
  }

  const [groups, managers, matches, teams] = await Promise.all([
    readSeedJson("groups.json"),
    readSeedJson("managers.json"),
    readSeedJson("matches.json"),
    readSeedJson("teams.json"),
  ]);
  const group = groups.find((item) => item.slug === groupSlug);
  if (!group) return null;

  const teamByCode = new Map(teams.map((team) => [team.fifa_code, team]));
  const groupManagers = managers
    .filter((manager) => manager.group_slug === groupSlug && manager.is_active)
    .map((manager) => ({
      manager_code: manager.manager_code,
      display_name: manager.display_name,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const now = Date.now();
  const upcomingMatches = matches
    .filter((match) => new Date(match.kickoff_at).getTime() >= now)
    .slice(0, UPCOMING_MATCH_LIMIT)
    .map((match) => ({
      external_match_id: match.external_match_id,
      stage: match.stage,
      group_label: match.group_label,
      kickoff_at: match.kickoff_at,
      status: match.status,
      team_a: teamByCode.get(match.team_a_code) || null,
      team_b: teamByCode.get(match.team_b_code) || null,
    }));

  return {
    ...group,
    managers: groupManagers,
    manager_count: groupManagers.length,
    upcoming_matches: upcomingMatches,
    data_mode: "seed",
  };
}

export async function findManagerForUnlock({ groupSlug, managerCode }) {
  const supabase = getOptionalSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("managers")
      .select("manager_code,display_name,pin_hash,role,is_active,groups!inner(slug)")
      .eq("groups.slug", groupSlug)
      .eq("manager_code", managerCode)
      .eq("is_active", true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data
      ? {
          group_slug: groupSlug,
          manager_code: data.manager_code,
          display_name: data.display_name,
          pin_hash: data.pin_hash,
          role: data.role,
        }
      : null;
  }

  const managers = await readSeedJson("managers.json");
  return managers.find((manager) => {
    return manager.group_slug === groupSlug
      && manager.manager_code === managerCode
      && manager.is_active;
  }) || null;
}

export async function getMatchForPrediction({ groupSlug, externalMatchId }) {
  const supabase = getOptionalSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("group_matches")
      .select(`
        groups!inner ( slug, lock_minutes_before_kickoff ),
        matches!inner (
          id,
          external_match_id,
          stage,
          kickoff_at,
          status,
          team_a:team_a_id ( id, fifa_code, name ),
          team_b:team_b_id ( id, fifa_code, name )
        )
      `)
      .eq("groups.slug", groupSlug)
      .eq("matches.external_match_id", externalMatchId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data?.matches) return null;
    return {
      ...data.matches,
      lock_minutes_before_kickoff: data.groups.lock_minutes_before_kickoff,
      data_mode: "supabase",
    };
  }

  const [groups, matches, teams] = await Promise.all([
    readSeedJson("groups.json"),
    readSeedJson("matches.json"),
    readSeedJson("teams.json"),
  ]);
  const group = groups.find((item) => item.slug === groupSlug);
  const match = matches.find((item) => item.external_match_id === externalMatchId);
  if (!group || !match) return null;

  const teamByCode = new Map(teams.map((team) => [team.fifa_code, team]));
  return {
    ...match,
    team_a: teamByCode.get(match.team_a_code) || null,
    team_b: teamByCode.get(match.team_b_code) || null,
    lock_minutes_before_kickoff: group.lock_minutes_before_kickoff,
    data_mode: "seed",
  };
}

export async function savePrediction({ groupSlug, managerCode, externalMatchId, pickType }) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) {
    throw new Error("Seed mode is read-only. Configure Supabase before saving predictions.");
  }

  const { data: rows, error: lookupError } = await supabase
    .from("group_matches")
    .select(`
      group_id,
      match_id,
      groups!inner ( slug ),
      matches!inner (
        team_a_id,
        team_b_id,
        external_match_id
      )
    `)
    .eq("groups.slug", groupSlug)
    .eq("matches.external_match_id", externalMatchId)
    .limit(1);

  if (lookupError) throw new Error(lookupError.message);
  const groupMatch = rows?.[0];
  if (!groupMatch) throw new Error("Match not found");

  const { data: manager, error: managerError } = await supabase
    .from("managers")
    .select("id")
    .eq("group_id", groupMatch.group_id)
    .eq("manager_code", managerCode)
    .eq("is_active", true)
    .maybeSingle();

  if (managerError) throw new Error(managerError.message);
  if (!manager) throw new Error("Manager not found");

  const pickTeamId = pickType === "team_a"
    ? groupMatch.matches.team_a_id
    : pickType === "team_b"
      ? groupMatch.matches.team_b_id
      : null;

  const predictionRow = {
      group_id: groupMatch.group_id,
      manager_id: manager.id,
      match_id: groupMatch.match_id,
      pick_type: pickType,
      pick_team_id: pickTeamId,
      status: "active",
      updated_at: new Date().toISOString(),
  };

  const { data: existing, error: existingError } = await supabase
    .from("predictions")
    .select("id,pick_type,pick_team_id")
    .eq("group_id", groupMatch.group_id)
    .eq("manager_id", manager.id)
    .eq("match_id", groupMatch.match_id)
    .eq("status", "active")
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  if (existing) {
    const { error: updateError } = await supabase
      .from("predictions")
      .update(predictionRow)
      .eq("id", existing.id);
    if (updateError) throw new Error(updateError.message);
    await appendPredictionAudit({
      supabase,
      predictionId: existing.id,
      groupId: groupMatch.group_id,
      managerId: manager.id,
      matchId: groupMatch.match_id,
      oldPickType: existing.pick_type,
      oldPickTeamId: existing.pick_team_id,
      newPickType: pickType,
      newPickTeamId: pickTeamId,
    });
    return { ok: true };
  }

  const { error: insertError } = await supabase
    .from("predictions")
    .insert(predictionRow);

  if (insertError) throw new Error(insertError.message);
  return { ok: true };
}

export async function getManagerPickPreview({ groupSlug, managerCode }) {
  const supabase = getOptionalSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("active_prediction_details")
      .select("*")
      .eq("group_slug", groupSlug)
      .eq("manager_code", managerCode)
      .gte("kickoff_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("kickoff_at", { ascending: true })
      .limit(12);

    if (error) throw new Error(error.message);
    return data || [];
  }

  return [];
}

export async function getPredictionPulse({ groupSlug, externalMatchIds = [] }) {
  const supabase = getOptionalSupabaseClient();
  if (supabase) {
    let query = supabase
      .from("prediction_pulse_details")
      .select("*")
      .eq("group_slug", groupSlug);

    if (externalMatchIds.length) {
      query = query.in("external_match_id", externalMatchIds);
    }

    const { data, error } = await query.order("kickoff_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }

  return [];
}

export async function getRecentResults({ groupSlug, limit = 8 }) {
  const supabase = getOptionalSupabaseClient();
  if (supabase) {
    const { data: group, error: groupError } = await supabase
      .from("groups")
      .select("id")
      .eq("slug", groupSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (groupError) throw new Error(groupError.message);
    if (!group) return [];

    const { data, error } = await supabase
      .from("group_matches")
      .select(`
        matches (
          external_match_id,
          stage,
          group_label,
          kickoff_at,
          status,
          team_a_score,
          team_b_score,
          winner_team_id,
          length,
          team_a:team_a_id ( id, fifa_code, name ),
          team_b:team_b_id ( id, fifa_code, name )
        )
      `)
      .eq("group_id", group.id)
      .limit(200);

    if (error) throw new Error(error.message);
    const fifaMatchesById = await getFifaMatchesByIdSafe();
    return normalizeRecentResults(data || [], limit, fifaMatchesById);
  }

  const [matches, teams] = await Promise.all([
    readSeedJson("matches.json"),
    readSeedJson("teams.json"),
  ]);
  const teamByCode = new Map(teams.map((team) => [team.fifa_code, team]));

  const fifaMatchesById = await getFifaMatchesByIdSafe();
  return matches
    .map((match) => overlayMatchResult({
      external_match_id: match.external_match_id,
      stage: match.stage,
      group_label: match.group_label,
      kickoff_at: match.kickoff_at,
      status: match.status,
      team_a_score: match.team_a_score ?? null,
      team_b_score: match.team_b_score ?? null,
      winner_team_id: match.winner_team_id ?? null,
      length: match.length ?? null,
      team_a: teamByCode.get(match.team_a_code) || null,
      team_b: teamByCode.get(match.team_b_code) || null,
    }, fifaMatchesById))
    .filter((match) => match.status === "finished")
    .sort((a, b) => new Date(b.kickoff_at).getTime() - new Date(a.kickoff_at).getTime())
    .slice(0, limit);
}

export async function getGroupMatchesForPulse({ groupSlug, limit = 40 }) {
  const supabase = getOptionalSupabaseClient();
  if (supabase) {
    const { data: group, error: groupError } = await supabase
      .from("groups")
      .select("id")
      .eq("slug", groupSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (groupError) throw new Error(groupError.message);
    if (!group) return [];

    const { data, error } = await supabase
      .from("group_matches")
      .select(`
        matches (
          external_match_id,
          stage,
          group_label,
          kickoff_at,
          status,
          team_a:team_a_id ( fifa_code, name ),
          team_b:team_b_id ( fifa_code, name )
        )
      `)
      .eq("group_id", group.id)
      .limit(200);

    if (error) throw new Error(error.message);
    return normalizePulseMatches(data || [], limit);
  }

  const [matches, teams] = await Promise.all([
    readSeedJson("matches.json"),
    readSeedJson("teams.json"),
  ]);
  const teamByCode = new Map(teams.map((team) => [team.fifa_code, team]));

  return matches
    .map((match) => ({
      external_match_id: match.external_match_id,
      stage: match.stage,
      group_label: match.group_label,
      kickoff_at: match.kickoff_at,
      status: match.status,
      team_a: teamByCode.get(match.team_a_code) || null,
      team_b: teamByCode.get(match.team_b_code) || null,
    }))
    .sort(sortByKickoffAsc)
    .slice(0, limit);
}

export async function getManagerPredictionState({ groupSlug, managerCode }) {
  const overview = await getGroupOverview(groupSlug);
  if (!overview) return null;

  const openMatches = overview.upcoming_matches;
  const picks = await getManagerPickPreview({ groupSlug, managerCode });
  const pickByMatch = new Map(picks.map((pick) => [pick.external_match_id, pick]));

  return {
    group_slug: groupSlug,
    manager_code: managerCode,
    matches: openMatches.map((match) => {
      const pick = pickByMatch.get(match.external_match_id) || null;
      return {
        external_match_id: match.external_match_id,
        stage: match.stage,
        group_label: match.group_label,
        kickoff_at: match.kickoff_at,
        status: match.status,
        team_a: match.team_a,
        team_b: match.team_b,
        pick_type: pick?.pick_type || null,
        pick_label: formatPickLabel(pick),
        picked_at: pick?.updated_at || null,
        is_missing: !pick,
      };
    }),
  };
}

export async function getPredictionPulseState({ groupSlug }) {
  const overview = await getGroupOverview(groupSlug);
  if (!overview) return null;

  const matches = await getGroupMatchesForPulse({ groupSlug });
  const pulse = await getPredictionPulse({
    groupSlug,
    externalMatchIds: matches.map((match) => match.external_match_id),
  });
  const pulseByMatch = new Map(pulse.map((item) => [item.external_match_id, item]));
  const revealedMatches = matches
    .map((match) => {
      const item = pulseByMatch.get(match.external_match_id);
      const reveal = shouldRevealPulse({
        kickoffAt: match.kickoff_at,
        lockMinutesBeforeKickoff: overview.lock_minutes_before_kickoff,
      });

      return {
        external_match_id: match.external_match_id,
        team_a_name: match.team_a?.name || null,
        team_a_code: match.team_a?.fifa_code || null,
        team_b_name: match.team_b?.name || null,
        team_b_code: match.team_b?.fifa_code || null,
        kickoff_at: match.kickoff_at,
        reveal,
        locked_until: reveal ? null : deadlineFor(match.kickoff_at, overview.lock_minutes_before_kickoff),
        team_a_picks: reveal ? Number(item?.team_a_picks || 0) : null,
        tie_picks: reveal ? Number(item?.tie_picks || 0) : null,
        team_b_picks: reveal ? Number(item?.team_b_picks || 0) : null,
        total_picks: reveal ? Number(item?.total_picks || 0) : null,
        team_a_managers: reveal ? item?.team_a_managers || "" : "",
        tie_managers: reveal ? item?.tie_managers || "" : "",
        team_b_managers: reveal ? item?.team_b_managers || "" : "",
      };
    })
    .filter((match) => match.reveal);
  const revealedWithPicks = revealedMatches.filter((match) => Number(match.total_picks || 0) > 0);
  const recentWithPicks = revealedWithPicks
    .sort(sortByKickoffDesc)
    .slice(0, PULSE_RECENT_LIMIT);
  const selectedIds = new Set(recentWithPicks.map((match) => match.external_match_id));
  const fillerMatches = revealedMatches
    .filter((match) => !selectedIds.has(match.external_match_id))
    .sort(sortByKickoffDesc)
    .slice(0, Math.max(0, PULSE_RECENT_LIMIT - recentWithPicks.length));
  const pulseMatches = [...recentWithPicks, ...fillerMatches].sort(sortByKickoffAsc);

  return {
    group_slug: groupSlug,
    matches: pulseMatches,
  };
}

export async function getLeaderboardShell({ groupSlug }) {
  const overview = await getGroupOverview(groupSlug);
  if (!overview) return null;
  const pointsByManager = await getGroupStagePointsByManager(overview);
  const rows = overview.managers.map((manager) => {
    const groupStage = pointsByManager.get(manager.manager_code) || 0;
    const total = totalLeaderboardPoints({
      groupStage,
      knockoutPredictions: 0,
      futures: 0,
      draftedTeams: 0,
      draftedPlayers: 0,
    });

    return {
      rank: 0,
      manager_code: manager.manager_code,
      manager_name: manager.display_name,
      total_points: total,
      group_stage_points: groupStage,
      knockout_prediction_points: 0,
      futures_points: 0,
      drafted_teams_points: 0,
      drafted_players_points: 0,
      rank_delta: null,
    };
  });
  const rankedRows = rankLeaderboardRows(rows);

  return {
    group_slug: groupSlug,
    scoring_status: "group_stage_live",
    rows: rankedRows,
  };
}

async function getGroupStagePointsByManager(overview) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase || !overview?.id) return new Map();

  const { data, error } = await supabase
    .from("predictions")
    .select(`
      pick_type,
      pick_team_id,
      managers!inner ( manager_code ),
      matches!inner (
        stage,
        external_match_id,
        status,
        team_a_id,
        team_b_id,
        team_a_score,
        team_b_score,
        winner_team_id,
        team_a:team_a_id ( fifa_code ),
        team_b:team_b_id ( fifa_code )
      )
    `)
    .eq("group_id", overview.id)
    .eq("status", "active");

  if (error) throw new Error(error.message);
  const fifaMatchesById = await getFifaMatchesByIdSafe();

  return (data || []).reduce((totals, prediction) => {
    const match = overlayMatchResult(prediction.matches, fifaMatchesById);
    const managerCode = prediction.managers?.manager_code;
    if (!managerCode || !isGroupStage(match?.stage)) return totals;

    const result = getGroupStageResult(match);
    if (!result) return totals;

    const points = scoreGroupStagePick({
      pickType: prediction.pick_type === "tie" ? "tie" : "team",
      pickedTeamId: prediction.pick_team_id,
      result,
    });

    totals.set(managerCode, (totals.get(managerCode) || 0) + points);
    return totals;
  }, new Map());
}

function getGroupStageResult(match) {
  if (!match || match.status !== "finished") return null;
  const teamAScore = numberOrNull(match.team_a_score);
  const teamBScore = numberOrNull(match.team_b_score);

  if (teamAScore !== null && teamBScore !== null) {
    if (teamAScore === teamBScore) {
      return {
        status: "finished",
        winnerType: "tie",
        winnerTeamId: null,
      };
    }

    return {
      status: "finished",
      winnerType: "team",
      winnerTeamId: teamAScore > teamBScore ? match.team_a_id : match.team_b_id,
    };
  }

  if (match.winner_team_id) {
    return {
      status: "finished",
      winnerType: "team",
      winnerTeamId: match.winner_team_id,
    };
  }

  return null;
}

function rankLeaderboardRows(rows) {
  const sorted = [...rows].sort((a, b) => {
    const pointDiff = Number(b.total_points || 0) - Number(a.total_points || 0);
    if (pointDiff) return pointDiff;
    return a.manager_name.localeCompare(b.manager_name);
  });

  let previousPoints = null;
  let previousRank = 0;
  return sorted.map((row, index) => {
    const points = Number(row.total_points || 0);
    const rank = points === previousPoints ? previousRank : index + 1;
    previousPoints = points;
    previousRank = rank;
    return { ...row, rank };
  });
}

function isGroupStage(stage) {
  return String(stage || "").toLowerCase().includes("group");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

async function appendPredictionAudit({
  supabase,
  predictionId,
  groupId,
  managerId,
  matchId,
  oldPickType,
  oldPickTeamId,
  newPickType,
  newPickTeamId,
}) {
  if (oldPickType === newPickType && oldPickTeamId === newPickTeamId) return;

  const { error } = await supabase
    .from("prediction_audit")
    .insert({
      prediction_id: predictionId,
      group_id: groupId,
      manager_id: managerId,
      match_id: matchId,
      old_pick_type: oldPickType,
      old_pick_team_id: oldPickTeamId,
      new_pick_type: newPickType,
      new_pick_team_id: newPickTeamId,
      reason: "manager_update",
    });
  if (error) throw new Error(error.message);
}

function getOptionalSupabaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createSupabaseServerClient();
}

async function readSeedJson(fileName) {
  const text = await fs.readFile(path.join(SEED_DIR, fileName), "utf8");
  return JSON.parse(text);
}

function normalizeSupabaseMatches(rows) {
  return rows
    .map((row) => row.matches)
    .filter(Boolean)
    .filter((match) => new Date(match.kickoff_at).getTime() >= Date.now())
    .sort(sortByKickoffAsc)
    .slice(0, UPCOMING_MATCH_LIMIT);
}

function normalizePulseMatches(rows, limit) {
  return rows
    .map((row) => row.matches)
    .filter(Boolean)
    .sort(sortByKickoffAsc)
    .slice(0, limit);
}

function normalizeRecentResults(rows, limit, fifaMatchesById = new Map()) {
  return rows
    .map((row) => row.matches)
    .filter(Boolean)
    .map((match) => overlayMatchResult(match, fifaMatchesById))
    .filter((match) => match.status === "finished")
    .sort(sortByKickoffDesc)
    .slice(0, limit);
}

function sortByKickoffAsc(a, b) {
  return new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime();
}

function sortByKickoffDesc(a, b) {
  return new Date(b.kickoff_at).getTime() - new Date(a.kickoff_at).getTime();
}

function overlayMatchResult(match, fifaMatchesById = new Map()) {
  if (!match?.external_match_id) return match;
  const fifaMatch = fifaMatchesById.get(String(match.external_match_id));
  if (!fifaMatch) return match;

  const teamAWinner = fifaMatch.winner_code
    && fifaMatch.winner_code === match.team_a?.fifa_code;
  const teamBWinner = fifaMatch.winner_code
    && fifaMatch.winner_code === match.team_b?.fifa_code;

  return {
    ...match,
    status: fifaMatch.status || match.status,
    team_a_score: fifaMatch.team_a_score ?? match.team_a_score ?? null,
    team_b_score: fifaMatch.team_b_score ?? match.team_b_score ?? null,
    winner_team_id: teamAWinner
      ? match.team_a?.id || match.team_a_id || match.winner_team_id || null
      : teamBWinner
        ? match.team_b?.id || match.team_b_id || match.winner_team_id || null
        : match.winner_team_id ?? null,
  };
}

async function getFifaMatchesByIdSafe() {
  try {
    return await getFifaMatchesById();
  } catch {
    return new Map();
  }
}

function formatPickLabel(pick) {
  if (!pick) return null;
  if (pick.pick_type === "tie") return "Tie";
  return pick.pick_team_name || null;
}

function shouldRevealPulse({ kickoffAt, lockMinutesBeforeKickoff }) {
  return Date.now() >= new Date(deadlineFor(kickoffAt, lockMinutesBeforeKickoff)).getTime();
}

function deadlineFor(kickoffAt, lockMinutesBeforeKickoff) {
  const kickoff = new Date(kickoffAt).getTime();
  const lockMs = Number(lockMinutesBeforeKickoff || 60) * 60 * 1000;
  return new Date(kickoff - lockMs).toISOString();
}
