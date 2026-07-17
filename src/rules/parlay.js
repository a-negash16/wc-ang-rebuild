export const PARLAY_STAGE_LABEL = "Final / 3rd Place Slip";

export const PARLAY_FIXTURES = Object.freeze([
  {
    external_match_id: "400021542",
    stage: "Third Place",
    team_a_code: "FRA",
    team_b_code: "ENG",
    label: "3rd Place Slip",
    markets: [
      overUnderMarket("total_goals", "Total Goals", 3.5, 5, 1),
      scorerMarket("mbappe_score", "Mbappe scores", "Kylian Mbappe", -185, 2),
      scorerMarket("kane_score", "Kane scores", "Harry Kane", 105, 3),
      overUnderMarket("var_reviews", "VAR Reviews", 1.5, 5, 4),
      overUnderMarket("yellow_cards", "Yellow Cards", 3.5, 5, 5),
      exactScoreMarket("exact_score", "Exact Score", 25, 6),
    ],
  },
  {
    external_match_id: "400021543",
    stage: "Final",
    team_a_code: "ESP",
    team_b_code: "ARG",
    label: "Final Slip",
    markets: [
      overUnderMarket("total_goals", "Total Goals", 2.5, 5, 1),
      scorerMarket("messi_score", "Messi scores", "Lionel Messi", 130, 2),
      scorerMarket("oyarzabal_score", "Oyarzabal scores", "Mikel Oyarzabal", 170, 3),
      overUnderMarket("var_reviews", "VAR Reviews", 1.5, 5, 4),
      overUnderMarket("yellow_cards", "Yellow Cards", 5.5, 5, 5),
      exactScoreMarket("exact_score", "Exact Score", 25, 6),
    ],
  },
]);

export function pointsFromAmericanOdds(odds) {
  const probability = impliedProbabilityFromAmericanOdds(odds);
  if (!probability) return { yes: 5, no: 5 };
  const yes = clampHalfPoint((1 - probability) * 10, 1, 9);
  const no = clampHalfPoint(10 - yes, 1, 9);
  return { yes, no };
}

export function getParlayFixtureByExternalMatchId(externalMatchId) {
  return PARLAY_FIXTURES.find((fixture) => String(fixture.external_match_id) === String(externalMatchId)) || null;
}

function overUnderMarket(key, label, line, points, displayOrder) {
  return {
    market_key: key,
    label,
    market_type: "over_under",
    line,
    display_order: displayOrder,
    options: [
      { option_key: "over", label: `Over ${line}`, points, sort_order: 1 },
      { option_key: "under", label: `Under ${line}`, points, sort_order: 2 },
    ],
  };
}

function yesNoMarket(key, label, points, displayOrder) {
  return {
    market_key: key,
    label,
    market_type: "boolean",
    line: null,
    display_order: displayOrder,
    options: [
      { option_key: "yes", label: "Yes", points, sort_order: 1 },
      { option_key: "no", label: "No", points, sort_order: 2 },
    ],
  };
}

function exactScoreMarket(key, label, points, displayOrder) {
  return {
    market_key: key,
    label,
    market_type: "exact_score",
    line: null,
    points,
    display_order: displayOrder,
    options: [],
  };
}

function scorerMarket(key, label, playerName, yesOdds, displayOrder) {
  const points = pointsFromAmericanOdds(yesOdds);
  return {
    market_key: key,
    label,
    market_type: "boolean",
    line: null,
    display_order: displayOrder,
    options: [
      { option_key: "yes", label: `${playerName}: Yes`, odds: yesOdds, points: points.yes, sort_order: 1 },
      { option_key: "no", label: `${playerName}: No`, odds: null, points: points.no, sort_order: 2 },
    ],
  };
}

function impliedProbabilityFromAmericanOdds(odds) {
  const value = Number(odds);
  if (!Number.isFinite(value) || value === 0) return null;
  if (value > 0) return 100 / (value + 100);
  return Math.abs(value) / (Math.abs(value) + 100);
}

function clampHalfPoint(value, min, max) {
  if (!Number.isFinite(value)) return min;
  const rounded = Math.round(value * 2) / 2;
  return Math.max(min, Math.min(max, rounded));
}
