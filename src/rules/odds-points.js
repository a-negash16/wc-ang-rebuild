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

export function calculateTwoTeamPointSplit({ teamAOdds, teamBOdds }) {
  const teamAProbability = americanOddsToImpliedProbability(teamAOdds);
  const teamBProbability = americanOddsToImpliedProbability(teamBOdds);
  if (!teamAProbability || !teamBProbability) {
    throw new Error("Both team odds are required to calculate point values.");
  }

  const totalProbability = teamAProbability + teamBProbability;
  const normalizedTeamA = teamAProbability / totalProbability;
  const rawTeamAPoints = roundToHalfPoint((1 - normalizedTeamA) * 10);
  const teamAPoints = clampNumber(rawTeamAPoints, 3, 7);
  const teamBPoints = roundToHalfPoint(10 - teamAPoints);

  return {
    team_a_points: teamAPoints,
    team_b_points: teamBPoints,
    team_a_probability: normalizedTeamA,
    team_b_probability: 1 - normalizedTeamA,
  };
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
