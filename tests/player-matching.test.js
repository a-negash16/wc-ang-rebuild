import test from "node:test";
import assert from "node:assert/strict";

import { playerNamesMatch } from "../src/rules/player-matching.js";

test("player names match despite accents and casing differences", () => {
  assert.equal(playerNamesMatch("Julián Quiñones", "Julian QUINONES"), true);
  assert.equal(playerNamesMatch("Raul Jimenez", "Raúl JIMENEZ"), true);
});

test("player names match regardless of word order", () => {
  assert.equal(playerNamesMatch("Erik Lira", "Lira Erik"), true);
});

test("different players do not match", () => {
  assert.equal(playerNamesMatch("Erik Lira", "Julian Quinones"), false);
  assert.equal(playerNamesMatch("", "Julian Quinones"), false);
});
