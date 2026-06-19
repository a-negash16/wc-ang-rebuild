import { getPredictionPulseState } from "@/data/league";

export async function GET(_request, { params }) {
  try {
    const { group: groupSlug } = await params;
    const pulse = await getPredictionPulseState({ groupSlug });
    if (!pulse) {
      return Response.json({ ok: false, message: "Group not found" }, { status: 404 });
    }
    return Response.json({ ok: true, ...pulse });
  } catch (error) {
    return Response.json({ ok: false, message: error.message }, { status: 500 });
  }
}
