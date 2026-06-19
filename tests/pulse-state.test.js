import test from "node:test";
import assert from "node:assert/strict";

import { isPredictionLocked } from "../src/rules/predictions.js";

test("pulse reveal shares the same deadline rule as prediction lock", () => {
  const kickoffAt = "2026-06-19T20:00:00Z";
  const beforeDeadline = new Date("2026-06-19T18:59:59Z");
  const atDeadline = new Date("2026-06-19T19:00:00Z");

  assert.equal(isPredictionLocked({
    kickoffAt,
    lockMinutesBeforeKickoff: 60,
    now: beforeDeadline,
  }), false);

  assert.equal(isPredictionLocked({
    kickoffAt,
    lockMinutesBeforeKickoff: 60,
    now: atDeadline,
  }), true);
});
