import test from "node:test";
import assert from "node:assert/strict";

import { normalizeFifaMatch } from "../src/integrations/fifa-api.js";

test("FIFA tied knockout score still preserves the declared winner", () => {
  const match = normalizeFifaMatch({
    IdMatch: "400021522",
    Date: "2026-06-30T01:00:00Z",
    MatchStatus: 0,
    ResultType: 1,
    HomeTeamScore: 1,
    AwayTeamScore: 1,
    Winner: "MAR-FIFA-ID",
    Home: {
      IdTeam: "NED-FIFA-ID",
      Abbreviation: "NED",
    },
    Away: {
      IdTeam: "MAR-FIFA-ID",
      Abbreviation: "MAR",
    },
  });

  assert.equal(match.status, "finished");
  assert.equal(match.team_a_score, 1);
  assert.equal(match.team_b_score, 1);
  assert.equal(match.winner_code, "MAR");
});
