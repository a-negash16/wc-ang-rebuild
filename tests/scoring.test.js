import test from "node:test";
import assert from "node:assert/strict";

import {
  scoreDraftedPlayer,
  scoreDraftedTeam,
  scoreFuturesChampionPick,
  scoreFirstScoreRisk,
  scoreGroupStagePick,
  scoreKnockoutLengthRisk,
  scoreKnockoutWinnerPick,
  scoreParlaySlip,
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
    pickedTeamId: "QF_UNDERDOG",
    winnerTeamId: "QF_UNDERDOG",
    teamPointValues: { QF_FAVORITE: 5, QF_UNDERDOG: 10 },
  }), 10);

  assert.equal(scoreKnockoutWinnerPick({
    pickedTeamId: "FAVORITE",
    winnerTeamId: "UNDERDOG",
    teamPointValues: { FAVORITE: 3, UNDERDOG: 7 },
  }), 0);
});

test("knockout length risk wins and loses points", () => {
  assert.equal(scoreKnockoutLengthRisk({
    pickedLength: "ET",
    actualLength: "ET",
  }), 4);

  assert.equal(scoreKnockoutLengthRisk({
    pickedLength: "ET",
    actualLength: "Pens",
  }), -2);

  assert.equal(scoreKnockoutLengthRisk({
    pickedLength: "Pens",
    actualLength: "Pens",
  }), 8);

  assert.equal(scoreKnockoutLengthRisk({
    pickedLength: "Pens",
    actualLength: "90",
  }), -4);

  assert.equal(scoreKnockoutLengthRisk({
    pickedLength: null,
    actualLength: "Pens",
  }), 0);
});

test("first score risk wins and loses points only after actual first score is set", () => {
  assert.equal(scoreFirstScoreRisk({
    pickedTeamId: "FRA",
    actualTeamId: "FRA",
  }), 3);

  assert.equal(scoreFirstScoreRisk({
    pickedTeamId: "FRA",
    actualTeamId: "MAR",
  }), -1);

  assert.equal(scoreFirstScoreRisk({
    pickedTeamId: "FRA",
    actualTeamId: null,
  }), 0);
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

test("final parlay slip applies completion multipliers only after grading", () => {
  assert.equal(scoreParlaySlip({
    requiredCount: 3,
    selections: [
      { points: 5, is_correct: true },
      { points: 6.5, is_correct: true },
      { points: 4, is_correct: true },
    ],
  }), 31);

  assert.equal(scoreParlaySlip({
    requiredCount: 3,
    selections: [
      { points: 5, is_correct: true },
      { points: 6.5, is_correct: false },
      { points: 4, is_correct: true },
    ],
  }), 13.5);

  assert.equal(scoreParlaySlip({
    requiredCount: 3,
    selections: [
      { points: 5, is_correct: true },
      { points: 6.5, is_correct: null },
      { points: 4, is_correct: true },
    ],
  }), 0);
});

test("leaderboard total sums all scoring buckets", () => {
  assert.equal(totalLeaderboardPoints({
    groupStage: 15,
    knockoutPredictions: 12,
    knockoutRisks: -2,
    parlays: 13.5,
    futures: 100,
    draftedTeams: 30,
    draftedPlayers: 25,
    manualAdjustments: 20,
  }), 213.5);
});
