import { saveGroupComment } from "@/data/league";
import { verifyManagerSessionToken } from "@/lib/auth/session";

export async function POST(request) {
  try {
    const body = await request.json();
    const token = String(body.token || "").trim();
    const comment = String(body.comment || "").trim();
    if (!token || !comment) return jsonError("Session and comment are required", 400);

    const session = verifyManagerSessionToken(token);
    const saved = await saveGroupComment({
      groupSlug: session.group_slug,
      managerCode: session.manager_code,
      body: comment,
    });

    return Response.json({ ok: true, comment: saved });
  } catch (error) {
    return jsonError(error.message, 400);
  }
}

function jsonError(message, status) {
  return Response.json({ ok: false, message }, { status });
}
