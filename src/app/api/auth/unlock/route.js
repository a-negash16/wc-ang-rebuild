import { findManagerForUnlock } from "@/data/league";
import { createManagerSessionToken } from "@/lib/auth/session";
import { verifyPin } from "@/lib/auth/pin";

export async function POST(request) {
  try {
    const body = await request.json();
    const groupSlug = clean(body.group_slug);
    const managerCode = clean(body.manager_code);
    const pin = String(body.pin || "");

    if (!groupSlug || !managerCode || !pin) {
      return jsonError("Group, manager, and PIN are required", 400);
    }

    const manager = await findManagerForUnlock({ groupSlug, managerCode });
    if (!manager) {
      return jsonError("Manager not found", 404);
    }

    const pinOk = verifyPin(pin, manager.pin_hash) || verifyDevPin(pin, manager.pin_hash);
    if (!pinOk) {
      return jsonError("Invalid PIN", 401);
    }

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

function jsonError(message, status) {
  return Response.json({ ok: false, message }, { status });
}
