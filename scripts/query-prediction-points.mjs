import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";
import { getFifaMatchesById } from "../src/integrations/fifa-api.js";
import {
  scoreGroupStagePick,
  scoreKnockoutWinnerPick,
} from "../src/rules/scoring.js";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const args = parseArgs(process.argv.slice(2));
const outputJson = Boolean(args.json);
const groupFilter = normalize(args.group);
const managerFilter = normalize(args.manager);

const predictions = await getPredictions();
const matchIds = [...new Set(predictions.map((row) => row.matches?.id).filter(Boolean))];
const [pickValuesByMatch, fifaMatchesById] = await Promise.all([
  getPickValuesByMatch(matchIds),
  getFifaMatchesByIdSafe(),
]);

const rows = predictions
  .map((prediction) => toAuditRow(prediction, pickValuesByMatch, fifaMatchesById))
  .filter((row) => !groupFilter || row.group_slug === groupFilter)
  .filter((row) => !managerFilter || normalizeName(row.manager_name) === normalizeName(managerFilter))
  .sort((left, right) => {
    const groupDiff = left.group_slug.localeCompare(right.group_slug);
    if (groupDiff) return groupDiff;
    const managerDiff = left.manager_name.localeCompare(right.manager_name);
    if (managerDiff) return managerDiff;
    return `${left.team_a} v ${left.team_b}`.localeCompare(`${right.team_a} v ${right.team_b}`);
  });

if (outputJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  printCsv(rows);
}

async function getPredictions() {
  const groupClause = groupFilter ? `&groups.slug=eq.${encodeURIComponent(groupFilter)}` : "";
  const managerClause = managerFilter ? `&managers.display_name=eq.${encodeURIComponent(managerFilter)}` : "";
  return supabaseRest(`/predictions?select=pick_type,pick_team_id,groups!inner(slug),managers!inner(display_name),matches!inner(id,external_match_id,stage,status,team_a_id,team_b_id,team_a_score,team_b_score,winner_team_id,team_a:team_a_id(name,fifa_code),team_b:team_b_id(name,fifa_code))&status=eq.active${groupClause}${managerClause}&limit=1000`);
}

async function getPickValuesByMatch(matchIds) {
  if (!matchIds.length) return new Map();
  const rows = await supabaseRest(`/match_pick_values?select=match_id,team_id,points&match_id=in.(${matchIds.join(",")})`);
  return rows.reduce((byMatch, row) => {
    const values = byMatch.get(row.match_id) || {};
    values[row.team_id] = Number(row.points || 0);
    byMatch.set(row.match_id, values);
    return byMatch;
  }, new Map());
}

function toAuditRow(prediction, pickValuesByMatch, fifaMatchesById) {
  const match = overlayMatchResult(prediction.matches || {}, fifaMatchesById);
  const pick = getPickLabel(prediction, match);
  return {
    manager_name: prediction.managers?.display_name || "",
    group_slug: prediction.groups?.slug || "",
    team_a: match.team_a?.name || "",
    team_b: match.team_b?.name || "",
    pick,
    points: scorePrediction(prediction, match, pickValuesByMatch),
  };
}

async function getFifaMatchesByIdSafe() {
  try {
    return await getFifaMatchesById();
  } catch {
    return new Map();
  }
}

function scorePrediction(prediction, match, pickValuesByMatch) {
  if (!hasFinishedResult(match)) return 0;
  const pickedTeamId = getPickedTeamId(prediction, match);

  if (isGroupStage(match.stage)) {
    const result = getGroupStageResult(match);
    return scoreGroupStagePick({
      pickType: prediction.pick_type === "tie" ? "tie" : "team",
      pickedTeamId,
      result,
    });
  }

  const winnerTeamId = getKnockoutWinnerTeamId(match);
  return scoreKnockoutWinnerPick({
    pickedTeamId,
    winnerTeamId,
    teamPointValues: pickValuesByMatch.get(match.id) || {},
  });
}

function getPickLabel(prediction, match) {
  if (prediction.pick_type === "tie") return "Tie";
  const pickedTeamId = getPickedTeamId(prediction, match);
  if (pickedTeamId === match.team_a_id) return match.team_a?.name || "Team A";
  if (pickedTeamId === match.team_b_id) return match.team_b?.name || "Team B";
  return prediction.pick_type || "";
}

function getPickedTeamId(prediction, match) {
  if (prediction.pick_team_id) return prediction.pick_team_id;
  if (prediction.pick_type === "team_a") return match.team_a_id;
  if (prediction.pick_type === "team_b") return match.team_b_id;
  return null;
}

function getGroupStageResult(match) {
  const teamAScore = numberOrNull(match.team_a_score);
  const teamBScore = numberOrNull(match.team_b_score);

  if (teamAScore !== null && teamBScore !== null) {
    if (teamAScore === teamBScore) {
      return { status: "finished", winnerType: "tie", winnerTeamId: null };
    }
    return {
      status: "finished",
      winnerType: "team",
      winnerTeamId: teamAScore > teamBScore ? match.team_a_id : match.team_b_id,
    };
  }

  if (match.winner_team_id) {
    return { status: "finished", winnerType: "team", winnerTeamId: match.winner_team_id };
  }

  return null;
}

function getKnockoutWinnerTeamId(match) {
  const teamAScore = numberOrNull(match.team_a_score);
  const teamBScore = numberOrNull(match.team_b_score);

  if (teamAScore !== null && teamBScore !== null && teamAScore !== teamBScore) {
    return teamAScore > teamBScore ? match.team_a_id : match.team_b_id;
  }

  return match.winner_team_id || null;
}

function overlayMatchResult(match, fifaMatchesById) {
  if (hasStoredFinalResult(match)) return match;
  const fifaMatch = fifaMatchesById.get(String(match.external_match_id || ""));
  if (!fifaMatch) return match;

  const teamAWinner = fifaMatch.winner_code && fifaMatch.winner_code === match.team_a?.fifa_code;
  const teamBWinner = fifaMatch.winner_code && fifaMatch.winner_code === match.team_b?.fifa_code;

  return {
    ...match,
    status: fifaMatch.status || match.status,
    team_a_score: fifaMatch.team_a_score ?? match.team_a_score ?? null,
    team_b_score: fifaMatch.team_b_score ?? match.team_b_score ?? null,
    winner_team_id: teamAWinner
      ? match.team_a_id || match.winner_team_id || null
      : teamBWinner
        ? match.team_b_id || match.winner_team_id || null
        : match.winner_team_id ?? null,
  };
}

function hasStoredFinalResult(match) {
  if (match?.status !== "finished") return false;
  return Boolean(match.winner_team_id)
    || numberOrNull(match.team_a_score) !== null && numberOrNull(match.team_b_score) !== null;
}

function hasFinishedResult(match) {
  if (!match) return false;
  if (match.status === "finished") return true;
  if (match.winner_team_id) return true;
  return numberOrNull(match.team_a_score) !== null && numberOrNull(match.team_b_score) !== null;
}

function printCsv(rows) {
  const headers = ["manager_name", "group_slug", "team_a", "team_b", "pick", "points"];
  console.log(headers.join(","));
  for (const row of rows) {
    console.log(headers.map((header) => csvValue(row[header])).join(","));
  }
}

function csvValue(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
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

function isGroupStage(stage) {
  return String(stage || "").toLowerCase().includes("group");
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalize(value) {
  return String(value || "").trim();
}

function normalizeName(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
