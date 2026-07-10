import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const args = parseArgs(process.argv.slice(2));
const externalMatchId = normalize(args.match);
const teamCode = normalize(args.team).toUpperCase();
const writeMode = Boolean(args.write);

if (!externalMatchId || !teamCode) {
  throw new Error("Usage: npm run set:first-score -- --match 400021536 --team FRA [--write]");
}

const [match] = await supabaseRest(
  `/matches?select=id,external_match_id,first_score_team_id,team_a_id,team_b_id,team_a:team_a_id(name,fifa_code),team_b:team_b_id(name,fifa_code)&external_match_id=eq.${encodeURIComponent(externalMatchId)}&limit=1`
);

if (!match) throw new Error(`No match found for external_match_id ${externalMatchId}`);

const firstScoreTeamId = teamCode === match.team_a?.fifa_code
  ? match.team_a_id
  : teamCode === match.team_b?.fifa_code
    ? match.team_b_id
    : null;

if (!firstScoreTeamId) {
  throw new Error(`${teamCode} is not one of ${match.team_a?.fifa_code || "TBD"} or ${match.team_b?.fifa_code || "TBD"}`);
}

const update = { first_score_team_id: firstScoreTeamId };
if (writeMode) {
  await supabaseRest(`/matches?id=eq.${match.id}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

console.log(JSON.stringify({
  mode: writeMode ? "write" : "dry-run",
  external_match_id: match.external_match_id,
  match: `${match.team_a?.name || "TBD"} v ${match.team_b?.name || "TBD"}`,
  previous_first_score_team: teamNameForId(match, match.first_score_team_id),
  next_first_score_team: teamNameForId(match, firstScoreTeamId),
}, null, 2));

function teamNameForId(match, teamId) {
  if (!teamId) return null;
  if (teamId === match.team_a_id) return match.team_a?.name || "Team A";
  if (teamId === match.team_b_id) return match.team_b?.name || "Team B";
  return teamId;
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

function normalize(value) {
  return String(value || "").trim();
}
