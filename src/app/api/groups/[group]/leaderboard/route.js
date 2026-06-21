import { getLeaderboardShell } from "@/data/league";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_request, { params }) {
  try {
    const { group: groupSlug } = await params;
    const leaderboard = await getLeaderboardShell({ groupSlug });
    if (!leaderboard) {
      return Response.json({ ok: false, message: "Group not found" }, { status: 404 });
    }
    return Response.json({ ok: true, ...leaderboard }, { headers: noStoreHeaders() });
  } catch (error) {
    return Response.json({ ok: false, message: error.message }, { status: 500, headers: noStoreHeaders() });
  }
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}
