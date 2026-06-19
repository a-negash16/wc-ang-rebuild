import test from "node:test";
import assert from "node:assert/strict";

import { OddsApiClient } from "../src/integrations/odds-api.js";

test("OddsApiClient builds a server-side odds request without exposing the key in code", async () => {
  const calls = [];
  const client = new OddsApiClient({
    apiKey: "test-key",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        headers: new Map([
          ["x-requests-remaining", "499"],
          ["x-requests-used", "1"],
        ]),
        json: async () => [{ id: "event-1" }],
      };
    },
  });

  const result = await client.getOdds({ sport: "soccer_fifa_world_cup", regions: "us" });
  assert.equal(result.remainingRequests, "499");
  assert.deepEqual(result.data, [{ id: "event-1" }]);
  assert.match(calls[0], /apiKey=test-key/);
  assert.match(calls[0], /markets=h2h/);
});
