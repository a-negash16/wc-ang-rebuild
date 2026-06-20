import { findManagerForUnlock } from "@/data/league";
import { createManagerSessionToken } from "@/lib/auth/session";
import { verifyPin } from "@/lib/auth/pin";

const MAX_UNLOCK_ATTEMPTS = 8;
const UNLOCK_WINDOW_MS = 15 * 60 * 1000;
const UNLOCK_LOCK_MS = 15 * 60 * 1000;
const unlockAttempts = new Map();

export async function POST(request) {
  try {
    const body = await request.json();
    const groupSlug = clean(body.group_slug);
    const managerCode = clean(body.manager_code);
    const pin = String(body.pin || "");

    if (!groupSlug || !managerCode || !pin) {
      return jsonError("Group, manager, and PIN are required", 400);
    }

    const attemptKey = getAttemptKey({ request, groupSlug, managerCode });
    if (isUnlockLimited(attemptKey)) {
      return jsonError("Too many unlock attempts. Try again later.", 429);
    }

    const manager = await findManagerForUnlock({ groupSlug, managerCode });
    if (!manager) {
      recordUnlockFailure(attemptKey);
      return jsonError("Invalid manager or PIN", 401);
    }

    const pinOk = verifyPin(pin, manager.pin_hash) || verifyDevPin(pin, manager.pin_hash);
    if (!pinOk) {
      recordUnlockFailure(attemptKey);
      return jsonError("Invalid manager or PIN", 401);
    }
    clearUnlockFailures(attemptKey);

    const session = createManagerSessionToken({
      groupSlug,
      managerCode: manager.manager_code,
      managerName: manager.display_name,
      role: manager.role,
    });

    return Response.json({
      ok: true,
      token: session.token,
      expires_at: session.expires_at,
      manager_code: manager.manager_code,
      manager_name: manager.display_name,
      group_slug: groupSlug,
    });
  } catch (error) {
    return jsonError(error.message, 500);
  }
}

function verifyDevPin(pin, pinHash) {
  const devPin = process.env.DEV_MANAGER_PIN;
  if (!devPin || pinHash !== "SET_BY_COMMISSIONER") return false;
  if (process.env.NODE_ENV === "production") return false;
  return pin === devPin;
}

function clean(value) {
  return String(value || "").trim();
}

function getAttemptKey({ request, groupSlug, managerCode }) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const ip = forwardedFor.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  return [
    ip,
    groupSlug.toLowerCase(),
    managerCode.toLowerCase(),
  ].join(":");
}

function isUnlockLimited(key) {
  const attempt = unlockAttempts.get(key);
  if (!attempt) return false;
  if (attempt.locked_until > Date.now()) return true;
  if (attempt.reset_at <= Date.now()) {
    unlockAttempts.delete(key);
    return false;
  }
  return false;
}

function recordUnlockFailure(key) {
  const now = Date.now();
  const current = unlockAttempts.get(key);
  const attempt = current && current.reset_at > now
    ? current
    : { count: 0, reset_at: now + UNLOCK_WINDOW_MS, locked_until: 0 };

  attempt.count += 1;
  if (attempt.count >= MAX_UNLOCK_ATTEMPTS) {
    attempt.locked_until = now + UNLOCK_LOCK_MS;
  }
  unlockAttempts.set(key, attempt);
}

function clearUnlockFailures(key) {
  unlockAttempts.delete(key);
}

function jsonError(message, status) {
  return Response.json({ ok: false, message }, { status });
}
