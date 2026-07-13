import {
  LOCKED_FUTURE_OPTIONS,
  LOCKED_FUTURE_STAGE,
} from "../src/rules/future-picks.js";
import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const teams = await supabaseRest("/teams?select=id,fifa_code,name&fifa_code=in.(FRA,ESP,ENG,ARG)");
const teamByCode = new Map((teams || []).map((team) => [team.fifa_code, team]));

await updateSemiFinalFixtures(teamByCode);
await upsertFutureOptions(teamByCode);

console.log(JSON.stringify({ ok: true, stage: LOCKED_FUTURE_STAGE, message: "Semi-final fixtures/options seeded" }, null, 2));

async function updateSemiFinalFixtures(teamByCode) {
  const fixtures = [
    { external_match_id: "400021541", team_a: "FRA", team_b: "ESP" },
    { external_match_id: "400021540", team_a: "ENG", team_b: "ARG" },
  ];

  for (const fixture of fixtures) {
    const teamA = teamByCode.get(fixture.team_a);
    const teamB = teamByCode.get(fixture.team_b);
    if (!teamA || !teamB) throw new Error(`Missing team for ${JSON.stringify(fixture)}`);
    await supabaseRest(`/matches?external_match_id=eq.${fixture.external_match_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        team_a_id: teamA.id,
        team_b_id: teamB.id,
        status: "scheduled",
      }),
    });
  }
}

async function upsertFutureOptions(teamByCode) {
  const rows = Object.entries(LOCKED_FUTURE_OPTIONS).flatMap(([category, options]) => {
    return options.map((option) => ({
      stage: LOCKED_FUTURE_STAGE,
      category,
      option_kind: option.option_kind,
      option_key: option.option_key,
      label: option.label,
      team_id: option.team_code ? teamByCode.get(option.team_code)?.id || null : null,
      points: option.points,
      sort_order: option.sort_order,
      is_active: true,
    }));
  });

  const response = await supabaseRest("/future_pick_options?on_conflict=stage,category,option_key", {
    method: "POST",
    body: JSON.stringify(rows),
    headers: {
      Prefer: "resolution=merge-duplicates",
    },
    rawResponse: true,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Could not seed future_pick_options. Apply migration 0010 first. ${response.status}: ${text}`);
  }
}
