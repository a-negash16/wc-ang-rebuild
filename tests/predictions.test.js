import test from "node:test";
import assert from "node:assert/strict";

import {
  isPredictionLocked,
  validateFirstScorePickForMatch,
  validateLengthPickForMatch,
  validatePickForMatch,
} from "../src/rules/predictions.js";

test("prediction deadline locks before kickoff", () => {
  const now = new Date("2026-06-19T17:59:00Z");
  assert.equal(isPredictionLocked({
    kickoffAt: "2026-06-19T19:00:00Z",
    lockMinutesBeforeKickoff: 60,
    now,
  }), false);

  assert.equal(isPredictionLocked({
    kickoffAt: "2026-06-19T19:00:00Z",
    lockMinutesBeforeKickoff: 60,
    now: new Date("2026-06-19T18:00:00Z"),
  }), true);
});

test("group stage allows tie but knockouts require a winner", () => {
  assert.deepEqual(validatePickForMatch({
    pickType: "tie",
    match: { stage: "Group Stage", team_a: {}, team_b: {} },
  }), { ok: true });

  assert.equal(validatePickForMatch({
    pickType: "tie",
    match: { stage: "Round of 32", team_a: {}, team_b: {} },
  }).ok, false);
});

test("length risk picks are knockout-only and ET/Pens-only", () => {
  assert.deepEqual(validateLengthPickForMatch({
    lengthPick: "ET",
    match: { stage: "Round of 32" },
  }), { ok: true });

  assert.equal(validateLengthPickForMatch({
    lengthPick: "90",
    match: { stage: "Round of 32" },
  }).ok, false);

  assert.equal(validateLengthPickForMatch({
    lengthPick: "Pens",
    match: { stage: "Group Stage" },
  }).ok, false);
});

test("first score risk picks are knockout-only team-side picks", () => {
  assert.deepEqual(validateFirstScorePickForMatch({
    firstScorePick: "team_a",
    match: { stage: "Quarterfinal", team_a: {}, team_b: {} },
  }), { ok: true });

  assert.equal(validateFirstScorePickForMatch({
    firstScorePick: "tie",
    match: { stage: "Quarterfinal", team_a: {}, team_b: {} },
  }).ok, false);

  assert.equal(validateFirstScorePickForMatch({
    firstScorePick: "team_b",
    match: { stage: "Group Stage", team_a: {}, team_b: {} },
  }).ok, false);
});
