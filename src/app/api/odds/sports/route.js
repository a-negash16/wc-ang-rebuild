import { createOddsApiClientFromEnv } from "@/integrations/odds-api";

export async function GET() {
  try {
    const client = createOddsApiClientFromEnv();
    const result = await client.getSports();
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { ok: false, message: error.message },
      { status: error.message.includes("ODDS_API_KEY") ? 500 : 502 }
    );
  }
}
