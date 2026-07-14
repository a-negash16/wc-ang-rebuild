import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultLockedFutureCategories,
  getRequiredLockedFutureCategoryKeys,
  isLockedFuturePickDeadlinePassed,
  requiresLockedFuturePicksForStage,
  validateLockedFutureSelections,
} from "./future-picks.js";

test("semi-final locked futures require every category", () => {
  const categories = buildDefaultLockedFutureCategories();
  const partial = validateLockedFutureSelections({ champion: "FRA" }, categories);
  assert.equal(partial.ok, false);
  assert.ok(partial.missing.includes("best_offense"));

  const selections = Object.fromEntries(
    getRequiredLockedFutureCategoryKeys().map((categoryKey) => {
      const category = categories.find((item) => item.key === categoryKey);
      return [categoryKey, category.options[0].option_key];
    })
  );
  const complete = validateLockedFutureSelections(selections, categories);
  assert.equal(complete.ok, true);
});

test("locked futures gate only the semi-final stage", () => {
  assert.equal(requiresLockedFuturePicksForStage("Semifinal"), true);
  assert.equal(requiresLockedFuturePicksForStage("Quarterfinal"), false);
  assert.equal(requiresLockedFuturePicksForStage("Final"), false);
});


test("semi-final locked futures deadline is 3:15 PM New York time on July 14", () => {
  assert.equal(isLockedFuturePickDeadlinePassed({ now: new Date("2026-07-14T19:14:59.000Z") }), false);
  assert.equal(isLockedFuturePickDeadlinePassed({ now: new Date("2026-07-14T19:15:00.000Z") }), true);
});
