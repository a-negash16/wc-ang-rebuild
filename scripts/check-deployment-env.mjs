import { loadEnvLocal } from "./supabase-rest.mjs";

loadEnvLocal();

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SESSION_SECRET",
  "ODDS_API_KEY",
];

const missing = required.filter((name) => !process.env[name]);
const issues = [];

if (missing.length) {
  issues.push(`Missing required env vars: ${missing.join(", ")}`);
}

const sessionSecret = process.env.SESSION_SECRET || "";
if (sessionSecret.length > 0 && sessionSecret.length < 32) {
  issues.push("SESSION_SECRET should be at least 32 characters.");
}

if (sessionSecret === "local-dev-session-secret-change-before-production") {
  issues.push("SESSION_SECRET is using the local fallback value.");
}

if (process.env.DEV_MANAGER_PIN) {
  issues.push("DEV_MANAGER_PIN is set. Clear it before real deployment.");
}

if (process.env.SUPABASE_SERVICE_ROLE_KEY?.startsWith("sb_publishable_")) {
  issues.push("SUPABASE_SERVICE_ROLE_KEY appears to contain a publishable key.");
}

if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.startsWith("sb_secret_")) {
  issues.push("NEXT_PUBLIC_SUPABASE_ANON_KEY appears to contain a secret key.");
}

if (issues.length) {
  console.error("Deployment env check failed:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log("Deployment env check OK");
console.log("Required variables are present and no local-only PIN override is set.");
