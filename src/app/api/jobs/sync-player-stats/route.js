import { syncPlayerStats } from "@/jobs/sync-player-stats";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const since = searchParams.get("since");
    const result = await syncPlayerStats({
      writeMode: searchParams.get("dryRun") !== "1",
      ...(since ? { sinceKickoffAt: since } : {}),
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ ok: false, message: error.message }, { status: 500 });
  }
}
