import { getCommissionerAuditLog } from "@/data/league";
import { verifyManagerSessionToken } from "@/lib/auth/session";

export async function POST(request) {
  try {
    const body = await request.json();
    const token = clean(body.token);
    if (!token) return jsonError("Commissioner session is required", 400);

    const session = verifyManagerSessionToken(token);
    if (session.role !== "commissioner") {
      return jsonError("Commissioner access required", 403);
    }

    const log = await getCommissionerAuditLog({
      groupSlug: session.group_slug,
      limit: 30,
    });
    if (!log) return jsonError("Group not found", 404);

    return Response.json({
      ok: true,
      group: log.group,
      audit: log.audit,
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
