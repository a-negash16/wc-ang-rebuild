export const TEAM_NAME_ALIASES = Object.freeze({
  "bosnia and herzegovina": "bosnia and herzegovina",
  "cabo verde": "cabo verde",
  "cape verde": "cabo verde",
  "congo dr": "congo dr",
  "dr congo": "congo dr",
  "czech republic": "czechia",
  "cote divoire": "cote divoire",
  "ivory coast": "cote divoire",
  "iran": "ir iran",
  "south korea": "korea republic",
  "usa": "usa",
  "united states": "usa",
});

export function americanOddsToImpliedProbability(odds) {
  const value = Number(odds);
  if (!Number.isFinite(value) || value === 0) return null;
  return value > 0
    ? 100 / (value + 100)
    : Math.abs(value) / (Math.abs(value) + 100);
}

export function calculateTwoTeamPointSplit({ teamAOdds, teamBOdds, totalPoints = 10, minPoints = 3, maxPoints = 7 }) {
  const teamAProbability = americanOddsToImpliedProbability(teamAOdds);
  const teamBProbability = americanOddsToImpliedProbability(teamBOdds);
  if (!teamAProbability || !teamBProbability) {
    throw new Error("Both team odds are required to calculate point values.");
  }

  const totalProbability = teamAProbability + teamBProbability;
  const normalizedTeamA = teamAProbability / totalProbability;
  const rawTeamAPoints = roundToHalfPoint((1 - normalizedTeamA) * totalPoints);
  const teamAPoints = clampNumber(rawTeamAPoints, minPoints, maxPoints);
  const teamBPoints = roundToHalfPoint(totalPoints - teamAPoints);

  return {
    team_a_points: teamAPoints,
    team_b_points: teamBPoints,
    team_a_probability: normalizedTeamA,
    team_b_probability: 1 - normalizedTeamA,
  };
}

export function getKnockoutStagePointScale(stage) {
  const normalized = String(stage || "").trim().toLowerCase();
  if (normalized.includes("semi")) return { totalPoints: 20, minPoints: 7, maxPoints: 13, label: "SF 13-7 scale" };
  if (normalized.includes("third")) return { totalPoints: 25, minPoints: 10, maxPoints: 15, label: "3rd place 15-10 scale" };
  if (normalized === "final" || normalized.includes("final")) return { totalPoints: 30, minPoints: 10, maxPoints: 20, label: "Final 20-10 scale" };
  if (normalized.includes("quarter")) return { totalPoints: 15, minPoints: 4, maxPoints: 11, label: "QF 11-4 scale" };
  return { totalPoints: 10, minPoints: 3, maxPoints: 7, label: "R32/R16 3-7 scale" };
}

export function normalizeTeamName(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_NAME_ALIASES[normalized] || normalized;
}

export function namesMatch(left, right) {
  return normalizeTeamName(left) === normalizeTeamName(right);
}

function roundToHalfPoint(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 2) / 2;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
