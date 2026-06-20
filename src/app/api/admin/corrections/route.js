import { applyCommissionerPredictionCorrection, getMatchForPrediction } from "@/data/league";
import { verifyManagerSessionToken } from "@/lib/auth/session";
import { validatePickForMatch } from "@/rules/predictions";

export async function POST(request) {
  try {
    const body = await request.json();
    const token = clean(body.token);
    const managerCode = clean(body.manager_code);
    const externalMatchId = clean(body.external_match_id);
    const pickType = clean(body.pick_type);
    const reason = clean(body.reason);

    if (!token || !managerCode || !externalMatchId || !pickType || !reason) {
      return jsonError("Session, manager, match, pick, and reason are required", 400);
    }

    const session = verifyManagerSessionToken(token);
    if (session.role !== "commissioner") {
      return jsonError("Commissioner access required", 403);
    }

    const match = await getMatchForPrediction({
      groupSlug: session.group_slug,
      externalMatchId,
    });
    if (!match) return jsonError("Match not found", 404);

    const validation = validatePickForMatch({ pickType, match });
    if (!validation.ok) return jsonError(validation.message, 400);

    const result = await applyCommissionerPredictionCorrection({
      groupSlug: session.group_slug,
      commissionerCode: session.manager_code,
      managerCode,
      externalMatchId,
      pickType,
      reason,
    });

    return Response.json({
      ok: true,
      changed: result.changed,
      saved_at: result.saved_at,
      manager: {
        manager_code: result.manager.manager_code,
        display_name: result.manager.display_name,
      },
      match: {
        external_match_id: result.match.external_match_id,
        stage: result.match.stage,
        team_a: result.match.team_a,
        team_b: result.match.team_b,
      },
      pick_label: result.pick_label,
    });
  } catch (error) {
    return jsonError(error.message, 400);
  }
}

function clean(value) {
  return String(value || "").trim();
}

function jsonError(message, status) {
  return Response.json({ ok: false, message }, { status });
}
