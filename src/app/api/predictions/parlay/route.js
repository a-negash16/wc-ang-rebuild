import { saveParlaySlip } from "@/data/league";
import { verifyManagerSessionToken } from "@/lib/auth/session";

export async function POST(request) {
  try {
    const body = await request.json();
    const token = String(body.token || "").trim();
    const externalMatchId = String(body.external_match_id || "").trim();
    const selections = body.selections || {};

    if (!token || !externalMatchId) return jsonError("Session and parlay match are required", 400);

    const session = verifyManagerSessionToken(token);
    const state = await saveParlaySlip({
      groupSlug: session.group_slug,
      managerCode: session.manager_code,
      externalMatchId,
      selections,
    });

    return Response.json({
      ok: true,
      message: "Parlay slip saved",
      parlay_slips: state,
    });
  } catch (error) {
    return jsonError(error.message, 400);
  }
}

function jsonError(message, status) {
  return Response.json({ ok: false, message }, { status });
}
