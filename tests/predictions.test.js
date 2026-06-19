import test from "node:test";
import assert from "node:assert/strict";

import { isPredictionLocked, validatePickForMatch } from "../src/rules/predictions.js";

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
