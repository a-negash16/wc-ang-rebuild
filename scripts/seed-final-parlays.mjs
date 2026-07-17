import { PARLAY_FIXTURES } from "../src/rules/parlay.js";
import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const teamCodes = [...new Set(PARLAY_FIXTURES.flatMap((fixture) => [fixture.team_a_code, fixture.team_b_code]))];
const teams = await supabaseRest(`/teams?select=id,fifa_code,name&fifa_code=in.(${teamCodes.join(",")})`);
const teamByCode = new Map((teams || []).map((team) => [team.fifa_code, team]));

await updateFinalFixtures(teamByCode);
await upsertParlayMarkets();

console.log(JSON.stringify({
  ok: true,
  message: "Final and third-place parlay slips seeded",
  fixtures: PARLAY_FIXTURES.map((fixture) => ({
    external_match_id: fixture.external_match_id,
    stage: fixture.stage,
    markets: fixture.markets.length,
  })),
}, null, 2));

async function updateFinalFixtures(teamByCode) {
  for (const fixture of PARLAY_FIXTURES) {
    const teamA = teamByCode.get(fixture.team_a_code);
    const teamB = teamByCode.get(fixture.team_b_code);
    if (!teamA || !teamB) throw new Error(`Missing team for ${JSON.stringify(fixture)}`);
    await supabaseRest(`/matches?external_match_id=eq.${fixture.external_match_id}`, {
      method: "PATCH",
      body: JSON.stringify({
        team_a_id: teamA.id,
        team_b_id: teamB.id,
        status: "scheduled",
      }),
    });
  }
}

async function upsertParlayMarkets() {
  const matches = await supabaseRest(`/matches?select=id,external_match_id&external_match_id=in.(${PARLAY_FIXTURES.map((fixture) => fixture.external_match_id).join(",")})`);
  const matchByExternalId = new Map((matches || []).map((match) => [String(match.external_match_id), match]));

  const marketRows = PARLAY_FIXTURES.flatMap((fixture) => {
    const match = matchByExternalId.get(String(fixture.external_match_id));
    if (!match) throw new Error(`Missing match ${fixture.external_match_id}`);
    return fixture.markets.map((market) => ({
      match_id: match.id,
      stage: fixture.stage,
      market_key: market.market_key,
      label: market.label,
      market_type: market.market_type,
      line: market.line,
      points: market.points || 0,
      display_order: market.display_order,
      is_active: true,
    }));
  });

  let response = await supabaseRest("/parlay_markets?on_conflict=match_id,market_key", {
    method: "POST",
    body: JSON.stringify(marketRows),
    headers: { Prefer: "resolution=merge-duplicates" },
    rawResponse: true,
  });
  let text = await response.text();
  if (!response.ok) {
    throw new Error(`Could not seed parlay_markets. Apply migration 0012 first. ${response.status}: ${text}`);
  }
  await deactivateRemovedMarkets(matchByExternalId);

  const markets = await supabaseRest(`/parlay_markets?select=id,match_id,market_key,matches(external_match_id)&market_key=in.(${[...new Set(marketRows.map((row) => row.market_key))].join(",")})`);
  const marketByFixtureKey = new Map((markets || []).map((market) => [
    `${market.matches?.external_match_id}:${market.market_key}`,
    market,
  ]));
  const optionRows = PARLAY_FIXTURES.flatMap((fixture) => {
    return fixture.markets.flatMap((market) => {
      const storedMarket = marketByFixtureKey.get(`${fixture.external_match_id}:${market.market_key}`);
      if (!storedMarket) throw new Error(`Missing market ${fixture.external_match_id}:${market.market_key}`);
      return (market.options || []).map((option) => ({
        market_id: storedMarket.id,
        option_key: option.option_key,
        label: option.label,
        odds: option.odds ?? null,
        points: option.points,
        sort_order: option.sort_order,
      }));
    });
  });

  response = await supabaseRest("/parlay_options?on_conflict=market_id,option_key", {
    method: "POST",
    body: JSON.stringify(optionRows),
    headers: { Prefer: "resolution=merge-duplicates" },
    rawResponse: true,
  });
  text = await response.text();
  if (!response.ok) {
    throw new Error(`Could not seed parlay_options. ${response.status}: ${text}`);
  }
}

async function deactivateRemovedMarkets(matchByExternalId) {
  for (const fixture of PARLAY_FIXTURES) {
    const match = matchByExternalId.get(String(fixture.external_match_id));
    if (!match) continue;
    const activeKeys = new Set(fixture.markets.map((market) => market.market_key));
    const existing = await supabaseRest(`/parlay_markets?select=id,market_key&match_id=eq.${match.id}`);
    const stale = (existing || []).filter((market) => !activeKeys.has(market.market_key));
    if (!stale.length) continue;
    const ids = stale.map((market) => market.id).join(",");
    await supabaseRest(`/parlay_markets?id=in.(${ids})`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false }),
    });
  }
}
