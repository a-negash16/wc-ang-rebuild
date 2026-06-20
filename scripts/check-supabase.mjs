import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();

requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const strict = process.argv.includes("--strict");

const groupsResult = await restGet("/groups?select=slug,name&order=slug.asc");
const managersResult = await restGet("/managers?select=id", { count: true });
const matchesResult = await restGet("/matches?select=id", { count: true });
const unsetPinResult = await restGet(
  "/managers?select=manager_code,display_name,groups(slug)&pin_hash=eq.SET_BY_COMMISSIONER&order=manager_code.asc"
);

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

if (unsetPinResult.data.length) {
  console.log("");
  console.log("Manager PINs still unset:");
  for (const manager of unsetPinResult.data) {
    console.log(`- ${manager.groups?.slug || "unknown"} ${manager.manager_code} ${manager.display_name}`);
  }
  if (strict) {
    fail("Set all manager PIN hashes before launch.");
  }
  console.log("Warning: set all manager PIN hashes before launch. Run with --strict to fail on this.");
}

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
