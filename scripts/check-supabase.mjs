import fs from "node:fs";
import path from "node:path";

loadEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const baseUrl = supabaseUrl.replace(/\/$/, "");
const groupsResult = await restGet("/rest/v1/groups?select=slug,name&order=slug.asc");
const managersResult = await restGet("/rest/v1/managers?select=id", { count: true });
const matchesResult = await restGet("/rest/v1/matches?select=id", { count: true });

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
  const response = await fetch(`${baseUrl}${endpoint}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: options.count ? "count=exact" : "",
    },
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

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    process.env[key.trim()] ||= value;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
