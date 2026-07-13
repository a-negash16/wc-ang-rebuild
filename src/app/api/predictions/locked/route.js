import { saveLockedFuturePicks } from "@/data/league";
import { verifyManagerSessionToken } from "@/lib/auth/session";
import { LOCKED_FUTURE_STAGE } from "@/rules/future-picks";

export async function POST(request) {
  try {
    const body = await request.json();
    const token = String(body.token || "").trim();
    const selections = body.selections || {};
    const stage = String(body.stage || LOCKED_FUTURE_STAGE).trim() || LOCKED_FUTURE_STAGE;

    if (!token) return jsonError("Session is required", 400);

    const session = verifyManagerSessionToken(token);
    const state = await saveLockedFuturePicks({
      groupSlug: session.group_slug,
      managerCode: session.manager_code,
      selections,
      stage,
    });

    return Response.json({
      ok: true,
      message: "Locked picks saved",
      locked_picks: state,
    });
  } catch (error) {
    return jsonError(error.message, 400);
  }
}

function jsonError(message, status) {
  return Response.json({ ok: false, message }, { status });
}
