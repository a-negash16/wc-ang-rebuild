import test from "node:test";
import assert from "node:assert/strict";

import {
  scoreDraftedPlayer,
  scoreDraftedTeam,
  scoreFuturesChampionPick,
  scoreGroupStagePick,
  scoreKnockoutLengthPick,
  scoreKnockoutWinnerPick,
  totalLeaderboardPoints,
} from "../src/rules/scoring.js";

test("group stage scores correct winner and tie picks", () => {
  assert.equal(scoreGroupStagePick({
    pickType: "team",
    pickedTeamId: "MEX",
    result: { status: "finished", winnerType: "team", winnerTeamId: "MEX" },
  }), 3);

  assert.equal(scoreGroupStagePick({
    pickType: "tie",
    result: { status: "finished", winnerType: "tie" },
  }), 5);

  assert.equal(scoreGroupStagePick({
    pickType: "team",
    pickedTeamId: "RSA",
    result: { status: "finished", winnerType: "team", winnerTeamId: "MEX" },
  }), 0);
});

test("knockout winner uses odds-weighted team point values", () => {
  assert.equal(scoreKnockoutWinnerPick({
    pickedTeamId: "UNDERDOG",
    winnerTeamId: "UNDERDOG",
    teamPointValues: { FAVORITE: 3, UNDERDOG: 6.5 },
  }), 6.5);

  assert.equal(scoreKnockoutWinnerPick({
    pickedTeamId: "FAVORITE",
    winnerTeamId: "UNDERDOG",
    teamPointValues: { FAVORITE: 3, UNDERDOG: 7 },
  }), 0);
});

test("knockout length picks are a flat bonus, not odds-weighted", () => {
  assert.equal(scoreKnockoutLengthPick({ pickedLength: "ET", actualLength: "ET" }), 5);
  assert.equal(scoreKnockoutLengthPick({ pickedLength: "Pens", actualLength: "Pens" }), 8);
  assert.equal(scoreKnockoutLengthPick({ pickedLength: "90", actualLength: "90" }), 0);
  assert.equal(scoreKnockoutLengthPick({ pickedLength: "ET", actualLength: "Pens" }), 0);
  assert.equal(scoreKnockoutLengthPick({ pickedLength: "ET", actualLength: null }), 0);
});

test("drafted teams score 10 points per stage advanced", () => {
  assert.equal(scoreDraftedTeam({ stagesAdvanced: 0 }), 0);
  assert.equal(scoreDraftedTeam({ stagesAdvanced: 3 }), 30);
});

test("drafted players score goals, assists, and player of the match only", () => {
  assert.equal(scoreDraftedPlayer({
    goals: 1,
    assists: 2,
    playerOfMatch: 1,
  }), 18);

  assert.equal(scoreDraftedPlayer({
    cleanSheets: 2,
    penaltySaves: 1,
  }), 0);
});

test("futures champion uses odds-weighted point values", () => {
  assert.equal(scoreFuturesChampionPick({
    pickedTeamId: "LONGSHOT",
    championTeamId: "LONGSHOT",
    teamPointValues: { FAVORITE: 12, LONGSHOT: 100 },
  }), 100);

  assert.equal(scoreFuturesChampionPick({
    pickedTeamId: "FAVORITE",
    championTeamId: "LONGSHOT",
    teamPointValues: { FAVORITE: 12, LONGSHOT: 100 },
  }), 0);
});

test("leaderboard total sums all scoring buckets", () => {
  assert.equal(totalLeaderboardPoints({
    groupStage: 15,
    knockoutPredictions: 12,
    futures: 100,
    draftedTeams: 30,
    draftedPlayers: 25,
    manualAdjustments: 20,
  }), 202);
});
