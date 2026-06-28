import { getMatchForPrediction, savePrediction } from "@/data/league";
import { verifyManagerSessionToken } from "@/lib/auth/session";
import { isPredictionLocked, validateLengthPickForMatch, validatePickForMatch } from "@/rules/predictions";

export async function POST(request) {
  try {
    const body = await request.json();
    const token = clean(body.token);
    const externalMatchId = clean(body.external_match_id);
    const pickType = clean(body.pick_type);
    const lengthPick = clean(body.length_pick);

    if (!token || !externalMatchId || (!pickType && !lengthPick)) {
      return jsonError("Session, match, and pick are required", 400);
    }

    const session = verifyManagerSessionToken(token);
    const match = await getMatchForPrediction({
      groupSlug: session.group_slug,
      externalMatchId,
    });

    if (!match) return jsonError("Match not found", 404);
    if (match.status === "finished" || match.status === "cancelled") {
      return jsonError("Match is not open for prediction", 400);
    }
    if (isPredictionLocked({
      kickoffAt: match.kickoff_at,
      lockMinutesBeforeKickoff: match.lock_minutes_before_kickoff,
    })) {
      return jsonError("Deadline passed", 400);
    }

    if (pickType) {
      const validation = validatePickForMatch({ pickType, match });
      if (!validation.ok) return jsonError(validation.message, 400);
    }

    if (lengthPick) {
      const lengthValidation = validateLengthPickForMatch({ lengthPick, match });
      if (!lengthValidation.ok) return jsonError(lengthValidation.message, 400);
    }

    const saved = await savePrediction({
      groupSlug: session.group_slug,
      managerCode: session.manager_code,
      externalMatchId,
      pickType,
      lengthPick,
    });

    return Response.json({
      ok: true,
      message: "Prediction saved",
      external_match_id: externalMatchId,
      pick_type: saved.pick_type || pickType,
      length_pick: saved.length_pick || lengthPick || null,
      saved_at: saved.saved_at,
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
