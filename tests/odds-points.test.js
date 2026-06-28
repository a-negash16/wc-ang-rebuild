import test from "node:test";
import assert from "node:assert/strict";

import {
  americanOddsToImpliedProbability,
  calculateTwoTeamPointSplit,
  namesMatch,
} from "../src/rules/odds-points.js";

test("american odds convert to implied probability", () => {
  assert.equal(Number(americanOddsToImpliedProbability(-100).toFixed(3)), 0.5);
  assert.equal(Number(americanOddsToImpliedProbability(300).toFixed(2)), 0.25);
});

test("two-team odds split into 10 half-point values favoring the underdog", () => {
  assert.deepEqual(calculateTwoTeamPointSplit({ teamAOdds: -100, teamBOdds: -100 }), {
    team_a_points: 5,
    team_b_points: 5,
    team_a_probability: 0.5,
    team_b_probability: 0.5,
  });

  assert.equal(calculateTwoTeamPointSplit({ teamAOdds: -295, teamBOdds: 900 }).team_a_points, 3);
  assert.equal(calculateTwoTeamPointSplit({ teamAOdds: -295, teamBOdds: 900 }).team_b_points, 7);
  assert.equal(calculateTwoTeamPointSplit({ teamAOdds: 115, teamBOdds: 295 }).team_a_points, 3.5);
  assert.equal(calculateTwoTeamPointSplit({ teamAOdds: 115, teamBOdds: 295 }).team_b_points, 6.5);
  assert.equal(calculateTwoTeamPointSplit({ teamAOdds: 230, teamBOdds: 150 }).team_a_points, 5.5);
  assert.equal(calculateTwoTeamPointSplit({ teamAOdds: 230, teamBOdds: 150 }).team_b_points, 4.5);
});

test("team aliases normalize bookmaker names to database names", () => {
  assert.equal(namesMatch("Ivory Coast", "Côte d'Ivoire"), true);
  assert.equal(namesMatch("Iran", "IR Iran"), true);
  assert.equal(namesMatch("DR Congo", "Congo DR"), true);
  assert.equal(namesMatch("Cape Verde", "Cabo Verde"), true);
  assert.equal(namesMatch("United States", "USA"), true);
});
