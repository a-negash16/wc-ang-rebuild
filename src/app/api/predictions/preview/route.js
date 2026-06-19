import { getManagerPickPreview } from "@/data/league";
import { verifyManagerSessionToken } from "@/lib/auth/session";

export async function POST(request) {
  try {
    const body = await request.json();
    const token = String(body.token || "").trim();
    if (!token) {
      return jsonError("Session is required", 400);
    }

    const session = verifyManagerSessionToken(token);
    const picks = await getManagerPickPreview({
      groupSlug: session.group_slug,
      managerCode: session.manager_code,
    });

    return Response.json({ ok: true, picks });
  } catch (error) {
    return jsonError(error.message, 400);
  }
}

function jsonError(message, status) {
  return Response.json({ ok: false, message }, { status });
}
