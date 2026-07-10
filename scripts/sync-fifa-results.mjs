import { getFifaMatchesById } from "../src/integrations/fifa-api.js";
import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const args = parseArgs(process.argv.slice(2));
const writeMode = Boolean(args.write);
const stageFilter = normalize(args.stage);

const fifaMatchesById = await getFifaMatchesById();
const matches = await supabaseRest(
  "/matches?select=id,external_match_id,stage,status,team_a_id,team_b_id,team_a_score,team_b_score,winner_team_id,length,team_a:team_a_id(name,fifa_code),team_b:team_b_id(name,fifa_code)&limit=500"
);

const candidates = matches
  .filter((match) => !stageFilter || normalizeName(match.stage).includes(normalizeName(stageFilter)))
  .map((match) => buildUpdate(match, fifaMatchesById.get(String(match.external_match_id))))
  .filter(Boolean)
  .filter((item) => hasChange(item.match, item.update));

for (const item of candidates) {
  if (writeMode) {
    await supabaseRest(`/matches?id=eq.${item.match.id}`, {
      method: "PATCH",
      body: JSON.stringify(item.update),
    });
  }
}

console.log(JSON.stringify({
  mode: writeMode ? "write" : "dry-run",
  updated_count: candidates.length,
  rows: candidates.map(({ match, fifa, update }) => ({
    external_match_id: match.external_match_id,
    stage: match.stage,
    match: `${match.team_a?.name || "TBD"} v ${match.team_b?.name || "TBD"}`,
    current: {
      status: match.status,
      score: formatScore(match.team_a_score, match.team_b_score),
      winner: teamNameForId(match, match.winner_team_id),
      length: match.length,
    },
    fifa: {
      status: fifa.status,
      score: formatScore(fifa.team_a_score, fifa.team_b_score),
      winner_code: fifa.winner_code,
      length: fifa.length,
    },
    update: {
      status: update.status,
      score: formatScore(update.team_a_score, update.team_b_score),
      winner: teamNameForId(match, update.winner_team_id),
      length: update.length,
    },
  })),
}, null, 2));

function buildUpdate(match, fifa) {
  if (!fifa || fifa.status !== "finished") return null;

  const winnerTeamId = fifa.winner_code === match.team_a?.fifa_code
    ? match.team_a_id
    : fifa.winner_code === match.team_b?.fifa_code
      ? match.team_b_id
      : match.winner_team_id || null;

  return {
    match,
    fifa,
    update: {
      status: "finished",
      team_a_score: fifa.team_a_score,
      team_b_score: fifa.team_b_score,
      winner_team_id: winnerTeamId,
      length: match.length || fifa.length || null,
    },
  };
}

function hasChange(match, update) {
  return match.status !== update.status
    || numberOrNull(match.team_a_score) !== numberOrNull(update.team_a_score)
    || numberOrNull(match.team_b_score) !== numberOrNull(update.team_b_score)
    || (match.winner_team_id || null) !== (update.winner_team_id || null)
    || (match.length || null) !== (update.length || null);
}

function teamNameForId(match, teamId) {
  if (!teamId) return null;
  if (teamId === match.team_a_id) return match.team_a?.name || "Team A";
  if (teamId === match.team_b_id) return match.team_b?.name || "Team B";
  return teamId;
}

function formatScore(teamAScore, teamBScore) {
  const left = teamAScore === null || teamAScore === undefined ? "-" : teamAScore;
  const right = teamBScore === null || teamBScore === undefined ? "-" : teamBScore;
  return `${left}-${right}`;
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

function normalizeName(value) {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
