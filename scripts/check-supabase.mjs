import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();

requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const groupsResult = await restGet("/groups?select=slug,name&order=slug.asc");
const managersResult = await restGet("/managers?select=id", { count: true });
const matchesResult = await restGet("/matches?select=id", { count: true });

const groups = groupsResult.data;
const slugs = groups.map((group) => group.slug);
const expected = ["dagi-united", "squad", "tikur-abay"];
const missing = expected.filter((slug) => !slugs.includes(slug));

if (missing.length) {
  fail(`Connected, but missing groups: ${missing.join(", ")}`);
}

console.log("Supabase connection OK");
console.log(`Groups: ${groups.map((group) => group.slug).join(", ")}`);
console.log(`Managers: ${managersResult.count ?? "unknown"}`);
console.log(`Matches: ${matchesResult.count ?? "unknown"}`);

async function restGet(endpoint, options = {}) {
  const response = await supabaseRest(endpoint, {
    rawResponse: true,
    headers: options.count ? { Prefer: "count=exact" } : {},
  });
  const text = await response.text();
  if (!response.ok) {
    fail(`Supabase request failed (${response.status}): ${text}`);
  }

  return {
    data: JSON.parse(text || "[]"),
    count: parseContentRange(response.headers.get("content-range")),
  };
}

function parseContentRange(value) {
  if (!value || !value.includes("/")) return null;
  const total = value.split("/").at(-1);
  return total === "*" ? null : Number(total);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
