export async function GET() {
  return Response.json({
    ok: true,
    service: "wc-ang-rebuild",
    timestamp: new Date().toISOString(),
  });
}
