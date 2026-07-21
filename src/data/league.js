import fs from "node:fs/promises";
import path from "node:path";

import { getFifaMatchesById } from "@/integrations/fifa-api";
import {
  LOCKED_FUTURE_DEADLINE_AT,
  LOCKED_FUTURE_STAGE,
  buildDefaultLockedFutureCategories,
  isLockedFuturePickDeadlinePassed,
  requiresLockedFuturePicksForStage,
  validateLockedFutureSelections,
} from "@/rules/future-picks";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLockMinutesBeforeKickoff, validatePickForMatch } from "@/rules/predictions";
import { PARLAY_FIXTURES } from "@/rules/parlay";
import {
  scoreDraftedPlayer,
  scoreDraftedTeam,
  scoreFirstScoreRisk,
  scoreGroupStagePick,
  scoreKnockoutLengthRisk,
  scoreKnockoutWinnerPick,
  scoreLockedFuturePick,
  scoreParlaySlip,
  totalLeaderboardPoints,
} from "@/rules/scoring";

const SEED_DIR = path.join(process.cwd(), "supabase", "seed-data");
const PULSE_RECENT_LIMIT = 6;
const UPCOMING_MATCH_LIMIT = 16;
const MISSING_PICK_WARNING_HOURS = 12;

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

    const { data: completionFlag, error: completionFlagError } = await supabase
      .from("groups")
      .select("tournament_complete")
      .eq("id", group.id)
      .maybeSingle();
    if (completionFlagError && !isMissingColumnError(completionFlagError, "tournament_complete")) {
      throw new Error(completionFlagError.message);
    }

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
              id,
              external_match_id,
              stage,
              group_label,
              kickoff_at,
              status,
              team_a_id,
              team_b_id,
              team_a:team_a_id ( id, fifa_code, name ),
              team_b:team_b_id ( id, fifa_code, name )
            )
          `)
          .eq("group_id", group.id)
          .limit(120),
      ]);

    if (managersError) throw new Error(managersError.message);
    if (matchError) throw new Error(matchError.message);

    const fifaMatchesById = await getFifaMatchesByIdSafe();

    const upcomingMatches = normalizeSupabaseMatches(matches || [], fifaMatchesById);
    await attachMatchPointValues({ supabase, matches: upcomingMatches });

    return {
      ...group,
      managers: managers || [],
      manager_count: managers?.length || 0,
      upcoming_matches: upcomingMatches,
      tournament_complete: Boolean(completionFlag?.tournament_complete),
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
  const fifaMatchesById = await getFifaMatchesByIdSafe();
  const now = Date.now();
  const upcomingMatches = matches
    .map((match) => ({
      external_match_id: match.external_match_id,
      stage: match.stage,
      group_label: match.group_label,
      kickoff_at: match.kickoff_at,
      status: match.status,
      team_a: teamByCode.get(match.team_a_code) || null,
      team_b: teamByCode.get(match.team_b_code) || null,
    }))
    .map((match) => overlayMatchResult(match, fifaMatchesById))
    .filter((match) => new Date(match.kickoff_at).getTime() >= now)
    .sort(sortByKickoffAsc)
    .slice(0, UPCOMING_MATCH_LIMIT);

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
    const fifaMatchesById = await getFifaMatchesByIdSafe();
    const match = overlayMatchResult(data.matches, fifaMatchesById);
    return {
      ...match,
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
  const fifaMatchesById = await getFifaMatchesByIdSafe();
  const overlaidMatch = overlayMatchResult({
    ...match,
    team_a: teamByCode.get(match.team_a_code) || null,
    team_b: teamByCode.get(match.team_b_code) || null,
  }, fifaMatchesById);

  return {
    ...overlaidMatch,
    team_a: teamByCode.get(match.team_a_code) || null,
    team_b: teamByCode.get(match.team_b_code) || null,
    lock_minutes_before_kickoff: group.lock_minutes_before_kickoff,
    data_mode: "seed",
  };
}

export async function savePrediction({
  groupSlug,
  managerCode,
  externalMatchId,
  pickType,
  lengthPick = null,
  firstScorePick = null,
}) {
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
        stage,
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
  const firstScorePickTeamId = firstScorePick === "team_a"
    ? groupMatch.matches.team_a_id
    : firstScorePick === "team_b"
      ? groupMatch.matches.team_b_id
      : null;

  const savedAt = new Date().toISOString();
  const firstScorePickValue = isGroupStage(groupMatch.matches.stage) ? null : firstScorePickTeamId;
  const predictionRow = {
    group_id: groupMatch.group_id,
    manager_id: manager.id,
    match_id: groupMatch.match_id,
    pick_type: pickType,
    pick_team_id: pickTeamId,
    length_pick: isGroupStage(groupMatch.matches.stage) ? null : lengthPick,
    first_score_pick_team_id: firstScorePickValue,
    status: "active",
    updated_at: savedAt,
  };
  let lengthPickColumnMissing = false;
  let firstScorePickColumnMissing = false;

  let { data: existing, error: existingError } = await supabase
    .from("predictions")
    .select("id,pick_type,pick_team_id,length_pick,first_score_pick_team_id")
    .eq("group_id", groupMatch.group_id)
    .eq("manager_id", manager.id)
    .eq("match_id", groupMatch.match_id)
    .eq("status", "active")
    .maybeSingle();

  if (isMissingColumnError(existingError, "length_pick") || isMissingColumnError(existingError, "first_score_pick_team_id")) {
    lengthPickColumnMissing = isMissingColumnError(existingError, "length_pick");
    firstScorePickColumnMissing = isMissingColumnError(existingError, "first_score_pick_team_id");
    const fallback = await supabase
      .from("predictions")
      .select(lengthPickColumnMissing ? "id,pick_type,pick_team_id" : "id,pick_type,pick_team_id,length_pick")
      .eq("group_id", groupMatch.group_id)
      .eq("manager_id", manager.id)
      .eq("match_id", groupMatch.match_id)
      .eq("status", "active")
      .maybeSingle();
    existing = fallback.data
      ? {
          ...fallback.data,
          length_pick: fallback.data.length_pick || null,
          first_score_pick_team_id: null,
        }
      : null;
    existingError = fallback.error;
  }

  if (existingError) throw new Error(existingError.message);

  if (existing) {
    let { error: updateError } = await supabase
      .from("predictions")
      .update(predictionRow)
      .eq("id", existing.id);
    if (isMissingColumnError(updateError, "length_pick")) {
      lengthPickColumnMissing = true;
      const fallback = await supabase
        .from("predictions")
        .update(stripUnsupportedPredictionColumns(predictionRow, {
          lengthPickColumnMissing,
          firstScorePickColumnMissing,
        }))
        .eq("id", existing.id);
      updateError = fallback.error;
    }
    if (isMissingColumnError(updateError, "first_score_pick_team_id")) {
      firstScorePickColumnMissing = true;
      const fallback = await supabase
        .from("predictions")
        .update(stripUnsupportedPredictionColumns(predictionRow, {
          lengthPickColumnMissing,
          firstScorePickColumnMissing,
        }))
        .eq("id", existing.id);
      updateError = fallback.error;
    }
    if (updateError) throw new Error(updateError.message);
    await appendPredictionAudit({
      supabase,
      predictionId: existing.id,
      groupId: groupMatch.group_id,
      managerId: manager.id,
      matchId: groupMatch.match_id,
      oldPickType: existing.pick_type,
      oldPickTeamId: existing.pick_team_id,
      oldLengthPick: existing.length_pick,
      oldFirstScorePickTeamId: existing.first_score_pick_team_id,
      newPickType: pickType,
      newPickTeamId: pickTeamId,
      newLengthPick: predictionRow.length_pick,
      newFirstScorePickTeamId: predictionRow.first_score_pick_team_id,
      reason: "manager_update",
    });
    return {
      ok: true,
      saved_at: savedAt,
      length_pick_saved: Boolean(predictionRow.length_pick) ? !lengthPickColumnMissing : true,
      first_score_pick_saved: Boolean(predictionRow.first_score_pick_team_id) ? !firstScorePickColumnMissing : true,
    };
  }

  let { error: insertError } = await supabase
    .from("predictions")
    .insert(predictionRow);
  if (isMissingColumnError(insertError, "length_pick")) {
    lengthPickColumnMissing = true;
    const fallback = await supabase
      .from("predictions")
      .insert(stripUnsupportedPredictionColumns(predictionRow, {
        lengthPickColumnMissing,
        firstScorePickColumnMissing,
      }));
    insertError = fallback.error;
  }
  if (isMissingColumnError(insertError, "first_score_pick_team_id")) {
    firstScorePickColumnMissing = true;
    const fallback = await supabase
      .from("predictions")
      .insert(stripUnsupportedPredictionColumns(predictionRow, {
        lengthPickColumnMissing,
        firstScorePickColumnMissing,
      }));
    insertError = fallback.error;
  }

  if (insertError) throw new Error(insertError.message);
  return {
    ok: true,
    saved_at: savedAt,
    length_pick_saved: Boolean(predictionRow.length_pick) ? !lengthPickColumnMissing : true,
    first_score_pick_saved: Boolean(predictionRow.first_score_pick_team_id) ? !firstScorePickColumnMissing : true,
  };
}

export async function getCommissionerCorrectionContext({ groupSlug }) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) {
    throw new Error("Commissioner corrections require Supabase.");
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id,slug,name")
    .eq("slug", groupSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (groupError) throw new Error(groupError.message);
  if (!group) return null;

  const [
    { data: managers, error: managersError },
    { data: matchRows, error: matchesError },
    { data: activePicks, error: picksError },
  ] =
    await Promise.all([
      supabase
        .from("managers")
        .select("manager_code,display_name,role")
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
        .limit(200),
      supabase
        .from("active_prediction_details")
        .select("manager_code,external_match_id,pick_type,pick_team_name,updated_at")
        .eq("group_slug", groupSlug),
    ]);

  if (managersError) throw new Error(managersError.message);
  if (matchesError) throw new Error(matchesError.message);
  if (picksError) throw new Error(picksError.message);

  const matches = (matchRows || [])
    .map((row) => row.matches)
    .filter(Boolean)
    .filter((match) => match.team_a && match.team_b)
    .sort(sortByKickoffDesc)
    .map((match) => ({
      external_match_id: match.external_match_id,
      stage: match.stage,
      group_label: match.group_label,
      kickoff_at: match.kickoff_at,
      status: match.status,
      team_a: match.team_a,
      team_b: match.team_b,
    }));

  return {
    group,
    managers: managers || [],
    matches,
    active_picks: (activePicks || []).map((pick) => ({
      manager_code: pick.manager_code,
      external_match_id: pick.external_match_id,
      pick_type: pick.pick_type,
      pick_label: formatPickLabel(pick),
      updated_at: pick.updated_at,
    })),
  };
}

export async function getCommissionerAuditLog({ groupSlug, limit = 25 }) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) {
    throw new Error("Commissioner audit requires Supabase.");
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id,slug,name")
    .eq("slug", groupSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (groupError) throw new Error(groupError.message);
  if (!group) return null;

  const { data, error } = await supabase
    .from("prediction_audit")
    .select(`
      id,
      changed_at,
      reason,
      old_pick_type,
      new_pick_type,
      manager:manager_id ( manager_code, display_name ),
      changed_by_manager:changed_by ( manager_code, display_name ),
      matches (
        external_match_id,
        stage,
        group_label,
        kickoff_at,
        team_a:team_a_id ( fifa_code, name ),
        team_b:team_b_id ( fifa_code, name )
      ),
      old_pick_team:old_pick_team_id ( fifa_code, name ),
      new_pick_team:new_pick_team_id ( fifa_code, name )
    `)
    .eq("group_id", group.id)
    .order("changed_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return {
    group,
    audit: (data || []).map((row) => ({
      id: row.id,
      changed_at: row.changed_at,
      reason: row.reason || "",
      manager: row.manager,
      changed_by: row.changed_by_manager,
      match: row.matches,
      old_pick_label: formatAuditPickLabel({
        pickType: row.old_pick_type,
        pickTeam: row.old_pick_team,
      }),
      new_pick_label: formatAuditPickLabel({
        pickType: row.new_pick_type,
        pickTeam: row.new_pick_team,
      }),
    })),
  };
}

export async function applyCommissionerPredictionCorrection({
  groupSlug,
  commissionerCode,
  managerCode,
  externalMatchId,
  pickType,
  reason,
}) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) {
    throw new Error("Commissioner corrections require Supabase.");
  }

  const cleanReason = String(reason || "").trim();
  if (cleanReason.length < 6) {
    throw new Error("A correction reason is required.");
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id,slug")
    .eq("slug", groupSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (groupError) throw new Error(groupError.message);
  if (!group) throw new Error("Group not found");

  const { data: commissioner, error: commissionerError } = await supabase
    .from("managers")
    .select("id,manager_code,display_name,role")
    .eq("group_id", group.id)
    .eq("manager_code", commissionerCode)
    .eq("is_active", true)
    .maybeSingle();

  if (commissionerError) throw new Error(commissionerError.message);
  if (!commissioner || commissioner.role !== "commissioner") {
    throw new Error("Commissioner access required");
  }

  const { data: manager, error: managerError } = await supabase
    .from("managers")
    .select("id,manager_code,display_name")
    .eq("group_id", group.id)
    .eq("manager_code", managerCode)
    .eq("is_active", true)
    .maybeSingle();

  if (managerError) throw new Error(managerError.message);
  if (!manager) throw new Error("Manager not found");

  const { data: groupMatch, error: matchError } = await supabase
    .from("group_matches")
    .select(`
      group_id,
      match_id,
      matches!inner (
        id,
        external_match_id,
        stage,
        team_a_id,
        team_b_id,
        team_a:team_a_id ( id, fifa_code, name ),
        team_b:team_b_id ( id, fifa_code, name )
      )
    `)
    .eq("group_id", group.id)
    .eq("matches.external_match_id", externalMatchId)
    .maybeSingle();

  if (matchError) throw new Error(matchError.message);
  if (!groupMatch?.matches) throw new Error("Match not found");

  const match = groupMatch.matches;
  const validation = validatePickForMatch({ pickType, match });
  if (!validation.ok) throw new Error(validation.message);

  const pickTeamId = pickType === "team_a"
    ? match.team_a_id
    : pickType === "team_b"
      ? match.team_b_id
      : null;

  const { data: existing, error: existingError } = await supabase
    .from("predictions")
    .select("id,pick_type,pick_team_id")
    .eq("group_id", group.id)
    .eq("manager_id", manager.id)
    .eq("match_id", match.id)
    .eq("status", "active")
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  const savedAt = new Date().toISOString();
  const predictionRow = {
    group_id: group.id,
    manager_id: manager.id,
    match_id: match.id,
    pick_type: pickType,
    pick_team_id: pickTeamId,
    status: "active",
    updated_at: savedAt,
  };

  const previous = existing
    ? {
        oldPickType: existing.pick_type,
        oldPickTeamId: existing.pick_team_id,
      }
    : {
        oldPickType: null,
        oldPickTeamId: null,
      };

  if (existing?.pick_type === pickType && existing?.pick_team_id === pickTeamId) {
    return {
      ok: true,
      changed: false,
      saved_at: savedAt,
      manager,
      match,
      pick_label: formatPickLabel({ pick_type: pickType, pick_team_name: pickNameForMatch({ match, pickType }) }),
    };
  }

  let predictionId = existing?.id;
  if (existing) {
    const { error: updateError } = await supabase
      .from("predictions")
      .update(predictionRow)
      .eq("id", existing.id);
    if (updateError) throw new Error(updateError.message);
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("predictions")
      .insert(predictionRow)
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);
    predictionId = inserted.id;
  }

  await appendPredictionAudit({
    supabase,
    predictionId,
    groupId: group.id,
    managerId: manager.id,
    matchId: match.id,
    oldPickType: previous.oldPickType,
    oldPickTeamId: previous.oldPickTeamId,
    newPickType: pickType,
    newPickTeamId: pickTeamId,
    changedBy: commissioner.id,
    reason: `commissioner_correction: ${cleanReason}`,
  });

  return {
    ok: true,
    changed: true,
    saved_at: savedAt,
    manager,
    match,
    pick_label: formatPickLabel({ pick_type: pickType, pick_team_name: pickNameForMatch({ match, pickType }) }),
  };
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

export async function getGroupComments({ groupSlug, limit = 30 }) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) return [];

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id")
    .eq("slug", groupSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (groupError) throw new Error(groupError.message);
  if (!group) return [];

  const { data, error } = await supabase
    .from("group_comments")
    .select("id,body,created_at")
    .eq("group_id", group.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new Error(error.message);
  }

  return (data || []).map((row, index) => ({
    id: row.id,
    body: row.body,
    created_at: row.created_at,
    anonymous_label: `Anonymous ${index + 1}`,
  }));
}

export async function saveGroupComment({ groupSlug, managerCode, body }) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) {
    throw new Error("Comments require Supabase.");
  }

  const cleanBody = String(body || "").replace(/\s+/g, " ").trim();
  if (!cleanBody) throw new Error("Comment is required.");
  if (cleanBody.length > 30) throw new Error("Comment must be 30 characters or less.");

  const { data: manager, error: managerError } = await supabase
    .from("managers")
    .select("id,group_id,groups!inner(slug,is_active)")
    .eq("groups.slug", groupSlug)
    .eq("groups.is_active", true)
    .eq("manager_code", managerCode)
    .eq("is_active", true)
    .maybeSingle();

  if (managerError) throw new Error(managerError.message);
  if (!manager) throw new Error("Manager not found.");

  const { data, error } = await supabase
    .from("group_comments")
    .insert({
      group_id: manager.group_id,
      manager_id: manager.id,
      body: cleanBody,
      status: "active",
    })
    .select("id,body,created_at")
    .single();

  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error("Comments table is not set up yet.");
    }
    throw new Error(error.message);
  }

  return {
    id: data.id,
    body: data.body,
    created_at: data.created_at,
    anonymous_label: "Anonymous",
  };
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

export async function getGroupMatchesForPulse({ groupSlug, limit = 200 }) {
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
          first_score_team_id,
          team_a_id,
          team_b_id,
          team_a:team_a_id ( id, fifa_code, name ),
          team_b:team_b_id ( id, fifa_code, name )
        )
      `)
      .eq("group_id", group.id)
      .limit(200);

    if (error) {
      if (isMissingColumnError(error, "first_score_team_id")) {
        const fallback = await supabase
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
              team_a_id,
              team_b_id,
              team_a:team_a_id ( id, fifa_code, name ),
              team_b:team_b_id ( id, fifa_code, name )
            )
          `)
          .eq("group_id", group.id)
          .limit(200);
        if (fallback.error) throw new Error(fallback.error.message);
        const fifaMatchesById = await getFifaMatchesByIdSafe();
        return normalizePulseMatches(fallback.data || [], limit, fifaMatchesById);
      }
      throw new Error(error.message);
    }
    const fifaMatchesById = await getFifaMatchesByIdSafe();
    return normalizePulseMatches(data || [], limit, fifaMatchesById);
  }

  const [matches, teams] = await Promise.all([
    readSeedJson("matches.json"),
    readSeedJson("teams.json"),
  ]);
  const teamByCode = new Map(teams.map((team) => [team.fifa_code, team]));

  const fifaMatchesById = await getFifaMatchesByIdSafe();
  return matches
    .map((match) => ({
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
    }))
    .map((match) => overlayMatchResult(match, fifaMatchesById))
    .sort(sortByKickoffAsc)
    .slice(0, limit);
}

export async function getManagerPredictionState({ groupSlug, managerCode }) {
  const overview = await getGroupOverview(groupSlug);
  if (!overview) return null;

  const openMatches = overview.upcoming_matches;
  const picks = await getManagerPickPreview({ groupSlug, managerCode });
  const pickByMatch = new Map(picks.map((pick) => [pick.external_match_id, pick]));

  const [lockedPicks, parlaySlips] = await Promise.all([
    getLockedFuturePickState({ groupSlug, managerCode }),
    getParlaySlipState({ groupSlug, managerCode }),
  ]);

  return {
    group_slug: groupSlug,
    manager_code: managerCode,
    locked_picks: lockedPicks,
    parlay_slips: parlaySlips,
    matches: openMatches.map((match) => {
      const pick = pickByMatch.get(match.external_match_id) || null;
      return {
        id: match.id,
        external_match_id: match.external_match_id,
        stage: match.stage,
        group_label: match.group_label,
        kickoff_at: match.kickoff_at,
        status: match.status,
        team_a: match.team_a,
        team_b: match.team_b,
        pick_type: pick?.pick_type || null,
        length_pick: pick?.length_pick || null,
        first_score_pick: getFirstScorePickType({
          firstScorePickTeamId: pick?.first_score_pick_team_id,
          match,
        }),
        pick_label: formatPickLabel(pick),
        risk_label: formatRiskPickLabel(pick?.length_pick),
        first_score_risk_label: formatFirstScoreRiskPickLabel({
          firstScorePickTeamId: pick?.first_score_pick_team_id,
          match,
        }),
        picked_at: pick?.updated_at || null,
        is_missing: !pick,
      };
    }),
  };
}

export async function getLockedFuturePickState({ groupSlug, managerCode, stage = LOCKED_FUTURE_STAGE }) {
  const supabase = getOptionalSupabaseClient();
  const defaultCategories = buildDefaultLockedFutureCategories();
  if (!supabase) {
    return buildLockedFuturePickState({ stage, categories: defaultCategories, savedRows: [] });
  }

  const categories = await getLockedFutureCategories({ supabase, stage });
  const { data: rows, error } = await supabase
    .from("future_predictions")
    .select(`
      category,
      updated_at,
      future_pick_options!inner (
        id,
        option_key,
        label,
        points,
        option_kind,
        team_id,
        teams ( fifa_code, name )
      ),
      groups!inner ( slug ),
      managers!inner ( manager_code )
    `)
    .eq("groups.slug", groupSlug)
    .eq("managers.manager_code", managerCode)
    .eq("stage", stage)
    .eq("status", "active");

  if (error) {
    if (isMissingRelationError(error)) {
      return buildLockedFuturePickState({ stage, categories, savedRows: [] });
    }
    throw new Error(error.message);
  }

  return buildLockedFuturePickState({ stage, categories, savedRows: rows || [] });
}

export async function getLockedFuturePickView({ groupSlug, stage = LOCKED_FUTURE_STAGE }) {
  const supabase = getOptionalSupabaseClient();
  const defaultCategories = buildDefaultLockedFutureCategories();
  if (!supabase) {
    return buildLockedFuturePickViewState({ groupSlug, stage, categories: defaultCategories, savedRows: [] });
  }

  const overview = await getGroupOverview(groupSlug);
  if (!overview?.id) return null;

  const categories = await getLockedFutureCategories({ supabase, stage });
  const { data: rows, error } = await supabase
    .from("future_predictions")
    .select(`
      category,
      managers!inner ( manager_code, display_name ),
      future_pick_options!inner (
        id,
        option_key,
        label,
        points,
        option_kind,
        team_id,
        teams ( fifa_code, name )
      )
    `)
    .eq("group_id", overview.id)
    .eq("stage", stage)
    .eq("status", "active");

  if (error) {
    if (isMissingRelationError(error)) {
      return buildLockedFuturePickViewState({ groupSlug, stage, categories, savedRows: [] });
    }
    throw new Error(error.message);
  }

  return buildLockedFuturePickViewState({ groupSlug, stage, categories, savedRows: rows || [] });
}

export async function hasCompletedLockedFuturePicks({ groupSlug, managerCode, stage = LOCKED_FUTURE_STAGE }) {
  const state = await getLockedFuturePickState({ groupSlug, managerCode, stage });
  return Boolean(state?.is_complete);
}

export async function saveLockedFuturePicks({ groupSlug, managerCode, selections, stage = LOCKED_FUTURE_STAGE }) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) {
    throw new Error("Seed mode is read-only. Configure Supabase before saving locked picks.");
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id,slug")
    .eq("slug", groupSlug)
    .eq("is_active", true)
    .maybeSingle();
  if (groupError) throw new Error(groupError.message);
  if (!group) throw new Error("Group not found");

  const { data: manager, error: managerError } = await supabase
    .from("managers")
    .select("id,manager_code,display_name")
    .eq("group_id", group.id)
    .eq("manager_code", managerCode)
    .eq("is_active", true)
    .maybeSingle();
  if (managerError) throw new Error(managerError.message);
  if (!manager) throw new Error("Manager not found");

  if (isLockedFuturePickDeadlinePassed()) {
    throw new Error("Semi-Final Locked Picks deadline passed");
  }

  const categories = await getLockedFutureCategories({ supabase, stage });
  const validation = validateLockedFutureSelections(selections, categories);
  if (!validation.ok) throw new Error(validation.message);

  const savedAt = new Date().toISOString();
  const rows = Object.entries(validation.cleaned).map(([category, option]) => ({
    group_id: group.id,
    manager_id: manager.id,
    stage,
    category,
    option_id: option.id,
    status: "active",
    updated_at: savedAt,
  }));

  const { error } = await supabase
    .from("future_predictions")
    .upsert(rows, { onConflict: "group_id,manager_id,stage,category" });

  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error("Locked picks table is not ready. Apply migration 0010_semifinal_future_picks.sql in Supabase first.");
    }
    throw new Error(error.message);
  }

  return getLockedFuturePickState({ groupSlug, managerCode, stage });
}

export async function getParlaySlipState({ groupSlug, managerCode = null } = {}) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) return { group_slug: groupSlug, matches: [] };

  const overview = await getGroupOverview(groupSlug);
  if (!overview?.id) return null;

  const [matchRows, manager] = await Promise.all([
    getParlayGroupMatchRows({ supabase, groupId: overview.id }),
    managerCode ? getManagerForGroup({ supabase, groupId: overview.id, managerCode }) : null,
  ]);
  if (managerCode && !manager) throw new Error("Manager not found");

  const matchIds = matchRows.map((row) => row.matches?.id).filter(Boolean);
  if (!matchIds.length) return { group_slug: groupSlug, matches: [] };

  const { data: markets, error: marketError } = await supabase
    .from("parlay_markets")
    .select(`
      id,
      match_id,
      stage,
      market_key,
      label,
      market_type,
      line,
      points,
      display_order,
      parlay_options (
        id,
        option_key,
        label,
        odds,
        points,
        is_correct,
        sort_order
      )
    `)
    .in("match_id", matchIds)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (marketError) {
    if (isMissingRelationError(marketError)) return { group_slug: groupSlug, matches: [] };
    throw new Error(marketError.message);
  }

  let savedRows = [];
  if (manager?.id) {
    const { data: predictions, error: predictionError } = await supabase
      .from("parlay_predictions")
      .select("match_id,market_id,option_id,predicted_team_a_score,predicted_team_b_score,updated_at")
      .eq("group_id", overview.id)
      .eq("manager_id", manager.id)
      .eq("status", "active");
    if (predictionError) {
      if (!isMissingRelationError(predictionError)) throw new Error(predictionError.message);
    } else {
      savedRows = predictions || [];
    }
  }

  return buildParlaySlipState({
    groupSlug,
    lockMinutesBeforeKickoff: overview.lock_minutes_before_kickoff,
    matchRows,
    markets: markets || [],
    savedRows,
  });
}

export async function saveParlaySlip({ groupSlug, managerCode, externalMatchId, selections }) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) throw new Error("Seed mode is read-only. Configure Supabase before saving parlay slips.");

  const overview = await getGroupOverview(groupSlug);
  if (!overview?.id) throw new Error("Group not found");

  const [manager, matchRows] = await Promise.all([
    getManagerForGroup({ supabase, groupId: overview.id, managerCode }),
    getParlayGroupMatchRows({ supabase, groupId: overview.id }),
  ]);
  if (!manager) throw new Error("Manager not found");

  const matchRow = matchRows.find((row) => String(row.matches?.external_match_id) === String(externalMatchId));
  const match = matchRow?.matches;
  if (!match) throw new Error("Parlay match not found");
  if (match.status === "finished" || match.status === "cancelled") throw new Error("Parlay slip is closed");
  if (Date.now() >= new Date(deadlineFor(match.kickoff_at, overview.lock_minutes_before_kickoff, match.stage)).getTime()) {
    throw new Error("Deadline passed");
  }

  const { data: markets, error: marketError } = await supabase
    .from("parlay_markets")
    .select("id,match_id,market_key,label,market_type,parlay_options(id,option_key,label)")
    .eq("match_id", match.id)
    .eq("is_active", true);
  if (marketError) {
    if (isMissingRelationError(marketError)) {
      throw new Error("Parlay tables are not ready. Apply migration 0012_final_parlay_slips.sql in Supabase first.");
    }
    throw new Error(marketError.message);
  }

  const cleanSelections = selections && typeof selections === "object" ? selections : {};
  const rows = [];
  for (const market of markets || []) {
    const selectedValue = cleanSelections[market.market_key];
    const exactScore = market.market_type === "exact_score"
      ? cleanExactScoreSelection(selectedValue)
      : null;
    const selectedOptionKey = market.market_type === "exact_score" ? "" : String(selectedValue || "").trim();
    const option = market.market_type === "exact_score"
      ? null
      : (market.parlay_options || []).find((item) => item.option_key === selectedOptionKey || item.id === selectedOptionKey);
    if (market.market_type === "exact_score" && !exactScore) throw new Error(`Enter ${market.label}`);
    if (market.market_type !== "exact_score" && !selectedOptionKey) throw new Error(`Select ${market.label}`);
    if (market.market_type !== "exact_score" && !option) throw new Error(`Invalid selection for ${market.label}`);
    rows.push({
      group_id: overview.id,
      manager_id: manager.id,
      match_id: match.id,
      market_id: market.id,
      option_id: option?.id || null,
      predicted_team_a_score: exactScore?.teamAScore ?? null,
      predicted_team_b_score: exactScore?.teamBScore ?? null,
      status: "active",
      updated_at: new Date().toISOString(),
    });
  }

  if (!rows.length) throw new Error("No parlay markets available for this match");

  const { error } = await supabase
    .from("parlay_predictions")
    .upsert(rows, { onConflict: "group_id,manager_id,match_id,market_id" });
  if (error) throw new Error(error.message);

  return getParlaySlipState({ groupSlug, managerCode });
}

async function getParlayGroupMatchRows({ supabase, groupId }) {
  const externalIds = PARLAY_FIXTURES.map((fixture) => fixture.external_match_id);
  const { data, error } = await supabase
    .from("group_matches")
    .select(`
      match_id,
      matches!inner (
        id,
        external_match_id,
        stage,
        group_label,
        kickoff_at,
        status,
        team_a_score,
        team_b_score,
        winner_team_id,
        length,
        first_score_team_id,
        team_a_id,
        team_b_id,
        team_a:team_a_id ( id, fifa_code, name ),
        team_b:team_b_id ( id, fifa_code, name )
      )
    `)
    .eq("group_id", groupId)
    .in("matches.external_match_id", externalIds)
    .limit(10);

  if (error) throw new Error(error.message);
  const fifaMatchesById = await getFifaMatchesByIdSafe();
  return (data || [])
    .map((row) => ({
      ...row,
      matches: row.matches ? overlayMatchResult(row.matches, fifaMatchesById) : null,
    }))
    .filter((row) => row.matches)
    .sort((left, right) => sortByKickoffAsc(left.matches, right.matches));
}

async function getManagerForGroup({ supabase, groupId, managerCode }) {
  const { data, error } = await supabase
    .from("managers")
    .select("id,manager_code,display_name")
    .eq("group_id", groupId)
    .eq("manager_code", managerCode)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

function buildParlaySlipState({ groupSlug, lockMinutesBeforeKickoff, matchRows, markets, savedRows }) {
  const marketsByMatch = groupRowsByKey(markets || [], "match_id");
  const savedByMarket = new Map((savedRows || []).map((row) => [row.market_id, row]));

  return {
    group_slug: groupSlug,
    label: "Final / 3rd Place Slip",
    matches: (matchRows || []).map((row) => {
      const match = row.matches;
      const deadlineAt = deadlineFor(match.kickoff_at, lockMinutesBeforeKickoff, match.stage);
      const marketRows = (marketsByMatch.get(match.id) || [])
        .sort((left, right) => Number(left.display_order || 0) - Number(right.display_order || 0));
      const marketState = marketRows.map((market) => {
        const saved = savedByMarket.get(market.id);
        const options = (market.parlay_options || [])
          .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
          .map((option) => ({
            id: option.id,
            option_key: option.option_key,
            label: option.label,
            odds: option.odds ?? null,
            points: Number(option.points || 0),
            is_correct: option.is_correct,
          }));
        const selected = options.find((option) => option.id === saved?.option_id) || null;
        return {
          id: market.id,
          market_key: market.market_key,
          label: market.label,
          market_type: market.market_type,
          line: market.line,
          points: Number(market.points || 0),
          options,
          selected,
          exact_score: saved?.predicted_team_a_score !== null && saved?.predicted_team_a_score !== undefined
            && saved?.predicted_team_b_score !== null && saved?.predicted_team_b_score !== undefined
            ? {
                team_a_score: Number(saved.predicted_team_a_score),
                team_b_score: Number(saved.predicted_team_b_score),
              }
            : null,
        };
      });
      const selectedCount = marketState.filter((market) => market.selected || market.exact_score).length;
      return {
        id: match.id,
        external_match_id: match.external_match_id,
        stage: match.stage,
        kickoff_at: match.kickoff_at,
        status: match.status,
        team_a_score: match.team_a_score ?? null,
        team_b_score: match.team_b_score ?? null,
        winner_team_id: match.winner_team_id ?? null,
        length: match.length ?? null,
        first_score_team_id: match.first_score_team_id ?? null,
        deadline_at: deadlineAt,
        is_locked: Date.now() >= new Date(deadlineAt).getTime(),
        team_a: match.team_a,
        team_b: match.team_b,
        markets: marketState,
        selected_count: selectedCount,
        required_count: marketState.length,
        is_complete: marketState.length > 0 && selectedCount === marketState.length,
      };
    }).filter((match) => match.markets.length),
  };
}

async function getLockedFutureCategories({ supabase, stage = LOCKED_FUTURE_STAGE }) {
  const defaults = buildDefaultLockedFutureCategories();
  if (!supabase) return defaults;

  let { data, error } = await supabase
    .from("future_pick_options")
    .select("id,stage,category,option_kind,option_key,label,points,sort_order,team_id,is_eliminated,teams(fifa_code,name)")
    .eq("stage", stage)
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error && isMissingColumnError(error, "is_eliminated")) {
    const fallback = await supabase
      .from("future_pick_options")
      .select("id,stage,category,option_kind,option_key,label,points,sort_order,team_id,teams(fifa_code,name)")
      .eq("stage", stage)
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("sort_order", { ascending: true });
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    if (isMissingRelationError(error)) return defaults;
    throw new Error(error.message);
  }
  if (!data?.length) return defaults;

  return defaults.map((category) => ({
    ...category,
    options: data
      .filter((option) => option.category === category.key)
      .sort((left, right) => {
        const pointDiff = Number(left.points || 0) - Number(right.points || 0);
        if (pointDiff) return pointDiff;
        return String(left.label || left.option_key || "").localeCompare(String(right.label || right.option_key || ""));
      })
      .map((option) => ({
        id: option.id,
        option_key: option.option_key,
        option_kind: option.option_kind,
        team_code: option.teams?.fifa_code || null,
        label: option.label || option.teams?.name || option.option_key,
        points: Number(option.points || 0),
        sort_order: option.sort_order,
        is_eliminated: Boolean(option.is_eliminated),
      })),
  }));
}

function buildLockedFuturePickState({ stage, categories, savedRows }) {
  const savedByCategory = new Map((savedRows || []).map((row) => {
    const option = row.future_pick_options || row.option || null;
    return [row.category, {
      category: row.category,
      option_id: option?.id || null,
      option_key: option?.option_key || null,
      label: option?.label || option?.teams?.name || null,
      points: Number(option?.points || 0),
      is_eliminated: Boolean(option?.is_eliminated),
      updated_at: row.updated_at || null,
    }];
  }));
  const categoryRows = categories.map((category) => ({
    ...category,
    selected: savedByCategory.get(category.key) || null,
  }));
  const requiredKeys = new Set(categoryRows.map((category) => category.key));
  const selectedRequiredCount = [...requiredKeys].filter((key) => savedByCategory.has(key)).length;

  return {
    stage,
    label: "Semi-Final Locked Picks",
    deadline_at: LOCKED_FUTURE_DEADLINE_AT,
    is_locked: isLockedFuturePickDeadlinePassed(),
    categories: categoryRows,
    selected_count: selectedRequiredCount,
    required_count: requiredKeys.size,
    is_complete: requiredKeys.size > 0 && selectedRequiredCount === requiredKeys.size,
  };
}

function buildLockedFuturePickViewState({ groupSlug, stage, categories, savedRows }) {
  const managersByCategoryOption = new Map();
  for (const row of savedRows || []) {
    const option = row.future_pick_options || row.option || null;
    const optionKey = option?.option_key;
    const managerName = row.managers?.display_name;
    if (!row.category || !optionKey || !managerName) continue;
    const key = `${row.category}::${optionKey}`;
    if (!managersByCategoryOption.has(key)) managersByCategoryOption.set(key, []);
    managersByCategoryOption.get(key).push(managerName);
  }

  return {
    group_slug: groupSlug,
    stage,
    label: "Semi-Final Locked Picks",
    deadline_at: LOCKED_FUTURE_DEADLINE_AT,
    categories: categories.map((category) => ({
      key: category.key,
      label: category.label,
      description: category.description,
      group: category.group,
      options: (category.options || []).map((option) => ({
        option_key: option.option_key,
        option_kind: option.option_kind,
        team_code: option.team_code || null,
        label: option.label,
        points: Number(option.points || 0),
        is_eliminated: Boolean(option.is_eliminated),
        managers: (managersByCategoryOption.get(`${category.key}::${option.option_key}`) || [])
          .sort((left, right) => left.localeCompare(right))
          .join(", "),
      })),
    })),
  };
}

export async function getMissingPicksSummary({ groupSlug, warningHours = MISSING_PICK_WARNING_HOURS } = {}) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) {
    const overview = await getGroupOverview(groupSlug);
    return {
      group_slug: groupSlug,
      warning_hours: warningHours,
      match_count: 0,
      rows: (overview?.managers || []).map((manager) => ({
        manager_code: manager.manager_code,
        manager_name: manager.display_name,
        missing_count: 0,
      })),
    };
  }

  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select("id,slug,lock_minutes_before_kickoff")
    .eq("slug", groupSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (groupError) throw new Error(groupError.message);
  if (!group) return null;

  const [
    { data: managers, error: managersError },
    { data: matchRows, error: matchesError },
    { data: predictions, error: predictionsError },
  ] = await Promise.all([
    supabase
      .from("managers")
      .select("id,manager_code,display_name")
      .eq("group_id", group.id)
      .eq("is_active", true)
      .order("display_name", { ascending: true }),
    supabase
      .from("group_matches")
      .select(`
        match_id,
        matches (
          id,
          external_match_id,
          stage,
          kickoff_at,
          status,
          team_a:team_a_id ( fifa_code, name ),
          team_b:team_b_id ( fifa_code, name )
        )
      `)
      .eq("group_id", group.id)
      .limit(200),
    supabase
      .from("predictions")
      .select("manager_id,match_id")
      .eq("group_id", group.id)
      .eq("status", "active"),
  ]);

  if (managersError) throw new Error(managersError.message);
  if (matchesError) throw new Error(matchesError.message);
  if (predictionsError) throw new Error(predictionsError.message);

  const fifaMatchesById = await getFifaMatchesByIdSafe();
  const now = Date.now();
  const warningUntil = now + Number(warningHours || MISSING_PICK_WARNING_HOURS) * 60 * 60 * 1000;
  const monitoredMatches = (matchRows || [])
    .map((row) => row.matches ? overlayMatchResult({ ...row.matches, id: row.match_id }, fifaMatchesById) : null)
    .filter(Boolean)
    .filter((match) => {
      if (match.status === "finished") return false;
      const deadline = new Date(deadlineFor(match.kickoff_at, group.lock_minutes_before_kickoff, match.stage)).getTime();
      return deadline >= now && deadline <= warningUntil;
    })
    .sort(sortByKickoffAsc);

  const monitoredMatchIds = new Set(monitoredMatches.map((match) => match.id));
  const pickedByManager = new Map();
  for (const prediction of predictions || []) {
    if (!monitoredMatchIds.has(prediction.match_id)) continue;
    const managerPicks = pickedByManager.get(prediction.manager_id) || new Set();
    managerPicks.add(prediction.match_id);
    pickedByManager.set(prediction.manager_id, managerPicks);
  }

  const rows = (managers || []).map((manager) => {
    const managerPicks = pickedByManager.get(manager.id) || new Set();
    const missingMatches = monitoredMatches.filter((match) => !managerPicks.has(match.id));
    return {
      manager_code: manager.manager_code,
      manager_name: manager.display_name,
      missing_count: missingMatches.length,
    };
  });

  return {
    group_slug: group.slug,
    warning_hours: warningHours,
    match_count: monitoredMatches.length,
    next_deadline_at: monitoredMatches[0]
      ? deadlineFor(monitoredMatches[0].kickoff_at, group.lock_minutes_before_kickoff, monitoredMatches[0].stage)
      : null,
    rows,
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
        stage: match.stage,
      });
      const winnerType = getPulseWinnerType(match);
      const status = getPulseStatus(match, winnerType);

      return {
        external_match_id: match.external_match_id,
        group_label: match.group_label,
        stage: match.stage,
        team_a_id: match.team_a?.id || match.team_a_id || null,
        team_a_name: match.team_a?.name || null,
        team_a_code: match.team_a?.fifa_code || null,
        team_b_id: match.team_b?.id || match.team_b_id || null,
        team_b_name: match.team_b?.name || null,
        team_b_code: match.team_b?.fifa_code || null,
        kickoff_at: match.kickoff_at,
        status,
        team_a_score: match.team_a_score ?? null,
        team_b_score: match.team_b_score ?? null,
        winner_type: winnerType,
        length: match.length ?? null,
        first_score_team_id: match.first_score_team_id ?? null,
        reveal,
        locked_until: reveal ? null : deadlineFor(match.kickoff_at, overview.lock_minutes_before_kickoff, match.stage),
        team_a_picks: reveal ? Number(item?.team_a_picks || 0) : null,
        tie_picks: reveal ? Number(item?.tie_picks || 0) : null,
        team_b_picks: reveal ? Number(item?.team_b_picks || 0) : null,
        total_picks: reveal ? Number(item?.total_picks || 0) : null,
        team_a_managers: reveal ? item?.team_a_managers || "" : "",
        tie_managers: reveal ? item?.tie_managers || "" : "",
        team_b_managers: reveal ? item?.team_b_managers || "" : "",
        et_risk_picks: reveal ? Number(item?.et_risk_picks || 0) : null,
        pens_risk_picks: reveal ? Number(item?.pens_risk_picks || 0) : null,
        et_risk_managers: reveal ? item?.et_risk_managers || "" : "",
        pens_risk_managers: reveal ? item?.pens_risk_managers || "" : "",
        team_a_first_score_managers: reveal ? item?.team_a_first_score_managers || "" : "",
        team_b_first_score_managers: reveal ? item?.team_b_first_score_managers || "" : "",
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
  const pulseMatches = [...recentWithPicks, ...fillerMatches].sort(sortByKickoffDesc);
  const parlayPulse = await getParlayPulseState({ groupSlug, overview });

  return {
    group_slug: groupSlug,
    matches: pulseMatches,
    parlay_matches: parlayPulse?.matches || [],
  };
}

export async function getParlayPulseState({ groupSlug, overview: providedOverview = null } = {}) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase) return { group_slug: groupSlug, matches: [] };

  const overview = providedOverview || await getGroupOverview(groupSlug);
  if (!overview?.id) return null;

  const slipState = await getParlaySlipState({ groupSlug });
  const matchIds = new Set((slipState?.matches || []).map((match) => match.external_match_id));
  if (!matchIds.size) return { group_slug: groupSlug, matches: [] };

  const { data: rows, error } = await supabase
    .from("parlay_predictions")
    .select(`
      match_id,
      market_id,
      option_id,
      predicted_team_a_score,
      predicted_team_b_score,
      managers!inner ( display_name )
    `)
    .eq("group_id", overview.id)
    .eq("status", "active");
  if (error) {
    if (isMissingRelationError(error)) return { group_slug: groupSlug, matches: [] };
    throw new Error(error.message);
  }

  const managersByOption = new Map();
  const exactScoresByMarket = new Map();
  const rowsByMatch = groupRowsByKey(rows || [], "match_id");
  for (const row of rows || []) {
    if (!row.managers?.display_name) continue;
    if (row.option_id) {
      const names = managersByOption.get(row.option_id) || [];
      names.push(row.managers.display_name);
      managersByOption.set(row.option_id, names);
      continue;
    }
    if (row.predicted_team_a_score === null || row.predicted_team_a_score === undefined) continue;
    if (row.predicted_team_b_score === null || row.predicted_team_b_score === undefined) continue;
    const scoreKey = `${row.predicted_team_a_score}-${row.predicted_team_b_score}`;
    const groupedKey = `${row.market_id}::${scoreKey}`;
    const names = exactScoresByMarket.get(groupedKey) || [];
    names.push(row.managers.display_name);
    exactScoresByMarket.set(groupedKey, names);
  }

  const matches = (slipState?.matches || [])
    .filter((match) => Date.now() >= new Date(match.deadline_at).getTime())
    .map((match) => {
      const multiplierWinners = getParlayMultiplierWinners({
        match,
        markets: match.markets || [],
        rows: rowsByMatch.get(match.id) || [],
      });
      return {
        external_match_id: match.external_match_id,
        stage: match.stage,
        kickoff_at: match.kickoff_at,
        status: match.status,
        team_a_score: match.team_a_score ?? null,
        team_b_score: match.team_b_score ?? null,
        winner_team_id: match.winner_team_id ?? null,
        length: match.length ?? null,
        first_score_team_id: match.first_score_team_id ?? null,
        team_a_name: match.team_a?.name || null,
        team_a_code: match.team_a?.fifa_code || null,
        team_b_name: match.team_b?.name || null,
        team_b_code: match.team_b?.fifa_code || null,
        multiplier_winners: multiplierWinners,
        markets: (match.markets || []).map((market) => ({
        market_key: market.market_key,
        label: market.label,
        line: market.line,
        options: (market.options || []).map((option) => ({
          option_key: option.option_key,
          label: option.label,
          points: option.points,
          is_correct: option.is_correct,
          managers: (managersByOption.get(option.id) || [])
            .sort((left, right) => left.localeCompare(right))
            .join(", "),
        })),
        exact_scores: market.market_type === "exact_score"
          ? [...exactScoresByMarket.entries()]
              .filter(([key]) => key.startsWith(`${market.id}::`))
              .map(([key, managers]) => {
                const score = key.split("::").at(-1);
                return {
                  label: score,
                  points: market.points,
                  is_correct: isExactScoreCorrect({ match, score }),
                  managers: managers.sort((left, right) => left.localeCompare(right)).join(", "),
                };
              })
          : [],
      })),
      };
    })
    .filter((match) => match.markets.some((market) => {
      return market.options.some((option) => hasText(option.managers))
        || market.exact_scores?.some((score) => hasText(score.managers));
    }))
    .sort(sortByKickoffDesc);

  return {
    group_slug: groupSlug,
    matches,
  };
}


function getParlayMultiplierWinners({ match, markets, rows }) {
  if (!match || match.status !== "finished") return [];
  const requiredCount = markets.length;
  if (!requiredCount) return [];

  const marketsById = new Map(markets.map((market) => [market.id, market]));
  const rowsByManager = (rows || []).reduce((grouped, row) => {
    const managerName = row.managers?.display_name;
    if (!managerName) return grouped;
    const managerRows = grouped.get(managerName) || [];
    managerRows.push(row);
    grouped.set(managerName, managerRows);
    return grouped;
  }, new Map());

  return [...rowsByManager.entries()]
    .map(([managerName, managerRows]) => {
      if (!managerName || managerRows.length < requiredCount) return null;
      const selections = managerRows.map((row) => {
        const market = marketsById.get(row.market_id);
        if (!market) return null;
        if (market.market_type === "exact_score") {
          const score = String(row.predicted_team_a_score) + "-" + String(row.predicted_team_b_score);
          return {
            points: market.points,
            is_correct: isExactScoreCorrect({ match, score }),
          };
        }
        const option = (market.options || []).find((item) => item.id === row.option_id);
        if (!option) return null;
        return { points: option.points, is_correct: option.is_correct };
      }).filter(Boolean);
      if (selections.length < requiredCount) return null;
      if (selections.some((selection) => selection.is_correct === null || selection.is_correct === undefined)) return null;

      const wrongCount = selections.filter((selection) => !selection.is_correct).length;
      if (wrongCount === 0) return { manager_name: managerName, multiplier: "2x" };
      if (wrongCount === 1) return { manager_name: managerName, multiplier: "1.5x" };
      return null;
    })
    .filter(Boolean)
    .sort((left, right) => {
      const multiplierDiff = Number.parseFloat(right.multiplier) - Number.parseFloat(left.multiplier);
      if (multiplierDiff) return multiplierDiff;
      return left.manager_name.localeCompare(right.manager_name);
    });
}

function getPulseStatus(match, winnerType = null) {
  if (!match) return "scheduled";
  if (match.status === "finished" || winnerType) return "finished";
  return match.status;
}

function getPulseWinnerType(match) {
  if (!match || !hasFinishedResult(match)) return null;

  if (!isGroupStage(match.stage)) {
    const winnerTeamId = getKnockoutWinnerTeamId(match);
    if (winnerTeamId && winnerTeamId === (match.team_a?.id || match.team_a_id)) return "team_a";
    if (winnerTeamId && winnerTeamId === (match.team_b?.id || match.team_b_id)) return "team_b";
    return null;
  }

  const result = getGroupStageResult(match);
  if (!result) return null;
  if (result.winnerType === "tie") return "tie";
  if (result.winnerTeamId && result.winnerTeamId === (match.team_a?.id || match.team_a_id)) return "team_a";
  if (result.winnerTeamId && result.winnerTeamId === (match.team_b?.id || match.team_b_id)) return "team_b";
  return null;
}

function hasFinishedResult(match) {
  if (!match) return false;
  if (match.status === "finished") return true;
  if (match.winner_team_id) return true;
  const teamAScore = numberOrNull(match.team_a_score);
  const teamBScore = numberOrNull(match.team_b_score);
  return teamAScore !== null && teamBScore !== null;
}

export async function getLeaderboardShell({ groupSlug }) {
  const overview = await getGroupOverview(groupSlug);
  if (!overview) return null;
  const [
    predictionSummary,
    manualPointsByManager,
    draftedTeamPointsByManager,
    draftedPlayerPointsByManager,
    lockedFuturePointsByManager,
    parlayPointsByManager,
  ] = await Promise.all([
    getPredictionScoringSummary(overview),
    getManualPointsByManager(overview),
    getDraftedTeamPointsByManager(overview),
    getDraftedPlayerPointsByManager(overview),
    getLockedFuturePointsByManager(overview),
    getParlayPointsByManager(overview),
  ]);
  const rows = overview.managers.map((manager) => {
    const groupStage = predictionSummary.groupStagePointsByManager.get(manager.manager_code) || 0;
    const knockoutPredictions = predictionSummary.knockoutPointsByManager.get(manager.manager_code) || 0;
    const knockoutRisks = predictionSummary.riskPointsByManager.get(manager.manager_code) || 0;
    const previousGroupStage = predictionSummary.previousGroupStagePointsByManager.get(manager.manager_code) || 0;
    const previousKnockoutPredictions = predictionSummary.previousKnockoutPointsByManager.get(manager.manager_code) || 0;
    const previousKnockoutRisks = predictionSummary.previousRiskPointsByManager.get(manager.manager_code) || 0;
    const manualAdjustments = manualPointsByManager.get(manager.manager_code) || 0;
    const draftedTeams = draftedTeamPointsByManager.get(manager.manager_code) || 0;
    const draftedPlayers = draftedPlayerPointsByManager.get(manager.manager_code) || 0;
    const futures = lockedFuturePointsByManager.get(manager.manager_code) || 0;
    const parlays = parlayPointsByManager.get(manager.manager_code) || 0;
    const total = totalLeaderboardPoints({
      groupStage,
      knockoutPredictions,
      knockoutRisks,
      parlays,
      futures,
      draftedTeams,
      draftedPlayers,
      manualAdjustments,
    });
    const previousTotal = totalLeaderboardPoints({
      groupStage: previousGroupStage,
      knockoutPredictions: previousKnockoutPredictions,
      knockoutRisks: previousKnockoutRisks,
      parlays,
      futures,
      draftedTeams,
      draftedPlayers,
      manualAdjustments,
    });

    return {
      rank: 0,
      manager_code: manager.manager_code,
      manager_name: manager.display_name,
      total_points: total,
      group_stage_points: groupStage,
      knockout_prediction_points: knockoutPredictions,
      knockout_risk_points: knockoutRisks,
      parlay_points: parlays,
      futures_points: futures,
      drafted_teams_points: draftedTeams,
      drafted_players_points: draftedPlayers,
      manual_adjustment_points: manualAdjustments,
      previous_total_points: previousTotal,
      rank_delta: 0,
    };
  });
  const rankedRows = rankLeaderboardRows(rows);
  const previousRows = rankLeaderboardRows(rows.map((row) => ({
    ...row,
    total_points: row.previous_total_points,
  })));
  const previousRankByManager = new Map(previousRows.map((row) => [row.manager_code, row.rank]));
  const rowsWithMovement = rankedRows.map((row) => {
    const previousRank = previousRankByManager.get(row.manager_code);
    const rankDelta = predictionSummary.latestFinishedMatchId && previousRank
      ? previousRank - row.rank
      : 0;
    const { previous_total_points, ...publicRow } = row;
    return {
      ...publicRow,
      rank_delta: rankDelta,
    };
  });

  return {
    group_slug: groupSlug,
    scoring_status: "group_stage_live",
    latest_rank_update_match_id: predictionSummary.latestFinishedMatchId,
    rows: rowsWithMovement,
  };
}

export async function getDraftRoomState({ groupSlug }) {
  const overview = await getGroupOverview(groupSlug);
  if (!overview) return null;

  const [teamDrafts, playerDrafts] = await Promise.all([
    getDraftedTeamRows(overview),
    getDraftedPlayerRows(overview),
  ]);

  const teamsByManager = groupRowsByManager(teamDrafts);
  const playersByManager = groupRowsByManager(playerDrafts);
  const rows = overview.managers.map((manager) => {
    const teams = teamsByManager.get(manager.manager_code) || [];
    const players = playersByManager.get(manager.manager_code) || [];
    const teamsPoints = teams.reduce((sum, item) => sum + Number(item.points || 0), 0);
    const playersPoints = players.reduce((sum, item) => sum + Number(item.points || 0), 0);
    return {
      manager_code: manager.manager_code,
      manager_name: manager.display_name,
      total_draft_points: teamsPoints + playersPoints,
      drafted_teams_points: teamsPoints,
      drafted_players_points: playersPoints,
      teams,
      players,
    };
  });

  return {
    group_slug: groupSlug,
    rows: rankDraftRoomRows(rows),
  };
}

async function getLockedFuturePointsByManager(overview) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase || !overview?.id) return new Map();

  const { data, error } = await supabase
    .from("future_predictions")
    .select(`
      category,
      managers!inner ( manager_code ),
      future_pick_options!inner ( points, is_winner )
    `)
    .eq("group_id", overview.id)
    .eq("stage", LOCKED_FUTURE_STAGE)
    .eq("status", "active");

  if (error) {
    if (isMissingRelationError(error)) return new Map();
    throw new Error(error.message);
  }

  return (data || []).reduce((totals, pick) => {
    const managerCode = pick.managers?.manager_code;
    if (!managerCode) return totals;
    const points = scoreLockedFuturePick({ selectedOption: pick.future_pick_options });
    if (!points) return totals;
    totals.set(managerCode, (totals.get(managerCode) || 0) + points);
    return totals;
  }, new Map());
}

async function getParlayPointsByManager(overview) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase || !overview?.id) return new Map();

  const [
    { data: marketRows, error: marketError },
    { data: predictionRows, error: predictionError },
  ] = await Promise.all([
    supabase
      .from("parlay_markets")
      .select("id,match_id")
      .eq("is_active", true),
    supabase
      .from("parlay_predictions")
      .select(`
        match_id,
        predicted_team_a_score,
        predicted_team_b_score,
        managers!inner ( manager_code ),
        parlay_markets!inner ( market_type, points ),
        parlay_options ( points, is_correct ),
        matches!inner ( status, team_a_score, team_b_score )
      `)
      .eq("group_id", overview.id)
      .eq("status", "active"),
  ]);

  if (marketError) {
    if (isMissingRelationError(marketError)) return new Map();
    throw new Error(marketError.message);
  }
  if (predictionError) {
    if (isMissingRelationError(predictionError)) return new Map();
    throw new Error(predictionError.message);
  }

  const requiredCountByMatch = (marketRows || []).reduce((counts, row) => {
    counts.set(row.match_id, (counts.get(row.match_id) || 0) + 1);
    return counts;
  }, new Map());
  const selectionsByManagerMatch = new Map();
  for (const row of predictionRows || []) {
    const managerCode = row.managers?.manager_code;
    if (!managerCode || !row.match_id) continue;
    const key = `${managerCode}::${row.match_id}`;
    const selections = selectionsByManagerMatch.get(key) || {
      managerCode,
      matchId: row.match_id,
      selections: [],
    };
    selections.selections.push({
      points: row.parlay_markets?.market_type === "exact_score"
        ? row.parlay_markets?.points
        : row.parlay_options?.points,
      is_correct: row.parlay_markets?.market_type === "exact_score"
        ? getExactScoreSelectionResult(row)
        : row.parlay_options?.is_correct,
    });
    selectionsByManagerMatch.set(key, selections);
  }

  const pointsByManager = new Map();
  for (const item of selectionsByManagerMatch.values()) {
    const points = scoreParlaySlip({
      selections: item.selections,
      requiredCount: requiredCountByMatch.get(item.matchId) || 0,
    });
    if (!points) continue;
    pointsByManager.set(item.managerCode, (pointsByManager.get(item.managerCode) || 0) + points);
  }

  return pointsByManager;
}

async function getManualPointsByManager(overview) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase || !overview?.id) return new Map();

  const { data, error } = await supabase
    .from("scoring_events")
    .select(`
      points,
      managers!inner ( manager_code )
    `)
    .eq("group_id", overview.id)
    .eq("source_type", "manual_adjustment");

  if (error) throw new Error(error.message);

  return (data || []).reduce((totals, event) => {
    const managerCode = event.managers?.manager_code;
    if (!managerCode) return totals;
    totals.set(managerCode, (totals.get(managerCode) || 0) + Number(event.points || 0));
    return totals;
  }, new Map());
}

async function getDraftedTeamPointsByManager(overview) {
  const rows = await getDraftedTeamRows(overview);
  return rows.reduce((totals, row) => {
    if (!row.manager_code || !row.points) return totals;
    totals.set(row.manager_code, (totals.get(row.manager_code) || 0) + row.points);
    return totals;
  }, new Map());
}

async function getDraftedTeamRows(overview) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase || !overview?.id) return [];

  const { data: draftedTeams, error: draftedTeamsError } = await supabase
    .from("drafted_teams")
    .select(`
      team_id,
      draft_slot,
      managers!inner ( manager_code, display_name ),
      teams!inner ( fifa_code, name )
    `)
    .eq("group_id", overview.id);

  if (draftedTeamsError) {
    if (isMissingRelationError(draftedTeamsError)) return [];
    throw new Error(draftedTeamsError.message);
  }

  const { winsByTeamCode, lossesByTeamCode } = await getKnockoutTeamOutcomeMaps(overview);

  return (draftedTeams || [])
    .map((draft) => {
      const teamCode = normalizeTeamCode(draft.teams?.fifa_code);
      const wins = winsByTeamCode.get(teamCode) || 0;
      return {
        manager_code: draft.managers?.manager_code || null,
        manager_name: draft.managers?.display_name || null,
        draft_slot: draft.draft_slot || null,
        code: teamCode,
        name: draft.teams?.name || "Unknown team",
        points: scoreDraftedTeam({ stagesAdvanced: wins }),
        eliminated: lossesByTeamCode.has(teamCode),
      };
    })
    .sort(sortDraftItems);
}

async function getDraftedPlayerPointsByManager(overview) {
  const rows = await getDraftedPlayerRows(overview);
  return rows.reduce((totals, row) => {
    if (!row.manager_code || !row.points) return totals;
    totals.set(row.manager_code, (totals.get(row.manager_code) || 0) + row.points);
    return totals;
  }, new Map());
}

async function getDraftedPlayerRows(overview) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase || !overview?.id) return [];

  const { data: draftedPlayers, error } = await supabase
    .from("drafted_players")
    .select(`
      player_id,
      draft_slot,
      managers!inner ( manager_code, display_name ),
      players!inner (
        display_name,
        position,
        teams ( id, fifa_code, name )
      )
    `)
    .eq("group_id", overview.id);

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw new Error(error.message);
  }
  if (!draftedPlayers?.length) return [];

  const playerIds = [...new Set(draftedPlayers.map((draft) => draft.player_id).filter(Boolean))];
  if (!playerIds.length) return [];

  const { data: tallies, error: talliesError } = await supabase
    .from("player_stat_tallies")
    .select("player_id,goals,assists,player_of_match")
    .in("player_id", playerIds);

  if (talliesError) {
    if (isMissingRelationError(talliesError)) return [];
    throw new Error(talliesError.message);
  }

  const tallyByPlayer = new Map((tallies || []).map((tally) => [tally.player_id, tally]));
  const { lossesByTeamCode } = await getKnockoutTeamOutcomeMaps(overview);
  return draftedPlayers
    .map((draft) => {
      const tally = tallyByPlayer.get(draft.player_id);
      const teamCode = normalizeTeamCode(draft.players?.teams?.fifa_code);
      return {
        manager_code: draft.managers?.manager_code || null,
        manager_name: draft.managers?.display_name || null,
        draft_slot: draft.draft_slot || null,
        code: teamCode,
        name: draft.players?.display_name || "Unknown player",
        team_name: draft.players?.teams?.name || null,
        eliminated: lossesByTeamCode.has(teamCode),
        points: scoreDraftedPlayer({
          goals: tally?.goals || 0,
          assists: tally?.assists || 0,
          playerOfMatch: tally?.player_of_match || 0,
        }),
      };
    })
    .sort(sortDraftItems);
}

async function getKnockoutTeamOutcomeMaps(overview) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase || !overview?.id) {
    return { winsByTeamCode: new Map(), lossesByTeamCode: new Set() };
  }

  const { data: matchRows, error } = await supabase
    .from("group_matches")
    .select(`
      matches (
        external_match_id,
        stage,
        status,
        team_a_id,
        team_b_id,
        team_a_score,
        team_b_score,
        winner_team_id,
        team_a:team_a_id ( id, fifa_code ),
        team_b:team_b_id ( id, fifa_code )
      )
    `)
    .eq("group_id", overview.id)
    .limit(200);

  if (error) throw new Error(error.message);

  const fifaMatchesById = await getFifaMatchesByIdSafe();
  const winsByTeamCode = new Map();
  const lossesByTeamCode = new Set();

  for (const match of (matchRows || []).map((row) => row.matches).filter(Boolean)) {
    const scoredMatch = overlayMatchResult(match, fifaMatchesById);
    if (scoredMatch.status !== "finished" || isGroupStage(scoredMatch.stage)) continue;

    const winnerTeamId = getKnockoutWinnerTeamId(scoredMatch);
    if (!winnerTeamId) continue;

    const winnerTeamCode = winnerTeamId === scoredMatch.team_a_id
      ? normalizeTeamCode(scoredMatch.team_a?.fifa_code)
      : normalizeTeamCode(scoredMatch.team_b?.fifa_code);
    const loserTeamCode = winnerTeamId === scoredMatch.team_a_id
      ? normalizeTeamCode(scoredMatch.team_b?.fifa_code)
      : normalizeTeamCode(scoredMatch.team_a?.fifa_code);

    if (!isThirdPlaceStage(scoredMatch.stage) && winnerTeamCode) {
      winsByTeamCode.set(winnerTeamCode, (winsByTeamCode.get(winnerTeamCode) || 0) + 1);
    }
    if (loserTeamCode) lossesByTeamCode.add(loserTeamCode);
  }

  return { winsByTeamCode, lossesByTeamCode };
}

async function getPredictionScoringSummary(overview) {
  const supabase = getOptionalSupabaseClient();
  if (!supabase || !overview?.id) {
    return {
      groupStagePointsByManager: new Map(),
      knockoutPointsByManager: new Map(),
      riskPointsByManager: new Map(),
      previousGroupStagePointsByManager: new Map(),
      previousKnockoutPointsByManager: new Map(),
      previousRiskPointsByManager: new Map(),
      latestFinishedMatchId: null,
    };
  }

  const buildPredictionQuery = () => supabase
    .from("predictions")
    .select(`
      pick_type,
      pick_team_id,
      length_pick,
      first_score_pick_team_id,
      managers!inner ( manager_code ),
      matches!inner (
        id,
        stage,
        external_match_id,
        status,
        length,
        first_score_team_id,
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
    .eq("status", "active")
    .order("submitted_at", { ascending: true })
    .order("id", { ascending: true });

  let { data, error } = await fetchAllSupabaseRows(buildPredictionQuery);

  if (
    isMissingColumnError(error, "length_pick")
    || isMissingColumnError(error, "first_score_pick_team_id")
    || isMissingColumnError(error, "first_score_team_id")
  ) {
    const lengthPickMissing = isMissingColumnError(error, "length_pick");
    const buildFallbackPredictionQuery = () => supabase
      .from("predictions")
      .select(`
        pick_type,
        pick_team_id,
        ${lengthPickMissing ? "" : "length_pick,"}
        managers!inner ( manager_code ),
        matches!inner (
          id,
          stage,
          external_match_id,
          status,
          length,
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
      .eq("status", "active")
      .order("submitted_at", { ascending: true })
      .order("id", { ascending: true });
    const fallback = await fetchAllSupabaseRows(buildFallbackPredictionQuery);
    data = (fallback.data || []).map((prediction) => ({
      ...prediction,
      length_pick: prediction.length_pick || null,
      first_score_pick_team_id: null,
      matches: {
        ...prediction.matches,
        first_score_team_id: null,
      },
    }));
    error = fallback.error;
  }

  if (error) throw new Error(error.message);
  const fifaMatchesById = await getFifaMatchesByIdSafe();
  const finishedKnockoutMatchIds = [...new Set((data || [])
    .map((prediction) => overlayMatchResult(prediction.matches, fifaMatchesById))
    .filter((match) => match?.status === "finished" && !isGroupStage(match.stage))
    .map((match) => match.id)
    .filter(Boolean))];
  const knockoutPointValuesByMatch = await getMatchPickValuesByMatch({ supabase, matchIds: finishedKnockoutMatchIds });
  const scoredPredictions = (data || [])
    .map((prediction) => {
      const match = overlayMatchResult(prediction.matches, fifaMatchesById);
      const managerCode = prediction.managers?.manager_code;
      if (!managerCode || match?.status !== "finished") return null;

      if (!isGroupStage(match.stage)) {
        const winnerTeamId = getKnockoutWinnerTeamId(match);
        if (!winnerTeamId) return null;
        const teamPointValues = knockoutPointValuesByMatch.get(match.id) || {};
        const winnerPoints = scoreKnockoutWinnerPick({
          pickedTeamId: prediction.pick_team_id,
          winnerTeamId,
          teamPointValues,
        });
        const lengthRiskPoints = scoreKnockoutLengthRisk({
          pickedLength: prediction.length_pick,
          actualLength: match.length,
        });
        const firstScoreRiskPoints = scoreFirstScoreRisk({
          pickedTeamId: prediction.first_score_pick_team_id,
          actualTeamId: match.first_score_team_id,
        });
        return {
          managerCode,
          match,
          bucket: "knockout",
          points: winnerPoints,
          riskPoints: lengthRiskPoints + firstScoreRiskPoints,
        };
      }

      const result = getGroupStageResult(match);
      if (!result) return null;

      return {
        managerCode,
        match,
        bucket: "groupStage",
        points: scoreGroupStagePick({
          pickType: prediction.pick_type === "tie" ? "tie" : "team",
          pickedTeamId: prediction.pick_team_id,
          result,
        }),
      };
    })
    .filter(Boolean);

  const latestFinishedMatchId = getLatestFinishedMatchId(scoredPredictions.map((item) => item.match));

  return scoredPredictions.reduce((summary, item) => {
    const pointsMap = item.bucket === "knockout"
      ? summary.knockoutPointsByManager
      : summary.groupStagePointsByManager;
    pointsMap.set(
      item.managerCode,
      (pointsMap.get(item.managerCode) || 0) + item.points
    );
    if (!latestFinishedMatchId || item.match.external_match_id !== latestFinishedMatchId) {
      const previousPointsMap = item.bucket === "knockout"
        ? summary.previousKnockoutPointsByManager
        : summary.previousGroupStagePointsByManager;
      previousPointsMap.set(
        item.managerCode,
        (previousPointsMap.get(item.managerCode) || 0) + item.points
      );
    }
    if (item.bucket === "knockout" && item.riskPoints) {
      summary.riskPointsByManager.set(
        item.managerCode,
        (summary.riskPointsByManager.get(item.managerCode) || 0) + item.riskPoints
      );
      if (!latestFinishedMatchId || item.match.external_match_id !== latestFinishedMatchId) {
        summary.previousRiskPointsByManager.set(
          item.managerCode,
          (summary.previousRiskPointsByManager.get(item.managerCode) || 0) + item.riskPoints
        );
      }
    }
    return summary;
  }, {
    groupStagePointsByManager: new Map(),
    knockoutPointsByManager: new Map(),
    riskPointsByManager: new Map(),
    previousGroupStagePointsByManager: new Map(),
    previousKnockoutPointsByManager: new Map(),
    previousRiskPointsByManager: new Map(),
    latestFinishedMatchId,
  });
}

async function getMatchPickValuesByMatch({ supabase, matchIds }) {
  if (!matchIds.length) return new Map();
  const { data, error } = await supabase
    .from("match_pick_values")
    .select("match_id,team_id,points")
    .in("match_id", matchIds);

  if (error) throw new Error(error.message);
  return (data || []).reduce((byMatch, row) => {
    const values = byMatch.get(row.match_id) || {};
    values[row.team_id] = Number(row.points || 0);
    byMatch.set(row.match_id, values);
    return byMatch;
  }, new Map());
}

async function fetchAllSupabaseRows(buildQuery, { pageSize = 1000 } = {}) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) return { data: rows, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { data: rows, error: null };
}

function getLatestFinishedMatchId(matches) {
  const uniqueFinishedMatches = new Map();
  for (const match of matches) {
    if (!match?.external_match_id || match.status !== "finished" || !isGroupStage(match.stage)) continue;
    uniqueFinishedMatches.set(String(match.external_match_id), match);
  }

  return [...uniqueFinishedMatches.values()]
    .sort((a, b) => {
      const kickoffDiff = sortByKickoffDesc(a, b);
      if (kickoffDiff) return kickoffDiff;
      return String(b.external_match_id).localeCompare(String(a.external_match_id));
    })[0]?.external_match_id || null;
}

function getGroupStageResult(match) {
  if (!match || !hasFinishedResult(match)) return null;
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
      winnerTeamId: teamAScore > teamBScore
        ? match.team_a?.id || match.team_a_id
        : match.team_b?.id || match.team_b_id,
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

function getKnockoutWinnerTeamId(match) {
  if (!match || !hasFinishedResult(match) || isGroupStage(match.stage)) return null;
  const teamAScore = numberOrNull(match.team_a_score);
  const teamBScore = numberOrNull(match.team_b_score);

  if (teamAScore !== null && teamBScore !== null && teamAScore !== teamBScore) {
    return teamAScore > teamBScore
      ? match.team_a?.id || match.team_a_id
      : match.team_b?.id || match.team_b_id;
  }

  return match.winner_team_id || null;
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

function rankDraftRoomRows(rows) {
  const sorted = [...rows].sort((a, b) => {
    const pointDiff = Number(b.total_draft_points || 0) - Number(a.total_draft_points || 0);
    if (pointDiff) return pointDiff;
    return a.manager_name.localeCompare(b.manager_name);
  });

  let previousPoints = null;
  let previousRank = 0;
  return sorted.map((row, index) => {
    const points = Number(row.total_draft_points || 0);
    const rank = points === previousPoints ? previousRank : index + 1;
    previousPoints = points;
    previousRank = rank;
    return { ...row, rank };
  });
}

function groupRowsByManager(rows) {
  return rows.reduce((grouped, row) => {
    if (!row.manager_code) return grouped;
    const managerRows = grouped.get(row.manager_code) || [];
    managerRows.push(row);
    grouped.set(row.manager_code, managerRows);
    return grouped;
  }, new Map());
}

function groupRowsByKey(rows, keyName) {
  return (rows || []).reduce((grouped, row) => {
    const key = row?.[keyName];
    if (!key) return grouped;
    const keyRows = grouped.get(key) || [];
    keyRows.push(row);
    grouped.set(key, keyRows);
    return grouped;
  }, new Map());
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function cleanExactScoreSelection(value) {
  if (!value || typeof value !== "object") return null;
  const teamAScore = Number(value.team_a_score);
  const teamBScore = Number(value.team_b_score);
  if (!Number.isInteger(teamAScore) || !Number.isInteger(teamBScore)) return null;
  if (teamAScore < 0 || teamBScore < 0) return null;
  return { teamAScore, teamBScore };
}

function getExactScoreSelectionResult(row) {
  const match = row.matches;
  if (!match || match.status !== "finished") return null;
  const predictedA = numberOrNull(row.predicted_team_a_score);
  const predictedB = numberOrNull(row.predicted_team_b_score);
  const actualA = numberOrNull(match.team_a_score);
  const actualB = numberOrNull(match.team_b_score);
  if (predictedA === null || predictedB === null || actualA === null || actualB === null) return null;
  return predictedA === actualA && predictedB === actualB;
}

function isExactScoreCorrect({ match, score }) {
  if (!match || match.status !== "finished") return null;
  const [teamA, teamB] = String(score || "").split("-").map((value) => numberOrNull(value));
  const actualA = numberOrNull(match.team_a_score);
  const actualB = numberOrNull(match.team_b_score);
  if (teamA === null || teamB === null || actualA === null || actualB === null) return null;
  return teamA === actualA && teamB === actualB;
}

function sortDraftItems(a, b) {
  const slotA = Number(a.draft_slot || 999);
  const slotB = Number(b.draft_slot || 999);
  if (slotA !== slotB) return slotA - slotB;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function normalizeTeamCode(value) {
  return String(value || "").trim().toUpperCase();
}

function stripUnsupportedPredictionColumns(row, {
  lengthPickColumnMissing = false,
  firstScorePickColumnMissing = false,
} = {}) {
  const next = { ...row };
  if (lengthPickColumnMissing) delete next.length_pick;
  if (firstScorePickColumnMissing) delete next.first_score_pick_team_id;
  return next;
}

function isGroupStage(stage) {
  return String(stage || "").toLowerCase().includes("group");
}

function isThirdPlaceStage(stage) {
  return String(stage || "").trim().toLowerCase().replace(/[\s_-]+/g, " ") === "third place";
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
  oldLengthPick = null,
  oldFirstScorePickTeamId = null,
  newPickType,
  newPickTeamId,
  newLengthPick = null,
  newFirstScorePickTeamId = null,
  changedBy = null,
  reason = "manager_update",
}) {
  if (
    oldPickType === newPickType
    && oldPickTeamId === newPickTeamId
    && oldLengthPick === newLengthPick
    && oldFirstScorePickTeamId === newFirstScorePickTeamId
  ) return;

  let { error } = await supabase
    .from("prediction_audit")
    .insert({
      prediction_id: predictionId,
      group_id: groupId,
      manager_id: managerId,
      match_id: matchId,
      old_pick_type: oldPickType,
      old_pick_team_id: oldPickTeamId,
      old_length_pick: oldLengthPick,
      old_first_score_pick_team_id: oldFirstScorePickTeamId,
      new_pick_type: newPickType,
      new_pick_team_id: newPickTeamId,
      new_length_pick: newLengthPick,
      new_first_score_pick_team_id: newFirstScorePickTeamId,
      changed_by: changedBy,
      reason,
    });
  if (isMissingColumnError(error, "length_pick") || isMissingColumnError(error, "first_score_pick_team_id")) {
    const fallback = await supabase
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
        changed_by: changedBy,
        reason,
      });
    error = fallback.error;
  }
  if (error) throw new Error(error.message);
}

function getOptionalSupabaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createSupabaseServerClient();
}

function isMissingRelationError(error) {
  const message = error?.message || "";
  return error?.code === "42P01"
    || error?.code === "PGRST205"
    || /relation .* does not exist/i.test(message)
    || /could not find the table/i.test(message);
}

function isMissingColumnError(error, columnName) {
  if (!error) return false;
  const message = error.message || "";
  return error.code === "42703"
    || message.includes(columnName)
    || message.includes(`.${columnName}`)
    || message.includes(`column ${columnName}`)
    || message.includes(`'${columnName}' column`)
    || message.includes(`"${columnName}" column`)
    || message.includes(`column '${columnName}'`)
    || message.includes(`column "${columnName}"`);
}

async function readSeedJson(fileName) {
  const text = await fs.readFile(path.join(SEED_DIR, fileName), "utf8");
  return JSON.parse(text);
}

async function attachMatchPointValues({ supabase, matches }) {
  const matchIds = [...new Set((matches || []).map((match) => match.id).filter(Boolean))];
  if (!supabase || !matchIds.length) return matches;

  const { data, error } = await supabase
    .from("match_pick_values")
    .select("match_id,team_id,points")
    .in("match_id", matchIds);

  if (error) {
    if (isMissingRelationError(error)) return matches;
    throw new Error(error.message);
  }

  const pointsByMatchTeam = new Map((data || []).map((row) => [`${row.match_id}:${row.team_id}`, Number(row.points)]));
  for (const match of matches) {
    match.team_a_points = pointsByMatchTeam.get(`${match.id}:${match.team_a_id}`) ?? null;
    match.team_b_points = pointsByMatchTeam.get(`${match.id}:${match.team_b_id}`) ?? null;
  }
  return matches;
}

function normalizeSupabaseMatches(rows, fifaMatchesById = new Map()) {
  return rows
    .map((row) => row.matches)
    .filter(Boolean)
    .map((match) => overlayMatchResult(match, fifaMatchesById))
    .filter((match) => new Date(match.kickoff_at).getTime() >= Date.now())
    .sort(sortByKickoffAsc)
    .slice(0, UPCOMING_MATCH_LIMIT);
}

function normalizePulseMatches(rows, limit, fifaMatchesById = new Map()) {
  return rows
    .map((row) => row.matches)
    .filter(Boolean)
    .map((match) => overlayMatchResult(match, fifaMatchesById))
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
  if (hasStoredFinalResult(match)) return match;
  const fifaMatch = fifaMatchesById.get(String(match.external_match_id));
  if (!fifaMatch) return match;

  const teamAWinner = fifaMatch.winner_code
    && fifaMatch.winner_code === match.team_a?.fifa_code;
  const teamBWinner = fifaMatch.winner_code
    && fifaMatch.winner_code === match.team_b?.fifa_code;

  return {
    ...match,
    kickoff_at: fifaMatch.kickoff_at || match.kickoff_at,
    status: fifaMatch.status || match.status,
    team_a_score: fifaMatch.team_a_score ?? match.team_a_score ?? null,
    team_b_score: fifaMatch.team_b_score ?? match.team_b_score ?? null,
    length: match.length ?? fifaMatch.length ?? null,
    winner_team_id: teamAWinner
      ? match.team_a?.id || match.team_a_id || match.winner_team_id || null
      : teamBWinner
        ? match.team_b?.id || match.team_b_id || match.winner_team_id || null
        : match.winner_team_id ?? null,
  };
}

function hasStoredFinalResult(match) {
  if (match?.status !== "finished") return false;
  return Boolean(match.winner_team_id)
    || numberOrNull(match.team_a_score) !== null
    && numberOrNull(match.team_b_score) !== null;
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

function formatRiskPickLabel(lengthPick) {
  if (lengthPick === "ET") return "ET risk: +4 / -2";
  if (lengthPick === "Pens") return "Pens risk: +8 / -4";
  return null;
}

function getFirstScorePickType({ firstScorePickTeamId, match }) {
  if (!firstScorePickTeamId || !match) return null;
  if (firstScorePickTeamId === match.team_a?.id || firstScorePickTeamId === match.team_a_id) return "team_a";
  if (firstScorePickTeamId === match.team_b?.id || firstScorePickTeamId === match.team_b_id) return "team_b";
  return null;
}

function formatFirstScoreRiskPickLabel({ firstScorePickTeamId, match }) {
  const firstScorePickType = getFirstScorePickType({ firstScorePickTeamId, match });
  if (firstScorePickType === "team_a") return `${match.team_a?.name || "Team A"} first score: +3 / -1`;
  if (firstScorePickType === "team_b") return `${match.team_b?.name || "Team B"} first score: +3 / -1`;
  return null;
}

function pickNameForMatch({ match, pickType }) {
  if (pickType === "tie") return "Tie";
  if (pickType === "team_a") return match.team_a?.name || null;
  if (pickType === "team_b") return match.team_b?.name || null;
  return null;
}

function formatAuditPickLabel({ pickType, pickTeam }) {
  if (!pickType) return "No pick";
  if (pickType === "tie") return "Tie";
  return pickTeam?.name || "Unknown team";
}

function shouldRevealPulse({ kickoffAt, lockMinutesBeforeKickoff, stage }) {
  return Date.now() >= new Date(deadlineFor(kickoffAt, lockMinutesBeforeKickoff, stage)).getTime();
}

function deadlineFor(kickoffAt, lockMinutesBeforeKickoff, stage) {
  const kickoff = new Date(kickoffAt).getTime();
  const lockMs = getLockMinutesBeforeKickoff({ stage, lockMinutesBeforeKickoff }) * 60 * 1000;
  return new Date(kickoff - lockMs).toISOString();
}
