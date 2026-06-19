import fs from "node:fs/promises";
import path from "node:path";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const SEED_DIR = path.join(process.cwd(), "supabase", "seed-data");

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

    const [{ count: managerCount, error: managerError }, { data: matches, error: matchError }] =
      await Promise.all([
        supabase
          .from("managers")
          .select("id", { count: "exact", head: true })
          .eq("group_id", group.id)
          .eq("is_active", true),
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
          .limit(8),
      ]);

    if (managerError) throw new Error(managerError.message);
    if (matchError) throw new Error(matchError.message);

    return {
      ...group,
      manager_count: managerCount || 0,
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
  const now = Date.now();
  const upcomingMatches = matches
    .filter((match) => new Date(match.kickoff_at).getTime() >= now)
    .slice(0, 8)
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
    manager_count: managers.filter((manager) => manager.group_slug === groupSlug && manager.is_active).length,
    upcoming_matches: upcomingMatches,
    data_mode: "seed",
  };
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
    .sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime());
}
