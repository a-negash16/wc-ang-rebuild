export const SCORING = Object.freeze({
  groupStageWinner: 3,
  groupStageTie: 5,
  knockoutScorer: 3,
  knockoutLength: 2,
  draftedTeamStageAdvance: 10,
  playerGoal: 5,
  playerAssist: 3,
  playerMotm: 7,
  playerCleanSheet: 3,
  playerPenaltySave: 10,
  futuresChampionMax: 100,
});

export const MATCH_LENGTHS = Object.freeze(["90", "ET", "Pens"]);
export const POSITIONS = Object.freeze(["GK", "DEF", "CB", "MID", "FWD"]);

export function scoreGroupStagePick({ pickType, pickedTeamId, result }) {
  if (!result || result.status !== "finished") return 0;

  if (result.winnerType === "tie") {
    return pickType === "tie" ? SCORING.groupStageTie : 0;
  }

  if (pickType !== "team") return 0;
  return pickedTeamId && pickedTeamId === result.winnerTeamId
    ? SCORING.groupStageWinner
    : 0;
}

export function scoreKnockoutWinnerPick({ pickedTeamId, winnerTeamId, teamPointValues }) {
  if (!pickedTeamId || !winnerTeamId || pickedTeamId !== winnerTeamId) return 0;
  const value = Number(teamPointValues?.[pickedTeamId] ?? 0);
  return clampInteger(value, 1, 9);
}

export function scoreKnockoutLengthPick({ pickedLength, actualLength }) {
  if (!MATCH_LENGTHS.includes(pickedLength) || !MATCH_LENGTHS.includes(actualLength)) return 0;
  return pickedLength === actualLength ? SCORING.knockoutLength : 0;
}

export function scoreKnockoutScorerPicks({ pickedPlayerIds = [], actualScorerIds = [] }) {
  const actual = new Set(actualScorerIds.filter(Boolean));
  const uniquePicks = [...new Set(pickedPlayerIds.filter(Boolean))].slice(0, 2);
  return uniquePicks.filter((playerId) => actual.has(playerId)).length * SCORING.knockoutScorer;
}

export function scoreDraftedTeam({ stagesAdvanced }) {
  return Math.max(0, Number(stagesAdvanced || 0)) * SCORING.draftedTeamStageAdvance;
}

export function scoreDraftedPlayer({
  position,
  goals = 0,
  assists = 0,
  motm = 0,
  cleanSheets = 0,
  penaltySaves = 0,
}) {
  const normalizedPosition = String(position || "").toUpperCase();
  const cleanSheetPoints = ["GK", "CB"].includes(normalizedPosition)
    ? Number(cleanSheets || 0) * SCORING.playerCleanSheet
    : 0;
  const penaltySavePoints = normalizedPosition === "GK"
    ? Number(penaltySaves || 0) * SCORING.playerPenaltySave
    : 0;

  return (
    Number(goals || 0) * SCORING.playerGoal +
    Number(assists || 0) * SCORING.playerAssist +
    Number(motm || 0) * SCORING.playerMotm +
    cleanSheetPoints +
    penaltySavePoints
  );
}

export function scoreFuturesChampionPick({ pickedTeamId, championTeamId, teamPointValues }) {
  if (!pickedTeamId || !championTeamId || pickedTeamId !== championTeamId) return 0;
  const value = Number(teamPointValues?.[pickedTeamId] ?? 0);
  return clampInteger(value, 1, SCORING.futuresChampionMax);
}

export function totalLeaderboardPoints({
  groupStage = 0,
  knockoutPredictions = 0,
  futures = 0,
  draftedTeams = 0,
  draftedPlayers = 0,
  manualAdjustments = 0,
}) {
  return [groupStage, knockoutPredictions, futures, draftedTeams, draftedPlayers, manualAdjustments]
    .reduce((sum, value) => sum + Number(value || 0), 0);
}

function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, Math.round(value)));
}
