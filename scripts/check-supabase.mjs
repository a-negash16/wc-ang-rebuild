import fs from "node:fs";

import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();

requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const strict = process.argv.includes("--strict");

const groupsResult = await restGet("/groups?select=slug,name&order=slug.asc");
const managersResult = await restGet("/managers?select=id", { count: true });
const matchesResult = await restGet("/matches?select=id", { count: true });
const activeManagersResult = await restGet(
  "/managers?select=manager_code,display_name,pin_hash,role,groups(slug)&is_active=eq.true&order=manager_code.asc"
);
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

const activeManagers = activeManagersResult.data;
const managerKeys = activeManagers.map(managerKey);
const commissionerProblems = expected.flatMap((slug) => {
  const commissioner = activeManagers.find((manager) => {
    return manager.groups?.slug === slug
      && manager.manager_code === "M001"
      && manager.display_name === "Abrham";
  });
  if (!commissioner) return [`${slug} M001 Abrham is missing`];
  if (commissioner.role !== "commissioner") return [`${slug} M001 Abrham role is ${commissioner.role}`];
  return [];
});

if (commissionerProblems.length) {
  console.log("");
  console.log("Commissioner role problems:");
  for (const problem of commissionerProblems) {
    console.log(`- ${problem}`);
  }
  if (strict) fail("Abrham must be commissioner in all groups before launch.");
  console.log("Warning: Abrham should be commissioner in all groups. Run with --strict to fail on this.");
} else {
  console.log("Commissioners: Abrham/M001 is commissioner in all groups");
}

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
} else {
  console.log("Manager PIN hashes: all active managers are set");
}

const privatePinCoverage = readPrivatePinCoverage();
if (privatePinCoverage) {
  const missingPrivateRows = managerKeys.filter((key) => !privatePinCoverage.has(key));
  if (missingPrivateRows.length) {
    console.log("");
    console.log("Managers missing from private/manager-pins.csv:");
    for (const key of missingPrivateRows) {
      console.log(`- ${key}`);
    }
    if (strict) fail("Private manager PIN CSV is missing active managers.");
    console.log("Warning: private PIN CSV is incomplete. Run with --strict to fail on this.");
  } else {
    console.log("Private PIN CSV: covers all active managers");
  }
} else {
  console.log("Private PIN CSV: not found, skipped local coverage check");
  if (strict) fail("private/manager-pins.csv is required for strict launch checks.");
}

console.log("");
console.log("Active predictions:");
for (const group of expected) {
  const result = await restGet(
    `/active_prediction_details?select=prediction_id&group_slug=eq.${encodeURIComponent(group)}`,
    { count: true }
  );
  console.log(`- ${group}: ${result.count ?? "unknown"}`);
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

function readPrivatePinCoverage() {
  const filePath = "private/manager-pins.csv";
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).slice(1);
  return new Set(lines.map((line) => {
    const [groupSlug, managerCode] = parseCsvLine(line);
    return `${groupSlug}:${managerCode}`;
  }));
}

function managerKey(manager) {
  return `${manager.groups?.slug || "unknown"}:${manager.manager_code}`;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
