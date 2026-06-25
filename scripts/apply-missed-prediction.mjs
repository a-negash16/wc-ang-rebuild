import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const args = parseArgs(process.argv.slice(2));
const required = ["group", "manager", "match", "pick"];
const missing = required.filter((name) => !args[name]);
if (missing.length) {
  fail(`Missing required args: ${missing.join(", ")}

Example:
  npm run apply:missed-prediction -- --group tikur-abay --manager Ermi --match "Uruguay v Cabo Verde" --pick Tie --reason "commissioner approved missed prediction" --write
`);
}

const writeMode = Boolean(args.write);
const groupSlug = normalize(args.group);
const managerName = normalize(args.manager);
const matchQuery = normalize(args.match);
const pickInput = normalize(args.pick);
const reason = normalize(args.reason) || "commissioner approved missed prediction";

const group = await one(
  `/groups?select=id,slug&slug=eq.${encodeURIComponent(groupSlug)}&is_active=eq.true`,
  `Group not found: ${groupSlug}`
);
const manager = await one(
  `/managers?select=id,manager_code,display_name&group_id=eq.${group.id}&display_name=eq.${encodeURIComponent(managerName)}&is_active=eq.true`,
  `Manager not found in ${groupSlug}: ${managerName}`
);
const commissioner = await maybeOne(
  `/managers?select=id&group_id=eq.${group.id}&manager_code=eq.M001&display_name=eq.Abrham`
);
const match = await findMatch(matchQuery);
const pick = resolvePick({ match, pickInput });
const existing = await maybeOne(
  `/predictions?select=id,pick_type,pick_team_id&group_id=eq.${group.id}&manager_id=eq.${manager.id}&match_id=eq.${match.id}&status=eq.active`
);

const alreadyCorrect = existing
  && existing.pick_type === pick.pick_type
  && (existing.pick_team_id || null) === pick.pick_team_id;

const summary = {
  mode: writeMode ? "write" : "dry-run",
  group: group.slug,
  manager: manager.display_name,
  manager_code: manager.manager_code,
  match: `${match.team_a.name} v ${match.team_b.name}`,
  external_match_id: match.external_match_id,
  pick: pick.label,
  existing_pick: existing ? formatExistingPick(existing, match) : null,
  action: alreadyCorrect ? "already_correct" : existing ? "update" : "insert",
};

if (!writeMode || alreadyCorrect) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const now = new Date().toISOString();
const predictionRow = {
  group_id: group.id,
  manager_id: manager.id,
  match_id: match.id,
  pick_type: pick.pick_type,
  pick_team_id: pick.pick_team_id,
  updated_at: now,
  status: "active",
};

let predictionId = existing?.id || null;
if (existing) {
  await write(`/predictions?id=eq.${existing.id}`, "PATCH", predictionRow);
} else {
  const inserted = await write("/predictions", "POST", {
    ...predictionRow,
    submitted_at: now,
  }, { Prefer: "return=representation" });
  predictionId = inserted?.[0]?.id || null;
}

await write("/prediction_audit", "POST", {
  prediction_id: predictionId,
  group_id: group.id,
  manager_id: manager.id,
  match_id: match.id,
  old_pick_type: existing?.pick_type || null,
  old_pick_team_id: existing?.pick_team_id || null,
  new_pick_type: pick.pick_type,
  new_pick_team_id: pick.pick_team_id,
  changed_by: commissioner?.id || null,
  reason: `commissioner_missed_prediction: ${reason}`,
});

console.log(JSON.stringify({ ...summary, wrote_audit: true }, null, 2));

async function findMatch(query) {
  const matches = await supabaseRest(
    "/matches?select=id,external_match_id,kickoff_at,team_a_id,team_b_id,team_a:team_a_id(id,name,fifa_code),team_b:team_b_id(id,name,fifa_code)&limit=200"
  );
  const normalizedQuery = normalizeName(query);
  const candidates = matches.filter((match) => {
    const pair = normalizeName(`${match.team_a?.name || ""} v ${match.team_b?.name || ""}`);
    const reversePair = normalizeName(`${match.team_b?.name || ""} v ${match.team_a?.name || ""}`);
    return pair.includes(normalizedQuery) || reversePair.includes(normalizedQuery);
  });

  if (candidates.length !== 1) {
    fail(`Expected exactly one match for "${query}", found ${candidates.length}: ${candidates.map((match) => {
      return `${match.external_match_id} ${match.team_a?.name} v ${match.team_b?.name}`;
    }).join("; ")}`);
  }
  return candidates[0];
}

function resolvePick({ match, pickInput }) {
  const normalizedPick = normalizeName(pickInput);
  if (["tie", "draw"].includes(normalizedPick)) {
    return { pick_type: "tie", pick_team_id: null, label: "Tie" };
  }

  const teamA = normalizeName(match.team_a?.name);
  const teamB = normalizeName(match.team_b?.name);
  if (teamA.includes(normalizedPick) || normalizedPick.includes(teamA)) {
    return { pick_type: "team_a", pick_team_id: match.team_a_id, label: match.team_a.name };
  }
  if (teamB.includes(normalizedPick) || normalizedPick.includes(teamB)) {
    return { pick_type: "team_b", pick_team_id: match.team_b_id, label: match.team_b.name };
  }

  fail(`Pick "${pickInput}" does not match ${match.team_a.name}, ${match.team_b.name}, or Tie`);
}

function formatExistingPick(existing, match) {
  if (!existing) return null;
  if (existing.pick_type === "tie") return "Tie";
  if (existing.pick_team_id === match.team_a_id) return match.team_a.name;
  if (existing.pick_team_id === match.team_b_id) return match.team_b.name;
  return existing.pick_type;
}

async function one(pathname, message) {
  const rows = await supabaseRest(pathname);
  if (rows.length !== 1) fail(`${message} (${rows.length} rows)`);
  return rows[0];
}

async function maybeOne(pathname) {
  const rows = await supabaseRest(pathname);
  return rows[0] || null;
}

async function write(pathname, method, body, headers = {}) {
  return supabaseRest(pathname, {
    method,
    body: JSON.stringify(body),
    headers,
  });
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function normalize(value) {
  return String(value || "").trim();
}

function normalizeName(value) {
  return normalize(value)
    .toLowerCase()
    .replace(/\bir\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
