import test from "node:test";
import assert from "node:assert/strict";

import { normalizeFifaMatch, normalizeFifaTimeline } from "../src/integrations/fifa-api.js";

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

test("FIFA penalty result normalizes match length to Pens", () => {
  const match = normalizeFifaMatch({
    IdMatch: "400021522",
    Date: "2026-06-30T01:00:00Z",
    MatchStatus: 0,
    MatchTime: "130'",
    ResultType: 2,
    HomeTeamScore: 1,
    AwayTeamScore: 1,
    HomeTeamPenaltyScore: 2,
    AwayTeamPenaltyScore: 3,
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

  assert.equal(match.length, "Pens");
});

test("FIFA extra-time result normalizes match length to ET without penalties", () => {
  const match = normalizeFifaMatch({
    IdMatch: "400021600",
    Date: "2026-07-01T01:00:00Z",
    MatchStatus: 0,
    MatchTime: "121'",
    ResultType: 1,
    HomeTeamScore: 2,
    AwayTeamScore: 1,
    Winner: "FRA-FIFA-ID",
    Home: {
      IdTeam: "FRA-FIFA-ID",
      Abbreviation: "FRA",
    },
    Away: {
      IdTeam: "GER-FIFA-ID",
      Abbreviation: "GER",
    },
  });

  assert.equal(match.length, "ET");
});

test("FIFA timeline extracts goal and assist events, drops everything else", () => {
  const timeline = normalizeFifaTimeline({
    Event: [
      { EventId: "1", Type: 79, IdPlayer: "1" },
      { EventId: "2", Type: 0, IdPlayer: "429157", EventDescription: [{ Description: "Julian QUINONES (Mexico) scores!!" }] },
      { EventId: "3", Type: 1, IdPlayer: "419518", EventDescription: [{ Description: "Assisted by Erik LIRA." }] },
      { EventId: "4", Type: 18, IdPlayer: "395050" },
    ],
  });

  assert.equal(timeline.events.length, 2);
  assert.deepEqual(timeline.events.map((event) => event.type), [0, 1]);
  assert.equal(timeline.events[0].playerId, "429157");
  assert.equal(timeline.events[1].playerId, "419518");
});

test("FIFA timeline flags own goals so they don't credit the scorer", () => {
  const timeline = normalizeFifaTimeline({
    Event: [
      { EventId: "1", Type: 0, IdPlayer: "1", EventDescription: [{ Description: "Own Goal by Aubrey MODIBA." }] },
      { EventId: "2", Type: 0, IdPlayer: "2", EventDescription: [{ Description: "Raul JIMENEZ (Mexico) scores!!" }] },
    ],
  });

  assert.equal(timeline.events[0].isOwnGoal, true);
  assert.equal(timeline.events[1].isOwnGoal, false);
});
