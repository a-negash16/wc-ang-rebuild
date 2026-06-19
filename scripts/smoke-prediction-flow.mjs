import { verifyPin } from "../src/lib/auth/pin.js";
import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const args = process.argv.slice(2);
const write = args.includes("--write");
const groupSlug = getArg("--group") || "squad";
const managerCode = getArg("--manager") || "M001";
const pin = getArg("--pin") || "";
const pickType = getArg("--pick") || "team_a";

if (!pin) {
  fail("Missing --pin. Example: node scripts/smoke-prediction-flow.mjs --group squad --manager M001 --pin 12345");
}

const group = await getOne(`/groups?select=id,slug,lock_minutes_before_kickoff&slug=eq.${encodeURIComponent(groupSlug)}`);
const manager = await getOne(
  `/managers?select=id,manager_code,display_name,pin_hash&group_id=eq.${group.id}&manager_code=eq.${encodeURIComponent(managerCode)}&is_active=eq.true`
);

if (!verifyPin(pin, manager.pin_hash)) {
  fail("PIN verification failed");
}

const match = await findNextOpenMatch(group);
const pickTeamId = pickType === "team_a"
  ? match.team_a_id
  : pickType === "team_b"
    ? match.team_b_id
    : null;

console.log(`Manager verified: ${manager.manager_code} (${manager.display_name})`);
console.log(`Next open match: ${match.external_match_id} ${match.team_a_name || "TBD"} vs ${match.team_b_name || "TBD"}`);
console.log(`Pick: ${pickType}`);

if (!write) {
  console.log("Dry run only. Add --write to save this pick.");
  process.exit(0);
}

const existing = await supabaseRest(
  `/predictions?select=id,pick_type,pick_team_id&group_id=eq.${group.id}&manager_id=eq.${manager.id}&match_id=eq.${match.id}&status=eq.active`
);

if (existing[0]) {
  await supabaseRest(`/predictions?id=eq.${existing[0].id}`, {
    method: "PATCH",
    body: JSON.stringify({
      pick_type: pickType,
      pick_team_id: pickTeamId,
      updated_at: new Date().toISOString(),
    }),
    headers: { Prefer: "return=minimal" },
  });
  console.log("Updated existing active prediction.");
} else {
  await supabaseRest("/predictions", {
    method: "POST",
    body: JSON.stringify({
      group_id: group.id,
      manager_id: manager.id,
      match_id: match.id,
      pick_type: pickType,
      pick_team_id: pickTeamId,
      status: "active",
    }),
    headers: { Prefer: "return=minimal" },
  });
  console.log("Inserted active prediction.");
}

const preview = await supabaseRest(
  `/active_prediction_details?select=external_match_id,manager_code,manager_name,pick_type,pick_team_name&group_slug=eq.${encodeURIComponent(groupSlug)}&manager_code=eq.${encodeURIComponent(managerCode)}&external_match_id=eq.${match.external_match_id}`
);

if (!preview[0]) {
  fail("Prediction write succeeded, but preview view did not return the row");
}

console.log(`Preview read-back: ${preview[0].external_match_id} ${preview[0].pick_type} ${preview[0].pick_team_name || ""}`.trim());

function getArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

async function getOne(endpoint) {
  const rows = await supabaseRest(endpoint);
  if (!rows[0]) {
    fail(`No row returned for ${endpoint}`);
  }
  return rows[0];
}

async function findNextOpenMatch(group) {
  const rows = await supabaseRest(
    `/group_matches?select=matches!inner(id,external_match_id,stage,kickoff_at,status,team_a_id,team_b_id,team_a:team_a_id(name),team_b:team_b_id(name))&group_id=eq.${group.id}&matches.status=eq.scheduled&order=matches(kickoff_at).asc`
  );
  const now = Date.now();
  const lockMs = Number(group.lock_minutes_before_kickoff || 60) * 60 * 1000;
  const match = rows
    .map((row) => row.matches)
    .find((item) => {
      return item.team_a_id
        && item.team_b_id
        && new Date(item.kickoff_at).getTime() - lockMs > now;
    });

  if (!match) {
    fail("No open seeded match found");
  }

  return {
    ...match,
    team_a_name: match.team_a?.name,
    team_b_name: match.team_b?.name,
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
