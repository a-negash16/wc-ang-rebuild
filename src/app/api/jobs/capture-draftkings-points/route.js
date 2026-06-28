import { captureDraftKingsPoints } from "@/jobs/capture-draftkings-points";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const result = await captureDraftKingsPoints({
      writeMode: searchParams.get("dryRun") !== "1",
      includeAllUpcoming: searchParams.get("allUpcoming") === "1",
      updateExisting: searchParams.get("updateExisting") === "1",
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ ok: false, message: error.message }, { status: 500 });
  }
}
