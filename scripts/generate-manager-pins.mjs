import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { hashPinSha256 } from "../src/lib/auth/pin.js";
import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const args = process.argv.slice(2);
const write = args.includes("--write");
const onlyUnset = !args.includes("--all");
const length = Number(getArg("--length") || 6);
const outPath = getArg("--out") || path.join("private", "manager-pins.csv");

if (!Number.isInteger(length) || length < 4 || length > 12) {
  fail("--length must be a number between 4 and 12.");
}

const managers = await supabaseRest(
  [
    "/managers",
    "?select=id,manager_code,display_name,pin_hash,groups(slug)",
    "&is_active=eq.true",
    "&order=manager_code.asc",
  ].join("")
);

const targets = managers
  .filter((manager) => !onlyUnset || manager.pin_hash === "SET_BY_COMMISSIONER")
  .sort((a, b) => {
    const left = `${a.groups?.slug || ""}:${a.manager_code}`;
    const right = `${b.groups?.slug || ""}:${b.manager_code}`;
    return left.localeCompare(right);
  });

if (!targets.length) {
  console.log(onlyUnset ? "No unset manager PINs found." : "No managers found.");
  process.exit(0);
}

const assigned = new Set();
const rows = [];

for (const manager of targets) {
  const pin = uniquePin({ assigned, length });
  rows.push({
    group_slug: manager.groups?.slug || "",
    manager_code: manager.manager_code,
    manager_name: manager.display_name,
    pin,
    manager_id: manager.id,
  });
}

await writeCsv(outPath, rows);

console.log(`Generated ${rows.length} manager PINs.`);
console.log(`Local PIN file: ${outPath}`);

if (!write) {
  console.log("Dry run only. Add --write to update Supabase manager pin_hash values.");
  process.exit(0);
}

for (const row of rows) {
  await supabaseRest(`/managers?id=eq.${row.manager_id}`, {
    method: "PATCH",
    body: JSON.stringify({ pin_hash: hashPinSha256(row.pin) }),
    headers: { Prefer: "return=minimal" },
  });
}

console.log("Supabase manager PIN hashes updated.");

function getArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function uniquePin({ assigned, length }) {
  let pin = "";
  do {
    pin = crypto.randomInt(0, 10 ** length).toString().padStart(length, "0");
  } while (assigned.has(pin));
  assigned.add(pin);
  return pin;
}

async function writeCsv(filePath, rows) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const header = ["group_slug", "manager_code", "manager_name", "pin"];
  const lines = [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
  ];
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

function csvEscape(value) {
  const text = String(value || "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
