import { getLeaderboardShell } from "@/data/league";

export async function GET(_request, { params }) {
  try {
    const { group: groupSlug } = await params;
    const leaderboard = await getLeaderboardShell({ groupSlug });
    if (!leaderboard) {
      return Response.json({ ok: false, message: "Group not found" }, { status: 404 });
    }
    return Response.json({ ok: true, ...leaderboard });
  } catch (error) {
    return Response.json({ ok: false, message: error.message }, { status: 500 });
  }
}
