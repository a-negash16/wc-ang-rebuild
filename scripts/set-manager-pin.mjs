import { hashPinSha256 } from "../src/lib/auth/pin.js";
import { loadEnvLocal, requireEnv, supabaseRest } from "./supabase-rest.mjs";

loadEnvLocal();
requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const [groupSlug, managerCode, pin] = process.argv.slice(2);

if (!groupSlug || !managerCode || !pin) {
  console.error("Usage: node scripts/set-manager-pin.mjs <group-slug> <manager-code> <pin>");
  process.exit(1);
}

const groups = await supabaseRest(`/groups?select=id,slug&slug=eq.${encodeURIComponent(groupSlug)}`);
const group = groups[0];
if (!group) {
  fail(`Group not found: ${groupSlug}`);
}

const managers = await supabaseRest(
  `/managers?select=id,manager_code,display_name&group_id=eq.${group.id}&manager_code=eq.${encodeURIComponent(managerCode)}`
);
const manager = managers[0];
if (!manager) {
  fail(`Manager not found: ${groupSlug} ${managerCode}`);
}

await supabaseRest(`/managers?id=eq.${manager.id}`, {
  method: "PATCH",
  body: JSON.stringify({ pin_hash: hashPinSha256(pin) }),
  headers: { Prefer: "return=minimal" },
});

console.log(`PIN hash updated for ${groupSlug} ${manager.manager_code} (${manager.display_name})`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
